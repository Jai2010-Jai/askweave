"""WhatsApp simulator: a page on the Weave computer that looks and behaves like a WhatsApp chat with Weave.

Messages enter exactly like real WhatsApp messages (store.enqueue_inbound, then the worker handles them) from
numbers in the fictional +1 555 area code. ChannelRouter swallows replies to those numbers instead of sending
them, so the page shows what a WhatsApp user would get, word for word. Only the Weave computer can open it."""

from __future__ import annotations

import re
import secrets
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, RedirectResponse

from ..config import Settings
from .observe import event
from .provider import SIMULATOR_PREFIX
from .store import SmsStore

STATIC = Path(__file__).resolve().parent.parent / "static" / "wa"
FILES = {"app.js": "text/javascript", "app.css": "text/css"}
PHONE_RE = re.compile(r"^\+1555\d{7}$")
FIRST_NUMBER = 15550100001
CSP = ("default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; "
       "frame-ancestors 'none'; base-uri 'none'; form-action 'self'")


def build_simulator_router(settings: Settings, store: SmsStore) -> APIRouter:
    r = APIRouter()

    def local_only(request: Request) -> None:
        if not getattr(request.state, "local", False):
            raise HTTPException(404, "Not found")

    def sim_phone(raw: object) -> str:
        phone = str(raw or "")
        if not PHONE_RE.fullmatch(phone):
            raise HTTPException(422, "phone must be a simulator number (+1555…)")
        return phone

    def enqueue(phone: str, text: str) -> None:
        # The number a real WhatsApp message arrives on, so the reply-from logic runs as it does in production.
        to = settings.meta_phone_number_id if settings.whatsapp_provider == "meta" else settings.twilio_whatsapp_number
        store.enqueue_inbound("whatsapp:" + phone, text, "SIM" + secrets.token_hex(16), to or None)

    @r.get("/wa")
    def page(request: Request):
        local_only(request)
        return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache", "Content-Security-Policy": CSP})

    @r.get("/wa/dashboard")
    def dashboard(request: Request, phone: str):
        """Signs this browser in to the number's account and opens its dashboard (enquiries, data, analytics)."""
        local_only(request)
        from ..site.routes import COOKIE, SESSION_TTL_S

        user = store.get_user(sim_phone(phone))
        account = store.account_for_user(user["id"]) if user else None
        if account is None:
            raise HTTPException(404, "This number has no Weave account yet. Use Sign up in the menu first.")
        resp = RedirectResponse("/dashboard", status_code=303)
        resp.set_cookie(COOKIE, store.create_account_session(account["id"], SESSION_TTL_S), max_age=SESSION_TTL_S,
                        httponly=True, samesite="lax", path="/")
        return resp

    @r.get("/wa/{name}")
    def asset(name: str, request: Request):
        local_only(request)
        if name not in FILES:
            raise HTTPException(404, "Not found")
        return FileResponse(STATIC / name, media_type=FILES[name], headers={"Cache-Control": "no-cache"})

    @r.get("/api/wa/chats")
    def chats(request: Request):
        local_only(request)
        rows = store.all(
            "SELECT m.phone, m.body, m.direction, m.created_at FROM messages m JOIN "
            "(SELECT phone, MAX(id) AS last FROM messages WHERE phone LIKE ? GROUP BY phone) t ON m.id = t.last "
            "ORDER BY m.id DESC", (SIMULATOR_PREFIX + "%",))
        return {"public_base_url": settings.public_base_url.rstrip("/"), "sites_domain": settings.sites_domain,
                "chats": [{"phone": r["phone"].removeprefix("whatsapp:"), "last": r["body"],
                           "from": "me" if r["direction"] == "in" else "weave", "at": r["created_at"]} for r in rows]}

    @r.post("/api/wa/chats")
    def new_chat(request: Request):
        """A number Weave has never seen, to test what a brand-new WhatsApp user gets."""
        local_only(request)
        used = store.one("SELECT MAX(CAST(SUBSTR(phone, 11) AS INTEGER)) AS n FROM messages WHERE phone LIKE ?",
                         (SIMULATOR_PREFIX + "%",))
        return {"phone": "+" + str(max(FIRST_NUMBER, (used["n"] or 0) + 1 if used else FIRST_NUMBER))}

    @r.get("/api/wa/messages")
    def messages(request: Request, phone: str, after: int = 0):
        local_only(request)
        address = "whatsapp:" + sim_phone(phone)
        rows = store.all("SELECT id, direction, body, status, created_at FROM messages WHERE phone = ? AND id > ? "
                         "ORDER BY id LIMIT 500", (address, max(0, after)))
        # Weave is "typing" while one of this number's messages waits for the worker.
        busy = store.one("SELECT 1 AS x FROM messages WHERE phone = ? AND direction = 'in' AND status IN ('pending', 'processing') LIMIT 1", (address,))
        return {"typing": busy is not None,
                "messages": [{"id": m["id"], "from": "me" if m["direction"] == "in" else "weave", "text": m["body"],
                              "status": m["status"], "at": m["created_at"]} for m in rows]}

    @r.post("/api/wa/messages")
    async def send(request: Request):
        local_only(request)
        data = await request.json()
        phone = sim_phone((data or {}).get("phone"))
        text = str((data or {}).get("text") or "").strip()
        if not text or len(text) > 1600:
            raise HTTPException(422, "Message must be 1-1600 characters")
        await run_in_threadpool(enqueue, phone, text)
        event("sim.message", chars=len(text))
        return {"ok": True}

    @r.post("/api/wa/sign-up")
    async def sign_up(request: Request):
        """A Weave account for the number, then its dashboard code sent as LINK <code>: what a real customer does
        after signing up on the website. Account sites get the contact form and live data; bare numbers don't."""
        local_only(request)
        data = await request.json()
        phone = sim_phone((data or {}).get("phone"))

        def run() -> str:
            username = "sim-" + phone[-4:]
            account = store.account_by("username", username) or store.create_account(
                username=username, call_sign=f"Sim {phone[-4:]}")
            code = store.create_phone_code(account["id"])
            enqueue(phone, f"LINK {code}")
            return username

        username = await run_in_threadpool(run)
        event("sim.sign_up", username=username)
        return {"ok": True, "username": username}

    @r.post("/api/wa/link-owner")
    async def link_owner(request: Request):
        """Sends LINK <code> from the number with a fresh owner code: the same way a real phone becomes an owner."""
        local_only(request)
        data = await request.json()
        phone = sim_phone((data or {}).get("phone"))
        code = await run_in_threadpool(store.create_link_code, "owner")
        await run_in_threadpool(enqueue, phone, f"LINK {code}")
        return {"ok": True}

    return r
