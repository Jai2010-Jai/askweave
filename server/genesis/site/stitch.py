"""Each customer's own Google Stitch connection.

People connect Stitch with one Google consent (at sign-up with Google, or one button on the dashboard), so the
designs Weave makes for them run in their own Stitch account and use their own Stitch credits, not Weave's. Google
gives a refresh token for the cloud-platform scope; it is stored encrypted (Fernet, key in GENESIS_SECRET_KEY or
data/secret.key) and swapped for a short-lived access token whenever one of their websites is designed. The access
token goes to the website bridge for that one build and is never written to disk."""

from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path

import httpx
from cryptography.fernet import Fernet, InvalidToken

from ..config import Settings

log = logging.getLogger(__name__)

SCOPE = "https://www.googleapis.com/auth/cloud-platform"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE = "https://oauth2.googleapis.com/revoke"


def _fernet(settings: Settings) -> Fernet:
    key = os.environ.get("GENESIS_SECRET_KEY", "").strip()
    if not key:
        path = Path(settings.data_dir) / "secret.key"
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(Fernet.generate_key())
        key = path.read_text().strip()
    return Fernet(key.encode())


class StitchLinks:
    def __init__(self, settings: Settings, store, http: httpx.Client | None = None):
        self.s = settings
        self.store = store
        self.http = http or httpx.Client(timeout=15)
        self._fernet = _fernet(settings)
        self._cache: dict[int, tuple[str, float]] = {}  # account_id -> (access token, expires at)
        self._lock = threading.Lock()

    @property
    def available(self) -> bool:
        return self.s.stitch and bool(self.s.google_client_id and self.s.google_client_secret)

    def save(self, account_id: int, email: str | None, refresh_token: str) -> None:
        self.store.save_stitch_link(account_id, email, self._fernet.encrypt(refresh_token.encode()).decode())
        with self._lock:
            self._cache.pop(account_id, None)

    def status(self, account_id: int) -> dict:
        link = self.store.stitch_link(account_id)
        return {"available": self.available, "connected": bool(link), "email": (link or {}).get("email"),
                "problem": (link or {}).get("error")}

    def credentials(self, account_id: int) -> dict | None:
        """What the website bridge needs to design in this person's Stitch account, or None (not connected,
        Stitch switched off, or the access was revoked: the build then designs with GLM alone)."""
        if not self.available:
            return None
        token = self.access_token(account_id)
        if not token:
            return None
        return {"access_token": token, "quota_project": self.s.stitch_quota_project,
                "timeout_ms": self.s.stitch_timeout * 1000}

    def access_token(self, account_id: int) -> str | None:
        with self._lock:
            cached = self._cache.get(account_id)
            if cached and cached[1] > time.time() + 60:
                return cached[0]
        link = self.store.stitch_link(account_id)
        if not link:
            return None
        try:
            refresh = self._fernet.decrypt(link["refresh_token"].encode()).decode()
        except InvalidToken:
            self.store.mark_stitch_link(account_id, "stored login unreadable; connect Stitch again")
            return None
        try:
            r = self.http.post(GOOGLE_TOKEN, data={"client_id": self.s.google_client_id,
                                                   "client_secret": self.s.google_client_secret,
                                                   "refresh_token": refresh, "grant_type": "refresh_token"})
        except httpx.HTTPError as e:
            log.warning("stitch token refresh failed: %s", type(e).__name__)
            return None
        if r.status_code != 200:
            # invalid_grant: they removed Weave's access in their Google account, or the login expired.
            reason = (r.json() if r.headers.get("content-type", "").startswith("application/json") else {}).get("error")
            self.store.mark_stitch_link(account_id, "Google access ended; connect Stitch again"
                                        if reason == "invalid_grant" else f"Google refused the login ({reason or r.status_code})")
            return None
        data = r.json()
        token = data["access_token"]
        with self._lock:
            self._cache[account_id] = (token, time.time() + float(data.get("expires_in", 3600)))
        self.store.mark_stitch_link(account_id, None)
        return token

    def disconnect(self, account_id: int) -> None:
        link = self.store.stitch_link(account_id)
        if link:
            try:
                refresh = self._fernet.decrypt(link["refresh_token"].encode()).decode()
                self.http.post(GOOGLE_REVOKE, data={"token": refresh})
            except (InvalidToken, httpx.HTTPError):
                pass  # removing it here is what matters; Google drops unused tokens on its own
        self.store.delete_stitch_link(account_id)
        with self._lock:
            self._cache.pop(account_id, None)
