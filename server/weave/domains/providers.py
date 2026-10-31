"""The outside services a custom domain needs, each behind a small interface so any of them can be swapped or faked.

- Registrar: availability, prices, registration, nameservers, renewal (OpenSRS, weave.domains.opensrs).
- DnsProvider: the zone that answers for the domain and its records (Cloudflare, weave.domains.cloudflare).
- HostingConnector: tells the edge in front of Weave to send the domain's traffic here (the Cloudflare tunnel).
- SslProvider: whether the HTTPS certificate for the zone is issued.
- PaymentProvider: a checkout for an approved quote, and proof that it was paid (Dodo Payments, weave.domains.dodo).
- DeploymentVerifier: fetches https://<domain>/ like a visitor would.

Errors say whether trying again can help: ProviderError(transient=True) and ProviderTimeout are retried with
backoff by the runner; anything else fails the step. A step that is merely waiting (DNS not delegated yet, a
certificate still issuing) returns "not yet" instead of raising, and is polled without counting as a failure.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


class ProviderError(Exception):
    def __init__(self, message: str, transient: bool = False):
        super().__init__(message)
        self.transient = transient


class ProviderTimeout(ProviderError):
    """The provider didn't answer in time. Whether the action happened is unknown, so it is retried, and every
    retry that could spend money first checks whether the first attempt went through."""

    def __init__(self, message: str = "the provider did not answer in time"):
        super().__init__(message, transient=True)


class ProviderNotConfigured(ProviderError):
    pass


@dataclass
class Availability:
    domain: str
    available: bool
    premium: bool = False
    reason: str = ""


@dataclass
class Price:
    """What the registrar charges us, in its currency's smallest unit."""
    domain: str
    first_year_minor: int
    renewal_minor: int
    currency: str
    premium: bool = False


@dataclass
class Registration:
    domain: str
    order_id: str
    expires_at: float | None = None
    already_ours: bool = False  # an earlier attempt had gone through (found when retrying after a timeout)


@dataclass
class Zone:
    zone_id: str
    nameservers: list[str]
    status: str  # pending | active | ...


@dataclass
class Checkout:
    checkout_id: str
    url: str


@dataclass
class Payment:
    payment_id: str
    status: str            # succeeded | failed | processing | cancelled | ...
    amount_minor: int
    currency: str
    metadata: dict = field(default_factory=dict)
    checkout_id: str | None = None


@dataclass
class WebhookEvent:
    webhook_id: str
    type: str              # payment.succeeded | payment.failed | ...
    payment_id: str | None
    data: dict


class Registrar(ABC):
    name = "registrar"
    live = False  # True when registering spends real money

    @abstractmethod
    def suggest(self, query: str, tlds: list[str], limit: int) -> list[Availability]: ...

    @abstractmethod
    def check(self, domain: str) -> Availability: ...

    @abstractmethod
    def price(self, domain: str, years: int = 1) -> Price: ...

    @abstractmethod
    def owns(self, domain: str) -> Registration | None:
        """The registration if this domain is already in our reseller account, else None."""

    @abstractmethod
    def register(self, domain: str, years: int, contact: dict, nameservers: list[str], price: Price) -> Registration: ...

    @abstractmethod
    def set_nameservers(self, domain: str, nameservers: list[str]) -> None: ...

    @abstractmethod
    def renew(self, domain: str, years: int, current_expiry_year: int) -> Registration: ...


class DnsProvider(ABC):
    name = "dns"

    @abstractmethod
    def ensure_zone(self, domain: str) -> Zone:
        """Create the zone, or return it if it already exists (safe to repeat)."""

    @abstractmethod
    def zone(self, zone_id: str) -> Zone: ...

    @abstractmethod
    def point_to_origin(self, zone_id: str, domain: str) -> None:
        """Apex and www go to Weave (safe to repeat)."""


class HostingConnector(ABC):
    name = "hosting"

    @abstractmethod
    def connect(self, domain: str) -> str:
        """Route the domain (and www.) to the Weave server. Returns a reference to what was set up."""

    @abstractmethod
    def disconnect(self, domain: str) -> None: ...


class SslProvider(ABC):
    name = "ssl"

    @abstractmethod
    def status(self, zone_id: str, domain: str) -> str:
        """'active' when HTTPS works; 'pending' while issuing; 'failed' when it never will."""


class PaymentProvider(ABC):
    name = "payments"
    live = False

    @abstractmethod
    def create_checkout(self, *, amount_minor: int, currency: str, description: str, customer_email: str | None,
                        return_url: str, metadata: dict) -> Checkout: ...

    @abstractmethod
    def payment(self, payment_id: str) -> Payment:
        """Fetched from the provider's API: the only thing trusted as proof of payment."""

    @abstractmethod
    def verify_webhook(self, headers: dict, body: bytes) -> WebhookEvent:
        """Check the signature on a raw webhook body. Raises ProviderError when it isn't genuine."""

    @abstractmethod
    def refund(self, payment_id: str, reason: str) -> str: ...


class DeploymentVerifier(ABC):
    @abstractmethod
    def check(self, domain: str, token: str) -> tuple[bool, str]:
        """Fetch https://<domain>/.well-known/weave-domain over verified TLS; ok when it returns `token`."""
