"""Cloudflare: the DNS zone for each customer domain, HTTPS for it, and the tunnel route to this server.

Weave is already reached through a Cloudflare tunnel (scripts/run_prod.sh), so a customer domain is added as its
own zone in the same Cloudflare account. Docs used (developers.cloudflare.com/api):
- POST /zones {account: {id}, name, type: "full"} -> id, status (initializing | pending | active | moved),
  name_servers. GET /zones?name=&account.id= finds an existing one. PUT /zones/{id}/activation_check asks
  Cloudflare to look at the nameservers again (allowed once an hour on free zones).
- DNS records: GET/POST /zones/{id}/dns_records, PATCH /zones/{id}/dns_records/{record_id}. Apex and www are
  proxied CNAMEs to <tunnel id>.cfargotunnel.com; a tunnel hostname only serves DNS records in the same account.
  Cloudflare flattens the CNAME at the apex.
- GET /zones/{id}/ssl/verification -> certificate_status (initializing, authorizing, active, expired, issuing,
  timing_out, pending_deployment). A full zone gets Universal SSL (apex + www) once it is active.
- GET/PUT /accounts/{account}/cfd_tunnel/{tunnel}/configurations: the remotely managed tunnel's ingress rules.
  The new hostnames go in before the last rule (the catch-all).
Token permissions: Zone:Edit, DNS:Edit, SSL and Certificates:Read, Cloudflare Tunnel:Edit.
"""

from __future__ import annotations

import httpx

from .providers import (DnsProvider, HostingConnector, ProviderError, ProviderTimeout, SslProvider, Zone)

API = "https://api.cloudflare.com/client/v4"


class CloudflareApi:
    def __init__(self, token: str, account_id: str, client: httpx.Client | None = None, timeout: float = 30):
        if not (token and account_id):
            raise ValueError("Cloudflare needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID")
        self.account_id = account_id
        self.http = client or httpx.Client(timeout=timeout)
        self.headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def call(self, method: str, path: str, body: dict | None = None, params: dict | None = None,
             ok_codes: tuple[int, ...] = ()) -> dict:
        try:
            r = self.http.request(method, API + path, json=body, params=params, headers=self.headers)
        except httpx.TimeoutException:
            raise ProviderTimeout("Cloudflare did not answer in time") from None
        except httpx.HTTPError as e:
            raise ProviderError(f"Cloudflare unreachable: {type(e).__name__}", transient=True) from None
        if r.status_code >= 500 or r.status_code == 429:
            raise ProviderError(f"Cloudflare error {r.status_code}", transient=True)
        try:
            data = r.json()
        except ValueError:
            raise ProviderError(f"Cloudflare sent a non-JSON reply ({r.status_code})", transient=True) from None
        if not data.get("success"):
            codes = tuple(e.get("code") for e in data.get("errors") or [])
            if any(c in ok_codes for c in codes):
                return data
            msg = "; ".join(f"{e.get('code')}: {e.get('message')}" for e in data.get("errors") or []) or r.status_code
            raise ProviderError(f"Cloudflare refused {method} {path.split('/')[1]}: {msg}")
        return data


class CloudflareDns(DnsProvider):
    name = "cloudflare"

    def __init__(self, api: CloudflareApi, tunnel_id: str):
        if not tunnel_id:
            raise ValueError("Cloudflare DNS needs CLOUDFLARE_TUNNEL_ID (what customer domains point at)")
        self.api, self.target = api, f"{tunnel_id}.cfargotunnel.com"

    @staticmethod
    def _zone(z: dict) -> Zone:
        return Zone(z["id"], list(z.get("name_servers") or []), z.get("status", "pending"))

    def ensure_zone(self, domain):
        found = self.api.call("GET", "/zones", params={"name": domain, "account.id": self.api.account_id})
        if found.get("result"):
            return self._zone(found["result"][0])
        made = self.api.call("POST", "/zones", {"account": {"id": self.api.account_id}, "name": domain, "type": "full"})
        return self._zone(made["result"])

    def zone(self, zone_id):
        z = self._zone(self.api.call("GET", f"/zones/{zone_id}")["result"])
        if z.status == "pending":
            # Only a nudge: Cloudflare rate-limits it and checks on its own anyway.
            try:
                self.api.call("PUT", f"/zones/{zone_id}/activation_check")
            except ProviderError:
                pass
        return z

    def point_to_origin(self, zone_id, domain):
        for host in (domain, f"www.{domain}"):
            have = self.api.call("GET", f"/zones/{zone_id}/dns_records", params={"name": host})["result"] or []
            record = {"type": "CNAME", "name": host, "content": self.target, "proxied": True, "ttl": 1,
                      "comment": "Weave custom domain"}
            for r in have:
                if r.get("type") in ("A", "AAAA"):  # a CNAME can't sit beside other address records
                    self.api.call("DELETE", f"/zones/{zone_id}/dns_records/{r['id']}")
            cname = next((r for r in have if r.get("type") == "CNAME"), None)
            if cname is None:
                self.api.call("POST", f"/zones/{zone_id}/dns_records", record)
            elif cname.get("content") != self.target or not cname.get("proxied"):
                self.api.call("PATCH", f"/zones/{zone_id}/dns_records/{cname['id']}", record)


class CloudflareSsl(SslProvider):
    name = "cloudflare"

    def __init__(self, api: CloudflareApi):
        self.api = api

    def status(self, zone_id, domain):
        results = self.api.call("GET", f"/zones/{zone_id}/ssl/verification")["result"] or []
        states = {r.get("certificate_status") for r in results}
        if states and states <= {"active"}:
            return "active"
        if "expired" in states:
            return "failed"
        if "timing_out" in states:
            self.api.call("GET", f"/zones/{zone_id}/ssl/verification", params={"retry": "true"})
        return "pending"


class CloudflareTunnelHosting(HostingConnector):
    """Adds the domain to the tunnel's ingress rules so cloudflared hands its requests to Weave, which then picks
    the customer's project from the Host header (weave.domains.routing)."""

    name = "cloudflare-tunnel"

    def __init__(self, api: CloudflareApi, tunnel_id: str, origin: str):
        if not (tunnel_id and origin):
            raise ValueError("the tunnel route needs CLOUDFLARE_TUNNEL_ID and WEAVE_DOMAIN_ORIGIN")
        self.api, self.tunnel_id, self.origin = api, tunnel_id, origin
        self.path = f"/accounts/{api.account_id}/cfd_tunnel/{tunnel_id}/configurations"

    def _config(self) -> dict:
        result = self.api.call("GET", self.path)["result"] or {}
        config = result.get("config") or {}
        if not config.get("ingress"):
            raise ProviderError("the tunnel has no remotely managed ingress rules to add to")
        return config

    def connect(self, domain):
        config = self._config()
        hosts = {domain, f"www.{domain}"}
        rules = [r for r in config["ingress"] if r.get("hostname") not in hosts]
        catch_all = rules.pop() if rules and not rules[-1].get("hostname") else {"service": "http_status:404"}
        rules += [{"hostname": h, "service": self.origin} for h in sorted(hosts)] + [catch_all]
        self.api.call("PUT", self.path, {"config": {**config, "ingress": rules}})
        return f"tunnel:{self.tunnel_id}"

    def disconnect(self, domain):
        config = self._config()
        hosts = {domain, f"www.{domain}"}
        rules = [r for r in config["ingress"] if r.get("hostname") not in hosts]
        self.api.call("PUT", self.path, {"config": {**config, "ingress": rules}})
