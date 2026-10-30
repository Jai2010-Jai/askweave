"""Each account's own data: tables of products, menu items, services or stock that their live websites show.

A table belongs to one account and has a fixed list of typed fields; each row is a JSON object keyed by those
fields. Hosted pages read the tables when they are served (weave.site.data), so a price or stock change shows on
the site straight away with no rebuild. Every change bumps the table's updated_at, which is also what retires
cached copies of the pages.
"""

from __future__ import annotations

import json
import time

DATA_SCHEMA = """
CREATE TABLE IF NOT EXISTS data_tables (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    name TEXT NOT NULL,                      -- what pages refer to: data-weave-list="products"
    label TEXT NOT NULL DEFAULT '',
    fields TEXT NOT NULL DEFAULT '[]',       -- [{"key": "price", "label": "Price", "type": "money"}, ...]
    currency TEXT NOT NULL DEFAULT '₹',
    public INTEGER NOT NULL DEFAULT 1,       -- 0 = kept private: never sent to the live site
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    UNIQUE (account_id, name)
);
CREATE TABLE IF NOT EXISTS data_rows (
    id INTEGER PRIMARY KEY,
    table_id INTEGER NOT NULL REFERENCES data_tables(id),
    data TEXT NOT NULL DEFAULT '{}',
    position INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS data_rows_table ON data_rows(table_id, position, id);
"""


def _table(row: dict | None) -> dict | None:
    if row is None:
        return None
    return {**row, "fields": json.loads(row["fields"] or "[]"), "public": bool(row["public"])}


def _row(row: dict) -> dict:
    return {"id": row["id"], "data": json.loads(row["data"] or "{}"), "updated_at": row["updated_at"]}


class DataMixin:
    """Data-table methods for SmsStore (uses its tx/one/all helpers)."""

    def _migrate_data(self, c) -> None:
        c.executescript(DATA_SCHEMA)

    # ---------- tables ----------
    def data_tables(self, account_id: int) -> list[dict]:
        rows = self.all("SELECT t.*, (SELECT COUNT(*) FROM data_rows r WHERE r.table_id = t.id) AS row_count "
                        "FROM data_tables t WHERE t.account_id = ? ORDER BY t.id", (account_id,))
        return [_table(r) for r in rows]

    def data_table(self, account_id: int, name: str) -> dict | None:
        return _table(self.one("SELECT * FROM data_tables WHERE account_id = ? AND name = ?", (account_id, name)))

    def create_data_table(self, account_id: int, name: str, label: str, fields: list[dict], currency: str = "₹") -> dict:
        now = time.time()
        with self.tx() as c:
            c.execute("INSERT INTO data_tables (account_id, name, label, fields, currency, created_at, updated_at) "
                      "VALUES (?, ?, ?, ?, ?, ?, ?)", (account_id, name, label, json.dumps(fields), currency, now, now))
        return self.data_table(account_id, name)

    def update_data_table(self, table_id: int, **changes) -> None:
        allowed = {k: v for k, v in changes.items() if k in ("label", "fields", "currency", "public")}
        if "fields" in allowed:
            allowed["fields"] = json.dumps(allowed["fields"])
        if "public" in allowed:
            allowed["public"] = 1 if allowed["public"] else 0
        sets = ", ".join(f"{k} = ?" for k in allowed)
        with self.tx() as c:
            c.execute(f"UPDATE data_tables SET {sets + ', ' if sets else ''}updated_at = ? WHERE id = ?",
                      (*allowed.values(), time.time(), table_id))

    def delete_data_table(self, table_id: int) -> None:
        with self.tx() as c:
            c.execute("DELETE FROM data_rows WHERE table_id = ?", (table_id,))
            c.execute("DELETE FROM data_tables WHERE id = ?", (table_id,))

    def delete_account_data(self, account_id: int) -> None:
        with self.tx() as c:
            c.execute("DELETE FROM data_rows WHERE table_id IN (SELECT id FROM data_tables WHERE account_id = ?)",
                      (account_id,))
            c.execute("DELETE FROM data_tables WHERE account_id = ?", (account_id,))

    def data_version(self, account_id: int) -> float:
        """Changes whenever any of the account's data does: part of each page's cache validator."""
        row = self.one("SELECT MAX(updated_at) AS v, COUNT(*) AS n FROM data_tables WHERE account_id = ?", (account_id,))
        return float(row["v"] or 0) + (row["n"] or 0) if row else 0.0

    # ---------- rows ----------
    def data_rows(self, table_id: int) -> list[dict]:
        return [_row(r) for r in self.all("SELECT * FROM data_rows WHERE table_id = ? ORDER BY position, id",
                                          (table_id,))]

    def data_row_count(self, table_id: int) -> int:
        return (self.one("SELECT COUNT(*) AS n FROM data_rows WHERE table_id = ?", (table_id,)) or {}).get("n", 0)

    def add_data_rows(self, table_id: int, items: list[dict]) -> list[int]:
        now = time.time()
        ids = []
        with self.tx() as c:
            top = c.execute("SELECT COALESCE(MAX(position), 0) AS p FROM data_rows WHERE table_id = ?",
                            (table_id,)).fetchone()["p"]
            for i, data in enumerate(items, 1):
                cur = c.execute("INSERT INTO data_rows (table_id, data, position, created_at, updated_at) "
                                "VALUES (?, ?, ?, ?, ?)", (table_id, json.dumps(data), top + i, now, now))
                ids.append(cur.lastrowid)
            c.execute("UPDATE data_tables SET updated_at = ? WHERE id = ?", (now, table_id))
        return ids

    def update_data_row(self, table_id: int, row_id: int, data: dict) -> bool:
        now = time.time()
        with self.tx() as c:
            cur = c.execute("UPDATE data_rows SET data = ?, updated_at = ? WHERE id = ? AND table_id = ?",
                            (json.dumps(data), now, row_id, table_id))
            if cur.rowcount:
                c.execute("UPDATE data_tables SET updated_at = ? WHERE id = ?", (now, table_id))
        return bool(cur.rowcount)

    def delete_data_row(self, table_id: int, row_id: int) -> bool:
        with self.tx() as c:
            cur = c.execute("DELETE FROM data_rows WHERE id = ? AND table_id = ?", (row_id, table_id))
            if cur.rowcount:
                c.execute("UPDATE data_tables SET updated_at = ? WHERE id = ?", (time.time(), table_id))
        return bool(cur.rowcount)

    def replace_data_rows(self, table_id: int, items: list[dict]) -> None:
        """A CSV import: the file becomes the table."""
        with self.tx() as c:
            c.execute("DELETE FROM data_rows WHERE table_id = ?", (table_id,))
        self.add_data_rows(table_id, items)
