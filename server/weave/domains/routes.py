"""/api/account/domains: the dashboard's custom-domain API, plus the payment webhook.

Same rules as weave/site/routes.py: the session cookie identifies the account, every POST needs the X-Weave header
(no other site can send it), and a domain is only ever looked up through the signed-in account, so one customer
can't see or touch another's. Each account is rate limited; the webhook is public and checked by its signature."""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from ..sms.observe import event
from .providers import ProviderError
from .service import DomainError, DomainService, contact_problem

WEBHOOK_PATH = "/api/webhooks/domains/payments"
PUBLIC_PREFIXES = ("/api/webhooks/domains/",)
CONTACT_FIELDS = ("first_name", "last_name", "org_name", "address1", "address2", "city", "state", "postal_code",
                  "country", "phone", "email")


class AccountLimiter:
    """At most `n` calls per account per window, per kind of call."""

    def __init__(self, n: int, window_s: float):
        self.n, self.window = n, window_s
        self.hits: dict[object, deque[float]] = defaultdict(deque)
        self.lock = threading.Lock()

    def allow(self, key) -> bool:
        now = time.monotonic()
        with self.lock:
            q = self.hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.n:
                return False
            q.append(now)
            return True


def build_domain_router(settings, store, domains: DomainService, cookie: str = "weave_session") -> APIRouter:
    r = APIRouter()
    reads = AccountLimiter(120, 600)
    searches = AccountLimiter(30, 600)
    writes = AccountLimiter(20, 600)
    hooks = AccountLimiter(600, 60)
    base = settings.public_base_url

    def current(request: Request) -> dict:
        token = request.cookies.get(cookie, "")
        account = store.account_by_session(token) if token else None
        if account is None:
            raise HTTPException(401, "Not signed in")
        return account

    def limited(limiter: AccountLimiter, account: dict) -> None:
        if not limiter.allow(account["id"]):
            raise HTTPException(429, "Too many domain requests. Try again in a few minutes.")

    def write(request: Request, limiter: AccountLimiter = writes) -> dict:
        if request.headers.get("x-weave") != "1":
            raise HTTPException(403, "missing X-Weave header")
        account = current(request)
        limited(limiter, account)
        return account

    async def body(request: Request) -> dict:
        try:
            data = await request.json()
        except ValueError:
            raise HTTPException(400, "send JSON") from None
        if not isinstance(data, dict):
            raise HTTPException(400, "send a JSON object")
        return data

    def fail(e: DomainError) -> JSONResponse:
        return JSONResponse({"detail": e.message, "code": e.code, **e.extra}, status_code=e.status)

    def provider_down(e: ProviderError) -> JSONResponse:
        event("domains.provider_error", error=str(e)[:200])
        return JSONResponse({"detail": "The domain service is busy. Try again in a minute.", "code": "provider"},
                            status_code=503 if e.transient else 502)

    def mine(account: dict, domain_id: int) -> dict:
        d = store.account_domain(account["id"], domain_id)
        if d is None:
            raise HTTPException(404, "domain not found")
        return d

    @r.get("/api/account/domains")
    def list_domains(request: Request):
        account = current(request)
        limited(reads, account)
        return {"config": domains.info(), "domains": [domains.summary(d) for d in store.account_domains(account["id"])]}

    @r.get("/api/account/domains/search")
    def search(request: Request, q: str = ""):
        account = current(request)
        limited(searches, account)
        try:
            return {"results": domains.suggest(q), "currency": settings.domain_currency}
        except DomainError as e:
            return fail(e)
        except ProviderError as e:
            return provider_down(e)

    @r.get("/api/account/domains/check")
    def check(request: Request, domain: str = ""):
        account = current(request)
        limited(searches, account)
        try:
            return domains.check(domain)
        except DomainError as e:
            return fail(e)
        except ProviderError as e:
            return provider_down(e)

    @r.get("/api/account/domains/contact")
    def get_contact(request: Request):
        account = current(request)
        contact = store.domain_contact(account["id"])
        return {"contact": contact, "problem": contact_problem(contact)}

    @r.post("/api/account/domains/contact")
    async def set_contact(request: Request):
        account = write(request)
        data = await body(request)
        contact = {k: str(data.get(k) or "").strip()[:120] for k in CONTACT_FIELDS}
        contact["country"] = contact["country"].upper()
        if problem := contact_problem(contact):
            raise HTTPException(400, problem)
        store.set_domain_contact(account["id"], contact)
        return {"contact": contact, "problem": ""}

    @r.post("/api/account/domains")
    async def quote(request: Request):
        """Pick a name for one of your websites: checks it and returns a quote to approve."""
        account = write(request)
        data = await body(request)
        project_id = data.get("project_id")
        if project_id is not None and not isinstance(project_id, int):
            raise HTTPException(400, "project_id must be a number")
        try:
            d, order = domains.quote(account, str(data.get("domain", "")), project_id)
        except DomainError as e:
            return fail(e)
        except ProviderError as e:
            return provider_down(e)
        return {**domains.summary(d), "quote": domains.quote_text(d, order)}

    @r.get("/api/account/domains/{domain_id}")
    def detail(request: Request, domain_id: int):
        account = current(request)
        limited(reads, account)
        d = mine(account, domain_id)
        events = [{"from": e["from_state"], "to": e["to_state"], "actor": e["actor"], "at": e["created_at"],
                   "note": e["detail"].get("note") or e["detail"].get("reason")} for e in store.domain_events(d["id"])]
        return {**domains.summary(d), "nameservers": d["nameservers"], "events": events}

    @r.post("/api/account/domains/{domain_id}/approve")
    async def approve(request: Request, domain_id: int):
        """The customer's explicit yes: {order_id, amount_minor, confirm: true}. Returns the checkout link."""
        account = write(request)
        mine(account, domain_id)
        data = await body(request)
        if data.get("confirm") is not True or not isinstance(data.get("order_id"), int) \
                or not isinstance(data.get("amount_minor"), int):
            raise HTTPException(400, "send order_id, amount_minor and confirm: true")
        try:
            return domains.approve(account, domain_id, data["order_id"], data["amount_minor"], via="dashboard",
                                   text="dashboard approve button",
                                   return_url=f"{base}/dashboard?domain={domain_id}" if base else "https://askweave.xyz/")
        except DomainError as e:
            return fail(e)
        except ProviderError as e:
            return provider_down(e)

    @r.post("/api/account/domains/{domain_id}/cancel")
    def cancel(request: Request, domain_id: int):
        account = write(request)
        try:
            return domains.summary(domains.cancel(account, domain_id))
        except DomainError as e:
            return fail(e)

    @r.post("/api/account/domains/{domain_id}/retry")
    def retry(request: Request, domain_id: int):
        account = write(request)
        try:
            return domains.summary(domains.retry(account, domain_id))
        except DomainError as e:
            return fail(e)

    @r.post("/api/account/domains/{domain_id}/renew")
    def renew(request: Request, domain_id: int):
        """A renewal quote; approve it with /approve like a purchase."""
        account = write(request)
        try:
            order = domains.renewal_quote(account, domain_id)
        except DomainError as e:
            return fail(e)
        except ProviderError as e:
            return provider_down(e)
        return {**domains.summary(store.domain(domain_id)), "order_id": order["id"],
                "amount_minor": order["amount_minor"]}

    @r.post(WEBHOOK_PATH)
    async def payment_webhook(request: Request):
        if not hooks.allow("all"):
            raise HTTPException(429, "slow down")
        raw = await request.body()
        try:
            outcome = domains.handle_webhook(dict(request.headers), raw)
        except ProviderError as e:
            if e.transient:  # couldn't reach the provider to confirm: ask them to send it again
                raise HTTPException(503, "try again") from None
            event("domains.webhook_rejected", reason=str(e)[:120])
            raise HTTPException(401, "invalid signature") from None
        event("domains.webhook", outcome=outcome)
        return {"received": True}

    return r
