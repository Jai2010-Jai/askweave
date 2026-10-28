"""Pharmacy and Medical Store inventory, order management, and agent persistence.

Handles medical store onboarding, multi-tenant pharmacy inventory tracking,
cross-store medicine search, order lifecycle, payment links, and bulk distributor reorders.
Mixed into SmsStore to share SQLite connection, WAL mode, and transactions.
"""

from __future__ import annotations

import logging
import re
import secrets
import time
from typing import Any

log = logging.getLogger("weave.sms.pharmacy")

PHARMACY_SCHEMA = """
CREATE TABLE IF NOT EXISTS pharmacy_stores (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
    account_id INTEGER REFERENCES accounts(id),
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    auto_payment_link INTEGER NOT NULL DEFAULT 0,
    upi_id TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS pharmacy_inventory (
    id INTEGER PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES pharmacy_stores(id),
    item_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'medicine',
    unit TEXT NOT NULL DEFAULT 'strip',
    price_paise INTEGER NOT NULL,
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    low_stock_threshold INTEGER NOT NULL DEFAULT 5,
    bulk_reorder_qty INTEGER NOT NULL DEFAULT 100,
    bulk_reorder_price_paise INTEGER NOT NULL DEFAULT 140000,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE (store_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS pharmacy_orders (
    id INTEGER PRIMARY KEY,
    order_ref TEXT NOT NULL UNIQUE,
    store_id INTEGER NOT NULL REFERENCES pharmacy_stores(id),
    customer_user_id INTEGER REFERENCES users(id),
    customer_phone TEXT NOT NULL,
    item_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit TEXT NOT NULL DEFAULT 'strip',
    unit_price_paise INTEGER NOT NULL,
    total_amount_paise INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_approval',
    payment_token TEXT UNIQUE,
    payment_link TEXT,
    created_at REAL NOT NULL,
    paid_at REAL,
    completed_at REAL
);

CREATE TABLE IF NOT EXISTS pharmacy_reorders (
    id INTEGER PRIMARY KEY,
    reorder_ref TEXT NOT NULL UNIQUE,
    store_id INTEGER NOT NULL REFERENCES pharmacy_stores(id),
    item_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit TEXT NOT NULL DEFAULT 'strip',
    total_price_paise INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'ordered',
    created_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_stores_user ON pharmacy_stores(user_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_inventory_search ON pharmacy_inventory(normalized_name, stock_quantity);
CREATE INDEX IF NOT EXISTS idx_pharmacy_inventory_store ON pharmacy_inventory(store_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_orders_store ON pharmacy_orders(store_id, status);
CREATE INDEX IF NOT EXISTS idx_pharmacy_orders_cust ON pharmacy_orders(customer_user_id, status);
CREATE INDEX IF NOT EXISTS idx_pharmacy_orders_token ON pharmacy_orders(payment_token);
"""


def normalize_med_name(name: str) -> str:
    """Normalize medicine names for consistent index lookup and query matching."""
    clean = re.sub(r"[^a-zA-Z0-9]+", " ", (name or "").strip().lower()).strip()
    return clean or "unknown"


class PharmacyMixin:
    """Pharmacy / Medical Store methods for SmsStore."""

    def _migrate_pharmacy(self, c) -> None:
        c.executescript(PHARMACY_SCHEMA)

    # ---------- store profiles ----------
    def register_pharmacy_store(self, user_id: int, name: str, phone: str,
                                account_id: int | None = None, upi_id: str | None = None,
                                auto_payment_link: int = 0) -> dict:
        now = time.time()
        clean_name = name.strip() or "Medical Store"
        clean_phone = phone.strip()
        with self.tx() as c:
            c.execute(
                """
                INSERT INTO pharmacy_stores (user_id, account_id, name, phone, auto_payment_link, upi_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    name = excluded.name,
                    phone = excluded.phone,
                    account_id = COALESCE(excluded.account_id, pharmacy_stores.account_id),
                    auto_payment_link = excluded.auto_payment_link,
                    upi_id = COALESCE(excluded.upi_id, pharmacy_stores.upi_id),
                    updated_at = excluded.updated_at
                """,
                (user_id, account_id, clean_name, clean_phone, auto_payment_link, upi_id, now, now),
            )
        return self.get_pharmacy_store_by_user(user_id)  # type: ignore[return-value]

    def get_pharmacy_store_by_user(self, user_id: int) -> dict | None:
        return self.one("SELECT * FROM pharmacy_stores WHERE user_id = ?", (user_id,))

    def get_pharmacy_store(self, store_id: int) -> dict | None:
        return self.one("SELECT * FROM pharmacy_stores WHERE id = ?", (store_id,))

    def update_pharmacy_store(self, store_id: int, **fields: Any) -> dict | None:
        if not fields:
            return self.get_pharmacy_store(store_id)
        fields["updated_at"] = time.time()
        cols = ", ".join(f"{k} = ?" for k in fields)
        vals = tuple(fields.values()) + (store_id,)
        with self.tx() as c:
            c.execute(f"UPDATE pharmacy_stores SET {cols} WHERE id = ?", vals)
        return self.get_pharmacy_store(store_id)

    # ---------- inventory ----------
    def add_or_update_inventory_item(self, store_id: int, item_name: str, price_paise: int,
                                     stock_quantity: int, low_stock_threshold: int = 5,
                                     unit: str = "strip", bulk_qty: int = 100,
                                     bulk_price_paise: int | None = None) -> dict:
        now = time.time()
        norm_name = normalize_med_name(item_name)
        clean_name = item_name.strip()
        clean_unit = unit.strip().lower() or "strip"
        if bulk_price_paise is None:
            # Wholesale discount assumption: 70% of retail price for bulk pack
            bulk_price_paise = int(price_paise * bulk_qty * 0.70)

        with self.tx() as c:
            c.execute(
                """
                INSERT INTO pharmacy_inventory (
                    store_id, item_name, normalized_name, unit, price_paise,
                    stock_quantity, low_stock_threshold, bulk_reorder_qty,
                    bulk_reorder_price_paise, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(store_id, normalized_name) DO UPDATE SET
                    item_name = excluded.item_name,
                    unit = excluded.unit,
                    price_paise = excluded.price_paise,
                    stock_quantity = excluded.stock_quantity,
                    low_stock_threshold = excluded.low_stock_threshold,
                    bulk_reorder_qty = excluded.bulk_reorder_qty,
                    bulk_reorder_price_paise = excluded.bulk_reorder_price_paise,
                    updated_at = excluded.updated_at
                """,
                (store_id, clean_name, norm_name, clean_unit, price_paise,
                 stock_quantity, low_stock_threshold, bulk_qty, bulk_price_paise, now, now),
            )
        return self.get_inventory_item(store_id, item_name)  # type: ignore[return-value]

    def batch_add_inventory(self, store_id: int, items: list[dict]) -> int:
        """Batch upsert inventory items, returns count added/updated."""
        count = 0
        for it in items:
            self.add_or_update_inventory_item(
                store_id=store_id,
                item_name=it["item_name"],
                price_paise=it["price_paise"],
                stock_quantity=it.get("stock_quantity", 0),
                low_stock_threshold=it.get("low_stock_threshold", 5),
                unit=it.get("unit", "strip"),
                bulk_qty=it.get("bulk_reorder_qty", 100),
                bulk_price_paise=it.get("bulk_reorder_price_paise"),
            )
            count += 1
        return count

    def get_inventory_item(self, store_id: int, item_name: str) -> dict | None:
        norm_name = normalize_med_name(item_name)
        return self.one(
            "SELECT * FROM pharmacy_inventory WHERE store_id = ? AND normalized_name = ?",
            (store_id, norm_name),
        )

    def get_inventory_items(self, store_id: int) -> list[dict]:
        return self.all(
            "SELECT * FROM pharmacy_inventory WHERE store_id = ? ORDER BY item_name ASC",
            (store_id,),
        )

    def get_low_stock_items(self, store_id: int | None = None) -> list[dict]:
        """Find items at or below low stock threshold."""
        if store_id is not None:
            return self.all(
                """
                SELECT i.*, s.name as store_name, s.phone as store_phone
                FROM pharmacy_inventory i
                JOIN pharmacy_stores s ON i.store_id = s.id
                WHERE i.store_id = ? AND i.stock_quantity <= i.low_stock_threshold
                ORDER BY i.stock_quantity ASC
                """,
                (store_id,),
            )
        return self.all(
            """
            SELECT i.*, s.name as store_name, s.phone as store_phone
            FROM pharmacy_inventory i
            JOIN pharmacy_stores s ON i.store_id = s.id
            WHERE i.stock_quantity <= i.low_stock_threshold
            ORDER BY i.stock_quantity ASC
            """
        )

    def deduct_inventory_stock(self, store_id: int, item_name: str, qty: int) -> tuple[int, bool]:
        """Deduct quantity from stock. Returns (new_stock, is_low_stock)."""
        norm_name = normalize_med_name(item_name)
        now = time.time()
        with self.tx() as c:
            row = c.execute(
                "SELECT * FROM pharmacy_inventory WHERE store_id = ? AND (normalized_name = ? OR normalized_name LIKE ?)",
                (store_id, norm_name, f"%{norm_name}%"),
            ).fetchone()
            if not row:
                return (0, False)
            item = dict(row)
            current_stock = item["stock_quantity"]
            new_stock = max(0, current_stock - qty)
            c.execute(
                "UPDATE pharmacy_inventory SET stock_quantity = ?, updated_at = ? WHERE id = ?",
                (new_stock, now, item["id"]),
            )
            is_low = new_stock <= item["low_stock_threshold"]
            return (new_stock, is_low)

    def set_inventory_stock(self, store_id: int, item_name: str, new_stock: int) -> tuple[dict | None, bool]:
        """Set stock directly (e.g. 'Paracetamol got over' -> new_stock=0)."""
        norm_name = normalize_med_name(item_name)
        now = time.time()
        with self.tx() as c:
            row = c.execute(
                "SELECT * FROM pharmacy_inventory WHERE store_id = ? AND (normalized_name = ? OR normalized_name LIKE ?)",
                (store_id, norm_name, f"%{norm_name}%"),
            ).fetchone()
            if not row:
                return (None, False)
            item = dict(row)
            c.execute(
                "UPDATE pharmacy_inventory SET stock_quantity = ?, updated_at = ? WHERE id = ?",
                (new_stock, now, item["id"]),
            )
            updated_row = c.execute("SELECT * FROM pharmacy_inventory WHERE id = ?", (item["id"],)).fetchone()
            updated = dict(updated_row) if updated_row else None
            is_low = new_stock <= (updated["low_stock_threshold"] if updated else 5)
            return (updated, is_low)

    # ---------- cross-store medicine search ----------
    def search_medicine(self, query: str, min_qty: int = 1) -> list[dict]:
        """Search across all medical stores for available stock matching query."""
        norm = normalize_med_name(query)
        words = norm.split()
        if not words:
            return []

        # Try exact normalized match first, then prefix/contains
        sql = """
        SELECT i.*, s.name as store_name, s.phone as store_phone,
               s.auto_payment_link, s.upi_id, s.user_id as store_user_id
        FROM pharmacy_inventory i
        JOIN pharmacy_stores s ON i.store_id = s.id
        WHERE i.stock_quantity >= ?
          AND (
            i.normalized_name = ?
            OR i.normalized_name LIKE ?
            OR ? LIKE '%' || i.normalized_name || '%'
          )
        ORDER BY i.price_paise ASC, i.stock_quantity DESC
        """
        exact_like = f"%{norm}%"
        matches = self.all(sql, (min_qty, norm, exact_like, norm))
        if matches:
            return matches

        # Fallback: match any significant word (length >= 4)
        for w in words:
            if len(w) >= 4:
                w_like = f"%{w}%"
                sub_matches = self.all(sql, (min_qty, w, w_like, w))
                if sub_matches:
                    return sub_matches
        return []

    # ---------- orders ----------
    def create_pharmacy_order(self, store_id: int, customer_phone: str, item_name: str,
                              quantity: int, unit_price_paise: int, total_amount_paise: int,
                              customer_user_id: int | None = None, unit: str = "strip",
                              payment_token: str | None = None, payment_link: str | None = None,
                              status: str = "pending_approval") -> dict:
        now = time.time()
        order_ref = f"MED-{secrets.randbelow(90000) + 10000}"
        token = payment_token or f"pay_med_{secrets.token_hex(12)}"
        with self.tx() as c:
            cur = c.execute(
                """
                INSERT INTO pharmacy_orders (
                    order_ref, store_id, customer_user_id, customer_phone, item_name,
                    quantity, unit, unit_price_paise, total_amount_paise,
                    status, payment_token, payment_link, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (order_ref, store_id, customer_user_id, customer_phone, item_name,
                 quantity, unit, unit_price_paise, total_amount_paise,
                 status, token, payment_link, now),
            )
            order_id = cur.lastrowid
        return self.get_pharmacy_order(order_id)  # type: ignore[return-value]

    def get_pharmacy_order(self, order_id: int) -> dict | None:
        return self.one(
            """
            SELECT o.*, s.name as store_name, s.phone as store_phone, s.user_id as store_user_id
            FROM pharmacy_orders o
            JOIN pharmacy_stores s ON o.store_id = s.id
            WHERE o.id = ?
            """,
            (order_id,),
        )

    def get_pharmacy_order_by_token(self, payment_token: str) -> dict | None:
        return self.one(
            """
            SELECT o.*, s.name as store_name, s.phone as store_phone, s.user_id as store_user_id
            FROM pharmacy_orders o
            JOIN pharmacy_stores s ON o.store_id = s.id
            WHERE o.payment_token = ?
            """,
            (payment_token,),
        )

    def get_pharmacy_order_by_ref(self, order_ref: str) -> dict | None:
        return self.one(
            """
            SELECT o.*, s.name as store_name, s.phone as store_phone, s.user_id as store_user_id
            FROM pharmacy_orders o
            JOIN pharmacy_stores s ON o.store_id = s.id
            WHERE o.order_ref = ?
            """,
            (order_ref,),
        )

    def get_pending_orders_for_store(self, store_id: int) -> list[dict]:
        return self.all(
            "SELECT * FROM pharmacy_orders WHERE store_id = ? AND status != 'completed' ORDER BY created_at DESC",
            (store_id,),
        )

    def update_pharmacy_order(self, order_id: int, **fields: Any) -> dict | None:
        if not fields:
            return self.get_pharmacy_order(order_id)
        cols = ", ".join(f"{k} = ?" for k in fields)
        vals = tuple(fields.values()) + (order_id,)
        with self.tx() as c:
            c.execute(f"UPDATE pharmacy_orders SET {cols} WHERE id = ?", vals)
        return self.get_pharmacy_order(order_id)

    def mark_pharmacy_order_paid(self, order_id: int) -> dict | None:
        now = time.time()
        return self.update_pharmacy_order(order_id, status="paid_ready_for_pickup", paid_at=now)

    # ---------- bulk distributor reorders ----------
    def record_bulk_reorder(self, store_id: int, item_name: str, quantity: int,
                            total_price_paise: int, unit: str = "strip") -> dict:
        now = time.time()
        reorder_ref = f"DIST-{secrets.randbelow(90000) + 10000}"
        with self.tx() as c:
            cur = c.execute(
                """
                INSERT INTO pharmacy_reorders (
                    reorder_ref, store_id, item_name, quantity, unit, total_price_paise, status, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, 'ordered', ?)
                """,
                (reorder_ref, store_id, item_name, quantity, unit, total_price_paise, now),
            )
            reorder_id = cur.lastrowid
        return self.one("SELECT * FROM pharmacy_reorders WHERE id = ?", (reorder_id,))  # type: ignore[return-value]
