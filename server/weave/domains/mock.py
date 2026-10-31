"""Fake providers: used by the tests, and for any provider with no credentials (WEAVE_DOMAINS=sandbox), so the whole
flow can be tried without spending anything. Nothing here makes a network call.

Each fake keeps what it was asked to do (`calls`) and can be told to misbehave: `fail_next` raises the given errors
one per call (a timeout, a hard failure), `taken` marks names as registered elsewhere, and the knobs on the DNS,
SSL and verifier fakes hold a step in "not yet" for as long as a test needs.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import threading
import time

from .providers import (Availability, Checkout, DeploymentVerifier, DnsProvider, HostingConnector, Payment,
                        PaymentProvider, Price, ProviderError, Registrar, Registration, SslProvider, WebhookEvent, Zone)

YEAR_S = 365 * 86_400
# Wholesale prices in USD cents, roughly what registrars charge resellers.
TLD_PRICES = {"com": (1099, 1499), "net": (1299, 1599), "org": (999, 1399), "in": (799, 1099),
              "co.in": (599, 899), "shop": (199, 3999), "store": (299, 4999), "xyz": (199, 1399)}


def tld_of(domain: str) -> str:
    parts = domain.split(".")
    two = ".".join(parts[-2:])
    return two if two in TLD_PRICES else parts[-1]


class _Faults:
    def __init__(self):
        self.calls: list[tuple] = []
        self.fail_next: dict[str, list[Exception]] = {}
        self.lock = threading.Lock()

    def _hit(self, op: str, *args) -> None:
        with self.lock:
            self.calls.append((op, *args))
            queue = self.fail_next.get(op)
            err = queue.pop(0) if queue else None
        if err is not None:
            raise err

    def count(self, op: str) -> int:
        return sum(1 for c in self.calls if c[0] == op)


class MockRegistrar(Registrar, _Faults):
    name = "mock"

    def __init__(self):
        _Faults.__init__(self)
        self.taken: set[str] = {"google.com", "taken.com"}
        self.registered: dict[str, Registration] = {}
        self.prices: dict[str, tuple[int, int]] = {}  # per-domain override (a price change)
        self.premium: set[str] = set()
        # Set to make register() go through *and then* raise a timeout, like a lost response.
        self.lose_response = False

    def suggest(self, query, tlds, limit):
        self._hit("suggest", query)
        base = "".join(ch for ch in query.lower() if ch.isalnum() or ch == "-").strip("-")[:40] or "mysite"
        names = [f"{base}.{t}" for t in tlds] + [f"{base}hq.{tlds[0]}", f"get{base}.{tlds[0]}"]
        return [self._avail(n) for n in names[:limit]]

    def _avail(self, domain):
        if domain in self.taken or domain in self.registered:
            return Availability(domain, False, reason="taken")
        return Availability(domain, True, premium=domain in self.premium)

    def check(self, domain):
        self._hit("check", domain)
        return self._avail(domain)

    def price(self, domain, years=1):
        self._hit("price", domain)
        first, renew = self.prices.get(domain) or TLD_PRICES.get(tld_of(domain), (1500, 1800))
        return Price(domain, first * years, renew, "USD", premium=domain in self.premium)

    def owns(self, domain):
        self._hit("owns", domain)
        return self.registered.get(domain)

    def register(self, domain, years, contact, nameservers, price):
        self._hit("register", domain, years)
        if domain in self.taken or domain in self.registered:
            raise ProviderError(f"{domain} is not available", transient=False)
        reg = Registration(domain, f"mock-{secrets.token_hex(4)}", time.time() + years * YEAR_S)
        self.registered[domain] = reg
        self.contacts = getattr(self, "contacts", {})
        self.contacts[domain] = contact
        if self.lose_response:
            self.lose_response = False
            from .providers import ProviderTimeout
            raise ProviderTimeout()
        return reg

    def set_nameservers(self, domain, nameservers):
        self._hit("set_nameservers", domain, tuple(nameservers))

    def renew(self, domain, years, current_expiry_year):
        self._hit("renew", domain, years)
        reg = self.registered.get(domain)
        if reg is None:
            raise ProviderError(f"{domain} is not in this account")
        reg.expires_at = (reg.expires_at or time.time()) + years * YEAR_S
        return Registration(domain, f"mock-renew-{secrets.token_hex(4)}", reg.expires_at)


class MockDns(DnsProvider, _Faults):
    name = "mock"

    def __init__(self):
        _Faults.__init__(self)
        self.zones: dict[str, Zone] = {}
        self.records: dict[str, list[str]] = {}
        self.pending_checks = 0  # how many zone() calls answer "pending" before the zone turns active

    def ensure_zone(self, domain):
        self._hit("ensure_zone", domain)
        z = self.zones.get(domain)
        if z is None:
            z = self.zones[domain] = Zone(f"zone-{secrets.token_hex(4)}", ["ada.ns.example", "bob.ns.example"], "pending")
        return z

    def zone(self, zone_id):
        self._hit("zone", zone_id)
        z = next(z for z in self.zones.values() if z.zone_id == zone_id)
        if self.pending_checks > 0:
            self.pending_checks -= 1
        else:
            z.status = "active"
        return z

    def point_to_origin(self, zone_id, domain):
        self._hit("point_to_origin", domain)
        self.records[domain] = [domain, f"www.{domain}"]


class MockHosting(HostingConnector, _Faults):
    name = "mock"

    def __init__(self):
        _Faults.__init__(self)
        self.hosts: set[str] = set()

    def connect(self, domain):
        self._hit("connect", domain)
        self.hosts |= {domain, f"www.{domain}"}
        return f"mock-route:{domain}"

    def disconnect(self, domain):
        self._hit("disconnect", domain)
        self.hosts -= {domain, f"www.{domain}"}


class MockSsl(SslProvider, _Faults):
    name = "mock"

    def __init__(self):
        _Faults.__init__(self)
        self.pending_checks = 0
        self.result = "active"

    def status(self, zone_id, domain):
        self._hit("status", domain)
        if self.pending_checks > 0:
            self.pending_checks -= 1
            return "pending"
        return self.result


class MockVerifier(DeploymentVerifier, _Faults):
    """Asks a callable (in tests, the app itself through TestClient) instead of the internet."""

    def __init__(self, fetch=None):
        _Faults.__init__(self)
        self.fetch = fetch  # fetch(domain) -> (status_code, body)

    def check(self, domain, token):
        self._hit("check", domain)
        if self.fetch is None:
            return True, "ok"
        status, body = self.fetch(domain)
        if status == 200 and body.strip() == token:
            return True, "ok"
        return False, f"https://{domain}/ answered {status}"


class MockPayments(PaymentProvider, _Faults):
    """Checkouts that never take money. A test 'pays' with complete(), which also produces the webhook Dodo would
    send, signed with the same Standard Webhooks scheme the real adapter checks."""

    name = "mock"

    def __init__(self, secret: str = "whsec_" + base64.b64encode(b"mock-webhook-secret-32-bytes!!!!").decode()):
        _Faults.__init__(self)
        self.secret = secret
        self.checkouts: dict[str, dict] = {}
        self.payments: dict[str, Payment] = {}
        self.refunds: list[tuple[str, str]] = []

    def create_checkout(self, *, amount_minor, currency, description, customer_email, return_url, metadata):
        self._hit("create_checkout", amount_minor, currency)
        cid = f"cks_{secrets.token_hex(6)}"
        self.checkouts[cid] = {"amount": amount_minor, "currency": currency, "metadata": dict(metadata)}
        return Checkout(cid, f"https://pay.mock.test/{cid}")

    def complete(self, checkout_id: str, *, succeed: bool = True, amount_minor: int | None = None,
                 currency: str | None = None) -> tuple[dict, bytes]:
        """Pay (or fail to pay) a checkout. Returns signed webhook (headers, body)."""
        co = self.checkouts[checkout_id]
        pid = f"pay_{secrets.token_hex(6)}"
        self.payments[pid] = Payment(pid, "succeeded" if succeed else "failed",
                                     co["amount"] if amount_minor is None else amount_minor,
                                     currency or co["currency"], co["metadata"], checkout_id)
        return self.sign({"business_id": "bus_mock", "type": "payment.succeeded" if succeed else "payment.failed",
                          "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                          "data": {"payload_type": "Payment", "payment_id": pid, "status": self.payments[pid].status,
                                   "total_amount": self.payments[pid].amount_minor, "metadata": co["metadata"],
                                   "checkout_session_id": checkout_id}})

    def sign(self, payload: dict, msg_id: str | None = None, ts: int | None = None) -> tuple[dict, bytes]:
        body = json.dumps(payload).encode()
        msg_id = msg_id or f"msg_{secrets.token_hex(8)}"
        ts = int(time.time()) if ts is None else ts
        key = base64.b64decode(self.secret.removeprefix("whsec_"))
        sig = base64.b64encode(hmac.new(key, f"{msg_id}.{ts}.".encode() + body, hashlib.sha256).digest()).decode()
        return {"webhook-id": msg_id, "webhook-timestamp": str(ts), "webhook-signature": f"v1,{sig}"}, body

    def payment(self, payment_id):
        self._hit("payment", payment_id)
        p = self.payments.get(payment_id)
        if p is None:
            raise ProviderError("unknown payment")
        return p

    def verify_webhook(self, headers, body):
        from .dodo import verify_standard_webhook
        payload = verify_standard_webhook(self.secret, headers, body)
        data = payload.get("data") or {}
        return WebhookEvent(headers.get("webhook-id", ""), payload.get("type", ""), data.get("payment_id"), data)

    def refund(self, payment_id, reason):
        self._hit("refund", payment_id)
        self.refunds.append((payment_id, reason))
        return f"ref_{secrets.token_hex(4)}"
