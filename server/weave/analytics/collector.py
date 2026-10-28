"""Turning a request for a hosted site into a countable view, without touching the database.

Nothing here identifies a person. A visitor is a keyed hash of IP + user agent + site, and the key is
32 random bytes that live in this process's memory only: never written to disk, replaced every UTC day and
on every restart. Once the day turns the hashes cannot be traced back to anyone, because the key that made
them no longer exists anywhere. The IP and the user agent themselves are never stored.
"""

from __future__ import annotations

import hashlib
import re
import secrets
import threading
import time
from collections import deque
from dataclasses import dataclass
from urllib.parse import urlsplit

MAX_BUFFERED = 20_000

BOT_RE = re.compile(
    r"bot|crawl|spider|slurp|bingpreview|headless|monitor|uptime|curl|wget|python-requests|httpx|"
    r"facebookexternalhit|whatsapp|telegrambot|twitterbot|linkedinbot|discordbot|preview|lighthouse",
    re.I)
MOBILE_RE = re.compile(r"android|iphone|ipad|ipod|mobile|windows phone|opera mini", re.I)

_salts: dict[int, bytes] = {}
_salt_lock = threading.Lock()


def utc_day(now: float | None = None) -> int:
    """Whole UTC days since the epoch: the bucket a view is counted in and the life of a visitor hash."""
    return int((time.time() if now is None else now) // 86_400)


def _salt_for_day(day: int) -> bytes:
    """Today's hashing key, made on first use and never persisted. Yesterday's is dropped as the day turns."""
    with _salt_lock:
        salt = _salts.get(day)
        if salt is None:
            salt = _salts[day] = secrets.token_bytes(32)
            for old in [d for d in _salts if d < day]:
                del _salts[old]
        return salt


def visitor_hash(ip: str, ua: str, label: str, now: float | None = None) -> str:
    """One visitor, on one site, on one day. Salting by `label` keeps the same person's visits to two
    different customers' sites unlinkable."""
    key = _salt_for_day(utc_day(now))
    return hashlib.blake2b(f"{ip}|{ua}|{label}".encode(), key=key, digest_size=8).hexdigest()


def client_ip(headers, fallback: str, trust_proxy: bool) -> str:
    """The visitor's address. Behind the Cloudflare tunnel every request arrives from localhost, so without
    a proxy header every visitor would hash the same and the visitor count would collapse to 1."""
    if trust_proxy:
        if cf := headers.get("cf-connecting-ip", "").strip():
            return cf[:64]
        if fwd := headers.get("x-forwarded-for", "").split(",")[0].strip():
            return fwd[:64]
    return fallback[:64]


def is_bot(ua: str) -> bool:
    return not ua.strip() or bool(BOT_RE.search(ua))


def device_class(ua: str) -> str:
    if not ua.strip():
        return ""
    return "mobile" if MOBILE_RE.search(ua) else "desktop"


def ref_host(referer: str, own_host: str) -> str:
    """The site someone came from, as a bare host. Empty for direct visits and for our own pages, so
    clicking between a site's own pages never looks like traffic from somewhere else."""
    try:
        host = urlsplit(referer.strip()).hostname or ""
    except ValueError:
        return ""
    host = host.lower().lstrip(".")
    if host.startswith("www."):
        host = host[4:]
    own = (own_host or "").lower().split(":")[0]
    if not host or host == own or (own and host.endswith("." + own)):
        return ""
    return host[:80]


@dataclass(slots=True)
class View:
    account_id: int
    slug: str
    page: str
    day: int
    ts: float
    visitor: str
    device: str = ""
    country: str = ""
    ref: str = ""
    beacon: int = 0

    def row(self) -> tuple:
        return (self.account_id, self.slug, self.page, self.day, self.ts, self.visitor,
                self.device, self.country, self.ref, self.beacon)


@dataclass(slots=True)
class Beacon:
    """A browser telling us it really rendered a page we served."""
    account_id: int
    slug: str
    visitor: str
    ts: float


class ViewBuffer:
    """Views waiting to be written. Appending is all that happens on the request path: no connection, no
    transaction, no disk. The worker drains it every few seconds.

    When it overflows the oldest views are dropped, so a flood of traffic costs us numbers, never the server.
    """

    def __init__(self, maxlen: int = MAX_BUFFERED) -> None:
        self._views: deque[View] = deque(maxlen=maxlen)
        self._beacons: deque[Beacon] = deque(maxlen=maxlen)
        self._lock = threading.Lock()
        self.dropped = 0
        self.written = 0

    def record(self, view: View) -> None:
        with self._lock:
            if len(self._views) == self._views.maxlen:
                self.dropped += 1
            self._views.append(view)

    def drain(self) -> list[View]:
        with self._lock:
            views = list(self._views)
            self._views.clear()
            self.written += len(views)
            return views

    def record_beacon(self, beacon: Beacon) -> None:
        with self._lock:
            if len(self._beacons) == self._beacons.maxlen:
                self.dropped += 1
            self._beacons.append(beacon)

    def drain_beacons(self) -> list[Beacon]:
        with self._lock:
            beacons = list(self._beacons)
            self._beacons.clear()
            return beacons

    def stats(self) -> dict:
        with self._lock:
            return {"buffered": len(self._views), "beacons": len(self._beacons),
                    "dropped": self.dropped, "written": self.written}
