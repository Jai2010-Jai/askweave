"""askweave.xyz accounts: sign up (email or Google), the dashboard, and abuse reports.

An account owns a permanent username (its subdomain, <username>.askweave.xyz) and an editable call sign. The
account proves it owns a WhatsApp number by texting LINK <code> from it; after that the bot and the dashboard
share the same projects. The browser holds an HttpOnly session cookie that is host-only (never shared with the
customer sites on the subdomains), and every POST needs the X-Weave header, so no other site can post here."""

from __future__ import annotations

import base64
import json
import logging
import re
import secrets
import threading
import time
from pathlib import Path
from urllib.parse import quote, urlencode

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response

from ..analytics.collector import Beacon, client_ip, is_bot, utc_day, visitor_hash
from ..analytics.metrics import WINDOWS, sales_summary, traffic_summary
from ..analytics.sales import read_csv
from ..config import Settings
from ..core.jobs import JobStore
from ..sms import messages as M
from ..sms.chat import AttemptLimiter
from ..sms.observe import event
from ..sms.phone import mask
from ..sms.routes import PREVIEW_CSP
from ..sms.service import Inbound, SmsService, address
from ..sms.store import SmsStore
from ..web.hosting import dir_size
from ..web.validate import PAGE_NAME_RE
from .names import clean_call_sign, username_problem
from .stitch import SCOPE as STITCH_SCOPE, StitchLinks

STATIC = Path(__file__).resolve().parent.parent / "static" / "site"
COOKIE = "weave_session"
PENDING_COOKIE = "weave_google"
SESSION_TTL_S = 30 * 86_400
PAGES = {"start", "dashboard", "terms", "privacy", "report", "contact"}
ASSETS = {"site.css": "text/css", "site.js": "text/javascript", "start.js": "text/javascript",
          "dashboard.js": "text/javascript", "report.js": "text/javascript", "chart.js": "text/javascript",
          "contact.js": "text/javascript"}
CSP = ("default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; "
       "frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://accounts.google.com")
REPORT_REASONS = {"phishing", "scam", "malware", "impersonation", "adult", "hate", "copyright", "other"}
GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_TOKENINFO = "https://oauth2.googleapis.com/tokeninfo"

log = logging.getLogger(__name__)


class Pending:
    """Short-lived server-side state: Google sign-ins waiting to pick a username, and OAuth `state` values."""

    def __init__(self, ttl_s: float = 900):
        self.ttl, self.items, self.lock = ttl_s, {}, threading.Lock()

    def put(self, value) -> str:
        key = secrets.token_urlsafe(24)
        with self.lock:
            now = time.time()
            self.items = {k: v for k, v in self.items.items() if v[0] > now}
            self.items[key] = (now + self.ttl, value)
        return key

    def get(self, key: str, pop: bool = False):
        with self.lock:
            item = self.items.pop(key, None) if pop else self.items.get(key)
        return item[1] if item and item[0] > time.time() else None


def build_site_router(settings: Settings, store: SmsStore, service: SmsService, builds: JobStore,
                      worker=None, stitch: StitchLinks | None = None) -> APIRouter:
    r = APIRouter()
    signups = AttemptLimiter(max_failures=40, window_s=3600)  # counts every sign-up, not just failures
    reports = AttemptLimiter(max_failures=30, window_s=3600)
    # Both are reachable from any hosted page, so they are capped globally rather than per visitor.
    beacons = AttemptLimiter(max_failures=20_000, window_s=3600)
    leads = AttemptLimiter(max_failures=300, window_s=3600)
    imports = AttemptLimiter(max_failures=60, window_s=3600)
    google = Pending()
    states = Pending(ttl_s=600)
    base = settings.public_base_url
    domain = settings.sites_domain or "askweave.xyz"

    def secure(request: Request) -> bool:
        return (request.headers.get("x-forwarded-proto") == "https" or request.url.scheme == "https"
                or base.startswith("https://") and not getattr(request.state, "local", False))

    def require_csrf(request: Request) -> None:
        if request.headers.get("x-weave") != "1":
            raise HTTPException(403, "missing X-Weave header")

    def current(request: Request) -> dict:
        token = request.cookies.get(COOKIE, "")
        account = store.account_by_session(token) if token else None
        if account is None:
            raise HTTPException(401, "Not signed in")
        return account

    def signed_in(resp: Response, request: Request, account_id: int) -> Response:
        token = store.create_account_session(account_id, SESSION_TTL_S)
        # No Domain attribute: the cookie stays on this host and never reaches <username>.askweave.xyz.
        resp.set_cookie(COOKIE, token, max_age=SESSION_TTL_S, httponly=True, samesite="lax",
                        secure=secure(request), path="/")
        resp.delete_cookie(PENDING_COOKIE, path="/")
        return resp

    async def body(request: Request) -> dict:
        try:
            data = await request.json()
        except ValueError:
            raise HTTPException(400, "send JSON") from None
        if not isinstance(data, dict):
            raise HTTPException(400, "send a JSON object")
        return data

    def project_of(account: dict, project_id: int, deleted: bool | None = False) -> tuple[dict, dict]:
        user = store.account_user(account["id"])
        project = store.project(user["id"], project_id) if user else None
        if project is None or (deleted is not None and bool(project.get("deleted_at")) != deleted):
            raise HTTPException(404, "project not found")
        return user, project

    def project_json(user: dict, p: dict) -> dict:
        last = store.latest_job(user["id"], p["id"])
        return {"id": p["id"], "number": p["number"], "name": M.name_of(p), "kind": p.get("kind") or "android",
                "url": p.get("deploy_url"), "prompt": p.get("original_prompt"), "updated_at": p.get("updated_at"),
                "status": last["status"] if last else None, "ref": last["ref"] if last else None,
                "ready": bool(p.get("last_success_build_id")), "deleted_at": p.get("deleted_at")}

    # ---------- pages ----------
    def page(name: str) -> FileResponse:
        return FileResponse(STATIC / f"{name}.html", headers={"Cache-Control": "no-cache", "Content-Security-Policy": CSP})

    @r.get("/start")
    def start_page():
        return page("start")

    @r.get("/dashboard")
    def dashboard_page():
        return page("dashboard")

    @r.get("/terms")
    def terms_page():
        return page("terms")

    @r.get("/privacy")
    def privacy_page():
        return page("privacy")

    @r.get("/report")
    def report_page():
        return page("report")

    @r.get("/site/{name}")
    def asset(name: str):
        if name not in ASSETS:
            raise HTTPException(404)
        return FileResponse(STATIC / name, media_type=ASSETS[name], headers={"Cache-Control": "no-cache"})

    # ---------- sign up and sign in ----------
    @r.get("/api/account/config")
    def config(request: Request):
        pending = google.get(request.cookies.get(PENDING_COOKIE, ""))
        return {"google": bool(settings.google_client_id and settings.google_client_secret), "domain": domain,
                "stitch": stitch_on(),
                "google_pending": {"email": pending["email"], "name": pending.get("name", ""),
                                   "stitch": bool(pending.get("stitch_refresh"))} if pending else None}

    @r.get("/api/account/username")
    def check_username(name: str = ""):
        name = name.strip().lower()
        problem = username_problem(name) or taken(name)
        return {"ok": not problem, "problem": problem}

    def taken(name: str) -> str:
        if store.account_by("username", name) or (settings.hosted_dir / name).exists():
            return "That name is taken."
        return ""

    @r.post("/api/account/signup")
    async def signup(request: Request):
        require_csrf(request)
        if signups.blocked():
            raise HTTPException(429, "Too many sign-ups right now. Try again in a while.")
        data = await body(request)
        username = str(data.get("username", "")).strip().lower()
        if problem := username_problem(username) or taken(username):
            raise HTTPException(400, problem)
        call_sign = clean_call_sign(str(data.get("call_sign", "")))
        if not call_sign:
            raise HTTPException(400, "Pick a name for Weave to call you (letters, numbers, spaces).")
        if data.get("terms") is not True:
            raise HTTPException(400, "Please accept the terms and privacy policy.")
        # Accounts are Google-only: sign-up finishes a Google sign-in that /auth/google/callback left pending.
        pending = google.get(request.cookies.get(PENDING_COOKIE, ""))
        if not pending:
            raise HTTPException(400, "Continue with Google first.")
        email, sub = pending["email"], pending["sub"]
        if store.account_by("google_sub", sub):
            raise HTTPException(400, "This Google account already has a Weave account. Sign in instead.")
        if store.account_by("email", email):
            raise HTTPException(400, "That email already has an account. Sign in instead.")
        invite = "".join(ch for ch in str(data.get("invite", "")).upper() if ch.isalnum())[:16] or None
        signups.record()
        try:
            account = await run_in_threadpool(lambda: store.create_account(
                username=username, call_sign=call_sign, email=email, password=None, google_sub=sub,
                referral_code=invite))
        except Exception as e:  # unique constraint: someone took it a moment ago
            log.info("signup conflict: %s", e)
            raise HTTPException(400, "That name or email was just taken. Try another.") from None
        google.get(request.cookies.get(PENDING_COOKIE, ""), pop=True)
        if stitch and pending.get("stitch_refresh"):  # they connected Stitch in the same Google consent
            stitch.save(account["id"], email, pending["stitch_refresh"])
        event("site.signup", account=account["id"], google=True, stitch=bool(pending.get("stitch_refresh")))
        return signed_in(JSONResponse({"ok": True}), request, account["id"])

    @r.post("/api/account/logout")
    def logout(request: Request):
        require_csrf(request)
        token = request.cookies.get(COOKIE, "")
        if token:
            store.delete_account_sessions(raw=token)
        resp = JSONResponse({"ok": True})
        resp.delete_cookie(COOKIE, path="/")
        return resp

    def stitch_on() -> bool:
        return bool(stitch and stitch.available)

    def google_redirect(*, with_stitch: bool, connect: int | None = None, hint: str | None = None) -> RedirectResponse:
        """Google's consent page. With Stitch, the same single consent also lets Weave design in the person's own
        Stitch account: offline access gives a refresh token for building later, while they're away."""
        params = {"client_id": settings.google_client_id, "redirect_uri": f"{base}/auth/google/callback",
                  "response_type": "code", "scope": "openid email profile",
                  "state": states.put({"stitch": with_stitch, "connect": connect}), "prompt": "select_account"}
        if with_stitch:
            params.update(scope=f"openid email profile {STITCH_SCOPE}", access_type="offline",
                          include_granted_scopes="true", prompt="consent select_account")
        if hint:
            params["login_hint"] = hint
        return RedirectResponse(f"{GOOGLE_AUTH}?{urlencode(params)}", status_code=303)

    @r.get("/auth/google")
    def google_start(stitch: int = 0):
        """Google's consent page: sign-in (name and email), plus Stitch access when ?stitch=1."""
        if not (settings.google_client_id and settings.google_client_secret and base):
            return RedirectResponse("/start?error=google_off", status_code=303)
        return google_redirect(with_stitch=bool(stitch and stitch_on()))

    @r.get("/auth/stitch")
    def stitch_start(request: Request):
        """The dashboard's one-click "Connect Stitch"."""
        account = current(request)
        if not stitch_on() or not base:
            return RedirectResponse("/dashboard?stitch=off", status_code=303)
        return google_redirect(with_stitch=True, connect=account["id"], hint=account.get("email"))

    @r.get("/auth/google/callback")
    async def google_callback(request: Request, code: str = "", state: str = "", error: str = ""):
        flow = states.get(state, pop=True)
        if isinstance(flow, dict) and flow.get("connect") and (error or not code):
            return RedirectResponse("/dashboard?stitch=cancelled", status_code=303)
        if not code or flow is None:
            return RedirectResponse("/start?error=google", status_code=303)
        flow = flow if isinstance(flow, dict) else {}
        try:
            info = await run_in_threadpool(google_identity, code)
        except Exception as e:
            log.warning("google sign-in failed: %s", e)
            return RedirectResponse("/dashboard?stitch=failed" if flow.get("connect") else "/start?error=google",
                                    status_code=303)
        # People can untick Stitch on Google's consent page; then there's no Stitch access to keep.
        refresh = info.get("refresh_token") if flow.get("stitch") and STITCH_SCOPE in info.get("scopes", ()) else None
        if flow.get("connect"):
            account = current(request)
            if account["id"] != flow["connect"]:
                raise HTTPException(403, "Signed in as someone else")
            if not (stitch and refresh):
                return RedirectResponse("/dashboard?stitch=missing", status_code=303)
            stitch.save(account["id"], info["email"], refresh)
            event("site.stitch_connected", account=account["id"])
            return RedirectResponse("/dashboard?stitch=connected", status_code=303)
        account = store.account_by("google_sub", info["sub"])
        if account is not None and account["status"] == "active":
            if stitch and refresh:
                stitch.save(account["id"], info["email"], refresh)
            return signed_in(RedirectResponse("/dashboard", status_code=303), request, account["id"])
        if account is not None:
            return RedirectResponse("/start?error=closed", status_code=303)
        key = google.put({"sub": info["sub"], "email": info["email"], "name": info.get("name", ""),
                          "stitch_refresh": refresh})
        resp = RedirectResponse("/start?google=1", status_code=303)
        resp.set_cookie(PENDING_COOKIE, key, max_age=900, httponly=True, samesite="lax", secure=secure(request), path="/")
        return resp

    def google_identity(code: str) -> dict:
        import httpx

        with httpx.Client(timeout=15) as client:
            tok = client.post(GOOGLE_TOKEN, data={
                "code": code, "client_id": settings.google_client_id, "client_secret": settings.google_client_secret,
                "redirect_uri": f"{base}/auth/google/callback", "grant_type": "authorization_code"})
            tok.raise_for_status()
            tokens = tok.json()
            # Google checks the token's signature and expiry for us; we check it was issued to this app.
            info = client.get(GOOGLE_TOKENINFO, params={"id_token": tokens["id_token"]})
            info.raise_for_status()
            claims = info.json()
        if claims.get("aud") != settings.google_client_id or claims.get("iss") not in ("accounts.google.com",
                                                                                         "https://accounts.google.com"):
            raise ValueError("token not issued to this app")
        if str(claims.get("email_verified")).lower() != "true" or not claims.get("email"):
            raise ValueError("email not verified")
        return {"sub": str(claims["sub"]), "email": claims["email"].lower(), "name": claims.get("name", ""),
                "refresh_token": tokens.get("refresh_token"), "scopes": str(tokens.get("scope", "")).split()}

    # ---------- the account ----------
    @r.get("/api/account/me")
    def me(request: Request):
        account = current(request)
        user = store.account_user(account["id"])
        projects = store.account_projects(user["id"]) if user else []
        trash = store.account_projects(user["id"], deleted=True) if user else []
        day = store.usage(user["id"], time.time() - 86_400) if user else {"builds": 0, "tokens_in": 0, "tokens_out": 0}
        month = store.usage(user["id"], time.time() - 30 * 86_400) if user else day
        number = settings.twilio_whatsapp_number or settings.twilio_phone_number
        return {
            "username": account["username"], "call_sign": account["call_sign"], "email": account.get("email"),
            "address": f"https://{account['username']}.{domain}/", "google": bool(account.get("google_sub")),
            "phone": mask(user["phone"]) if user else None, "whatsapp": number,
            "projects": [project_json(user, p) for p in projects],
            "trash": [project_json(user, p) for p in trash],
            "usage": {"today": day, "month": month,
                      "storage_mb": round(dir_size(settings.user_sites_dir / account["username"]) / 1e6, 2)},
            "limits": {"builds_per_day": settings.sms_daily_builds_member + ((user.get("bonus_builds") or 0) if user else 0),
                       "projects": settings.max_projects, "storage_mb": settings.user_storage_mb,
                       "trash_days": settings.trash_days},
            "invite": store.referral_code(user["id"]) if user and settings.sms_referrals else None,
            "stitch": stitch.status(account["id"]) if stitch else {"available": False, "connected": False},
        }

    @r.get("/api/account/analytics")
    async def account_analytics(request: Request, days: int = 7):
        """Visits to this account's sites. Scoped by account id, never by anything in the request."""
        account = current(request)
        if not settings.analytics:
            raise HTTPException(404, "Analytics is switched off on this server.")
        window = days if days in WINDOWS else 7
        facts = await run_in_threadpool(traffic_summary, store, account["id"], days=window)
        return {**facts, "counting": (account.get("analytics") or "on") == "on"}

    @r.post("/api/account/analytics")
    async def set_account_analytics(request: Request):
        require_csrf(request)
        account = current(request)
        on = bool((await body(request)).get("on", True))
        store.update_account(account["id"], analytics="on" if on else "off")
        return {"ok": True, "counting": on}

    @r.get("/api/account/digest")
    async def account_digest(request: Request):
        account = current(request)
        if not settings.analytics:
            raise HTTPException(404, "Analytics is switched off on this server.")
        digest = await run_in_threadpool(store.latest_digest, account["id"])
        if not digest:
            return {"has_digest": False}
        return {
            "has_digest": True,
            "week": digest["week"],
            "body": digest["body"],
            "at": digest["at"],
        }

    @r.post("/api/account/digest/generate")
    async def generate_account_digest(request: Request):
        require_csrf(request)
        account = current(request)
        if not settings.analytics:
            raise HTTPException(404, "Analytics is switched off on this server.")
        import json
        from ..analytics.digest import generate_digest
        from ..analytics.metrics import week_of

        today = utc_day()
        week = week_of(today)
        nlg_pres = getattr(worker, "nlg", None)
        facts, text = await run_in_threadpool(
            generate_digest, store, account["id"], nlg=nlg_pres,
            limit=M.MAX_CHARS_CHAT, unicode=True,
        )
        now = time.time()
        await run_in_threadpool(store.save_digest, account["id"], week, text, json.dumps(facts), now)
        return {
            "has_digest": True,
            "week": week,
            "body": text,
            "has_data": facts.get("has_data", False),
            "at": now,
        }

    @r.get("/api/account/leads")
    async def account_leads(request: Request):
        account = current(request)
        rows = await run_in_threadpool(store.leads, account["id"], 50)
        return {"leads": [{"id": r["id"], "site": r["slug"] or account["username"], "name": r["name"],
                           "contact": r["contact"], "message": r["message"], "at": r["at"],
                           "read": r["read_at"] is not None} for r in rows],
                "unread": sum(1 for r in rows if r["read_at"] is None)}

    @r.post("/api/account/leads/read")
    def read_leads(request: Request):
        require_csrf(request)
        account = current(request)
        return {"ok": True, "marked": store.mark_leads_read(account["id"], time.time())}

    # ---------- sales ----------
    @r.post("/api/account/sales/import")
    async def import_sales(request: Request):
        """Step one parses and shows what it found; step two, with confirm, stores it.

        Two steps because 03/04 is the 3rd of April in most of the world and the 4th of March in some of it,
        and quietly picking one would move a month's takings into the wrong week with nothing to show for it.
        The uploaded file is never written to disk; only the rows read out of it are kept.
        """
        require_csrf(request)
        account = current(request)
        if imports.blocked():
            raise HTTPException(429, "Too many uploads just now. Try again shortly.")
        # The file arrives as the raw body rather than a multipart form: one fewer dependency
        # (python-multipart), and the size cap in the middleware reads Content-Length either way.
        data = await request.body()
        if not data:
            raise HTTPException(400, "Attach a .csv file.")
        yes = ("1", "true", "yes")
        confirm = request.query_params.get("confirm", "").lower() in yes
        dayfirst = None if not confirm else request.query_params.get("dayfirst", "true").lower() in yes
        try:
            parsed = await run_in_threadpool(read_csv, data, dayfirst=dayfirst)
        except ValueError as e:
            raise HTTPException(400, str(e)) from None

        preview = {"rows": len(parsed.rows), "skipped": parsed.skipped, "problems": parsed.problems,
                   "sample": parsed.sample, "currency": parsed.currency, "dayfirst": parsed.dayfirst,
                   "columns": {role: (parsed.headers[i] if i is not None and i < len(parsed.headers) else None)
                               for role, i in parsed.columns.items()},
                   "date_ambiguous": parsed.ambiguity == "unclear"}
        if not confirm:
            return {"stored": False, **preview}

        imports.record()
        name = re.sub(r"[^\w.\- ]", "", request.query_params.get("filename", ""))[:120] or "sales.csv"
        import_id = await run_in_threadpool(store.add_sales, account["id"], name, parsed.rows,
                                            parsed.skipped, parsed.currency, time.time())
        event("site.sales_import", account=account["id"], rows=len(parsed.rows))
        return {"stored": True, "import_id": import_id, **preview}

    @r.get("/api/account/sales")
    async def account_sales(request: Request):
        account = current(request)
        facts = await run_in_threadpool(sales_summary, store, account["id"])
        return {**facts, "imports": [{"id": i["id"], "filename": i["filename"], "rows": i["rows"],
                                      "skipped": i["skipped"], "at": i["at"]}
                                     for i in store.sales_imports(account["id"])]}

    @r.post("/api/account/sales/{import_id}/delete")
    def delete_sales(request: Request, import_id: int):
        require_csrf(request)
        account = current(request)
        removed = store.delete_sales_import(account["id"], import_id)
        return {"ok": True, "removed": removed}

    @r.post("/api/account/phone-code")
    def phone_code(request: Request):
        require_csrf(request)
        account = current(request)
        code = store.create_phone_code(account["id"])
        number = re.sub(r"\D", "", settings.twilio_whatsapp_number or settings.twilio_phone_number or "")
        link = f"https://wa.me/{number}?text={quote('LINK ' + code)}" if number else None
        return {"code": code, "whatsapp_link": link, "expires_in": 3600}

    @r.post("/api/account/call-sign")
    async def call_sign(request: Request):
        require_csrf(request)
        account = current(request)
        name = clean_call_sign(str((await body(request)).get("call_sign", "")))
        if not name:
            raise HTTPException(400, "That name can't be used. Letters, numbers and spaces, up to 30.")
        store.update_account(account["id"], call_sign=name)
        return {"ok": True, "call_sign": name}

    # ---------- projects (the same ones the bot works on) ----------
    @r.post("/api/account/projects")
    async def new_project(request: Request):
        require_csrf(request)
        account = current(request)
        user = store.account_user(account["id"])
        if user is None:
            raise HTTPException(400, "Link your WhatsApp number first.")
        idea = " ".join(str((await body(request)).get("idea", "")).split())[:1500]
        if len(idea) < 10:
            raise HTTPException(400, "Describe it in a sentence or two.")
        # Exactly as if they texted it: same limits, same queue, and the bot replies on WhatsApp.
        msg = Inbound(from_=address(user["phone"], user["channel"]), to=user.get("reply_from") or "",
                      body=f"NEW {idea}", sid=f"site-{secrets.token_hex(12)}")
        outcome = await run_in_threadpool(service.handle, msg)
        return {"ok": outcome in ("queued_new", "ask_style", "ask_kind"), "outcome": outcome}

    @r.post("/api/account/projects/{project_id}/rename")
    async def rename(request: Request, project_id: int):
        require_csrf(request)
        user, project = project_of(current(request), project_id)
        try:
            url = service.rename_project(user, project, str((await body(request)).get("name", "")))
        except ValueError as e:
            raise HTTPException(400, str(e)) from None
        return {"ok": True, "url": url}

    @r.post("/api/account/projects/{project_id}/delete")
    def delete(request: Request, project_id: int):
        require_csrf(request)
        user, project = project_of(current(request), project_id)
        service.delete_project(user, project)
        return {"ok": True}

    @r.post("/api/account/projects/{project_id}/restore")
    def restore(request: Request, project_id: int):
        require_csrf(request)
        account = current(request)
        user, project = project_of(account, project_id, deleted=True)
        if len(store.account_projects(user["id"])) >= settings.max_projects:
            raise HTTPException(400, f"You already have {settings.max_projects} projects. Delete one first.")
        if not service.restore_project(user, project):
            raise HTTPException(400, "This project can't be restored any more.")
        return {"ok": True}

    @r.get("/api/account/projects/{project_id}/files")
    def files(request: Request, project_id: int):
        user, project = project_of(current(request), project_id)
        build_id = project.get("last_success_build_id")
        out = {"kind": project.get("kind") or "android", "files": [], "preview": None, "apk": None}
        if not build_id:
            return out
        if out["kind"] == "website":
            site = service.web.site_dir(build_id) if service.web is not None else None
            if site and site.is_dir():
                out["files"] = [{"name": f.name, "bytes": f.stat().st_size} for f in sorted(site.iterdir())
                                if f.is_file() and not f.is_symlink() and PAGE_NAME_RE.fullmatch(f.name)]
            out["preview"] = service.preview_url(user["id"], build_id, relative_ok=True)
        else:
            out["apk"] = service.download_url(user["id"], build_id, relative_ok=True)
        return out

    @r.get("/api/account/projects/{project_id}/files/{name}")
    def file(request: Request, project_id: int, name: str):
        user, project = project_of(current(request), project_id)
        build_id = project.get("last_success_build_id")
        if not build_id or project.get("kind") != "website" or service.web is None or not PAGE_NAME_RE.fullmatch(name):
            raise HTTPException(404)
        root = service.web.site_dir(build_id).resolve()
        f = (root / name).resolve()
        if f.parent != root or not f.is_file():
            raise HTTPException(404)
        # Always a download, never rendered on this origin (it holds the session cookie).
        return FileResponse(f, media_type="application/octet-stream", filename=name,
                            headers={"Content-Security-Policy": PREVIEW_CSP, "Cache-Control": "private, no-store"})

    # ---------- your data ----------
    @r.get("/api/account/export")
    def export(request: Request):
        account = current(request)
        user = store.account_user(account["id"])
        data = {"account": {k: account[k] for k in ("username", "call_sign", "email", "created_at")},
                "phone": user["phone"] if user else None, "projects": [], "messages": []}
        if user:
            for p in store.account_projects(user["id"]) + store.account_projects(user["id"], deleted=True):
                jobs = store.all("SELECT ref, kind, status, prompt, change_request, created_at, finished_at "
                                 "FROM jobs WHERE project_id = ? ORDER BY id", (p["id"],))
                data["projects"].append({**project_json(user, p), "builds": jobs})
            data["messages"] = store.all("SELECT direction, body, created_at FROM messages WHERE user_id = ? "
                                         "ORDER BY id DESC LIMIT 2000", (user["id"],))
        return Response(json.dumps(data, indent=2, default=str), media_type="application/json", headers={
            "Content-Disposition": f'attachment; filename="weave-{account["username"]}.json"'})

    @r.post("/api/account/stitch/disconnect")
    def stitch_disconnect(request: Request):
        require_csrf(request)
        account = current(request)
        if stitch:
            stitch.disconnect(account["id"])
        event("site.stitch_disconnected", account=account["id"])
        return {"ok": True}

    @r.post("/api/account/delete")
    async def delete_account(request: Request):
        require_csrf(request)
        account = current(request)
        if str((await body(request)).get("confirm", "")).strip().lower() != account["username"]:
            raise HTTPException(400, "Type your username to confirm.")
        user = store.account_user(account["id"])
        if user:
            for p in store.account_projects(user["id"]):
                service.delete_project(user, p)
            store.update_user(user["id"], account_id=None, status="deleted",
                              phone=f"deleted:{user['id']}:{user['phone']}")
        # The username stays taken forever, so nobody can pick it up and pose as this person.
        store.update_account(account["id"], status="deleted", email=None, google_sub=None, password_hash=None)
        store.delete_account_sessions(account_id=account["id"])
        if stitch:
            stitch.disconnect(account["id"])
        event("site.account_deleted", account=account["id"])
        resp = JSONResponse({"ok": True})
        resp.delete_cookie(COOKIE, path="/")
        return resp

    # ---------- abuse reports (anyone) ----------
    @r.post("/api/report")
    async def report(request: Request):
        require_csrf(request)
        if reports.blocked():
            raise HTTPException(429, "Too many reports right now. Email us instead.")
        data = await body(request)
        site = str(data.get("site", "")).strip()[:300]
        reason = str(data.get("reason", "")).strip().lower()
        details = str(data.get("details", "")).strip()[:2000]
        if domain not in site or reason not in REPORT_REASONS:
            raise HTTPException(400, f"Give the address of a site on {domain} and pick a reason.")
        reports.record()
        rid = store.add_report(site, reason, details)
        event("site.report", logging.WARNING, report=rid, reason=reason)
        for owner in service.owners:
            owner_user = store.get_user(owner)
            if owner_user:
                service._reply(owner, owner_user, f"Abuse report #{rid} ({reason}): {site}\n{details[:300]}\n"
                               "Text TAKEDOWN <username> or TAKEDOWN <username>/<project> to take it offline.")
        return {"ok": True, "id": rid}

    # ---------- what a hosted site sends back ----------
    # These are reached from inside the CSP sandbox, where fetch and form posts are blocked. The pixel is an
    # <img>, and the contact form is a popup that escapes the sandbox onto this origin.
    @r.get("/px/{username}/{slug}.gif")
    def beacon(request: Request, username: str, slug: str):
        """A page telling us a real browser rendered it. It only ever flags a visit we already counted."""
        views = getattr(worker, "views", None)
        account = store.account_by("username", username) if views is not None else None
        if (account is not None and account["status"] == "active"
                and (account.get("analytics") or "on") == "on" and not beacons.blocked()):
            ua = request.headers.get("user-agent", "")
            if not is_bot(ua):
                beacons.record()
                ip = client_ip(request.headers, request.client.host if request.client else "",
                               settings.trust_proxy)
                now = time.time()
                views.record_beacon(Beacon(account_id=account["id"], slug="" if slug == "-" else slug,
                                           visitor=visitor_hash(ip, ua, username, now), ts=now))
        return Response(PIXEL, media_type="image/gif",
                        headers={"Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'"})

    @r.get("/c/{username}/{slug}")
    def contact_page(username: str, slug: str):
        account = store.account_by("username", username)
        if account is None or account["status"] != "active":
            raise HTTPException(404, "That site doesn't exist.")
        return page("contact")

    @r.get("/api/leads/{username}/{slug}")
    def lead_target(username: str, slug: str):
        """Who the enquiry is going to, so the form can say so instead of asking people to trust a bare page."""
        account = store.account_by("username", username)
        if account is None or account["status"] != "active":
            raise HTTPException(404, "That site doesn't exist.")
        return {"site": slug if slug != "-" else account["username"], "owner": account["call_sign"]}

    @r.post("/api/leads/{username}/{slug}")
    async def new_lead(request: Request, username: str, slug: str):
        require_csrf(request)
        account = store.account_by("username", username)
        if account is None or account["status"] != "active":
            raise HTTPException(404, "That site doesn't exist.")
        data = await body(request)
        if str(data.get("website", "")).strip():
            return {"ok": True}  # a hidden field only a bot would fill in; answer as if it worked
        if leads.blocked() or store.lead_count(account["id"], time.time() - 86_400) >= MAX_LEADS_PER_DAY:
            raise HTTPException(429, "Too many messages right now. Try again later.")
        name = str(data.get("name", "")).strip()[:80]
        contact = str(data.get("contact", "")).strip()[:120]
        message = str(data.get("message", "")).strip()[:1000]
        if not message or not contact:
            raise HTTPException(400, "Leave a message and a way to reach you.")
        leads.record()
        site = slug if slug != "-" else account["username"]
        lead_id = store.add_lead(account["id"], "" if slug == "-" else slug, name, contact, message, time.time())
        event("site.lead", account=account["id"], lead=lead_id)
        owner = store.account_user(account["id"])
        if owner is not None:  # tell them on WhatsApp straight away; an enquiry is worth interrupting for
            who = f"{name} ({contact})" if name else contact
            service._reply(owner["phone"], owner,
                           f"New enquiry on {site} from {who}: {message[:220]}")
        return {"ok": True}

    return r


MAX_LEADS_PER_DAY = 100
# A 1x1 transparent GIF: the smallest thing a sandboxed page is allowed to send us.
PIXEL = base64.b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")

PUBLIC_PREFIXES = ("/start", "/dashboard", "/terms", "/privacy", "/report", "/site/", "/auth/google", "/auth/stitch",
                   "/api/account/", "/api/report", "/px/", "/c/", "/api/leads/")
