"""Dodo Payments for domain purchases.

Docs used (docs.dodopayments.com):
- Checkout sessions, POST /checkouts, with a "Pay What You Want" one-time product so the cart line carries our
  exact quote: `product_cart: [{product_id, quantity: 1, amount}]` (amount in the smallest currency unit; it is
  ignored for products without PWYW, and must be at or above the product's minimum). Response: session_id,
  checkout_url. The charge is in the product's currency, so WEAVE_DOMAIN_CURRENCY must match it.
- GET /payments/{payment_id}: status, total_amount, currency, metadata, checkout_session_id. This, not the
  webhook body, is what proves a payment.
- POST /refunds {payment_id, reason}.
- Webhooks follow Standard Webhooks: headers webhook-id, webhook-timestamp, webhook-signature ("v1,<base64>",
  space separated); HMAC-SHA256 over "{id}.{timestamp}.{raw body}" with the base64 key after "whsec_"; reject
  timestamps more than 5 minutes off.
Hosts: https://test.dodopayments.com (test mode) and https://live.dodopayments.com (live).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

import httpx

from .providers import Checkout, Payment, PaymentProvider, ProviderError, ProviderTimeout, WebhookEvent

HOSTS = {"test": "https://test.dodopayments.com", "live": "https://live.dodopayments.com"}
WEBHOOK_TOLERANCE_S = 300


def verify_standard_webhook(secret: str, headers: dict, body: bytes, now: float | None = None) -> dict:
    """The parsed payload, if the signature is genuine and fresh. Raises ProviderError otherwise."""
    h = {k.lower(): v for k, v in headers.items()}
    msg_id, ts, sigs = h.get("webhook-id", ""), h.get("webhook-timestamp", ""), h.get("webhook-signature", "")
    if not (msg_id and ts.isdigit() and sigs and secret):
        raise ProviderError("missing webhook signature headers")
    if abs((time.time() if now is None else now) - int(ts)) > WEBHOOK_TOLERANCE_S:
        raise ProviderError("webhook timestamp is too old or in the future")
    try:
        key = base64.b64decode(secret.removeprefix("whsec_"))
    except ValueError:
        raise ProviderError("webhook secret is not valid base64") from None
    expected = base64.b64encode(hmac.new(key, f"{msg_id}.{ts}.".encode() + body, hashlib.sha256).digest()).decode()
    for part in sigs.split():
        version, _, sig = part.partition(",")
        if version == "v1" and hmac.compare_digest(sig, expected):
            try:
                payload = json.loads(body)
            except ValueError:
                raise ProviderError("webhook body is not JSON") from None
            if not isinstance(payload, dict):
                raise ProviderError("webhook body is not an object")
            return payload
    raise ProviderError("webhook signature does not match")


class DodoPayments(PaymentProvider):
    name = "dodo"

    def __init__(self, api_key: str, webhook_key: str, product_id: str, env: str = "test",
                 client: httpx.Client | None = None, timeout: float = 20):
        if not (api_key and webhook_key and product_id):
            raise ValueError("Dodo Payments needs DODO_PAYMENTS_API_KEY, DODO_PAYMENTS_WEBHOOK_KEY and "
                             "DODO_DOMAIN_PRODUCT_ID")
        self.live = env == "live"
        self.base = HOSTS["live" if self.live else "test"]
        self.webhook_key, self.product_id = webhook_key, product_id
        self.http = client or httpx.Client(timeout=timeout)
        self.headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    def _call(self, method: str, path: str, body: dict | None = None) -> dict:
        try:
            r = self.http.request(method, self.base + path, json=body, headers=self.headers)
        except httpx.TimeoutException:
            raise ProviderTimeout("Dodo Payments did not answer in time") from None
        except httpx.HTTPError as e:
            raise ProviderError(f"Dodo Payments unreachable: {type(e).__name__}", transient=True) from None
        if r.status_code >= 500 or r.status_code == 429:
            raise ProviderError(f"Dodo Payments error {r.status_code}", transient=True)
        if r.status_code >= 400:
            raise ProviderError(f"Dodo Payments refused the request ({r.status_code}): {r.text[:200]}")
        return r.json()

    def create_checkout(self, *, amount_minor, currency, description, customer_email, return_url, metadata):
        body = {"product_cart": [{"product_id": self.product_id, "quantity": 1, "amount": amount_minor}],
                "return_url": return_url, "metadata": {k: str(v) for k, v in metadata.items()}}
        if customer_email:
            body["customer"] = {"email": customer_email}
        out = self._call("POST", "/checkouts", body)
        return Checkout(out["session_id"], out["checkout_url"])

    def payment(self, payment_id):
        p = self._call("GET", f"/payments/{payment_id}")
        return Payment(p["payment_id"], p.get("status") or "unknown", int(p.get("total_amount") or 0),
                       p.get("currency") or "", p.get("metadata") or {}, p.get("checkout_session_id"))

    def verify_webhook(self, headers, body):
        payload = verify_standard_webhook(self.webhook_key, headers, body)
        data = payload.get("data") or {}
        return WebhookEvent({k.lower(): v for k, v in headers.items()}.get("webhook-id", ""),
                            payload.get("type", ""), data.get("payment_id"), data)

    def refund(self, payment_id, reason):
        out = self._call("POST", "/refunds", {"payment_id": payment_id, "reason": reason[:200]})
        return out.get("refund_id", "")
