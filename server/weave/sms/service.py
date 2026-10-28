"""Inbound SMS handling: identity, rate limits, commands and conversation routing.

Runs inside the webhook request, so it only reads/writes SQLite and enqueues work; it never calls Gemini,
Gradle or the SMS provider. Replies go to the outbox, which the worker sends."""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from dataclasses import dataclass

from ..config import Settings
from ..core.jobs import JobStore
from . import messages as M
from .observe import event
from .phone import mask, normalize_e164
from .intent import (answer_kind, answer_reply, classify, other_kind_requested, substance,
                     target_kind)
from .language import CONFIRM, language_label, needs_translation, requested_language, script_language
from .store import SmsStore

MIN_PROMPT, MAX_PROMPT = 10, 4000
LINK_MAX_FAILURES, LINK_LOCK_S = 5, 3600
UNKNOWN_REPLY_EVERY_S = 86_400
ONBOARD_REMINDER_S = 120
# Twilio's default Advanced Opt-Out keywords (whole-message match). Twilio blocks further sends itself;
# Weave records the state and never replies. CANCEL is one of them, so builds are stopped with ABORT.
OPT_OUT = {"STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"}
# WhatsApp has no carrier opt-out keywords; STOP still opts out of Weave messages there. The web chat has none.
OPT_OUT_BY_CHANNEL = {"sms": OPT_OUT, "whatsapp": {"STOP", "STOPALL", "UNSUBSCRIBE"}, "web": set()}
OPT_IN = {"START", "UNSTOP", "YES"}
WEB_ADDRESS_RE = re.compile(r"^web:[0-9a-f]{32}$")
NEW_INTENT = re.compile(
    r"\b(?:build|create|make|generate|design|develop|start)\s+(?:me\s+|us\s+)?(?:a|an|another|one)\s+"
    r"(?:\w+\s+){0,5}?(?:app|application|tracker|calculator|planner|journal|timer|counter|game|manager|"
    r"organi[sz]er|flashcards?|quiz|to-?do list)\b"
    r"|\b(?:new|another|second|separate|different)\s+app\b", re.I)
STYLES = {"1": "clean and minimal", "2": "bold and colourful", "3": "dark and premium", "4": "warm and cosy"}
STYLE_QUESTION = ("Quick question before I design it. Which style do you like?\n"
                  "1. Clean and minimal\n2. Bold and colourful\n3. Dark and premium\n4. Warm and cosy\n"
                  "Reply with a number and anything else you want (colours, fonts, sites you like), "
                  "e.g. \"3, gold accents\". Or say \"skip\" and I'll choose.")
STYLE_SKIP = re.compile(r"^(skip|no|nah|nope|none|any|anything|whatever|idk|go|go ahead|just build( it)?|"
                        r"you (choose|pick|decide)|surprise me|up to you|doesn'?t matter|no preference)[.! ]*$", re.I)
STYLE_STOP = re.compile(r"^(cancel|stop|abort|never ?mind|forget it)[.! ]*$", re.I)
# A request that already describes the look doesn't need the style question.
STYLE_WORDS = re.compile(r"\b(colou?rs?|dark|light|minimal\w*|vintage|retro|pastel|neon|palette|fonts?|themes?|"
                         r"aesthetic|style[ds]?|black|white|blue|red|green|pink|purple|gold(en)?|orange|yellow|beige|"
                         r"brown|navy|teal|cream|monochrome|brutalist|glass\w*)\b", re.I)
REF_RE = re.compile(r"^G-[2-9A-HJ-NP-TV-Z]{5}$", re.I)
ASKS_SALES = re.compile(r"\b(?:sales?|revenue|profit|loss|takings|earning|income|turnover|money|business)\b", re.I)
NEVER_BUILDS = {"greeting", "thanks", "help", "status", "projects", "download", "cancel", "publish", "analytics"}


@dataclass
class Inbound:
    from_: str
    to: str
    body: str
    sid: str
    account_sid: str = ""
    num_media: int = 0
    heard: bool = False  # body is the transcript of a voice note


class SmsService:
    def __init__(self, settings: Settings, store: SmsStore, builds: JobStore):
        self.s = settings
        self.store = store
        self.builds = builds
        self._req = threading.local()  # per-request: our number the inbound message was sent to
        self.brain = None  # ChatBrain when plain-language chat runs through the AI backend
        self.web = None  # weave.web.builder.WebsiteBuilder; None = no website builder in this process
        self.nlg = None  # weave.sms.nlg.NlgPresenter; presents verified facts naturally
        self.translator = None  # weave.sms.translate.Translator; puts messages into each person's language
        self.owners = {n for n in (normalize_e164(x, settings.sms_default_country_code) for x in settings.sms_owner_numbers) if n}

    def _present(self, kind: str, facts: dict, fallback: str, user_query: str = "") -> str:
        if self.nlg is not None:
            try:
                return self.nlg.present(kind, facts, fallback, user_query=user_query)
            except Exception as e:
                log.info("NLG presentation failed for kind=%s: %s", kind, e)
        return fallback

    # ---------- entry point ----------
    def handle(self, msg: Inbound) -> str:
        """Process one inbound SMS. Returns an outcome label (for logs and tests)."""
        self._req.to = None
        self._req.heard = (msg.body or "").strip() if msg.heard else None
        channel = channel_of(msg.from_)
        if channel == "web":
            # Web chat identities are created by the authenticated chat API, never from a phone number.
            phone = msg.from_ if WEB_ADDRESS_RE.fullmatch(msg.from_ or "") else None
        else:
            phone = normalize_e164(msg.from_, self.s.sms_default_country_code)
        if not phone:
            event("sms.inbound_rejected", logging.WARNING, reason="invalid_sender", sid=msg.sid)
            return "invalid_sender"
        body = (msg.body or "").strip()[:1600]
        user = self.store.get_user(phone)
        if phone in self.owners:
            if user is None:
                user = self.store.create_user(phone, "owner", channel)
                event("sms.user_created", role="owner", phone=mask(phone), channel=channel)
            elif user["role"] != "owner":
                self.store.update_user(user["id"], role="owner")
        our_number = normalize_e164(msg.to) if channel != "web" else None
        if user is not None and channel != "web" and (user["channel"] != channel or
                                                      (our_number and user["reply_from"] != our_number)):
            # Reply on the channel and from the number the user last wrote to.
            self.store.update_user(user["id"], channel=channel, reply_from=our_number or user["reply_from"])
            user = self.store.get_user(phone)
        self._req.to = our_number
        if not self.store.record_inbound(phone, body, msg.sid, user["id"] if user else None):
            event("sms.duplicate", sid=msg.sid, phone=mask(phone))
            return "duplicate"
        event("sms.inbound", sid=msg.sid, phone=mask(phone), channel=channel, chars=len(body),
              media=msg.num_media or None, known=bool(user))

        count = self.store.inbound_count(phone, time.time() - 3600)
        if count > self.s.sms_inbound_per_hour:
            event("sms.rate_limited", logging.WARNING, phone=mask(phone), count=count)
            if count == self.s.sms_inbound_per_hour + 1 and user and user["status"] == "active":
                self._reply(phone, user, "You're sending messages too quickly. Please wait a while and try again.")
            return "rate_limited"

        word, rest = _split(body)
        if body.upper() in OPT_OUT_BY_CHANNEL[channel]:
            if user:
                self.store.update_user(user["id"], status="opted_out")
            event("sms.opted_out", phone=mask(phone))
            return "opted_out"
        if body.upper() in OPT_IN and user and user["status"] == "opted_out":
            self.store.update_user(user["id"], status="active")
            self._reply(phone, user, "Welcome back. Text HELP for commands.")
            return "opted_in"

        if user is None:
            if channel == "web":
                return "unauthorized"
            return self._unknown(phone, channel, word, rest, body, msg.sid)
        if user["status"] != "active":
            event("sms.ignored", phone=mask(phone), status=user["status"])
            return "ignored"
        self.store.set_inbound_user(msg.sid, user["id"])
        if word in ("LINK", "JOIN") and rest and " " not in rest.strip():
            linked = self._link_account(phone, channel, rest, msg.sid, user)
            if linked is not None:
                return linked
        if self.s.sms_signup == "account" and user["role"] != "owner" and not user.get("account_id"):
            return self._onboard(phone, channel, body)
        if user.get("account_id") and user["role"] != "owner" and self.store.account_for_user(user["id"]) is None:
            event("sms.account_inactive", phone=mask(phone))
            return "account_inactive"  # suspended after an abuse report, or deleted
        if body == "[voice note]":
            self._reply(phone, user, "I couldn't hear any audio with that voice note. Describe your app in words, or send a voice note.")
            return "voice_note"
        if body.startswith("[") and body.endswith("]"):
            self._reply(phone, user, "I received your message, but I only support text messages right now. Please describe your app or website in words.")
            return "unsupported"
        if msg.num_media and not body:
            self._reply(phone, user, "I can only read text and voice notes. Describe your app in words, or send a voice note.")
            return "media_only"
        return self._dispatch(user, word, rest, body, msg.sid)

    # ---------- unknown senders ----------
    def _unknown(self, phone: str, channel: str, word: str, rest: str, body: str, sid: str) -> str:
        info = self.store.unknown_sender(phone)
        reply_to = address(phone, channel)
        now = time.time()
        if word in ("LINK", "JOIN") and rest and info["locked_until"] <= now:
            linked = self._link_account(phone, channel, rest, sid)
            if linked is not None:
                return linked
        if re.fullmatch(r"[A-Za-z0-9]{6}", body) and info["locked_until"] <= now:
            # The dashboard code sent on its own, without LINK in front.
            linked = self._link_account(phone, channel, body, sid)
            if linked is not None:
                return linked
        if self.s.sms_signup == "account" and not (word in ("LINK", "JOIN") and rest):
            return self._onboard(phone, channel, body)
        if word in ("LINK", "JOIN") and self.s.sms_signup in ("link", "open", "account"):
            if info["locked_until"] > now:
                event("sms.link_locked", logging.WARNING, phone=mask(phone))
                return "link_locked"
            user = self.store.consume_link_code(rest, phone, channel)
            if user is None and self.s.sms_referrals and self.s.sms_signup != "account":
                referred = self.store.consume_referral_code(rest, phone, channel, "guest", self.s.sms_referral_bonus,
                                                            self.s.sms_referral_max)
                if referred is not None:
                    self.store.update_unknown_sender(phone, link_failures=0, locked_until=0)
                    return self._referred(referred[0], referred[1], sid)
            if user is None:
                failures = info["link_failures"] + 1
                self.store.update_unknown_sender(phone, link_failures=failures,
                                                 locked_until=now + LINK_LOCK_S if failures >= LINK_MAX_FAILURES else 0)
                event("sms.link_failed", logging.WARNING, phone=mask(phone), failures=failures)
                fallback = ("That code is invalid or expired. Get a new one from your Weave dashboard: "
                            f"{self.s.public_base_url}/dashboard" if self.s.sms_signup == "account" else
                            "That link code is invalid or expired. Ask the Weave owner for a new one.")
                self._send(reply_to, None, self._present("link_failed", {"action": "link"}, fallback, user_query=f"{word} {rest}"))
                return "link_failed"
            self.store.update_unknown_sender(phone, link_failures=0, locked_until=0)
            self.store.set_inbound_user(sid, user["id"])
            user = self._remember_reply_from(user)
            event("sms.user_linked", role=user["role"], phone=mask(phone))
            fallback = ("Your number is linked. Text an app idea to start, e.g. "
                        "\"Build me a habit tracker with streaks\". Text HELP for commands.")
            self._reply(phone, user, self._present("user_linked", {"role": user["role"]}, fallback, user_query=f"{word} {rest}"))
            return "linked"
        if self.s.sms_signup == "open":
            user = self.store.create_user(phone, "guest", channel)
            self.store.set_inbound_user(sid, user["id"])
            user = self._remember_reply_from(user)
            event("sms.user_created", role="guest", phone=mask(phone))
            if word in ("HELP", "INFO", "HI", "HELLO", "") or len(body) < MIN_PROMPT:
                self._reply(phone, user, "Welcome! Describe an Android app and I'll build it. " + M.HELP)
                return "welcomed"
            return self._dispatch(user, word, rest, body, sid)
        event("sms.unauthorized", logging.WARNING, phone=mask(phone))
        if now - info["last_reply_at"] > UNKNOWN_REPLY_EVERY_S:
            self.store.update_unknown_sender(phone, last_reply_at=now)
            text = ("This number isn't linked to Weave yet. Ask the owner for a link code (or a friend for an invite code), then text LINK <code>."
                    if self.s.sms_signup == "link" else "This number isn't authorized to use Weave.")
            self._send(reply_to, None, self._present("unauthorized", {"signup": self.s.sms_signup}, text, user_query=body))
        return "unauthorized"

    def _referred(self, user: dict, referrer: dict, sid: str) -> str:
        self.store.set_inbound_user(sid, user["id"])
        user = self._remember_reply_from(user)
        event("sms.user_referred", phone=mask(user["phone"]), referrer=mask(referrer["phone"]))
        self._reply(user["phone"], user, "Welcome to Weave! You joined with a friend's invite. Describe an app or "
                    "website and I'll build it. Text INVITE to get your own code.")
        if self.s.sms_referral_bonus:
            self._reply(referrer["phone"], referrer, f"A friend just joined Weave with your invite code. You earned "
                        f"{self.s.sms_referral_bonus} extra builds per day.")
        return "referred"

    def _onboard(self, phone: str, channel: str, body: str) -> str:
        """Account mode: numbers without a Weave account get the sign-up link (at most once a day)."""
        info = self.store.unknown_sender(phone)
        now = time.time()
        event("sms.onboarding", phone=mask(phone))
        if now - info["last_reply_at"] > UNKNOWN_REPLY_EVERY_S or body.upper() in ("HI", "HELLO", "HEY", "START", "HELP"):
            self.store.update_unknown_sender(phone, last_reply_at=now)
            self._send(address(phone, channel), None,
                       f"Hi! I'm Weave. I build apps and websites from a text. To start, create your free account "
                       f"(takes a minute): {self.s.public_base_url}/start\nThen text me the code it gives you.")
        elif now - info["last_reply_at"] > ONBOARD_REMINDER_S:
            # Never leave someone talking to silence; a short nudge at most every couple of minutes.
            self.store.update_unknown_sender(phone, last_reply_at=now)
            self._send(address(phone, channel), None,
                       f"I'm here! Finish signing up at {self.s.public_base_url}/start, then send me the 6-letter "
                       "code from your dashboard.")
        return "onboarding"

    def _link_account(self, phone: str, channel: str, rest: str, sid: str, user: dict | None = None) -> str | None:
        """LINK <code> with a code from the dashboard: proves this number belongs to the account. None if the code
        isn't a phone code (it may still be an owner link code or an invite code)."""
        outcome, linked, account = self.store.link_phone(rest, phone, channel)
        if outcome == "invalid":
            return None
        if outcome == "taken":
            event("sms.link_taken", logging.WARNING, phone=mask(phone))
            self._send(address(phone, channel), None, "This number is already linked to a different Weave account. "
                       "Use the number already on your account, or sign in to that account instead.")
            return "link_taken"
        self.store.update_unknown_sender(phone, link_failures=0, locked_until=0)
        self.store.set_inbound_user(sid, linked["id"])
        linked = self._remember_reply_from(linked)
        event("sms.account_linked", outcome=outcome, phone=mask(phone), account=account["id"])
        name = account.get("call_sign") or account["username"]
        if outcome == "relinked":
            text = f"Done, {name}. Weave now uses this number for your account. Your projects came with you."
        else:
            text = (f"You're in, {name}! Your Weave address is {account['username']}.{self.s.sites_domain or 'askweave.xyz'}"
                    f"\nDescribe an app or website and I'll build it, like \"a website for my bakery\". Text HELP for commands.")
            if outcome == "created" and account.get("referral_code") and self.s.sms_referrals:
                referrer = self.store.credit_referral(linked["id"], account["referral_code"], self.s.sms_referral_bonus,
                                                      self.s.sms_referral_max)
                if referrer is not None and self.s.sms_referral_bonus:
                    self._reply(referrer["phone"], referrer, f"A friend just joined Weave with your invite code. You earned "
                                f"{self.s.sms_referral_bonus} extra builds per day.")
        self._reply(phone, linked, text)
        return "account_" + outcome

    def _call_sign(self, user: dict) -> str:
        account = self.store.account_for_user(user["id"]) if user.get("account_id") else None
        return (account.get("call_sign") or "") if account else ""

    def _rename_me(self, user: dict, raw: str) -> str:
        from ..site.names import clean_call_sign

        account = self.store.account_for_user(user["id"]) if user.get("account_id") else None
        if account is None:
            self._reply(user["phone"], user, f"Create a Weave account to set your name: {self.s.public_base_url}/start")
            return "call_sign_none"
        name = clean_call_sign(raw.strip().strip(".!\"'"))
        if not name:
            self._reply(user["phone"], user, "I can't use that name. Try something shorter, without links.")
            return "call_sign_bad"
        self.store.update_account(account["id"], call_sign=name)
        self._reply(user["phone"], user, f"Got it, I'll call you {name}.")
        return "call_sign"

    def _moderate(self, user: dict, word: str, target: str) -> str:
        """Owner-only abuse handling: REPORTS lists open reports; TAKEDOWN <username>[/<project>] takes a whole
        account's sites (suspends it) or one project offline; REINSTATE <username> lifts a suspension."""
        if word == "REPORTS":
            items = self.store.reports()[:10]
            lines = [f"#{r['id']} {r['reason']}: {r['site']}" for r in items] or ["No open reports."]
            self._reply(user["phone"], user, "\n".join(lines))
            return "reports"
        username, _, slug = target.partition("/")
        account = self.store.account_by("username", username) if username else None
        if account is None:
            self._reply(user["phone"], user, f"No account called {username or '(none)'}. Use TAKEDOWN <username>[/<project>].")
            return "moderate_none"
        if word == "REINSTATE":
            self.store.update_account(account["id"], status="active")
            self._reply(user["phone"], user, f"{username} is reinstated.")
            return "reinstated"
        member = self.store.account_user(account["id"])
        if slug:
            project = self.store.project_by_slug(member["id"], slug) if member else None
            if project is None:
                self._reply(user["phone"], user, f"{username} has no live project at /{slug}/.")
                return "moderate_none"
            self.delete_project(member, project)
            self._reply(user["phone"], user, f"Took down {username}/{slug}.")
        else:
            self.store.update_account(account["id"], status="suspended")
            self.store.delete_account_sessions(account_id=account["id"])
            self._reply(user["phone"], user, f"Suspended {username}: all their sites are offline and they can't sign in. "
                        f"REINSTATE {username} to undo.")
        for r in self.store.reports():
            if f"{username}." in r["site"]:
                self.store.close_report(r["id"], "actioned")
        event("sms.takedown", target=target)
        return "takedown"

    def _delete_request(self, user: dict, project: dict | None) -> str:
        if project is None:
            return self._clarify(user, "Which project should I delete? Say DELETE and its number.")
        self.store.update_user(user["id"], pending_text=str(project["id"]), pending_question="delete")
        where = " Its website goes offline." if project.get("deploy_url") else ""
        self._reply(user["phone"], user, f"Delete {project['number']} {M.name_of(project)}?{where} You can restore it from "
                    f"your dashboard for {self.s.trash_days} days. Reply YES to delete, or anything else to keep it.")
        return "delete_confirm"

    def _resolve_delete(self, user: dict, body: str) -> str | None:
        project_id = int(user["pending_text"]) if str(user["pending_text"]).isdigit() else None
        self.store.update_user(user["id"], pending_text=None, pending_question=None)
        if not re.fullmatch(r"(yes|y|yeah|yep|confirm|delete( it)?|do it)[.! ]*", body.strip(), re.I):
            if re.fullmatch(r"(no|n|nope|nah|keep( it)?|cancel|never ?mind|stop)[.! ]*", body.strip(), re.I):
                self._reply(user["phone"], user, "Okay, I kept it.")
                return "delete_kept"
            return None  # something else entirely: handle it normally
        project = self.store.project(user["id"], project_id)
        if project is None or project.get("deleted_at"):
            self._reply(user["phone"], user, "That project is already gone.")
            return "delete_none"
        self.delete_project(user, project)
        self._reply(user["phone"], user, f"Deleted {M.name_of(project)}. Restore it from your dashboard within "
                    f"{self.s.trash_days} days if you change your mind.")
        return "deleted"

    def delete_project(self, user: dict, project: dict) -> None:
        """Soft delete: the project leaves every list and its site goes offline into the trash, restorable for
        trash_days days. A running build for it is cancelled."""
        from ..web.hosting import move_to_trash

        job = self.store.active_job(user["id"])
        if job and job["project_id"] == project["id"]:
            self.store.request_cancel(job["id"])
        trash_name = None
        account = self.store.account_for_user(user["id"]) if user.get("account_id") else None
        if account and project.get("slug"):
            trash_name = move_to_trash(self.s.user_sites_dir / account["username"], self.s.trash_dir,
                                       account["username"], project["slug"])
        self.store.update_project(project["id"], deleted_at=time.time(), trash_name=trash_name)
        if user.get("active_project_id") == project["id"]:
            self.store.update_user(user["id"], active_project_id=None)
        event("sms.project_deleted", phone=mask(user["phone"]), project=project["id"])

    def rename_project(self, user: dict, project: dict, name: str) -> str | None:
        """Rename a project. A live website moves with it: <username>.<domain>/<old-slug>/ becomes /<new-slug>/.
        Returns the project's address after the rename (None when it isn't live)."""
        from ..web.hosting import move_project, project_slug, project_url

        name = " ".join(name.split())[:60]
        if not name or "<" in name or ">" in name:
            raise ValueError("Enter a name.")
        changes: dict = {"name": name}
        account = self.store.account_for_user(user["id"]) if user.get("account_id") else None
        old = project.get("slug")
        if account and old and self.s.sites_domain:
            user_root = self.s.user_sites_dir / account["username"]
            new = project_slug(name, lambda x: x != old and (self.store.slug_taken(user["id"], x, project["id"])
                                                             or (user_root / x).exists()))
            if new != old and (move_project(user_root, old, new) or not (user_root / old).exists()):
                changes.update(slug=new, deploy_site_id=f"{account['username']}/{new}",
                               deploy_url=project_url(account["username"], new, self.s.sites_domain)
                               if project.get("deploy_url") else None)
                event("sms.project_moved", project=project["id"], old=old, new=new)
        self.store.update_project(project["id"], **changes)
        return changes.get("deploy_url", project.get("deploy_url"))

    def restore_project(self, user: dict, project: dict) -> bool:
        from ..web.hosting import restore_from_trash

        account = self.store.account_for_user(user["id"]) if user.get("account_id") else None
        if not project.get("deleted_at"):
            return False
        if account and project.get("trash_name") and project.get("slug"):
            if not restore_from_trash(self.s.user_sites_dir / account["username"], self.s.trash_dir,
                                      account["username"], project["trash_name"], project["slug"]):
                return False
        self.store.update_project(project["id"], deleted_at=None, trash_name=None)
        event("sms.project_restored", phone=mask(user["phone"]), project=project["id"])
        return True

    def _invite(self, user: dict) -> str:
        if not self.s.sms_referrals or self.s.sms_signup == "closed":
            self._reply(user["phone"], user, "Invites aren't available right now.")
            return "invite_off"
        code = self.store.referral_code(user["id"])
        left = max(0, self.s.sms_referral_max - self.store.referral_count(user["id"]))
        text = (f"Your invite code: {code}\nFriends sign up at {self.s.public_base_url}/start and enter it."
                if self.s.sms_signup == "account" else
                f"Your invite code: {code}\nFriends text JOIN {code} to this number to start building.")
        if self.s.sms_referral_bonus:
            text += f" You get {self.s.sms_referral_bonus} extra builds per day for each friend who joins."
        text += f" ({left} invites left)"
        self._reply(user["phone"], user, text)
        return "invite"

    # ---------- commands and plain English ----------
    def _dispatch(self, user: dict, word: str, rest: str, body: str, sid: str) -> str:
        if (lang := requested_language(body)) is not None:
            # "speak telugu", "hindi me baat karo": switch now, answered instantly in the new language.
            code = None if lang == "en" else lang
            self.store.update_user(user["id"], language=code)
            event("sms.language", phone=mask(user["phone"]), language=lang)
            self._reply(user["phone"], self.store.user_by_id(user["id"]), CONFIRM[lang], localized=True)
            return "language"
        if (seen := script_language(body)) is not None and (user.get("language") or "").split("-")[0] != seen:
            # Writing in Telugu/Kannada/Tamil/Hindi script switches replies to that language.
            self.store.update_user(user["id"], language=seen)
            event("sms.language", phone=mask(user["phone"]), language=seen, detected=True)
            user = self.store.user_by_id(user["id"])
        question = user.get("pending_question")
        if question == "publish" and user.get("pending_text"):
            handled = self._resolve_publish(user, body, sid)
            if handled is not None:
                return handled
            user = self.store.user_by_id(user["id"])
        elif question == "style" and user.get("pending_text"):
            return self._resolve_style(user, body, sid)
        elif question == "what" and user.get("pending_text"):
            # Answer to "What's the website for?": "fitness" becomes "fitness website".
            self.store.update_user(user["id"], pending_text=None, pending_question=None)
            if self._command(user, word, rest, sid) is None and classify(
                    body, has_projects=False, has_active=False).kind not in NEVER_BUILDS:
                idea = body if target_kind(body) else f"{body} {user['pending_text']}"
                if len(idea) >= MIN_PROMPT:
                    return self._start_new(user, idea, sid, kind=target_kind(idea))
            else:
                return "handled"
            user = self.store.user_by_id(user["id"])
        elif question == "delete" and user.get("pending_text"):
            handled = self._resolve_delete(user, body)
            if handled is not None:
                return handled
            user = self.store.user_by_id(user["id"])
        elif question == "kind" and user.get("pending_text"):
            handled = self._resolve_kind(user, body, sid)
            if handled is not None:
                return handled
            user = self.store.user_by_id(user["id"])
        if user.get("pending_text") and answer_reply(body) is not None:
            # "new" / "change" / "no" answers the question we just asked; it is not the NEW command.
            return self._resolve_pending(user, body, sid)
        command = self._command(user, word, rest, sid)
        if command is not None:
            if user.get("pending_text"):
                self.store.update_user(user["id"], pending_text=None)
            return command
        if self.brain is not None:
            # Everything that isn't an exact command is a conversation: the AI answers it, with the full context.
            if user.get("pending_text"):
                self.store.update_user(user["id"], pending_text=None)
            to, heard = getattr(self._req, "to", None), getattr(self._req, "heard", None)
            self.brain.submit(lambda: self._think(user["id"], body, sid, to, heard), key=user["id"])
            return "thinking"
        if user.get("pending_text"):
            resolved = self._resolve_pending(user, body, sid)
            if resolved is not None:
                return resolved
            user = self.store.user_by_id(user["id"])
        return self._plain(user, body, sid)

    # ---------- chat brain ----------
    def _think(self, user_id: int, body: str, sid: str, to: str | None, heard: str | None) -> str:
        self._req.to, self._req.heard = to, heard
        user = self.store.user_by_id(user_id)
        if user is None:
            return "gone"
        try:
            decision = self.brain.decide(self._chat_context(user, body))
        except Exception as e:  # noqa: BLE001 - said honestly; no scripted guess at what they meant
            event("sms.brain_failed", logging.WARNING, error=type(e).__name__, detail=str(e)[:200])
            self._reply(user["phone"], user, "Sorry, I couldn't think that through just now (the AI is busy). "
                                             "Please send it again in a minute.")
            return "brain_failed"
        event("sms.brain", action=decision.action, phone=mask(user["phone"]))
        try:
            return self._apply(user, decision, body, sid)
        except Exception:  # noqa: BLE001
            logging.getLogger("weave.sms").exception("applying chat decision failed")
            self._reply(user["phone"], user, "Sorry, something went wrong on my side. Could you say that again?")
            return "brain_error"

    def _chat_context(self, user: dict, body: str) -> str:
        problem = self.website_problem()
        name = self._call_sign(user)
        account = self.store.account_for_user(user["id"]) if user.get("account_id") else None
        lines = [f"Their name: {name or 'unknown (they have not told you)'}"
                 + (f" (Weave username {account['username']}, address {account['username']}.{self.s.sites_domain})"
                    if account and self.s.sites_domain else ""),
                 f"Reply language (default when their style is unclear): {language_label(user.get('language'))}",
                 f"Channel: {user['channel']}",
                 "Website builder: " + ("available" if not problem else f"NOT available ({problem})"),
                 "Websites go live: " + (f"automatically at https://{account['username']}.{self.s.sites_domain}/<project>/"
                                         if account and self.s.website_deploy == "weave" and self.s.sites_domain else
                                         "only as private preview links"),
                 "", "Their projects (newest first):"]
        projects = self.store.projects(user["id"], limit=15)
        for p in projects:
            last = self.store.latest_job(user["id"], p["id"])
            state = last["status"] if last else "no builds yet"
            if p["last_success_build_id"] and state != "succeeded":
                state += " (an earlier version is ready)"
            active = " [ACTIVE]" if p["id"] == user["active_project_id"] else ""
            kind = "website" if p.get("kind") == "website" else "Android app"
            lines.append(f"{p['number']}. {M.name_of(p)} ({kind}){active}, status: {state}")
            lines.append(f"   Idea: {p['original_prompt'][:500]}")
            changes = [c for c in json.loads(p.get("changes") or "[]") if c][-5:]
            if changes:
                lines.append("   Changes asked for (oldest first): " + " | ".join(str(c)[:160] for c in changes))
            if p.get("deploy_url"):
                lines.append(f"   Live at: {p['deploy_url']}")
            elif p["last_success_build_id"]:
                lines.append("   Ready: the server can send its " + ("preview link" if kind == "website" else "APK link"))
            if last and last["status"] == "failed" and last.get("error"):
                lines.append(f"   Last build failed: {str(last['error'])[:300]}")
        if not projects:
            lines.append("(none yet)")
        job = self.store.active_job(user["id"])
        lines += ["", f"Build running now: {job['ref']} ({job['kind']}, {job['status']})" if job else "Build running now: none"]
        history = [m for m in self.store.messages_for_user(user["id"], limit=30) if m["body"]]
        if history and history[-1]["direction"] == "in" and history[-1]["body"].strip() == body.strip():
            history = history[:-1]  # the new message itself
        lines += ["", "Conversation (oldest first):"]
        # 20 messages is plenty of memory; every token counts against the provider's tokens-per-minute limit.
        for m in history[-20:]:
            who = "User" if m["direction"] == "in" else "Weave"
            lines.append(f"{who}: {m['body'].removeprefix('Weave: ')[:500]}")
        if not history:
            lines.append("(this is the first message)")
        lines += ["", f"New message from the user: {body[:1600]}",
                  # Last, so it outweighs earlier replies in the history that didn't match their style.
                  "", "Reply in the same language mix, script and tone as this new message (Hinglish gets Hinglish, "
                      "Gen Z slang gets Gen Z slang), even if your earlier replies above didn't."]
        return "\n".join(lines)

    def _apply(self, user: dict, d, body: str, sid: str) -> str:
        reply = (d.reply or "").strip()
        project = None
        if d.project is not None:
            project = self.store.project_by_number(user["id"], d.project)
        if d.action in ("new_app", "new_website", "change_app"):
            # Deterministic guard: greetings, thanks and status/list/link questions never start or change a build,
            # whatever the model decided.
            rule = classify(body, has_projects=True, has_active=True).kind
            if rule in NEVER_BUILDS:
                event("sms.brain_overruled", action=d.action, rule=rule)
                return self._plain(user, body, sid)
        if d.action in ("new_app", "new_website"):
            spec = (d.spec or "").strip() or body
            kind = "website" if d.action == "new_website" else "android"
            said = target_kind(body) or target_kind(spec)
            if said is not None and said != kind:
                # The model and the user's own words disagree: ask (or follow their words if there's no choice).
                kind = None if self.websites_available() else said
            # The AI already had the chance to ask about the look, so no separate style question.
            return self._start_new(user, spec, sid, lead=reply if kind else "", kind=kind, styled=True)
        if d.action == "change_app":
            if d.project is not None and project is None:
                return self._clarify(user, "I couldn't find that project.")
            project = project or self._active_project(user)
            if project is None:
                return self._clarify(user, reply or "Which app should I change?")
            return self._start_change(user, project, (d.spec or "").strip() or body, sid, lead=reply)
        if d.action == "rename":
            project = project or self._active_project(user)
            name = (d.spec or "").strip()
            if project is None or not name:
                self._reply(user["phone"], user, reply or "Which project should I rename, and to what?", localized=True)
                return "rename_unclear"
            try:
                url = self.rename_project(user, project, name)
            except ValueError:
                self._reply(user["phone"], user, "That name won't work. Try a short plain name.")
                return "rename_bad"
            text = f"Renamed it to {name}." + (f" It now lives at {url}" if url else "")
            self._reply(user["phone"], user, text)
            return "renamed"
        if d.action == "status":
            return self._status(user, "")
        if d.action == "list_apps":
            return self._projects(user)
        if d.action == "download":
            return self._open(user, str(project["number"]) if project else "")
        if d.action == "switch" and project is not None:
            return self._use(user, str(project["number"]))
        if d.action == "cancel":
            return self._cancel(user)
        if d.action == "retry":
            return self._retry(user, sid)
        if d.action == "publish":
            return self._publish_request(user, project)  # only asks; the owner must reply PUBLISH
        if d.action == "analytics":
            return self._analytics(user, project, body)
        if reply:
            self._reply(user["phone"], user, reply, localized=True)
        else:
            self._reply(user["phone"], user, "Sorry, I didn't catch that. What would you like to build?")
        return "chat"

    def _command(self, user: dict, word: str, rest: str, sid: str) -> str | None:
        """Exact commands (HELP, STATUS, USE 2, ...). Returns None for anything that reads like normal speech."""
        number = rest.strip().lstrip("#")
        if word in ("HELP", "INFO", "COMMANDS", "?", "MENU") and not rest:
            help_text = self._help()
            text = self._present("help", {"commands": help_text}, help_text, user_query=word)
            self._reply(user["phone"], user, text)
            return "help"
        if word == "NEW":
            if len(rest) >= MIN_PROMPT:
                return self._start_new(user, rest, sid)
            if not rest:
                self.store.update_user(user["id"], awaiting_new=1, active_project_id=None)
                self._reply(user["phone"], user, "Okay, a new app. What should it do?")
                return "awaiting_new"
            return None
        if word == "CHANGE" and rest:
            if re.fullmatch(r"(?:app|project|site|website)\s*#?\d+", rest.strip(), re.I):
                return self._clarify(user, "Which change should I make? To pick a project, say \"switch to <number>\".")
            project = self._active_project(user)
            if project is None:
                return self._clarify(user, "Which app should I change?")
            return self._start_change(user, project, rest, sid)
        if word == "STATUS" and (not rest or REF_RE.fullmatch(rest.strip())):
            return self._status(user, rest)
        if word in ("PROJECTS", "APPS", "LIST") and not rest:
            return self._projects(user)
        if word in ("STATS", "ANALYTICS", "VISITORS", "TRAFFIC") and not rest:
            return self._analytics(user, None, "")
        if word in ("DIGEST", "WEEKLY", "TIPS") and not rest:
            return self._digest(user, "")
        if word in ("LEADS", "ENQUIRIES", "ENQUIRY", "MESSAGES") and not rest:
            return self._leads(user)
        if word in ("SALES", "REVENUE", "PROFIT") and not rest:
            return self._sales(user)
        if word in ("USE", "SWITCH", "SELECT") and number.isdigit():
            return self._use(user, number)
        if word in ("OPEN", "DOWNLOAD") and (not rest or number.isdigit()):
            return self._open(user, number)
        if word in ("INVITE", "REFER", "REFERRAL", "CODE") and not rest:
            return self._invite(user)
        if user["role"] == "owner" and word in ("TAKEDOWN", "REINSTATE", "REPORTS"):
            return self._moderate(user, word, rest.strip().lower())
        if word in ("DELETE", "REMOVE") and number.isdigit():
            return self._delete_request(user, self.store.project_by_number(user["id"], int(number)))
        if word == "CALL" and rest.lower().startswith("me ") and len(rest) <= 40:
            return self._rename_me(user, rest[3:])
        if word in ("LINK", "JOIN") and rest and " " not in rest.strip():
            self._reply(user["phone"], user, "This number is already linked. Just tell me what to build.")
            return "already_linked"
        if word in ("ABORT", "CANCEL") and not rest:  # bare CANCEL on SMS is an opt-out keyword and never gets here
            return self._cancel(user)
        if word == "RETRY" and not rest:
            return self._retry(user, sid)
        if word in ("PUBLISH", "DEPLOY") and (not rest or number.isdigit()):
            project = self.store.project_by_number(user["id"], int(number)) if number.isdigit() else None
            return self._publish_request(user, project)
        return None

    def _plain(self, user: dict, body: str, sid: str) -> str:
        projects = self.store.projects(user["id"], limit=20)
        project = self._active_project(user)
        intent = classify(body, has_projects=bool(projects), has_active=project is not None,
                          project_names={p["number"]: M.name_of(p) for p in projects})
        event("sms.intent", kind=intent.kind, phone=mask(user["phone"]))
        if user["awaiting_new"] and intent.kind in ("new", "change", "ambiguous", "unclear") and len(body) >= MIN_PROMPT:
            return self._start_new(user, body, sid)
        if (project is not None and intent.kind not in NEVER_BUILDS
                and other_kind_requested(body, project.get("kind") or "android")):
            # "can u make me an apk version of this" on a website: a new Android app, whatever else it looks like.
            return self._start_change(user, project, body, sid)
        kind = intent.kind
        if kind == "greeting":
            hey = f"Hey {name}!" if (name := self._call_sign(user)) else "Hey!"
            if project is not None:
                text = (f"{hey} We're working on {M.name_of(project)}. Tell me what to change "
                        "(like \"make the buttons bigger\"), or describe a new app.")
            elif self.websites_available():
                text = (f"{hey} I'm Weave. Describe an Android app or a website and I'll build it, like \"a habit "
                        "tracker with streaks\" or \"a website for my bakery\". You can also send a voice note.")
            else:
                text = (f"{hey} I'm Weave. Describe an app and I'll build it for your Android phone, "
                        "like \"a habit tracker with streaks and a dark theme\". You can also send a voice note.")
            # Fixed text, no AI rewording: a "hi" must be answered in seconds even when Gemini is overloaded.
            self._reply(user["phone"], user, text)
            return "greeting"
        if kind == "thanks":
            job = self.store.active_job(user["id"])
            text = ("I'll message you as soon as it's ready." if job else
                    "Anytime! Tell me a change or a new app idea whenever you like.")
            self._reply(user["phone"], user, text)
            return "thanks"
        if kind == "help":
            help_text = self._help()
            text = self._present("help", {"commands": help_text}, help_text, user_query=body)
            self._reply(user["phone"], user, text)
            return "help"
        if kind == "publish":
            return self._publish_request(user, None)
        if kind == "analytics":
            return self._analytics(user, project, body)
        if kind == "status":
            return self._status(user, "")
        if kind == "projects":
            return self._projects(user)
        if kind == "download":
            return self._open(user, "")
        if kind == "cancel":
            return self._cancel(user)
        if kind == "retry":
            return self._retry(user, sid)
        if kind == "switch":
            return self._use(user, intent.arg)
        if kind == "new":
            if substance(intent.arg) < 1:
                self.store.update_user(user["id"], awaiting_new=1)
                self._reply(user["phone"], user, "Sure, a new app! What should it do?")
                return "awaiting_new"
            return self._start_new(user, intent.arg, sid)
        if kind == "question":
            # Only reached when the AI couldn't answer (or isn't on): answer what the rules can, honestly.
            if re.search(r"\b(?:my name|who am i|what(?:'?s| is) my)\b", body, re.I):
                name = self._call_sign(user)
                self._reply(user["phone"], user, f"You're {name}! Want me to call you something else? Say \"call me ...\"."
                            if name else "I don't know your name yet. Tell me: say \"call me ...\".")
                return "question"
            if not re.search(r"\b(?:you|u|weave)\b.*\b(?:do|make|build|create|work)\b|\b(?:can|could)\s+(?:you|u)\b",
                             body, re.I):
                self._reply(user["phone"], user, "Sorry, I'm a bit slow to think right now. Could you ask me that again "
                                                 "in a moment?")
                return "question_later"
            if self.websites_available():
                fallback = ("I build Android apps and simple websites from a description (not iPhone "
                            "apps). Tell me what you'd like and I'll build it.")
            else:
                fallback = ("I build Android apps from a description (not websites or iPhone apps). "
                            "Tell me what you'd like the app to do and I'll build it.")
            text = self._present("question", {"websites": self.websites_available()}, fallback, user_query=body)
            self._reply(user["phone"], user, text)
            return "question"
        if kind == "change" and project is not None:
            return self._start_change(user, project, intent.arg, sid)
        if kind == "ambiguous" and project is not None:
            self.store.update_user(user["id"], pending_text=body[:MAX_PROMPT], pending_question=None)
            self._reply(user["phone"], user, f"Should I change {M.name_of(project)} with that, or make it a new app? "
                                             "Reply \"change\" or \"new\".")
            return "ask_new_or_change"
        if kind in ("ambiguous", "change"):
            return self._clarify(user, "Which app is that for?")
        if target_kind(body) == "website" and not re.sub(r"\b(?:a|an|the|my|new|make|build|create|me|website|site|"
                                                          r"web ?page|please|pls)\b|[^\w]", "", body.lower()):
            self.store.update_user(user["id"], awaiting_new=1, pending_text="website", pending_question="what")
            self._reply(user["phone"], user, "Sure! What's the website for? Like \"my bakery called Crumbs\" or "
                                             "\"my fitness coaching\".")
            return "ask_what"
        if not projects:
            self._reply(user["phone"], user, "Tell me what app you'd like, e.g. \"a workout log that tracks my sets "
                                             "and shows weekly progress\".")
        else:
            name = M.name_of(project) if project else "your app"
            self._reply(user["phone"], user, f"I'm not sure what you mean. Tell me a change for {name}, describe a "
                                             "new app, or ask \"how's it going?\" or \"send the link\".")
        return "unclear"

    def _resolve_pending(self, user: dict, body: str, sid: str) -> str | None:
        pending = user["pending_text"]
        answer = answer_reply(body)
        self.store.update_user(user["id"], pending_text=None)
        if answer == "new":
            if substance(pending) < 1 or classify(pending, has_projects=False, has_active=False).kind == "question":
                self.store.update_user(user["id"], awaiting_new=1, active_project_id=None)
                self._reply(user["phone"], user, "Sure, a new app! What should it do?")
                return "awaiting_new"
            return self._start_new(user, pending, sid)
        if answer == "change":
            project = self._active_project(user)
            if project is None:
                return self._clarify(user, "Which app should I change?")
            return self._start_change(user, project, pending, sid)
        if answer == "no":
            self._reply(user["phone"], user, "Okay, I won't build that.")
            return "pending_dropped"
        return None  # they said something else: treat it as a new message

    def _clarify(self, user: dict, question: str) -> str:
        lines = [question, "Reply NEW <idea> for a new app, or USE <n> to pick one to change:"]
        lines += [f"{p['number']} {M.name_of(p)}" for p in self.store.projects(user["id"], limit=5)]
        self._reply(user["phone"], user, "\n".join(lines))
        return "clarify"

    def _start_new(self, user: dict, idea: str, sid: str, lead: str = "", kind: str | None = None,
                   styled: bool = False) -> str:
        if len(idea) < MIN_PROMPT:
            self._reply(user["phone"], user, "Tell me a bit more about the app (at least 10 characters).")
            return "too_short"
        if len(idea) > MAX_PROMPT:
            idea = idea[:MAX_PROMPT]
        if kind is None:
            kind = target_kind(idea)
            if kind is None:
                if not self.websites_available():
                    kind = "android"  # the only builder here: nothing to choose between
                else:
                    self.store.update_user(user["id"], pending_text=idea, pending_question="kind")
                    self._reply(user["phone"], user, "Should I make that as a phone app (Android APK) or as a website? "
                                                     "Reply \"app\" or \"website\".")
                    return "ask_kind"
        if kind == "website" and (problem := self.website_problem()):
            event("sms.website_unavailable", phone=mask(user["phone"]))
            self._reply(user["phone"], user, "Sorry, I can't make websites right now. "
                                             "I can make it as an Android app instead: say \"build it as an app\".")
            return "website_unavailable"
        if kind == "website" and self.s.website_ask_style and not styled and not STYLE_WORDS.search(idea):
            self.store.update_user(user["id"], pending_text=idea, pending_question="style")
            self._reply(user["phone"], user, STYLE_QUESTION)
            return "ask_style"
        if (blocked := self._gate(user)) is not None:
            return blocked
        if user["role"] != "owner" and len(self.store.projects(user["id"], limit=self.s.max_projects)) >= self.s.max_projects:
            self._reply(user["phone"], user, f"You have {self.s.max_projects} projects, the most an account can keep. "
                        "Delete one first: text PROJECTS to see them, then DELETE <number>.")
            return "project_limit"
        project = self.store.create_project(user["id"], idea, kind)
        job = self.store.enqueue_job(user_id=user["id"], project_id=project["id"], kind="new", prompt=idea,
                                     change_request=None, base_build_id=None,
                                     max_attempts=self.s.sms_job_max_attempts, inbound_sid=sid)
        event("sms.job_enqueued", ref=job["ref"], kind="new", project_kind=kind, phone=mask(user["phone"]))
        if kind == "website":
            fallback = ((f"{lead} " if lead else "Got it! I'm designing your website now. ") +
                        "It takes a few minutes. I'll send you the link when it's ready.")
            facts = {"action": "build_accepted", "kind": "website", "ref": job["ref"], "lead": lead}
        else:
            fallback = ((f"{lead} " if lead else "Got it! I'm turning your idea into an app. ") + f"Build ID: {job['ref']}. "
                        "I'll message you when it's ready (usually a few minutes). Ask \"how's it going?\" anytime.")
            facts = {"action": "build_accepted", "kind": "android", "ref": job["ref"], "lead": lead}
        text = self._present("build_accepted", facts, fallback, user_query=idea)
        self._reply(user["phone"], user, text, job_id=job["id"])
        return "queued_new"

    def _resolve_style(self, user: dict, body: str, sid: str) -> str:
        """Answer to the style question: a number, free-form preferences, "skip", or "cancel"."""
        idea = user["pending_text"]
        self.store.update_user(user["id"], pending_text=None, pending_question=None)
        answer = body.strip()
        if STYLE_STOP.fullmatch(answer):
            self._reply(user["phone"], user, "Okay, I won't build that.")
            return "pending_dropped"
        if not answer or STYLE_SKIP.fullmatch(answer):
            return self._start_new(user, idea, sid, kind="website", styled=True)
        prefs = re.sub(r"(?<![\d.])([1-4])(?![\d.])", lambda m: STYLES[m.group(1)], answer, count=1)[:400]
        event("sms.style_chosen", phone=mask(user["phone"]))
        return self._start_new(user, f"{idea}\n\nDesign preferences from the customer: {prefs}", sid,
                               kind="website", styled=True)

    def _resolve_kind(self, user: dict, body: str, sid: str) -> str | None:
        """Answer to "Android app or website?". None = they said something else (handled as a new message)."""
        pending = user["pending_text"]
        answer = answer_kind(body)
        self.store.update_user(user["id"], pending_text=None, pending_question=None)
        if answer in ("android", "website"):
            return self._start_new(user, pending, sid, kind=answer)
        if answer == "no":
            self._reply(user["phone"], user, "Okay, I won't build that.")
            return "pending_dropped"
        return None

    # ---------- publishing (websites only, owner approval every time) ----------
    def publish_problem(self) -> str:
        if self.s.website_deploy == "weave":
            return "" if self.s.sites_domain else "Weave hosting has no domain (WEAVE_SITES_DOMAIN)"
        if self.s.website_deploy != "netlify":
            return "publishing is switched off on this Weave server"
        if not self.s.netlify_auth_token:
            return "publishing is not configured (no Netlify token)"
        return ""

    def _publish_request(self, user: dict, project: dict | None) -> str:
        """Explain what publishing does and ask for an explicit PUBLISH. Never publishes by itself."""
        project = project or self._active_project(user)
        if project is None or project.get("kind") != "website":
            websites = [p for p in self.store.projects(user["id"], limit=20) if p.get("kind") == "website"]
            if project is None and len(websites) == 1:
                project = websites[0]
            else:
                self._reply(user["phone"], user, "Only websites can be published. Switch to the website first "
                                                 "(\"show my projects\", then \"switch to <n>\").")
                return "publish_not_website"
        if user["role"] != "owner":
            self._reply(user["phone"], user, "Only the Weave owner can publish websites. Your private preview link "
                                             "still works: say \"send the link\".")
            return "publish_forbidden"
        if (problem := self.publish_problem()):
            self._reply(user["phone"], user, "Putting websites on the public internet isn't turned on yet, so your "
                                             "website stays private. Say \"send the link\" to see it.")
            return "publish_unavailable"
        build_id = project["last_success_build_id"]
        if not build_id or not self._build_ok(build_id, "website"):
            self._reply(user["phone"], user, f"{M.name_of(project)} has no finished version to publish yet.")
            return "publish_none"
        self.store.update_user(user["id"], pending_text=str(project["id"]), pending_question="publish")
        where = f"update the public site at {project['deploy_url']}" if project.get("deploy_url") else \
            "put it on the public internet with Netlify"
        self._reply(user["phone"], user, f"Publishing {M.name_of(project)} will {where}. Anyone with the address can "
                                         "see it. Reply PUBLISH to confirm, or anything else to cancel.")
        event("sms.publish_requested", phone=mask(user["phone"]))
        return "publish_confirm"

    def _resolve_publish(self, user: dict, body: str, sid: str) -> str | None:
        project = self.store.project(user["id"], int(user["pending_text"])) if user["pending_text"].isdigit() else None
        self.store.update_user(user["id"], pending_text=None, pending_question=None)
        if body.strip().upper().rstrip(".!") != "PUBLISH":
            if answer_reply(body) == "no" or len(body.split()) <= 2:
                self._reply(user["phone"], user, "Okay, not publishing. Your preview is unchanged.")
                return "publish_declined"
            return None  # something else entirely: handle it as a normal message
        if project is None or user["role"] != "owner" or self.publish_problem():
            self._reply(user["phone"], user, "I can't publish that now.")
            return "publish_unavailable"
        build_id = project["last_success_build_id"]
        if not build_id or not self._build_ok(build_id, "website"):
            self._reply(user["phone"], user, f"{M.name_of(project)} has no finished version to publish.")
            return "publish_none"
        if (blocked := self._gate(user)) is not None:
            return blocked
        job = self.store.enqueue_job(user_id=user["id"], project_id=project["id"], kind="publish",
                                     prompt=project["original_prompt"], change_request=None, base_build_id=build_id,
                                     max_attempts=1, inbound_sid=sid)
        event("sms.publish_approved", ref=job["ref"], phone=mask(user["phone"]))
        self._reply(user["phone"], user, f"Publishing {M.name_of(project)} now. Build ID: {job['ref']}. "
                                         "I'll send the public address when Netlify confirms it.", job_id=job["id"])
        return "queued_publish"

    def _start_change(self, user: dict, project: dict, change: str, sid: str, lead: str = "") -> str:
        current = project.get("kind") or "android"
        if (other := other_kind_requested(change, current)) is not None:
            # "make me an APK version of this" while a website is active: a new Android app based on it.
            event("sms.cross_kind", from_kind=current, to_kind=other, phone=mask(user["phone"]))
            spec = (f"{change.strip()}\n\nBase it on my existing {'website' if current == 'website' else 'Android app'} "
                    f"\"{M.name_of(project)}\": {project['original_prompt'][:1500]}")
            return self._start_new(user, spec, sid, kind=other)
        running = self.store.all("SELECT * FROM jobs WHERE user_id = ? AND status IN ('queued', 'running') ORDER BY id",
                                 (user["id"],))
        if running and all(j["project_id"] == project["id"] for j in running):
            return self._queue_change(user, project, change, sid, running)
        if (blocked := self._gate(user)) is not None:
            return blocked
        changes = json.loads(project["changes"]) + [change[:1000]]
        spec = compose_spec(project["original_prompt"], changes)
        if spec is None:
            self._reply(user["phone"], user, "That project has too many changes to track by SMS. Text NEW <idea> to start fresh.")
            return "too_long"
        if project.get("kind") == "website" and (problem := self.website_problem()):
            self._reply(user["phone"], user, f"Sorry, I can't change websites on this Weave server right now ({problem}).")
            return "website_unavailable"
        base = project["last_success_build_id"]
        if base and not self._build_ok(base, project.get("kind", "android")):
            base = None
        # With a working previous version, Gemini edits its sources; otherwise rebuild from the full spec.
        job = self.store.enqueue_job(user_id=user["id"], project_id=project["id"], kind="change" if base else "new",
                                     prompt=spec, change_request=change[:1000] if base else None, base_build_id=base,
                                     max_attempts=self.s.sms_job_max_attempts, inbound_sid=sid)
        self.store.add_change(project["id"], change[:1000])
        event("sms.job_enqueued", ref=job["ref"], kind=job["kind"], phone=mask(user["phone"]))
        if project.get("kind") == "website":
            fallback = ((f"{lead} " if lead else f"Got it! Changing {M.name_of(project)} now. ") +
                        "It takes a few minutes. I'll send you the new link when it's ready.")
            facts = {"action": "build_accepted_change", "kind": "website", "ref": job["ref"], "project": M.name_of(project)}
        else:
            fallback = ((f"{lead} " if lead else f"Got it! Updating {M.name_of(project)} "
                                                 f"(project {project['number']}). ") +
                        f"Build ID: {job['ref']}. I'll text you when it's ready. "
                        "(For a separate app, say \"new app: <idea>\".)")
            facts = {"action": "build_accepted_change", "kind": "android", "ref": job["ref"], "project": M.name_of(project), "number": project['number']}
        text = self._present("build_accepted_change", facts, fallback, user_query=change)
        self._reply(user["phone"], user, text, job_id=job["id"])
        return "queued_change"

    def _queue_change(self, user: dict, project: dict, change: str, sid: str, running: list[dict]) -> str:
        """A change for the project that is being built right now: queue it to run on top of that build instead of
        telling the customer to come back later. Several such changes are applied together."""
        if (blocked := self._gate(user, busy_ok=True)) is not None:
            return blocked
        spec = compose_spec(project["original_prompt"], json.loads(project["changes"]) + [change[:1000]])
        if spec is None:
            self._reply(user["phone"], user, "That project has too many changes to track by SMS. Text NEW <idea> to start fresh.")
            return "too_long"
        waiting = next((j for j in running if j["status"] == "queued" and j["kind"] == "change" and not j["base_build_id"]), None)
        self.store.add_change(project["id"], change[:1000])
        if waiting is not None:
            self.store.update_job(waiting["id"], prompt=spec,
                                  change_request=f"{waiting['change_request']}\nAlso: {change[:1000]}"[:3000])
            self._reply(user["phone"], user, "Added that too. I'll apply all your changes together as soon as the "
                                             "current build finishes.")
            return "queued_change_merged"
        current = running[0]
        job = self.store.enqueue_job(user_id=user["id"], project_id=project["id"], kind="change", prompt=spec,
                                     change_request=change[:1000], base_build_id=None,
                                     max_attempts=self.s.sms_job_max_attempts, inbound_sid=sid)
        event("sms.job_enqueued", ref=job["ref"], kind="change", deferred=True, phone=mask(user["phone"]))
        self._reply(user["phone"], user, f"Got it. {M.name_of(project)} is still being built ({current['ref']}), so I'll "
                                         "make that change right after it finishes and send you the updated link.",
                    job_id=job["id"])
        return "queued_change"

    def _gate(self, user: dict, busy_ok: bool = False) -> str | None:
        active = None if busy_ok else self.store.active_job(user["id"])
        if active:
            fallback = f"Build {active['ref']} is still in progress. Reply STATUS, or ABORT to stop it before starting another."
            facts = {"action": "gate_busy", "ref": active["ref"]}
            text = self._present("gate_busy", facts, fallback)
            self._reply(user["phone"], user, text)
            return "busy"
        limit = self.s.sms_daily_builds_guest if user["role"] == "guest" else self.s.sms_daily_builds_member
        limit += user.get("bonus_builds") or 0
        if self.store.jobs_since(user["id"], time.time() - 86_400) >= limit:
            event("sms.quota_exceeded", logging.WARNING, phone=mask(user["phone"]), limit=limit)
            fallback = f"You've reached the limit of {limit} builds per day. Please try again tomorrow."
            text = self._present("quota_exceeded", {"limit": limit}, fallback)
            self._reply(user["phone"], user, text)
            return "quota"
        if self.store.queued_total() >= self.s.sms_max_queued:
            event("sms.queue_full", logging.WARNING)
            self._reply(user["phone"], user, "Weave is busy with other builds. Please try again in a few minutes.")
            return "queue_full"
        return None

    def _status(self, user: dict, rest: str) -> str:
        job = None
        if REF_RE.fullmatch(rest.strip()):
            job = self.store.job_for_user(user["id"], rest.strip())
        if job is None:
            job = self.store.active_job(user["id"])
        if job is None and (project := self._active_project(user)):
            job = self.store.latest_job(user["id"], project["id"])
        if job is None:
            fallback = "No builds yet. Text an app idea to start."
            text = self._present("status_none", {"active": False}, fallback, user_query=rest)
            self._reply(user["phone"], user, text)
            return "status_none"
        project = self.store.project(user["id"], job["project_id"])
        name, ref = M.name_of(project), job["ref"]
        website = bool(project and project.get("kind") == "website")
        if job["kind"] == "publish":
            fallback = {"queued": f"{ref}: publishing {name} is waiting to start.",
                        "running": f"{ref}: publishing {name} to Netlify now.",
                        "succeeded": f"{ref}: {name} is published at {project.get('deploy_url') if project else ''}",
                        "cancelled": f"{ref}: publishing {name} was cancelled."}.get(
                            job["status"], f"{ref}: publishing {name} failed. {M.failure_reason(job['error'])}")
            facts = {"action": "publish_status", "status": job["status"], "ref": ref, "name": name, "deploy_url": project.get('deploy_url') if project else None}
            text = self._present("status", facts, fallback, user_query=rest)
            self._reply(user["phone"], user, text)
            return "status"
        if job["status"] == "queued":
            fallback = f"{name[0].upper() + name[1:]} is waiting for a build slot and will start soon. (Build {ref})"
            if job["attempts"]:
                fallback = f"{name[0].upper() + name[1:]} hit a temporary problem. I'll try again shortly. (Build {ref})"
        elif job["status"] == "running":
            fallback = f"Working on {name} now. (Build {ref})"
            if job["build_id"]:
                b = self.build_record(job["build_id"], "website" if website else "android")
                if b is not None:
                    table = M.WEB_PROGRESS if website else M.PROGRESS
                    stage = table.get(b.get("stage", ""), (None, None, b.get("message") or ""))[2]
                    fallback = f"Working on {name} now: {stage} (Build {ref})"
            if job["cancel_requested"]:
                fallback += " Stopping it now."
        elif job["status"] == "succeeded":
            fallback = f"{name[0].upper() + name[1:]} is ready! Say \"send the link\" to get it. (Build {ref})"
        elif job["status"] == "cancelled":
            fallback = f"Build {ref} ({name}) was cancelled. Reply RETRY to build it again."
        else:
            fallback = f"Build {ref} ({name}) failed. {M.failure_reason(job['error'])} Reply RETRY to try again."
        facts = {"action": "status", "status": job["status"], "ref": ref, "name": name, "kind": project.get("kind", "android") if project else "android"}
        text = self._present("status", facts, fallback, user_query=rest)
        self._reply(user["phone"], user, text)
        return "status"

    def _projects(self, user: dict) -> str:
        projects = self.store.projects(user["id"])
        if not projects:
            fallback = "No projects yet. Text an app idea to start."
            text = self._present("projects_none", {"count": 0}, fallback)
            self._reply(user["phone"], user, text)
            return "projects_none"
        lines = []
        for p in projects:
            last = self.store.latest_job(user["id"], p["id"])
            if last and last["kind"] == "publish":
                last = self.store.one("SELECT * FROM jobs WHERE user_id = ? AND project_id = ? AND kind != 'publish' "
                                      "ORDER BY id DESC LIMIT 1", (user["id"], p["id"]))
            state = {"succeeded": "ready", "running": "building", "queued": "queued"}.get(last["status"] if last else "", "failed" if last else "-")
            if p["last_success_build_id"] and state == "failed":
                state = "ready (last change failed)"
            if p.get("deploy_url"):
                state += ", published"
            star = " *" if p["id"] == user["active_project_id"] else ""
            label = " (website)" if p.get("kind") == "website" else ""
            lines.append(f"{p['number']} {M.name_of(p)}{label} - {state}{star}")
        title = "Your projects" if any(p.get("kind") == "website" for p in projects) else "Your apps"
        raw_list = f"{title} (* = active):\n" + "\n".join(lines) + "\nSay \"switch to <number>\" to pick one."
        text = self._present("projects", {"projects": "\n".join(lines)}, raw_list)
        self._reply(user["phone"], user, text)
        return "projects"

    def _sales(self, user: dict, query: str = "") -> str:
        """How the shop is doing, from the sales file they uploaded."""
        from ..analytics.metrics import sales_summary

        account = self.store.account_for_user(user["id"])
        if account is None:
            self._reply(user["phone"], user, "Sales figures come with a Weave account.")
            return "sales_no_account"
        facts = sales_summary(self.store, account["id"])
        chat = user["phone"].startswith(("whatsapp:", "web:"))
        fallback = M.sales_text(facts, M.MAX_CHARS_CHAT if chat else M.MAX_CHARS, unicode=chat)
        text = self._present("sales", facts, fallback, user_query=query)
        self._reply(user["phone"], user, text)
        return "sales" if facts.get("has_sales") else "sales_none"

    def _analytics(self, user: dict, project: dict | None, query: str = "") -> str:
        """How their live site is doing. Costs nothing and runs during a build, so there's no quota gate."""
        from ..analytics.metrics import sales_summary, traffic_summary

        # Check if weekly digest / tips were asked for specifically
        if query and re.search(r"\b(?:digest|weekly\s*(?:update|summary|report)?|tips?)\b", query, re.I):
            return self._digest(user, query)

        # "How's business?" means the shop when there are sales to talk about, and the website otherwise.
        account_now = self.store.account_for_user(user["id"])
        if account_now is not None and ASKS_SALES.search(query or ""):
            if sales_summary(self.store, account_now["id"]).get("has_sales"):
                return self._sales(user, query)

        if not self.s.analytics:
            self._reply(user["phone"], user, "Visitor numbers aren't switched on for this server.")
            return "analytics_off"
        account = self.store.account_for_user(user["id"])
        if account is None:
            where = f"{self.s.public_base_url}/start" if self.s.public_base_url else "the Weave website"
            self._reply(user["phone"], user, f"Visitor numbers come with a Weave account. Sign up at {where}.")
            return "analytics_no_account"
        live = [p for p in self.store.projects(user["id"]) if p.get("deploy_url")]
        if not live:
            self._reply(user["phone"], user, "You don't have a website live yet. Once one is up I'll count its visits.")
            return "analytics_no_site"

        if project is not None and not project.get("deploy_url"):
            project = None  # asked about something that isn't live; answer for everything instead
        slug = project.get("slug") if project else None
        site = M.name_of(project) if project else (M.name_of(live[0]) if len(live) == 1 else "your sites")
        facts = traffic_summary(self.store, account["id"], days=7, slug=slug)
        facts["leads"] = self.store.lead_count(account["id"], time.time() - 7 * 86_400)

        chat = user["phone"].startswith(("whatsapp:", "web:"))
        dashboard = f"{self.s.public_base_url}/dashboard" if self.s.public_base_url else ""
        fallback = M.analytics_text(facts, site, M.MAX_CHARS_CHAT if chat else M.MAX_CHARS,
                                    unicode=chat, dashboard=dashboard)
        text = self._present("analytics", {**facts, "site": site}, fallback, user_query=query)
        self._reply(user["phone"], user, text)
        return "analytics"

    def _digest(self, user: dict, query: str = "") -> str:
        """Weekly performance digest and tips. Generated on demand or served from the latest snapshot."""
        import json
        from ..analytics.collector import utc_day
        from ..analytics.digest import generate_digest
        from ..analytics.metrics import week_of

        if not self.s.analytics:
            self._reply(user["phone"], user, "Visitor numbers aren't switched on for this server.")
            return "analytics_off"
        account = self.store.account_for_user(user["id"])
        if account is None:
            where = f"{self.s.public_base_url}/start" if self.s.public_base_url else "the Weave website"
            self._reply(user["phone"], user, f"Weekly digests come with a Weave account. Sign up at {where}.")
            return "digest_no_account"

        chat = user["phone"].startswith(("whatsapp:", "web:"))
        limit = M.MAX_CHARS_CHAT if chat else M.MAX_CHARS
        now = time.time()
        today = utc_day(now)
        week = week_of(today)

        facts, text = generate_digest(
            self.store, account["id"], nlg=self.nlg, now=now,
            user_query=query, limit=limit, unicode=chat,
        )
        if not facts.get("has_data"):
            self._reply(user["phone"], user, "No activity recorded this week yet. Once visitors arrive or you upload sales, your weekly digest will appear here.")
            return "digest_empty"

        self.store.save_digest(account["id"], week, text, facts=json.dumps(facts), now=now)
        self._reply(user["phone"], user, text)
        return "digest"

    def _leads(self, user: dict) -> str:
        """The enquiries people have left on their sites. Each one was already sent when it arrived; this is
        the list, for when they want to look back."""
        account = self.store.account_for_user(user["id"])
        if account is None:
            self._reply(user["phone"], user, "Enquiries come with a Weave account.")
            return "leads_no_account"
        rows = self.store.leads(account["id"], limit=5)
        if not rows:
            self._reply(user["phone"], user, "No enquiries yet. They arrive here the moment someone writes in.")
            return "leads_none"
        chat = user["phone"].startswith(("whatsapp:", "web:"))
        lines = [f"{r['name'] or 'Someone'} ({r['contact']}): {r['message'][:120]}" for r in rows]
        total = self.store.lead_count(account["id"])
        head = f"Your last {len(rows)} of {total} enquiries:" if total > len(rows) else "Your enquiries:"
        text = M.fit(head + "\n" + "\n".join(lines), M.MAX_CHARS_CHAT if chat else M.MAX_CHARS, unicode=chat)
        self.store.mark_leads_read(account["id"], time.time())
        self._reply(user["phone"], user, text)
        return "leads"

    def _use(self, user: dict, rest: str) -> str:
        n = rest.strip().lstrip("#")
        project = self.store.project_by_number(user["id"], int(n)) if n.isdigit() else None
        if project is None:
            return self._clarify(user, "I couldn't find that project.")
        self.store.update_user(user["id"], active_project_id=project["id"], awaiting_new=0)
        fallback = f"Now working on {M.name_of(project)}. Tell me a change, or say \"send the link\"."
        text = self._present("switch", {"project": M.name_of(project), "number": n}, fallback, user_query=f"switch to {rest}")
        self._reply(user["phone"], user, text)
        return "use"

    def _open(self, user: dict, rest: str) -> str:
        n = rest.strip().lstrip("#")
        project = self.store.project_by_number(user["id"], int(n)) if n.isdigit() else self._active_project(user)
        if project is None:
            return self._clarify(user, "Which app?")
        build_id = project["last_success_build_id"]
        kind = project.get("kind", "android")
        if not build_id or not self._build_ok(build_id, kind):
            fallback = f"{M.name_of(project)} has no finished build yet. Reply STATUS for progress."
            self._reply(user["phone"], user, fallback)
            return "open_none"
        if kind == "website" and project.get("deploy_url"):
            # Live on its own address: that's the link people want (it follows renames).
            text = f"{M.name_of(project)} is live at {project['deploy_url']}"
            self._reply(user["phone"], user, text)
            return "open"
        if kind == "website":
            url = self.preview_url(user["id"], build_id, relative_ok=user["channel"] == "web")
            lines = [f"Here's your website {M.name_of(project)}:"]
            if url:
                lines.append(f"{url}\n(Private link, works for {M.duration(self.s.sms_link_ttl_hours)}.)")
            else:
                lines.append("(The link isn't set up on the Weave server yet.)")
            lines.append(f"It's also live at: {project['deploy_url']}" if project.get("deploy_url") else "Not published.")
            fallback = "\n".join(lines)
            facts = {"action": "download", "kind": "website", "preview_url": url, "deploy_url": project.get("deploy_url")}
            text = self._present("download", facts, fallback, user_query=rest)
            self._reply(user["phone"], user, text)
            return "open"
        url = self.download_url(user["id"], build_id, relative_ok=user["channel"] == "web")
        if url is None:
            self._reply(user["phone"], user, "Download links aren't configured on the Weave server (PUBLIC_BASE_URL).")
            return "open_unconfigured"
        fallback = (f"{M.name_of(project)} (Android APK): {url}\n"
                    f"Open it on your Android phone to install. The link works for "
                    f"{M.duration(self.s.sms_link_ttl_hours)}.")
        facts = {"action": "download", "kind": "android", "download_url": url, "project": M.name_of(project)}
        text = self._present("download", facts, fallback, user_query=rest)
        self._reply(user["phone"], user, text)
        return "open"

    def _cancel(self, user: dict) -> str:
        job = self.store.active_job(user["id"])
        if job is None:
            fallback = "No build is running."
            text = self._present("cancel_none", {"active": False}, fallback)
            self._reply(user["phone"], user, text)
            return "cancel_none"
        state = self.store.request_cancel(job["id"])
        event("sms.cancel_requested", ref=job["ref"], state=state)
        if state == "cancelled":
            fallback = f"Build {job['ref']} cancelled."
        else:
            fallback = f"Stopping build {job['ref']}..."
        facts = {"action": "cancel", "state": state, "ref": job["ref"]}
        text = self._present("cancel", facts, fallback)
        self._reply(user["phone"], user, text)
        return "cancel_" + state

    def _retry(self, user: dict, sid: str) -> str:
        project = self._active_project(user)
        last = self.store.latest_job(user["id"], project["id"]) if project else None
        if last is None:
            fallback = "Nothing to retry. Text an app idea to start."
            text = self._present("retry_none", {"has_last": False}, fallback)
            self._reply(user["phone"], user, text)
            return "retry_none"
        if last["kind"] == "publish":
            self._reply(user["phone"], user, "To try publishing again, say \"publish it\" (you'll be asked to confirm).")
            return "retry_publish"
        if last["status"] not in ("failed", "cancelled"):
            fallback = f"Build {last['ref']} is {last['status']}; nothing to retry."
            facts = {"action": "retry_not_needed", "status": last["status"], "ref": last["ref"]}
            text = self._present("retry_not_needed", facts, fallback)
            self._reply(user["phone"], user, text)
            return "retry_none"
        if (blocked := self._gate(user)) is not None:
            return blocked
        kind = project.get("kind", "android")
        if kind == "website" and (problem := self.website_problem()):
            self._reply(user["phone"], user, f"Sorry, I can't build websites on this Weave server right now ({problem}).")
            return "website_unavailable"
        base = last["base_build_id"] if last["base_build_id"] and self._build_ok(last["base_build_id"], kind) else None
        job = self.store.enqueue_job(user_id=user["id"], project_id=project["id"], kind="change" if base else "new",
                                     prompt=last["prompt"], change_request=last["change_request"] if base else None,
                                     base_build_id=base, max_attempts=self.s.sms_job_max_attempts, inbound_sid=sid)
        event("sms.job_enqueued", ref=job["ref"], kind=job["kind"], retry_of=last["ref"])
        fallback = f"Retrying {M.name_of(project)}. Build ID: {job['ref']}."
        facts = {"action": "retry", "project": M.name_of(project), "ref": job["ref"], "retry_of": last["ref"]}
        text = self._present("retry", facts, fallback, user_query=f"retry {last['ref']}")
        self._reply(user["phone"], user, text, job_id=job["id"])
        return "retry"

    # ---------- helpers ----------
    def _remember_reply_from(self, user: dict) -> dict:
        to = getattr(self._req, "to", None)
        if to and user["reply_from"] != to:
            self.store.update_user(user["id"], reply_from=to)
            user = self.store.user_by_id(user["id"])
        return user

    def _active_project(self, user: dict) -> dict | None:
        return self.store.project(user["id"], user["active_project_id"])

    def _build_ok(self, build_id: str, kind: str = "android") -> bool:
        if kind == "website":
            return self.web is not None and self.web.site_ok(build_id)
        try:
            b = self.builds.get(build_id)
        except KeyError:
            return False
        return b.get("status") == "succeeded" and bool(b.get("apk"))

    def build_record(self, build_id: str, kind: str = "android") -> dict | None:
        store = self.web.store if kind == "website" and self.web is not None else self.builds
        try:
            return store.get(build_id)
        except KeyError:
            return None

    def website_problem(self) -> str:
        if self.web is None:
            return "the website builder isn't set up"
        return self.web.problem()

    def websites_available(self) -> bool:
        return not self.website_problem()

    def _help(self) -> str:
        if not self.websites_available():
            return M.HELP
        return M.HELP.replace("- Describe an app to build it\n",
                              "- Describe an app or a website to build it\n") + "\nWebsites: \"publish it\" puts one online (owner only)."

    def preview_url(self, user_id: int, build_id: str, relative_ok: bool = False) -> str | None:
        """An expiring private link to a generated website (served sandboxed by /preview/<token>/)."""
        base = self.s.public_base_url if self.s.public_base_url.startswith(("https://", "http://")) else None
        if base is None and not relative_ok:
            return None
        token = self.store.create_download_token(user_id, build_id, self.s.sms_link_ttl_hours * 3600)
        return f"{base or ''}/preview/{token}/"

    def download_url(self, user_id: int, build_id: str, relative_ok: bool = False) -> str | None:
        """An expiring link to the build's APK. The web chat can use a same-origin relative link."""
        base = self.s.public_base_url if self.s.public_base_url.startswith(("https://", "http://")) else None
        if base is None and not relative_ok:
            return None
        token = self.store.create_download_token(user_id, build_id, self.s.sms_link_ttl_hours * 3600)
        return f"{base or ''}/download/{token}"

    def voice_allowed(self, sender: str) -> bool:
        """Only transcribe voice notes from linked, active users (transcription costs CPU time)."""
        if channel_of(sender) == "web":
            return False
        phone = normalize_e164(sender, self.s.sms_default_country_code)
        user = self.store.get_user(phone) if phone else None
        return bool(user and user["status"] == "active") or (phone in self.owners)

    def voice_failed(self, msg: Inbound, reason: str) -> None:
        phone = normalize_e164(msg.from_, self.s.sms_default_country_code)
        user = self.store.get_user(phone) if phone else None
        if user is None and phone in self.owners:
            user = self.store.create_user(phone, "owner", channel_of(msg.from_))
        if user is None:
            return
        self._req.to, self._req.heard = normalize_e164(msg.to), None
        self.store.record_inbound(phone, "[voice note]", msg.sid, user["id"])
        self._reply(phone, user, f"Sorry, I couldn't use that voice note ({reason}). Could you type it instead?")

    def _reply(self, phone: str, user: dict | None, text: str, job_id: int | None = None,
               localized: bool = False) -> None:
        heard = getattr(self._req, "heard", None)
        if heard:
            self._req.heard = None  # only the first reply repeats what we heard
            quoted = heard if len(heard) <= 140 else heard[:137].rstrip() + "..."
            text = f'You said: "{quoted}"\n\n{text}'
        to = address(user["phone"], user["channel"]) if user else phone
        sender = (user.get("reply_from") if user else None) or getattr(self._req, "to", None)
        self._send(to, user["id"] if user else None, text, job_id, sender, localized=localized)

    def _send(self, phone: str, user_id: int | None, text: str, job_id: int | None = None,
              sender: str | None = None, localized: bool = False) -> None:
        if sender is None and not phone.startswith("web:"):
            sender = getattr(self._req, "to", None)
        limit = M.MAX_CHARS if not phone.startswith(("whatsapp:", "web:")) else M.MAX_CHARS_CHAT
        self.queue_text(phone, user_id, text, limit, job_id, sender, localized)

    def queue_text(self, phone: str, user_id: int | None, text: str, limit: int, job_id: int | None,
                   sender: str | None, localized: bool = False) -> None:
        """Every outgoing message passes here: in the person's language, translated in the background if needed."""
        lang = (self.store.user_by_id(user_id) or {}).get("language") if user_id is not None else None
        # Chat channels carry any script. Plain SMS is kept ASCII, unless the person reads another script.
        unicode = phone.startswith(("whatsapp:", "web:")) or needs_translation(lang)

        def fit(t: str) -> str:
            return M.fit(t, limit, unicode=unicode)

        if needs_translation(lang) and self.translator is not None and not localized:
            msg_id = self.store.enqueue_sms(phone, fit(text), user_id, job_id, sender, status="localizing")
            self.translator.submit(msg_id, user_id, text, lang, fit)
            return
        self.store.enqueue_sms(phone, fit(text), user_id, job_id, sender)


def channel_of(sender: str | None) -> str:
    s = (sender or "").strip().lower()
    if s.startswith("whatsapp:"):
        return "whatsapp"
    if s.startswith("web:"):
        return "web"
    return "sms"


def address(phone: str, channel: str) -> str:
    """Where replies to a user go: '+91…' (SMS), 'whatsapp:+91…' or 'web:<id>' (web chat)."""
    return "whatsapp:" + phone if channel == "whatsapp" else phone


def _split(body: str) -> tuple[str, str]:
    parts = body.strip().split(None, 1)
    if not parts:
        return "", ""
    return parts[0].upper().rstrip(":,.!"), (parts[1].strip() if len(parts) > 1 else "")


def compose_spec(original: str, changes: list[str]) -> str | None:
    """The full description of a project: the first request plus every change, newest last, within the prompt limit."""
    kept = list(changes)
    while True:
        spec = original if not kept else original + "\n\nRequested changes (apply all, newest last):\n" + \
            "\n".join(f"- {c}" for c in kept)
        if len(spec) <= MAX_PROMPT:
            return spec
        if len(kept) <= 1:
            return None
        kept.pop(0)
