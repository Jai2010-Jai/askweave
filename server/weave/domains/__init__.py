"""Custom domains for hosted websites: find, approve, pay, register, DNS, HTTPS, live (see docs/DOMAINS.md).

make_domain_service picks each provider from the settings: the real one when its credentials are set, the fake
(weave.domains.mock) otherwise. Purchasing is only switched on when the registrar and the payments are both real,
or both fake (WEAVE_DOMAINS=sandbox), so a real payment can never meet a pretend registration or the reverse; and
real money additionally needs OPENSRS_ENV=live, DODO_PAYMENTS_ENV=live and WEAVE_DOMAIN_LIVE_PURCHASES=on together.
"""

from __future__ import annotations

import httpx

from .providers import DeploymentVerifier, ProviderError
from .service import DomainService, Providers


class HttpsVerifier(DeploymentVerifier):
    """Fetches https://<domain>/.well-known/weave-domain with certificate checks on, like a visitor's browser."""

    def __init__(self, client: httpx.Client | None = None):
        self.http = client or httpx.Client(timeout=15, follow_redirects=False, verify=True)

    def check(self, domain, token):
        try:
            r = self.http.get(f"https://{domain}/.well-known/weave-domain")
        except httpx.HTTPError as e:
            return False, f"https://{domain}/ not reachable yet ({type(e).__name__})"
        if r.status_code == 200 and r.text.strip() == token:
            return True, "ok"
        return False, f"https://{domain}/ answered {r.status_code}"


def make_providers(settings) -> tuple[Providers, dict]:
    from . import mock

    real: dict[str, bool] = {}
    if settings.domains == "on" and settings.opensrs_username and settings.opensrs_api_key:
        from .opensrs import OpenSrs
        registrar = OpenSrs(settings.opensrs_username, settings.opensrs_api_key, settings.opensrs_env,
                            settings.opensrs_currency)
        real["registrar"] = True
    else:
        registrar, real["registrar"] = mock.MockRegistrar(), False
    if settings.domains == "on" and settings.cloudflare_api_token and settings.cloudflare_account_id \
            and settings.cloudflare_tunnel_id:
        from .cloudflare import CloudflareApi, CloudflareDns, CloudflareSsl, CloudflareTunnelHosting
        api = CloudflareApi(settings.cloudflare_api_token, settings.cloudflare_account_id)
        dns, ssl = CloudflareDns(api, settings.cloudflare_tunnel_id), CloudflareSsl(api)
        hosting = CloudflareTunnelHosting(api, settings.cloudflare_tunnel_id,
                                          settings.domain_origin or f"http://127.0.0.1:{settings.port}")
        verifier: DeploymentVerifier = HttpsVerifier()
        real["dns"] = True
    else:
        dns, ssl, hosting, verifier = mock.MockDns(), mock.MockSsl(), mock.MockHosting(), mock.MockVerifier()
        real["dns"] = False
    if settings.domains == "on" and settings.dodo_api_key and settings.dodo_webhook_key \
            and settings.dodo_domain_product_id:
        from .dodo import DodoPayments
        payments = DodoPayments(settings.dodo_api_key, settings.dodo_webhook_key, settings.dodo_domain_product_id,
                                settings.dodo_env)
        real["payments"] = True
    else:
        payments, real["payments"] = mock.MockPayments(), False
    return Providers(registrar, dns, hosting, ssl, payments, verifier), real


def purchase_mode(settings, p: Providers, real: dict) -> tuple[str, str]:
    """(mode, problem): mode is sandbox | test | live; problem says why buying is off ("" = it's on)."""
    if settings.domains == "sandbox":
        return "sandbox", ""
    if not any(real.values()):
        return "sandbox", "no domain provider credentials are set (see docs/DOMAINS.md)"
    missing = [k for k, v in real.items() if not v]
    if missing:
        return "test", f"{', '.join(missing)} not configured"
    if p.registrar.live != p.payments.live:
        return "test", "OPENSRS_ENV and DODO_PAYMENTS_ENV must both be test or both be live"
    if p.registrar.live and not settings.domain_live_purchases:
        return "live", "live purchases need WEAVE_DOMAIN_LIVE_PURCHASES=on"
    return ("live" if p.registrar.live else "test"), ""


def make_domain_service(settings, store, notify=None, providers: Providers | None = None) -> DomainService | None:
    if settings.domains == "off":
        return None
    if providers is None:
        providers, real = make_providers(settings)
    else:
        real = {"registrar": True, "dns": True, "payments": True}
    mode, problem = purchase_mode(settings, providers, real)
    return DomainService(settings, store, providers, mode=mode, problem=problem, notify=notify)


__all__ = ["DomainService", "Providers", "ProviderError", "make_domain_service", "HttpsVerifier"]
