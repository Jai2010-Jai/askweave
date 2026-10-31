"""OpenSRS (Tucows) as the registrar, over its XML API.

Docs used (domains.opensrs.guide): quickstart (hosts, signing), lookup (domain), name_suggest, get_price,
sw_register (domain), advanced_update_nameservers, get (domain) all_info, renew.
- Live: https://rr-n1-tor.opensrs.net:55443 (the calling IP must be on the reseller's IP access list).
  Test: https://horizon.opensrs.net:55443 (no allow-list; the test environment never registers real domains).
- POST text/xml with X-Username (reseller username) and X-Signature = md5(md5(xml + key) + key), hex.
- LOOKUP: response_code 210 available, 211 taken (a taken name still has is_success 1).
- GET_PRICE: price for reg_type new or renewal, includes the ICANN fee; is_registry_premium on premium names.
  The currency is the reseller account's (USD for most accounts; set OPENSRS_CURRENCY if yours differs).
- SW_REGISTER: reg_type new, handle process, period, contact_set (owner/admin/billing/tech), custom_nameservers,
  nameserver_list, custom_tech_contact, reg_username/reg_password. It has no idempotency key, so a retry first
  asks get all_info whether the name is already in our account (see Registrar.owns).
"""

from __future__ import annotations

import hashlib
import re
import secrets
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from xml.sax.saxutils import escape

import httpx

from .providers import Availability, Price, ProviderError, ProviderTimeout, Registrar, Registration

HOSTS = {"test": "https://horizon.opensrs.net:55443", "live": "https://rr-n1-tor.opensrs.net:55443"}
CONTACT_KEYS = ("first_name", "last_name", "org_name", "address1", "address2", "city", "state", "postal_code",
                "country", "phone", "email")


def _value(v) -> str:
    if isinstance(v, dict):
        return "<dt_assoc>" + "".join(f'<item key="{escape(str(k))}">{_value(x)}</item>' for k, x in v.items()) + "</dt_assoc>"
    if isinstance(v, (list, tuple)):
        return "<dt_array>" + "".join(f'<item key="{i}">{_value(x)}</item>' for i, x in enumerate(v)) + "</dt_array>"
    return escape(str(v))


def envelope(action: str, attributes: dict, **top) -> str:
    body = {"protocol": "XCP", "action": action, "object": "DOMAIN", **top, "attributes": attributes}
    return ("<?xml version='1.0' encoding='UTF-8' standalone='no'?><!DOCTYPE OPS_envelope SYSTEM 'ops.dtd'>"
            "<OPS_envelope><header><version>0.9</version></header><body><data_block>"
            + _value(body) + "</data_block></body></OPS_envelope>")


def _parse(el):
    if el is None:
        return None
    child = next(iter(el), None)
    if child is None:
        return (el.text or "").strip()
    if child.tag == "dt_assoc":
        return {i.get("key"): _parse(i) for i in child.findall("item")}
    if child.tag == "dt_array":
        return [_parse(i) for i in child.findall("item")]
    return (el.text or "").strip()


def parse_reply(xml: str) -> dict:
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        raise ProviderError("OpenSRS sent a reply that isn't XML", transient=True) from None
    block = root.find("./body/data_block")
    if block is None:
        raise ProviderError("OpenSRS reply has no data block", transient=True)
    return _parse(block) or {}


def signature(xml: str, key: str) -> str:
    return hashlib.md5((hashlib.md5((xml + key).encode()).hexdigest() + key).encode()).hexdigest()  # noqa: S324 - OpenSRS's scheme


def _minor(price: str) -> int:
    return int(round(float(price) * 100))


class OpenSrs(Registrar):
    name = "opensrs"

    def __init__(self, username: str, api_key: str, env: str = "test", currency: str = "USD",
                 client: httpx.Client | None = None, timeout: float = 60):
        if not (username and api_key):
            raise ValueError("OpenSRS needs OPENSRS_USERNAME and OPENSRS_API_KEY")
        self.live = env == "live"
        self.url = HOSTS["live" if self.live else "test"]
        self.username, self.key, self.currency = username, api_key, currency
        self.http = client or httpx.Client(timeout=timeout)

    def call(self, action: str, attributes: dict, **top) -> dict:
        xml = envelope(action, attributes, **top)
        try:
            r = self.http.post(self.url, content=xml.encode(), headers={
                "Content-Type": "text/xml", "X-Username": self.username, "X-Signature": signature(xml, self.key)})
        except httpx.TimeoutException:
            raise ProviderTimeout("OpenSRS did not answer in time") from None
        except httpx.HTTPError as e:
            raise ProviderError(f"OpenSRS unreachable: {type(e).__name__}", transient=True) from None
        if r.status_code >= 500:
            raise ProviderError(f"OpenSRS error {r.status_code}", transient=True)
        if r.status_code >= 400:
            raise ProviderError(f"OpenSRS refused the request ({r.status_code})")
        return parse_reply(r.text)

    @staticmethod
    def _ok(reply: dict, what: str) -> dict:
        if str(reply.get("is_success")) != "1":
            code = str(reply.get("response_code", ""))
            # 4xx/5xx in OpenSRS's own codes: 400-series are bad requests, 7xx are system problems worth a retry.
            raise ProviderError(f"OpenSRS {what} failed ({code}): {reply.get('response_text', '')}",
                                transient=code.startswith("7"))
        return reply.get("attributes") or {}

    def suggest(self, query, tlds, limit):
        word = re.sub(r"[^a-z0-9-]", "", query.lower())[:63].strip("-")
        if not word:
            return []
        reply = self.call("NAME_SUGGEST", {"searchstring": word, "tlds": [f".{t}" for t in tlds],
                                           "services": ["lookup", "suggestion"], "max_wait_time": 5,
                                           "service_override": {"suggestion": {"maximum": limit}}})
        attrs = self._ok(reply, "name suggestion")
        out: list[Availability] = []
        for service in ("lookup", "suggestion"):
            for item in ((attrs.get(service) or {}).get("items") or []):
                if isinstance(item, dict) and item.get("domain"):
                    status = item.get("status", "")
                    out.append(Availability(item["domain"].lower(), status == "available", reason=status))
        return out[:limit]

    def check(self, domain):
        reply = self.call("LOOKUP", {"domain": domain, "no_cache": 1})
        attrs = self._ok(reply, "lookup")
        code = str(reply.get("response_code", ""))
        available = code == "210" or attrs.get("status") == "available"
        return Availability(domain, available, premium=attrs.get("reason") == "Premium Name",
                            reason=attrs.get("status", ""))

    def price(self, domain, years=1):
        first = self._ok(self.call("GET_PRICE", {"domain": domain, "period": years, "reg_type": "new"}), "price")
        renew = self._ok(self.call("GET_PRICE", {"domain": domain, "period": 1, "reg_type": "renewal"}), "renewal price")
        return Price(domain, _minor(first["price"]), _minor(renew["price"]), self.currency,
                     premium=str(first.get("is_registry_premium", "0")) == "1")

    def owns(self, domain):
        reply = self.call("GET", {"type": "all_info"}, domain=domain)
        if str(reply.get("is_success")) != "1":
            return None  # not in our reseller account
        attrs = reply.get("attributes") or {}
        return Registration(domain, str(attrs.get("id") or ""), _expiry(attrs.get("expiredate")), already_ours=True)

    def register(self, domain, years, contact, nameservers, price):
        person = {k: contact.get(k, "") for k in CONTACT_KEYS}
        attrs = {"domain": domain, "reg_type": "new", "period": years, "handle": "process",
                 "custom_tech_contact": 0, "auto_renew": 0, "f_lock_domain": 1,
                 "f_whois_privacy": 1, "custom_nameservers": 1 if nameservers else 0,
                 "contact_set": {"owner": person, "admin": person, "billing": person, "tech": person},
                 # OpenSRS end-user profile credentials. We manage the domain through the reseller account, so
                 # these are never needed again; the customer can ask support to transfer it out.
                 "reg_username": "w" + secrets.token_hex(8),
                 "reg_password": secrets.token_urlsafe(12)[:16]}
        if nameservers:
            attrs["nameserver_list"] = [{"name": ns, "sortorder": i} for i, ns in enumerate(nameservers, 1)]
        attrs = self._ok(self.call("SW_REGISTER", attrs), "registration")
        if attrs.get("forced_pending"):
            raise ProviderError(f"OpenSRS left the order pending ({attrs.get('forced_pending')}): check funds")
        return Registration(domain, str(attrs.get("id") or attrs.get("queue_request_id") or ""),
                            time.time() + years * 365 * 86_400)

    def set_nameservers(self, domain, nameservers):
        self._ok(self.call("advanced_update_nameservers", {"op_type": "assign", "assign_ns": list(nameservers)},
                           domain=domain), "nameserver update")

    def renew(self, domain, years, current_expiry_year):
        attrs = self._ok(self.call("RENEW", {"domain": domain, "period": years, "handle": "process", "auto_renew": 0,
                                             "currentexpirationyear": current_expiry_year}), "renewal")
        return Registration(domain, str(attrs.get("order_id") or attrs.get("id") or ""),
                            _expiry(attrs.get("registration expiration date")))


def _expiry(text) -> float | None:
    if not text:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(str(text)[:19], fmt).replace(tzinfo=timezone.utc).timestamp()
        except ValueError:
            continue
    return None
