"""The custom-domain flow: suggest, quote, approve, pay, register, DNS, hosting, HTTPS, check, live, renew.

Money rules, enforced here and nowhere else:
1. A quote is only ever an offer. The customer approves one exact order (its id and amount) through the
   dashboard or with an explicit "yes" in chat, and only then gets a checkout link.
2. Nothing is registered until the payment provider's own API says that order was paid in full
   (payment_verified). A webhook only tells us where to look; its body is never trusted as proof.
3. Just before registering, availability and price are checked again. If the name went or the price rose past
   what was paid, the payment is refunded and nothing is bought.
4. Registration is idempotent: each paid order is registered by one leased runner at a time, a name can be held
   by only one paid row (a unique index), and a retry after a timeout asks the registrar whether the first attempt
   went through before trying again.

Every state change goes through SmsStore.transition_domain, which records it in domain_events.
"""

from __future__ import annotations

import logging
import math
import re
import time
from dataclasses import dataclass
from typing import Callable

from ..sms.domains_store import DuplicateDomainError
from ..sms.observe import event
from . import states as S
from .providers import (DeploymentVerifier, DnsProvider, HostingConnector, PaymentProvider, Price, ProviderError,
                        Registrar, SslProvider)

log = logging.getLogger("weave.domains")

LEASE_S = 300
RETRY_BASE_S = 30
RETRY_CAP_S = 6 * 3600
MAX_ATTEMPTS = 8
# How long a step may wait on the outside world before it counts as failed.
WAIT_LIMITS = {S.VERIFYING_DNS: 72 * 3600, S.PROVISIONING_SSL: 24 * 3600, S.VERIFYING_DEPLOYMENT: 6 * 3600}
RENEW_NOTICE_S = 30 * 86_400
LABEL_RE = re.compile(r"^(?!-)[a-z0-9-]{1,63}(?<!-)$")
CONTACT_REQUIRED = ("first_name", "last_name", "address1", "city", "state", "postal_code", "country", "phone", "email")
YES_RE = re.compile(r"^\s*(yes|yes please|yep|yeah|haan|haan ji|ha|han|ji haan|ok buy( it)?|buy( it)?|confirm|"
                    r"i confirm|approve|go ahead|yes,? buy( it)?|ok,? go ahead|y)\s*[.!]*\s*$", re.IGNORECASE)


class DomainError(Exception):
    """Something the customer can fix or should hear about; `code` is stable for the API."""

    def __init__(self, code: str, message: str, status: int = 400, **extra):
        super().__init__(message)
        self.code, self.message, self.status, self.extra = code, message, status, extra


@dataclass
class Providers:
    registrar: Registrar
    dns: DnsProvider
    hosting: HostingConnector
    ssl: SslProvider
    payments: PaymentProvider
    verifier: DeploymentVerifier


def is_yes(text: str) -> bool:
    """An explicit yes and nothing else. "yes but which one?" or "maybe" is not consent to pay."""
    return bool(YES_RE.match(text or ""))


def clean_domain(raw: str) -> str:
    """'https://www.Chai-Point.com/menu' -> 'chai-point.com'. Raises DomainError for anything that isn't a name."""
    name = (raw or "").strip().lower()
    name = re.sub(r"^[a-z]+://", "", name).split("/")[0].split("?")[0].rstrip(".")
    name = name.removeprefix("www.")
    try:
        name = name.encode("idna").decode("ascii")
    except UnicodeError:
        raise DomainError("bad_name", "That isn't a valid domain name.") from None
    labels = name.split(".")
    if len(labels) < 2 or len(name) > 253 or not all(LABEL_RE.fullmatch(lb) for lb in labels):
        raise DomainError("bad_name", "That isn't a valid domain name.")
    return name


def contact_problem(contact: dict | None) -> str:
    if not contact:
        return "add the registrant's name, address, phone and email (the domain is registered to them)"
    missing = [k for k in CONTACT_REQUIRED if not str(contact.get(k) or "").strip()]
    if missing:
        return "the registrant details are missing " + ", ".join(m.replace("_", " ") for m in missing)
    if not re.fullmatch(r"[A-Z]{2}", str(contact["country"]).upper()):
        return "country must be a two-letter code like IN or US"
    if not re.fullmatch(r"\+\d{1,3}\.\d{4,14}", str(contact["phone"])):
        return "phone must look like +91.9876543210 (country code, a dot, then the number)"
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", str(contact["email"])):
        return "email doesn't look right"
    return ""


def money(minor: int | None, currency: str) -> str:
    if minor is None:
        return "?"
    symbol = {"USD": "$", "INR": "₹", "EUR": "€", "GBP": "£"}.get(currency, currency + " ")
    whole, cents = divmod(int(minor), 100)
    return f"{symbol}{whole:,}" + (f".{cents:02d}" if cents else "")


class DomainService:
    def __init__(self, settings, store, providers: Providers, *, mode: str, problem: str = "",
                 notify: Callable[[int, str], None] | None = None, clock: Callable[[], float] = time.time):
        self.s, self.store, self.p = settings, store, providers
        self.mode = mode            # sandbox | test | live
        self._problem = problem     # why purchasing is off ("" when it is on)
        self.notify_fn = notify
        self.clock = clock

    # ---------- configuration ----------
    def problem(self) -> str:
        return self._problem

    def info(self) -> dict:
        return {"mode": self.mode, "purchasing": not self._problem, "problem": self._problem,
                "currency": self.s.domain_currency, "tlds": self.s.domain_tlds,
                "registrar": self.p.registrar.name, "dns": self.p.dns.name, "payments": self.p.payments.name}

    def customer_price(self, cost_minor: int, cost_currency: str) -> int:
        """Registrar cost -> what the customer pays, rounded up to a whole currency unit."""
        rate = 1.0 if cost_currency == self.s.domain_currency else self.s.domain_fx_rate
        raw = cost_minor * rate * (1 + self.s.domain_markup_percent / 100)
        return int(math.ceil(raw / 100) * 100)

    def _priced(self, price: Price) -> tuple[int, int]:
        return (self.customer_price(price.first_year_minor, price.currency),
                self.customer_price(price.renewal_minor, price.currency))

    def _tld_ok(self, name: str) -> bool:
        return any(name.endswith("." + t.strip(".").lower()) for t in self.s.domain_tlds)

    def notify(self, account_id: int, text: str) -> None:
        if self.notify_fn is None:
            return
        try:
            self.notify_fn(account_id, text)
        except Exception:  # noqa: BLE001 - a lost message must never break the flow
            log.exception("domain notification failed")

    # ---------- discovery ----------
    def suggest(self, query: str, limit: int = 6) -> list[dict]:
        """Names worth offering, each with real first-year and renewal prices. Taken and premium names are left out."""
        words = re.sub(r"[^a-z0-9 -]", "", (query or "").lower()).split()
        word = "".join(words)[:40]
        if len(word) < 2:
            raise DomainError("bad_query", "Tell me the business name to search for.")
        out: list[dict] = []
        for a in self.p.registrar.suggest(word, list(self.s.domain_tlds), limit * 2):
            if not a.available or a.premium or not self._tld_ok(a.domain):
                continue
            try:
                price = self.p.registrar.price(a.domain)
            except ProviderError:
                continue
            first, renew = self._priced(price)
            if price.premium or first > self.s.domain_max_price_minor:
                continue
            out.append({"domain": a.domain, "available": True, "first_year_minor": first, "renewal_minor": renew,
                        "currency": self.s.domain_currency})
            if len(out) >= limit:
                break
        event("domains.suggest", query=word, found=len(out))
        return out

    def check(self, raw: str) -> dict:
        name = clean_domain(raw)
        if not self._tld_ok(name):
            raise DomainError("tld", f"Weave can register {', '.join('.' + t for t in self.s.domain_tlds)} names.")
        if self.store.domain_owner(name):
            return {"domain": name, "available": False, "reason": "taken"}
        a = self.p.registrar.check(name)
        if not a.available or a.premium:
            return {"domain": name, "available": False, "reason": "premium" if a.premium else "taken"}
        first, renew = self._priced(self.p.registrar.price(name))
        if first > self.s.domain_max_price_minor:
            return {"domain": name, "available": False, "reason": "premium"}
        return {"domain": name, "available": True, "first_year_minor": first, "renewal_minor": renew,
                "currency": self.s.domain_currency}

    # ---------- quote ----------
    def _project_for(self, account: dict, project_id: int | None) -> dict:
        user = self.store.account_user(account["id"])
        if user is None:
            raise DomainError("no_phone", "Link your phone to this account first; your sites live there.")
        if project_id is None:
            live = [p for p in self.store.account_projects(user["id"]) if p.get("slug") and p.get("deploy_url")]
            if len(live) != 1:
                raise DomainError("which_project", "Which website should the domain show?",
                                  projects=[{"id": p["id"], "name": p.get("name") or p["slug"]} for p in live])
            return live[0]
        project = self.store.project(user["id"], project_id)
        if project is None or project.get("deleted_at") or not project.get("slug"):
            raise DomainError("bad_project", "That website wasn't found, or isn't live yet.", status=404)
        return project

    def quote(self, account: dict, raw: str, project_id: int | None, actor: str = "customer") -> tuple[dict, dict]:
        """Check a name and price it for this account. The domain waits in AWAITING_APPROVAL with a quote that
        expires after WEAVE_DOMAIN_QUOTE_MINUTES. Nothing is charged or reserved."""
        name = clean_domain(raw)
        if not self._tld_ok(name):
            raise DomainError("tld", f"Weave can register {', '.join('.' + t for t in self.s.domain_tlds)} names.")
        project = self._project_for(account, project_id)
        owner = self.store.domain_owner(name)
        if owner is not None:
            if owner["account_id"] == account["id"]:
                raise DomainError("already_yours", f"{name} is already yours.", status=409, domain_id=owner["id"])
            raise DomainError("taken", f"{name} is taken.", status=409)
        d = self.store.open_domain(account["id"], name)
        if d is not None and d["state"] == S.PAYMENT_PENDING:
            raise DomainError("payment_pending", f"{name} is waiting for your payment already.", status=409,
                              domain_id=d["id"])
        if d is None:
            d = self.store.create_domain(account["id"], project["id"], name, S.DISCOVERING, actor)
        else:
            self.store.update_domain(d["id"], project_id=project["id"])
        a = self.p.registrar.check(name)
        if not a.available or a.premium:
            self._fail(d, "premium name" if a.premium else "taken", actor, step=None)
            raise DomainError("taken", f"{name} is " + ("a premium name Weave doesn't sell." if a.premium else "taken."),
                              status=409)
        price = self.p.registrar.price(name)
        first, renew = self._priced(price)
        if price.premium or first > self.s.domain_max_price_minor:
            self._fail(d, "over the price limit", actor, step=None)
            raise DomainError("premium", f"{name} costs more than Weave sells domains for.", status=409)
        if d["state"] == S.DISCOVERING:
            self.store.transition_domain(d["id"], (S.DISCOVERING,), S.AVAILABLE, actor)
        order = self.store.create_domain_order(
            d["id"], account["id"], "register", 1, first, self.s.domain_currency, renew, price.first_year_minor,
            price.currency, self.s.domain_quote_minutes * 60, self.clock())
        self.store.transition_domain(
            d["id"], (S.AVAILABLE, S.AWAITING_APPROVAL), S.AWAITING_APPROVAL, actor, order["id"],
            {"amount": first, "renewal": renew, "currency": self.s.domain_currency},
            first_year_minor=first, renewal_minor=renew, currency=self.s.domain_currency,
            cost_currency=price.currency, first_year_cost_minor=price.first_year_minor,
            renewal_cost_minor=price.renewal_minor, registrar=self.p.registrar.name)
        event("domains.quoted", domain=name, amount=first)
        return self.store.domain(d["id"]), order

    def quote_text(self, d: dict, order: dict) -> str:
        return (f"{d['name']} is available: {money(order['amount_minor'], order['currency'])} for the first year, "
                f"then {money(order['renewal_minor'], order['currency'])} a year. It's registered in your name. "
                f"Reply YES to buy it (the price holds for {self.s.domain_quote_minutes} minutes).")

    # ---------- approval and payment ----------
    def approve(self, account: dict, domain_id: int, order_id: int, amount_minor: int, *, via: str, text: str,
                return_url: str) -> dict:
        """The customer said yes to this exact order and amount. Re-check the name and price; if either moved,
        ask again. Otherwise open a checkout for exactly the approved amount."""
        if self._problem:
            raise DomainError("purchasing_off", f"Buying domains isn't switched on yet ({self._problem}).", status=503)
        d = self.store.account_domain(account["id"], domain_id)
        order = self.store.domain_order(order_id)
        if d is None or order is None or order["domain_id"] != d["id"] or order["account_id"] != account["id"]:
            raise DomainError("not_found", "That domain order wasn't found.", status=404)
        renewal = order["kind"] == "renew"
        if (d["state"] != (S.EXPIRING if renewal else S.AWAITING_APPROVAL)) or order["status"] != "quoted":
            raise DomainError("not_awaiting", "That quote isn't waiting for approval any more.", status=409)
        if order["quote_expires_at"] < self.clock():
            self.store.update_domain_order(order["id"], ("quoted",), status="expired")
            raise DomainError("quote_expired", "That price has expired. Ask again for a fresh one.", status=409)
        if int(amount_minor) != order["amount_minor"]:
            raise DomainError("amount_mismatch", "The amount approved doesn't match the quote.", status=409)
        contact = self.store.domain_contact(account["id"])
        if not renewal and (problem := contact_problem(contact)):
            raise DomainError("contact", f"Before buying, {problem}.", status=409)
        # Re-check right before taking money: the name or its price may have changed since the quote.
        if not renewal:
            a = self.p.registrar.check(d["name"])
            if not a.available or a.premium or (self.store.domain_owner(d["name"]) or {}).get("id", d["id"]) != d["id"]:
                self._fail(d, "taken before payment", via, step=None, order=order)
                raise DomainError("taken", f"Sorry, {d['name']} was just taken.", status=409)
        price = self.p.registrar.price(d["name"])
        first, renew = self._priced(price)
        now_amount = renew if renewal else first
        if now_amount != order["amount_minor"]:
            self.store.domain_event(d["id"], via, "price changed before payment", order["id"],
                                    {"quoted": order["amount_minor"], "now": now_amount})
            new = self.store.create_domain_order(
                d["id"], account["id"], order["kind"], 1, now_amount, self.s.domain_currency, renew,
                price.renewal_minor if renewal else price.first_year_minor, price.currency,
                self.s.domain_quote_minutes * 60, self.clock())
            if not renewal:
                self.store.transition_domain(d["id"], (S.AWAITING_APPROVAL,), S.AWAITING_APPROVAL, "system",
                                             new["id"], {"amount": now_amount, "reason": "price changed"},
                                             first_year_minor=first, renewal_minor=renew)
            raise DomainError("price_changed", f"The price of {d['name']} changed to "
                              f"{money(now_amount, self.s.domain_currency)}. Please approve the new price.",
                              status=409, order_id=new["id"], amount_minor=now_amount)
        checkout = self.p.payments.create_checkout(
            amount_minor=order["amount_minor"], currency=order["currency"],
            description=f"{'Renewal of' if renewal else 'Domain'} {d['name']} (1 year)",
            customer_email=account.get("email"), return_url=return_url,
            metadata={"domain_order_id": order["id"], "domain_id": d["id"], "account_id": account["id"],
                      "idempotency_key": order["idempotency_key"]})
        ok = self.store.update_domain_order(
            order["id"], ("quoted",), status="awaiting_payment", approved_at=self.clock(), approved_via=via,
            approval_text=(text or "")[:300], registrant=contact, payment_provider=self.p.payments.name,
            checkout_id=checkout.checkout_id, checkout_url=checkout.url,
            quote_expires_at=self.clock() + self.s.domain_payment_hours * 3600)
        if not ok:
            raise DomainError("not_awaiting", "That quote was already approved.", status=409)
        if not renewal:
            self.store.transition_domain(d["id"], (S.AWAITING_APPROVAL,), S.PAYMENT_PENDING, via, order["id"],
                                         {"checkout": checkout.checkout_id, "approval": (text or "")[:120]})
        else:
            self.store.domain_event(d["id"], via, "renewal approved", order["id"], {"checkout": checkout.checkout_id})
        event("domains.approved", domain=d["name"], order=order["id"], via=via)
        return {"domain_id": d["id"], "order_id": order["id"], "checkout_url": checkout.url,
                "amount_minor": order["amount_minor"], "currency": order["currency"]}

    def handle_webhook(self, headers: dict, body: bytes) -> str:
        """A signed payment webhook. Raises ProviderError (-> 401) when the signature is wrong."""
        ev = self.p.payments.verify_webhook(headers, body)
        if self.store.domain_webhook_seen(ev.webhook_id):
            return "duplicate"
        outcome = self._payment_event(ev)
        # Marked as handled only once it was: if the provider couldn't be reached it raised, the sender retries,
        # and the retry is processed. Processing twice is harmless (every payment step is compare-and-set).
        self.store.first_domain_webhook(ev.webhook_id)
        return outcome

    def _payment_event(self, ev) -> str:
        if not ev.type.startswith("payment.") or not ev.payment_id:
            return "ignored"
        payment = self.p.payments.payment(ev.payment_id)  # the provider's API is the proof, not the webhook body
        order = None
        if (oid := str((payment.metadata or {}).get("domain_order_id") or "")).isdigit():
            order = self.store.domain_order(int(oid))
        if order is None and payment.checkout_id:
            order = self.store.domain_order_by("checkout_id", payment.checkout_id)
        if order is None:
            return "not_ours"
        if payment.status == "succeeded":
            return self.payment_verified(order, payment)
        if payment.status in ("failed", "cancelled"):
            self.store.update_domain_order(order["id"], ("awaiting_payment",), error=f"payment {payment.status}")
            self.store.domain_event(order["domain_id"], "webhook", f"payment {payment.status}", order["id"],
                                    {"payment": payment.payment_id})
            d = self.store.domain(order["domain_id"])
            self.notify(order["account_id"], f"The payment for {d['name']} didn't go through, so nothing was bought. "
                                             f"You can try again with the same link: {order['checkout_url']}")
            return "payment_failed"
        return "pending"

    def payment_verified(self, order: dict, payment) -> str:
        """Payment confirmed by the provider's API. Checks it really is for this order, in full, then hands the
        domain to the runner. Late, short or doubled payments are refunded."""
        problems = []
        if str((payment.metadata or {}).get("domain_order_id", order["id"])) != str(order["id"]):
            problems.append("metadata names another order")
        if order.get("checkout_id") and payment.checkout_id and payment.checkout_id != order["checkout_id"]:
            problems.append("different checkout")
        if payment.currency.upper() != order["currency"].upper() or payment.amount_minor < order["amount_minor"]:
            problems.append(f"paid {payment.amount_minor} {payment.currency}, quoted {order['amount_minor']} "
                            f"{order['currency']}")
        if problems:
            self.store.domain_event(order["domain_id"], "webhook", "payment rejected", order["id"],
                                    {"payment": payment.payment_id, "problems": problems})
            self._refund(order, payment.payment_id, "payment did not match the quote")
            return "rejected"
        claimed = self.store.update_domain_order(order["id"], ("awaiting_payment",), status="paid",
                                                 payment_id=payment.payment_id, paid_minor=payment.amount_minor,
                                                 paid_at=self.clock(), error=None)
        if not claimed:
            current = self.store.domain_order(order["id"])
            if current and current["payment_id"] == payment.payment_id:
                return "already_paid"
            # Paid after the quote ran out or was cancelled, or paid twice: never register on it, give it back.
            self.store.domain_event(order["domain_id"], "webhook", "payment for a closed order", order["id"],
                                    {"payment": payment.payment_id, "order_status": current and current["status"]})
            self._refund(order, payment.payment_id, "the order was no longer open")
            return "refunded"
        d = self.store.domain(order["domain_id"])
        if order["kind"] == "renew":
            self.store.domain_event(d["id"], "webhook", "renewal paid", order["id"], {"payment": payment.payment_id})
            self.store.update_domain(d["id"], next_run_at=self.clock(), attempts=0, step_started_at=self.clock())
            return "renewal_paid"
        try:
            moved = self.store.transition_domain(
                d["id"], (S.PAYMENT_PENDING,), S.REGISTERING, "webhook", order["id"],
                {"payment": payment.payment_id, "amount": payment.amount_minor},
                next_run_at=self.clock(), attempts=0, step_started_at=self.clock(), last_error=None)
        except DuplicateDomainError:
            moved = False
        if not moved:
            self._refund(self.store.domain_order(order["id"]), payment.payment_id, "the domain could not be reserved")
            self._fail(d, "paid but the domain was no longer reservable", "webhook", step=None)
            return "refunded"
        event("domains.paid", domain=d["name"], order=order["id"])
        self.notify(order["account_id"], f"Payment received. Registering {d['name']} for you now; "
                                         "I'll message you when it's live.")
        return "paid"

    def _refund(self, order: dict | None, payment_id: str, reason: str) -> None:
        if order is None:
            return
        try:
            ref = self.p.payments.refund(payment_id, reason)
            if order.get("payment_id") in (None, payment_id):
                self.store.update_domain_order(order["id"], refund_status="refunded", error=reason)
            self.store.domain_event(order["domain_id"], "system", "refunded", order["id"],
                                    {"payment": payment_id, "refund": ref, "reason": reason})
        except ProviderError as e:
            self.store.update_domain_order(order["id"], refund_status="failed", error=f"{reason}; refund failed: {e}")
            self.store.domain_event(order["domain_id"], "system", "REFUND FAILED: needs a person", order["id"],
                                    {"payment": payment_id, "error": str(e)})
            event("domains.refund_failed", logging.ERROR, order=order["id"])

    # ---------- customer actions ----------
    def cancel(self, account: dict, domain_id: int) -> dict:
        d = self.store.account_domain(account["id"], domain_id)
        if d is None:
            raise DomainError("not_found", "That domain wasn't found.", status=404)
        if d["state"] not in S.PRE_PAYMENT:
            raise DomainError("too_late", "That domain is already paid for.", status=409)
        order = self.store.latest_domain_order(d["id"], "register")
        if order:
            self.store.update_domain_order(order["id"], ("quoted", "awaiting_payment"), status="cancelled")
        self._fail(d, "cancelled by the customer", "customer", step=None)
        return self.store.domain(d["id"])

    def retry(self, account: dict | None, domain_id: int, actor: str = "customer") -> dict:
        """Resume a failed domain from the step that failed (only after it was paid for and registered or while
        registering: nothing before payment is retried, the customer asks for a new quote instead)."""
        d = self.store.domain(domain_id) if account is None else self.store.account_domain(account["id"], domain_id)
        if d is None:
            raise DomainError("not_found", "That domain wasn't found.", status=404)
        step = d.get("failed_step")
        order = self.store.latest_domain_order(d["id"], "register")
        if d["state"] != S.FAILED or step not in S.PIPELINE or (order or {}).get("refund_status") == "refunded":
            raise DomainError("not_retryable", "That domain can't be retried; ask for a new quote instead.", status=409)
        self.store.transition_domain(d["id"], (S.FAILED,), step, actor, detail={"retry": True}, attempts=0,
                                     next_run_at=self.clock(), step_started_at=self.clock(), failed_step=None,
                                     last_error=None)
        return self.store.domain(d["id"])

    def renewal_quote(self, account: dict, domain_id: int) -> dict:
        d = self.store.account_domain(account["id"], domain_id)
        if d is None:
            raise DomainError("not_found", "That domain wasn't found.", status=404)
        if d["state"] not in (S.LIVE, S.EXPIRING):
            raise DomainError("not_renewable", "Only a live domain can be renewed.", status=409)
        if d["state"] == S.LIVE:
            self.store.transition_domain(d["id"], (S.LIVE,), S.EXPIRING, "customer", detail={"early_renewal": True})
        price = self.p.registrar.price(d["name"])
        _, renew = self._priced(price)
        return self.store.create_domain_order(d["id"], account["id"], "renew", 1, renew, self.s.domain_currency, renew,
                                              price.renewal_minor, price.currency, self.s.domain_quote_minutes * 60, self.clock())

    def summary(self, d: dict) -> dict:
        order = self.store.latest_domain_order(d["id"])
        return {"id": d["id"], "domain": d["name"], "state": d["state"], "label": S.LABELS.get(d["state"], ""),
                "project_id": d["project_id"], "url": f"https://{d['name']}/" if d["state"] in S.ROUTABLE else None,
                "first_year_minor": d["first_year_minor"], "renewal_minor": d["renewal_minor"],
                "currency": d["currency"], "expires_at": d["expires_at"], "error": d["last_error"],
                "retryable": d["state"] == S.FAILED and d.get("failed_step") in S.PIPELINE,
                "order": None if order is None else {
                    "id": order["id"], "kind": order["kind"], "status": order["status"],
                    "amount_minor": order["amount_minor"], "currency": order["currency"],
                    "quote_expires_at": order["quote_expires_at"],
                    "checkout_url": order["checkout_url"] if order["status"] == "awaiting_payment" else None,
                    "refund_status": order["refund_status"]}}

    def status_text(self, account: dict) -> str:
        rows = self.store.account_domains(account["id"])[:5]
        if not rows:
            return "You don't have a custom domain yet. Want me to find one for your site?"
        lines = []
        for d in rows:
            line = f"{d['name']}: {S.LABELS.get(d['state'], d['state'].lower())}"
            if d["state"] in (S.LIVE, S.EXPIRING):
                line += f" at https://{d['name']}/"
            if d["state"] == S.FAILED and d.get("last_error"):
                line += f" ({d['last_error'][:80]})"
            lines.append(line)
        return "\n".join(lines)

    # ---------- the background runner ----------
    def run_due(self, owner: str) -> bool:
        d = self.store.claim_domain(owner, LEASE_S, self.clock())
        if d is None:
            return False
        try:
            self.step(d)
        except Exception as e:  # noqa: BLE001 - one bad domain must not stop the others
            log.exception("domain step crashed")
            self._retry_later(d, f"internal error: {type(e).__name__}", transient=True)
        finally:
            self.store.release_domain(d["id"], owner)
        return True

    def step(self, d: dict) -> None:
        handler = {S.REGISTERING: self._register, S.REGISTERED: self._after_registered,
                   S.CONFIGURING_DNS: self._configure_dns, S.VERIFYING_DNS: self._verify_dns,
                   S.CONNECTING_HOSTING: self._connect_hosting, S.PROVISIONING_SSL: self._provision_ssl,
                   S.VERIFYING_DEPLOYMENT: self._verify_deployment, S.LIVE: self._renew,
                   S.EXPIRING: self._renew}.get(d["state"])
        if handler is None:
            self.store.update_domain(d["id"], next_run_at=None)
            return
        try:
            handler(d)
        except ProviderError as e:
            self._retry_later(d, str(e), e.transient)

    def _advance(self, d: dict, to_state: str, detail: dict | None = None, **fields) -> None:
        if not S.allowed(d["state"], to_state):
            raise RuntimeError(f"illegal domain transition {d['state']} -> {to_state}")
        now = self.clock()
        self.store.transition_domain(d["id"], (d["state"],), to_state, "runner", detail=detail, attempts=0,
                                     next_run_at=now, step_started_at=now, last_error=None, **fields)

    def _wait(self, d: dict, why: str) -> None:
        """The outside world isn't ready yet (DNS delegation, a certificate). Poll again, slower over time."""
        started = d.get("step_started_at") or self.clock()
        elapsed = self.clock() - started
        if elapsed > WAIT_LIMITS.get(d["state"], 3600):
            self._fail(d, f"gave up waiting: {why}", "runner", step=d["state"])
            return
        delay = min(max(elapsed / 4, 30), 1800)
        self.store.update_domain(d["id"], next_run_at=self.clock() + delay, last_error=why)

    def _retry_later(self, d: dict, error: str, transient: bool) -> None:
        attempts = (d.get("attempts") or 0) + 1
        if not transient or attempts >= MAX_ATTEMPTS:
            if d["state"] == S.REGISTERING:
                order = self.store.latest_domain_order(d["id"], "register")
                # Refund only if we can be sure nothing was bought.
                if order and order.get("payment_id") and self.p.registrar.owns(d["name"]) is None:
                    self._refund(order, order["payment_id"], f"registration failed: {error}")
                    self._fail(d, f"registration failed and was refunded: {error}", "runner", step=None)
                    return
            self._fail(d, error, "runner", step=d["state"])
            return
        delay = min(RETRY_BASE_S * 2 ** (attempts - 1), RETRY_CAP_S)
        self.store.update_domain(d["id"], attempts=attempts, next_run_at=self.clock() + delay, last_error=error)
        self.store.domain_event(d["id"], "runner", "will retry", detail={"error": error[:300], "attempt": attempts,
                                                                          "in_s": delay})

    def _fail(self, d: dict, reason: str, actor: str, step: str | None, order: dict | None = None) -> None:
        self.store.transition_domain(d["id"], tuple(s for s in S.ALL if s not in (S.FAILED, S.EXPIRED)), S.FAILED,
                                     actor, order and order["id"], {"reason": reason[:300]}, failed_step=step,
                                     last_error=reason[:500], next_run_at=None)
        event("domains.failed", logging.WARNING, domain=d["name"], step=step, reason=reason[:120])
        if step is not None:  # after payment: the customer must hear about it
            self.notify(d["account_id"], f"Setting up {d['name']} hit a problem ({reason[:120]}). "
                                         "We're looking into it; your payment is safe.")

    # ---------- the steps ----------
    def _register(self, d: dict) -> None:
        order = self.store.latest_domain_order(d["id"], "register")
        if order is None or order["status"] != "paid" or not order.get("payment_id"):
            self._fail(d, "no verified payment for this domain", "runner", step=None)  # never register unpaid
            return
        mine = self.p.registrar.owns(d["name"])  # an earlier attempt may have gone through before a timeout
        if mine is not None:
            self.store.domain_event(d["id"], "runner", "already registered by an earlier attempt", order["id"])
            self.store.update_domain_order(order["id"], status="fulfilled")
            self._advance(d, S.REGISTERED, {"order": mine.order_id, "recovered": True},
                          registrar_order_id=mine.order_id, expires_at=mine.expires_at)
            return
        a = self.p.registrar.check(d["name"])
        if not a.available:
            self._refund(order, order["payment_id"], "the domain was taken before registration")
            self._fail(d, "taken before it could be registered; refunded", "runner", step=None)
            self.notify(d["account_id"], f"Sorry, {d['name']} was taken by someone else before I could register "
                                         "it. Your payment has been refunded.")
            return
        price = self.p.registrar.price(d["name"])
        first, _ = self._priced(price)
        if first > order["amount_minor"]:
            self._refund(order, order["payment_id"], "the registry price went up")
            self._fail(d, "price went up after payment; refunded", "runner", step=None)
            self.notify(d["account_id"], f"The price of {d['name']} went up after you paid, so I didn't buy it and "
                                         "refunded you. Ask me for a fresh quote if you still want it.")
            return
        contact = order.get("registrant") or {}
        reg = self.p.registrar.register(d["name"], order["years"], contact, [], price)
        self.store.update_domain_order(order["id"], status="fulfilled")
        self._advance(d, S.REGISTERED, {"order": reg.order_id}, registrar_order_id=reg.order_id,
                      expires_at=reg.expires_at)

    def _after_registered(self, d: dict) -> None:
        self._advance(d, S.CONFIGURING_DNS)

    def _configure_dns(self, d: dict) -> None:
        zone = self.p.dns.ensure_zone(d["name"])
        self.store.update_domain(d["id"], dns_zone_id=zone.zone_id, nameservers=zone.nameservers)
        self.p.dns.point_to_origin(zone.zone_id, d["name"])
        if zone.nameservers:
            self.p.registrar.set_nameservers(d["name"], zone.nameservers)
        self._advance(d, S.VERIFYING_DNS, {"zone": zone.zone_id, "nameservers": zone.nameservers})

    def _verify_dns(self, d: dict) -> None:
        zone = self.p.dns.zone(d["dns_zone_id"])
        if zone.status == "active":
            self._advance(d, S.CONNECTING_HOSTING)
        else:
            self._wait(d, f"DNS zone is {zone.status}")

    def _connect_hosting(self, d: dict) -> None:
        if not d.get("project_id"):
            self._fail(d, "no website chosen for this domain", "runner", step=d["state"])
            return
        ref = self.p.hosting.connect(d["name"])
        self._advance(d, S.PROVISIONING_SSL, {"route": ref}, hosting_ref=ref)

    def _provision_ssl(self, d: dict) -> None:
        status = self.p.ssl.status(d["dns_zone_id"], d["name"])
        self.store.update_domain(d["id"], ssl_status=status)
        if status == "active":
            self._advance(d, S.VERIFYING_DEPLOYMENT)
        elif status == "failed":
            self._fail(d, "the HTTPS certificate could not be issued", "runner", step=d["state"])
        else:
            self._wait(d, f"certificate {status}")

    def _verify_deployment(self, d: dict) -> None:
        ok, why = self.p.verifier.check(d["name"], d["verify_token"])
        if not ok:
            self._wait(d, why)
            return
        self._advance(d, S.LIVE, {"url": f"https://{d['name']}/"}, live_at=self.clock())
        self.store.update_domain(d["id"], next_run_at=None)
        event("domains.live", domain=d["name"])
        self.notify(d["account_id"], f"Your domain is live: https://{d['name']}/ (HTTPS on, it shows your site).")

    def _renew(self, d: dict) -> None:
        order = self.store.latest_domain_order(d["id"], "renew")
        if order is None or order["status"] != "paid":
            self.store.update_domain(d["id"], next_run_at=None)
            return
        year = time.gmtime(d["expires_at"] or self.clock()).tm_year
        reg = self.p.registrar.renew(d["name"], order["years"], year)
        self.store.update_domain_order(order["id"], status="fulfilled")
        expires = reg.expires_at or (d["expires_at"] or self.clock()) + 365 * 86_400
        if d["state"] == S.EXPIRING:
            self._advance(d, S.LIVE, {"renewed_until": expires}, expires_at=expires)
        else:
            self.store.update_domain(d["id"], expires_at=expires)
        self.store.update_domain(d["id"], next_run_at=None)
        self.notify(d["account_id"], f"{d['name']} is renewed until {time.strftime('%d %b %Y', time.gmtime(expires))}.")

    # ---------- housekeeping ----------
    def housekeeping(self) -> None:
        now = self.clock()
        for order in self.store.stale_domain_orders(now):
            if not self.store.update_domain_order(order["id"], ("quoted", "awaiting_payment"), status="expired"):
                continue
            d = self.store.domain(order["domain_id"])
            if order["kind"] == "register" and d and d["state"] in (S.AWAITING_APPROVAL, S.PAYMENT_PENDING):
                self._fail(d, "the quote expired before payment", "system", step=None)
        for d in self.store.domains_in((S.LIVE,)):
            if d["expires_at"] and d["expires_at"] - now < RENEW_NOTICE_S:
                self.store.transition_domain(d["id"], (S.LIVE,), S.EXPIRING, "system",
                                             detail={"expires_at": d["expires_at"]})
                account = self.store.one("SELECT * FROM accounts WHERE id = ?", (d["account_id"],))
                try:
                    order = self.renewal_quote(account, d["id"]) if account else None
                except (DomainError, ProviderError):
                    order = None
                left = max(0, int((d["expires_at"] - now) // 86_400))
                self.notify(d["account_id"], f"{d['name']} expires in {left} days. Renewing costs "
                                             f"{money(order['amount_minor'] if order else d['renewal_minor'], d['currency'])} "
                                             "for a year: reply YES to renew it.")
        for d in self.store.domains_in((S.EXPIRING,)):
            if d["expires_at"] and d["expires_at"] < now:
                paid = self.store.latest_domain_order(d["id"], "renew")
                if paid and paid["status"] == "paid":
                    continue  # renewal is in flight
                self.store.transition_domain(d["id"], (S.EXPIRING,), S.EXPIRED, "system", next_run_at=None)
                try:
                    self.p.hosting.disconnect(d["name"])
                except ProviderError:
                    log.warning("could not disconnect expired domain %s", d["name"])
                self.notify(d["account_id"], f"{d['name']} has expired and no longer shows your site.")
