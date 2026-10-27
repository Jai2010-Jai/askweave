"""Udhar / Credit Ledger for Kirana Stores.

Tracks customer debts (udhar), promises to pay (due dates), balances, and UPI payment tokens.
Mixed into SmsStore so the ledger shares SQLite transactions, connections, and WAL mode.
"""

from __future__ import annotations

import logging
import secrets
import time
from typing import Any

log = logging.getLogger("weave.sms.udhar")

UDHAR_SCHEMA = """
CREATE TABLE IF NOT EXISTS udhar_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    account_id INTEGER REFERENCES accounts(id),
    upi_id TEXT NOT NULL,
    payee_name TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS udhar_customers (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    account_id INTEGER REFERENCES accounts(id),
    name TEXT NOT NULL,
    phone TEXT,
    total_balance_paise INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS udhar_entries (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    account_id INTEGER REFERENCES accounts(id),
    customer_id INTEGER NOT NULL REFERENCES udhar_customers(id),
    amount_paise INTEGER NOT NULL,
    due_day INTEGER,                       -- whole UTC day since epoch: int(ts // 86400)
    status TEXT NOT NULL DEFAULT 'pending',-- pending | settled | cancelled
    items_summary TEXT,
    voice_transcript TEXT,
    payment_token TEXT UNIQUE,             -- token for /pay/<token> checkout link
    reminded_owner_day INTEGER,            -- day when the kirana owner was reminded
    reminded_customer_at REAL,             -- timestamp when customer was sent link
    created_at REAL NOT NULL,
    settled_at REAL
);

CREATE INDEX IF NOT EXISTS idx_udhar_entries_due ON udhar_entries(user_id, status, due_day);
CREATE INDEX IF NOT EXISTS idx_udhar_entries_token ON udhar_entries(payment_token);
CREATE INDEX IF NOT EXISTS idx_udhar_customers_phone ON udhar_customers(user_id, phone);
"""


def normalize_customer_name(name: str) -> str:
    """Normalize customer names: strip honorifics like 'Mr.', 'bhaiya', 'ji' for consistent lookup."""
    clean = (name or "").strip()
    # Strip common English & Hindi prefixes
    for prefix in ("mr.", "mr ", "mister ", "shri ", "shree "):
        if clean.lower().startswith(prefix):
            clean = clean[len(prefix):].strip()
            break
    # Strip common Hindi suffixes
    for suffix in (" ji", "ji", " bhaiya", " bhai", " uncle", " chacha", " babu"):
        if clean.lower().endswith(suffix):
            clean = clean[:-len(suffix)].strip()
            break
    return clean.title() if clean else "Unknown"


class UdharMixin:
    """Udhar / Credit ledger methods for SmsStore."""

    def _migrate_udhar(self, c) -> None:
        c.executescript(UDHAR_SCHEMA)

    # ---------- settings ----------
    def set_udhar_settings(self, user_id: int, upi_id: str, payee_name: str, account_id: int | None = None) -> dict:
        now = time.time()
        clean_upi = upi_id.strip()
        clean_name = payee_name.strip()
        with self.tx() as c:
            c.execute(
                """
                INSERT INTO udhar_settings (user_id, account_id, upi_id, payee_name, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    upi_id = excluded.upi_id,
                    payee_name = excluded.payee_name,
                    account_id = COALESCE(excluded.account_id, udhar_settings.account_id),
                    updated_at = excluded.updated_at
                """,
                (user_id, account_id, clean_upi, clean_name, now, now),
            )
        return self.get_udhar_settings(user_id)  # type: ignore[return-value]

    def get_udhar_settings(self, user_id: int) -> dict | None:
        return self.one("SELECT * FROM udhar_settings WHERE user_id = ?", (user_id,))

    # ---------- customers ----------
    def get_or_create_udhar_customer(self, user_id: int, name: str, phone: str | None = None,
                                     account_id: int | None = None) -> dict:
        norm_name = normalize_customer_name(name)
        row = self.one("SELECT * FROM udhar_customers WHERE user_id = ? AND name = ?", (user_id, norm_name))
        now = time.time()
        clean_phone = phone.strip() if phone else None
        if row is not None:
            if clean_phone and not row["phone"]:
                with self.tx() as c:
                    c.execute("UPDATE udhar_customers SET phone = ?, updated_at = ? WHERE id = ?",
                              (clean_phone, now, row["id"]))
                return self.one("SELECT * FROM udhar_customers WHERE id = ?", (row["id"],))  # type: ignore[return-value]
            return row

        with self.tx() as c:
            cur = c.execute(
                """
                INSERT INTO udhar_customers (user_id, account_id, name, phone, total_balance_paise, created_at, updated_at)
                VALUES (?, ?, ?, ?, 0, ?, ?)
                """,
                (user_id, account_id, norm_name, clean_phone, now, now),
            )
            cust_id = cur.lastrowid
        return self.one("SELECT * FROM udhar_customers WHERE id = ?", (cust_id,))  # type: ignore[return-value]

    def find_udhar_customer(self, user_id: int, name_or_phone: str) -> dict | None:
        norm = normalize_customer_name(name_or_phone)
        row = self.one("SELECT * FROM udhar_customers WHERE user_id = ? AND name = ?", (user_id, norm))
        if row:
            return row
        clean_digits = "".join(ch for ch in name_or_phone if ch.isdigit())
        if len(clean_digits) >= 10:
            return self.one("SELECT * FROM udhar_customers WHERE user_id = ? AND phone LIKE ?",
                            (user_id, f"%{clean_digits[-10:]}"))
        return None

    def update_customer_phone(self, customer_id: int, phone: str) -> None:
        now = time.time()
        with self.tx() as c:
            c.execute("UPDATE udhar_customers SET phone = ?, updated_at = ? WHERE id = ?",
                      (phone.strip(), now, customer_id))

    # ---------- credit entries ----------
    def record_udhar_entry(
        self,
        user_id: int,
        customer_name: str,
        amount_paise: int,
        due_day: int | None = None,
        items_summary: str | None = None,
        voice_transcript: str | None = None,
        customer_phone: str | None = None,
        account_id: int | None = None,
    ) -> dict:
        """Record money owed by a customer. Creates customer if not present and increments total balance."""
        if amount_paise <= 0:
            raise ValueError("Amount must be greater than zero")

        now = time.time()
        token = "pay_" + secrets.token_urlsafe(12)
        with self.tx() as c:
            # 1. Ensure customer exists
            norm_name = normalize_customer_name(customer_name)
            cust = self.one("SELECT * FROM udhar_customers WHERE user_id = ? AND name = ?", (user_id, norm_name))
            if cust is None:
                cur = c.execute(
                    """
                    INSERT INTO udhar_customers (user_id, account_id, name, phone, total_balance_paise, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (user_id, account_id, norm_name, customer_phone, amount_paise, now, now),
                )
                cust_id = cur.lastrowid
            else:
                cust_id = cust["id"]
                phone_update = customer_phone if (customer_phone and not cust["phone"]) else cust["phone"]
                c.execute(
                    """
                    UPDATE udhar_customers
                    SET total_balance_paise = total_balance_paise + ?,
                        phone = ?,
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (amount_paise, phone_update, now, cust_id),
                )

            # 2. Insert ledger entry
            cur_entry = c.execute(
                """
                INSERT INTO udhar_entries (
                    user_id, account_id, customer_id, amount_paise, due_day,
                    status, items_summary, voice_transcript, payment_token,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
                """,
                (user_id, account_id, cust_id, amount_paise, due_day, items_summary,
                 voice_transcript, token, now),
            )
            entry_id = cur_entry.lastrowid

        return self.get_udhar_entry(entry_id)  # type: ignore[return-value]

    def get_udhar_entry(self, entry_id: int) -> dict | None:
        query = """
            SELECT e.*, c.name as customer_name, c.phone as customer_phone, c.total_balance_paise
            FROM udhar_entries e
            JOIN udhar_customers c ON e.customer_id = c.id
            WHERE e.id = ?
        """
        return self.one(query, (entry_id,))

    def get_udhar_entry_by_token(self, token: str) -> dict | None:
        query = """
            SELECT e.*, c.name as customer_name, c.phone as customer_phone,
                   s.upi_id, s.payee_name
            FROM udhar_entries e
            JOIN udhar_customers c ON e.customer_id = c.id
            LEFT JOIN udhar_settings s ON e.user_id = s.user_id
            WHERE e.payment_token = ?
        """
        return self.one(query, (token,))

    def settle_udhar(self, user_id: int, customer_name: str, amount_paise: int | None = None) -> dict:
        """Mark credit as settled (partial or full)."""
        cust = self.find_udhar_customer(user_id, customer_name)
        if not cust:
            return {"found": False, "customer": customer_name, "settled_paise": 0, "balance_paise": 0}

        now = time.time()
        cust_id = cust["id"]
        current_balance = cust["total_balance_paise"]

        to_settle = current_balance if (amount_paise is None or amount_paise >= current_balance) else amount_paise
        if to_settle <= 0:
            return {"found": True, "customer": cust["name"], "settled_paise": 0, "balance_paise": current_balance}

        with self.tx() as c:
            # 1. Update customer balance
            new_balance = max(0, current_balance - to_settle)
            c.execute("UPDATE udhar_customers SET total_balance_paise = ?, updated_at = ? WHERE id = ?",
                      (new_balance, now, cust_id))

            # 2. Mark entries as settled (oldest first)
            pending_entries = c.execute(
                "SELECT id, amount_paise FROM udhar_entries WHERE customer_id = ? AND status = 'pending' ORDER BY id ASC",
                (cust_id,),
            ).fetchall()

            rem = to_settle
            for e in pending_entries:
                if rem <= 0:
                    break
                e_id, e_amt = e["id"], e["amount_paise"]
                if rem >= e_amt:
                    c.execute("UPDATE udhar_entries SET status = 'settled', settled_at = ? WHERE id = ?", (now, e_id))
                    rem -= e_amt
                else:
                    # Partial reduction on an entry: split or keep note
                    break

        return {
            "found": True,
            "customer": cust["name"],
            "settled_paise": to_settle,
            "balance_paise": new_balance,
        }

    def snooze_udhar_entry(self, entry_id: int, extra_days: int) -> dict | None:
        """Extend due date of an entry."""
        entry = self.get_udhar_entry(entry_id)
        if not entry:
            return None
        current_due = entry["due_day"] or int(time.time() // 86400)
        new_due = current_due + extra_days
        with self.tx() as c:
            c.execute("UPDATE udhar_entries SET due_day = ?, reminded_owner_day = NULL WHERE id = ?", (new_due, entry_id))
        return self.get_udhar_entry(entry_id)

    # ---------- due date & reminder queries ----------
    def get_due_udhar_entries_for_owner(self, user_id: int, current_day: int) -> list[dict]:
        """Fetch pending entries that are due today or earlier and haven't notified the owner today."""
        query = """
            SELECT e.*, c.name as customer_name, c.phone as customer_phone, c.total_balance_paise
            FROM udhar_entries e
            JOIN udhar_customers c ON e.customer_id = c.id
            WHERE e.user_id = ?
              AND e.status = 'pending'
              AND e.due_day <= ?
              AND (e.reminded_owner_day IS NULL OR e.reminded_owner_day < ?)
            ORDER BY e.due_day ASC
        """
        return self.all(query, (user_id, current_day, current_day))

    def get_all_due_udhar_entries(self, current_day: int) -> list[dict]:
        """Fetch all due pending entries across all users for background daemon notifications."""
        query = """
            SELECT e.*, c.name as customer_name, c.phone as customer_phone, c.total_balance_paise,
                   u.phone as owner_phone, u.channel as owner_channel,
                   s.upi_id, s.payee_name
            FROM udhar_entries e
            JOIN udhar_customers c ON e.customer_id = c.id
            JOIN users u ON e.user_id = u.id
            LEFT JOIN udhar_settings s ON e.user_id = s.user_id
            WHERE e.status = 'pending'
              AND e.due_day <= ?
              AND (e.reminded_owner_day IS NULL OR e.reminded_owner_day < ?)
            ORDER BY e.user_id, e.due_day ASC
        """
        return self.all(query, (current_day, current_day))

    def mark_udhar_owner_reminded(self, entry_id: int, current_day: int) -> None:
        with self.tx() as c:
            c.execute("UPDATE udhar_entries SET reminded_owner_day = ? WHERE id = ?", (current_day, entry_id))

    def mark_udhar_customer_reminded(self, entry_id: int) -> None:
        now = time.time()
        with self.tx() as c:
            c.execute("UPDATE udhar_entries SET reminded_customer_at = ? WHERE id = ?", (now, entry_id))

    # ---------- khata reporting ----------
    def get_customer_khata(self, user_id: int, customer_name: str) -> dict | None:
        cust = self.find_udhar_customer(user_id, customer_name)
        if not cust:
            return None
        entries = self.all(
            """
            SELECT * FROM udhar_entries
            WHERE customer_id = ? AND status = 'pending'
            ORDER BY created_at DESC
            """,
            (cust["id"],),
        )
        return {
            "customer": cust,
            "entries": entries,
            "total_balance_paise": cust["total_balance_paise"],
        }

    def get_total_market_udhar(self, user_id: int) -> dict:
        row = self.one(
            """
            SELECT COUNT(DISTINCT customer_id) as total_customers,
                   COALESCE(SUM(amount_paise), 0) as total_paise
            FROM udhar_entries
            WHERE user_id = ? AND status = 'pending'
            """,
            (user_id,),
        )
        customers = self.all(
            """
            SELECT name, phone, total_balance_paise
            FROM udhar_customers
            WHERE user_id = ? AND total_balance_paise > 0
            ORDER BY total_balance_paise DESC
            LIMIT 10
            """,
            (user_id,),
        )
        return {
            "total_customers": row["total_customers"] if row else 0,
            "total_paise": row["total_paise"] if row else 0,
            "top_debtors": customers,
        }
