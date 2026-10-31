"""Where a custom domain is in its life, and which moves are allowed.

    DISCOVERING -> AVAILABLE -> AWAITING_APPROVAL -> PAYMENT_PENDING -> REGISTERING -> REGISTERED
      -> CONFIGURING_DNS -> VERIFYING_DNS -> CONNECTING_HOSTING -> PROVISIONING_SSL -> VERIFYING_DEPLOYMENT -> LIVE
    LIVE -> EXPIRING -> LIVE (renewed) | EXPIRED

Any state can fail. Nothing reaches REGISTERING without a verified payment for an approved quote: that is the one
edge that spends money, and only weave.domains.service.payment_verified takes it.
"""

from __future__ import annotations

DISCOVERING = "DISCOVERING"
AVAILABLE = "AVAILABLE"
AWAITING_APPROVAL = "AWAITING_APPROVAL"
PAYMENT_PENDING = "PAYMENT_PENDING"
REGISTERING = "REGISTERING"
REGISTERED = "REGISTERED"
CONFIGURING_DNS = "CONFIGURING_DNS"
VERIFYING_DNS = "VERIFYING_DNS"
CONNECTING_HOSTING = "CONNECTING_HOSTING"
PROVISIONING_SSL = "PROVISIONING_SSL"
VERIFYING_DEPLOYMENT = "VERIFYING_DEPLOYMENT"
LIVE = "LIVE"
FAILED = "FAILED"
EXPIRING = "EXPIRING"
EXPIRED = "EXPIRED"

ALL = (DISCOVERING, AVAILABLE, AWAITING_APPROVAL, PAYMENT_PENDING, REGISTERING, REGISTERED, CONFIGURING_DNS,
       VERIFYING_DNS, CONNECTING_HOSTING, PROVISIONING_SSL, VERIFYING_DEPLOYMENT, LIVE, FAILED, EXPIRING, EXPIRED)

# Before payment: nothing has been bought, the customer can walk away.
PRE_PAYMENT = (DISCOVERING, AVAILABLE, AWAITING_APPROVAL, PAYMENT_PENDING)
# The steps the background runner carries out, in order.
PIPELINE = (REGISTERING, REGISTERED, CONFIGURING_DNS, VERIFYING_DNS, CONNECTING_HOSTING, PROVISIONING_SSL,
            VERIFYING_DEPLOYMENT)
# A request for one of these hosts is answered with the customer's site. Hosting is connected and the domain is
# ours from PROVISIONING_SSL on (the deployment check needs the route to exist before it can pass).
ROUTABLE = (PROVISIONING_SSL, VERIFYING_DEPLOYMENT, LIVE, EXPIRING)
OWNED = PIPELINE + (LIVE, EXPIRING)

NEXT = {
    DISCOVERING: (AVAILABLE, FAILED),
    AVAILABLE: (AWAITING_APPROVAL, FAILED),
    AWAITING_APPROVAL: (PAYMENT_PENDING, AWAITING_APPROVAL, FAILED),
    PAYMENT_PENDING: (REGISTERING, AWAITING_APPROVAL, FAILED),
    REGISTERING: (REGISTERED, FAILED),
    REGISTERED: (CONFIGURING_DNS, FAILED),
    CONFIGURING_DNS: (VERIFYING_DNS, FAILED),
    VERIFYING_DNS: (CONNECTING_HOSTING, FAILED),
    CONNECTING_HOSTING: (PROVISIONING_SSL, FAILED),
    PROVISIONING_SSL: (VERIFYING_DEPLOYMENT, FAILED),
    VERIFYING_DEPLOYMENT: (LIVE, FAILED),
    LIVE: (EXPIRING, FAILED),
    EXPIRING: (LIVE, EXPIRED),
    FAILED: PIPELINE,          # retry resumes the step that failed
    EXPIRED: (),
}


def allowed(src: str, dst: str) -> bool:
    return dst in NEXT.get(src, ())


def came_from(dst: str) -> tuple[str, ...]:
    """Every state that may move to `dst` (what transition_domain checks against)."""
    return tuple(s for s, nxt in NEXT.items() if dst in nxt)


LABELS = {
    DISCOVERING: "checking", AVAILABLE: "available", AWAITING_APPROVAL: "waiting for your OK",
    PAYMENT_PENDING: "waiting for payment", REGISTERING: "registering", REGISTERED: "registered",
    CONFIGURING_DNS: "setting up DNS", VERIFYING_DNS: "waiting for DNS", CONNECTING_HOSTING: "connecting your site",
    PROVISIONING_SSL: "setting up HTTPS", VERIFYING_DEPLOYMENT: "checking it works", LIVE: "live",
    FAILED: "stopped", EXPIRING: "expiring soon", EXPIRED: "expired",
}
