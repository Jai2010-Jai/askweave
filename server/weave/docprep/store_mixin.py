"""Storage Mixin for Government Form Photos, Signatures, and Documents.

Manages SQLite records for:
1. Generated document tokens & metadata (72-hour TTL).
2. 30-day cached exam specifications (exam_specs_cache).
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import time
from pathlib import Path
from typing import Any

log = logging.getLogger("weave.docprep.store")

DOCPREP_SCHEMA = """
CREATE TABLE IF NOT EXISTS exam_specs_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query_key TEXT UNIQUE NOT NULL,
    specs_json TEXT NOT NULL,
    source_title TEXT,
    created_at REAL NOT NULL,
    expires_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exam_specs_query ON exam_specs_cache(query_key);

CREATE TABLE IF NOT EXISTS docprep_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT UNIQUE NOT NULL,
    user_id INTEGER,
    phone TEXT NOT NULL,
    filename TEXT NOT NULL,
    doc_type TEXT NOT NULL,
    file_bytes INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    downloads_count INTEGER DEFAULT 0,
    expires_at REAL NOT NULL,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docprep_token ON docprep_files(token_hash);
CREATE INDEX IF NOT EXISTS idx_docprep_user ON docprep_files(user_id);
CREATE INDEX IF NOT EXISTS idx_docprep_expires ON docprep_files(expires_at);
"""


def _sha256(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class DocprepMixin:
    """Methods mixed into SmsStore for citizen document storage."""

    def _migrate_docprep(self, c) -> None:
        c.executescript(DOCPREP_SCHEMA)

    # ---------- Document Files & Tokens ----------

    def save_docprep_file(
        self,
        phone: str,
        filename: str,
        doc_type: str,
        data: bytes,
        mime_type: str,
        user_id: int | None = None,
        ttl_hours: float = 72.0,
    ) -> tuple[str, dict]:
        """Save formatted document data to disk and create a secure download token."""
        now = time.time()
        raw_token = secrets.token_urlsafe(24)
        token_hash = _sha256(raw_token)
        expires_at = now + (ttl_hours * 3600)

        # Storage directory: data/docprep/
        docprep_dir: Path = getattr(self, "path").parent / "docprep"
        docprep_dir.mkdir(parents=True, exist_ok=True)

        disk_name = f"{token_hash[:16]}_{filename}"
        disk_path = docprep_dir / disk_name
        disk_path.write_bytes(data)

        # Store relative path
        rel_path = f"docprep/{disk_name}"

        with self.tx() as c:
            cur = c.execute(
                """
                INSERT INTO docprep_files
                (token_hash, user_id, phone, filename, doc_type, file_bytes, mime_type, file_path, downloads_count, expires_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
                """,
                (token_hash, user_id, phone, filename, doc_type, len(data), mime_type, rel_path, expires_at, now),
            )
            row_id = cur.lastrowid

        row = self.one("SELECT * FROM docprep_files WHERE id = ?", (row_id,))
        return raw_token, dict(row)  # type: ignore[return-value]

    def get_docprep_file(self, raw_token: str) -> tuple[str, dict | None]:
        """Fetch file record by raw token. Returns ('ok', row) | ('expired', row) | ('unknown', None)."""
        token_hash = _sha256(raw_token)
        row = self.one("SELECT * FROM docprep_files WHERE token_hash = ?", (token_hash,))
        if not row:
            return "unknown", None

        now = time.time()
        if row["expires_at"] <= now:
            return "expired", row

        # Atomically increment downloads count
        with self.tx() as c:
            c.execute("UPDATE docprep_files SET downloads_count = downloads_count + 1 WHERE id = ?", (row["id"],))

        updated = self.one("SELECT * FROM docprep_files WHERE id = ?", (row["id"],))
        return "ok", updated

    def purge_expired_docprep_files(self) -> int:
        """Housekeeping: permanently delete expired docprep records and disk files."""
        now = time.time()
        base_dir: Path = getattr(self, "path").parent

        rows = self.all("SELECT id, file_path FROM docprep_files WHERE expires_at < ?", (now,))
        if not rows:
            return 0

        purged = 0
        with self.tx() as c:
            for r in rows:
                c.execute("DELETE FROM docprep_files WHERE id = ?", (r["id"],))
                # Delete disk file
                try:
                    f = base_dir / r["file_path"]
                    if f.is_file():
                        f.unlink()
                except Exception as e:
                    log.warning("Could not delete expired file %s: %s", r["file_path"], e)
                purged += 1

        return purged

    # ---------- Exam Specs Cache ----------

    def get_cached_specs(self, norm_key: str) -> dict | None:
        """Fetch valid cached specs from exam_specs_cache."""
        now = time.time()
        row = self.one(
            """
            SELECT specs_json, expires_at FROM exam_specs_cache
            WHERE query_key = ? OR ? LIKE ('%' || query_key || '%')
            ORDER BY length(query_key) DESC LIMIT 1
            """,
            (norm_key, norm_key),
        )
        if row and row["expires_at"] > now:
            import json
            try:
                return json.loads(row["specs_json"])
            except Exception:
                return None
        return None

    def set_cached_specs(self, norm_key: str, specs_json: str, source_title: str | None = None, ttl_days: float = 30.0) -> None:
        """Store resolved specs into exam_specs_cache with 30-day TTL."""
        now = time.time()
        expires_at = now + (ttl_days * 86400)
        with self.tx() as c:
            c.execute(
                """
                INSERT OR REPLACE INTO exam_specs_cache
                (query_key, specs_json, source_title, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (norm_key, specs_json, source_title, now, expires_at),
            )
