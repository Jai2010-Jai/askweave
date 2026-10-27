"""Visits to hosted customer sites.

Raw views are kept for a few weeks so recent questions ("which page did people look at on Tuesday?") can be
answered exactly; a nightly rollup keeps the daily totals for much longer at a fixed cost per site per day.
Nothing here can be traced to a person: see weave/analytics/collector.py for how `visitor` is made.
Mixed into SmsStore so it shares the same database, connection and transactions.
"""

from __future__ import annotations

import time

ANALYTICS_SCHEMA = """
CREATE TABLE IF NOT EXISTS digests (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    week INTEGER NOT NULL,                   -- week number: week_of(day)
    body TEXT NOT NULL,                      -- the natural-language digest + tips
    facts TEXT NOT NULL DEFAULT '',          -- JSON-encoded facts dictionary for reference / audit
    at REAL NOT NULL                         -- timestamp when generated
);
CREATE UNIQUE INDEX IF NOT EXISTS digests_acct_week ON digests(account_id, week);
CREATE TABLE IF NOT EXISTS site_views (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    slug TEXT NOT NULL DEFAULT '',           -- the project's path; '' is the account's index page
    page TEXT NOT NULL,                      -- index.html, about.html
    day INTEGER NOT NULL,                    -- whole UTC days since the epoch
    ts REAL NOT NULL,
    visitor TEXT NOT NULL,                   -- keyed hash; the key is never stored and dies with the day
    device TEXT NOT NULL DEFAULT '',         -- mobile | desktop
    country TEXT NOT NULL DEFAULT '',        -- two letters, when Cloudflare tells us
    ref TEXT NOT NULL DEFAULT '',            -- the host someone came from, never a full URL
    beacon INTEGER NOT NULL DEFAULT 0        -- a browser confirmed the page rendered
);
CREATE INDEX IF NOT EXISTS site_views_acct_day ON site_views(account_id, day);
CREATE INDEX IF NOT EXISTS site_views_day ON site_views(day);
CREATE TABLE IF NOT EXISTS site_leads (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    slug TEXT NOT NULL DEFAULT '',           -- the site the enquiry came from
    name TEXT NOT NULL DEFAULT '',
    contact TEXT NOT NULL DEFAULT '',        -- however they want to be reached back
    message TEXT NOT NULL DEFAULT '',
    at REAL NOT NULL,
    read_at REAL                             -- when the owner marked it dealt with
);
CREATE INDEX IF NOT EXISTS site_leads_account ON site_leads(account_id, at);
CREATE TABLE IF NOT EXISTS sales_imports (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    filename TEXT NOT NULL DEFAULT '',
    rows INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT '',
    at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sales_rows (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    import_id INTEGER NOT NULL REFERENCES sales_imports(id),
    day INTEGER NOT NULL,                    -- whole UTC days since the epoch, as everywhere else here
    product TEXT NOT NULL DEFAULT '',
    units INTEGER NOT NULL DEFAULT 1,
    amount REAL NOT NULL DEFAULT 0,          -- what came in; negative for a refund
    cost REAL NOT NULL DEFAULT 0             -- what it cost them, 0 when the file didn't say
);
CREATE INDEX IF NOT EXISTS sales_rows_acct_day ON sales_rows(account_id, day);
CREATE INDEX IF NOT EXISTS sales_rows_import ON sales_rows(import_id);
CREATE TABLE IF NOT EXISTS site_daily (
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    slug TEXT NOT NULL,
    day INTEGER NOT NULL,
    views INTEGER NOT NULL DEFAULT 0,
    visitors INTEGER NOT NULL DEFAULT 0,
    beacons INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, slug, day)
) WITHOUT ROWID;
"""

BEACON_WINDOW_S = 600  # how long after a view its beacon may still arrive

_COLUMNS = "account_id, slug, page, day, ts, visitor, device, country, ref, beacon"


class AnalyticsMixin:
    """Site-visit methods for SmsStore (uses its tx/one/all helpers)."""

    def _migrate_analytics(self, c) -> None:
        c.executescript(ANALYTICS_SCHEMA)
        acols = {r["name"] for r in c.execute("PRAGMA table_info(accounts)").fetchall()}
        if "analytics" not in acols:  # per-account opt-out; takes effect on the next request, no rebuild
            c.execute("ALTER TABLE accounts ADD COLUMN analytics TEXT NOT NULL DEFAULT 'on'")

    # ---------- writing ----------
    def record_views(self, views: list) -> int:
        """Write a drained buffer. One transaction however many views there are."""
        if not views:
            return 0
        rows = [v.row() for v in views]
        with self.tx() as c:
            c.executemany(f"INSERT INTO site_views ({_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
        return len(rows)

    def roll_up_days(self, days: list[int]) -> None:
        """Recompute the daily totals for these days. Recomputing rather than adding keeps a repeated or
        replayed flush from inflating anything."""
        if not days:
            return
        with self.tx() as c:
            for day in days:
                c.execute("""
                    INSERT INTO site_daily (account_id, slug, day, views, visitors, beacons)
                    SELECT account_id, slug, day, COUNT(*), COUNT(DISTINCT visitor), SUM(beacon)
                      FROM site_views WHERE day = ? GROUP BY account_id, slug, day
                    ON CONFLICT(account_id, slug, day) DO UPDATE
                      SET views = excluded.views, visitors = excluded.visitors, beacons = excluded.beacons
                """, (day,))

    def mark_beacons(self, beacons: list) -> int:
        """Flag the views a browser confirmed. A beacon reaches us a moment after its page, so it is applied
        after the views in the same flush; it only ever updates a row, never creates one."""
        if not beacons:
            return 0
        done = 0
        with self.tx() as c:
            for b in beacons:
                done += c.execute(
                    "UPDATE site_views SET beacon = 1 WHERE id = (SELECT id FROM site_views "
                    "WHERE account_id = ? AND slug = ? AND visitor = ? AND ts >= ? AND beacon = 0 "
                    "ORDER BY ts DESC LIMIT 1)",
                    (b.account_id, b.slug, b.visitor, b.ts - BEACON_WINDOW_S)).rowcount
        return done

    # ---------- enquiries ----------
    def add_lead(self, account_id: int, slug: str, name: str, contact: str, message: str, now: float) -> int:
        with self.tx() as c:
            cur = c.execute("INSERT INTO site_leads (account_id, slug, name, contact, message, at) "
                            "VALUES (?, ?, ?, ?, ?, ?)", (account_id, slug, name, contact, message, now))
        return int(cur.lastrowid)

    def leads(self, account_id: int, limit: int = 50) -> list[dict]:
        return self.all("SELECT * FROM site_leads WHERE account_id = ? ORDER BY at DESC LIMIT ?",
                        (account_id, limit))

    def lead_count(self, account_id: int, since: float = 0, unread: bool = False) -> int:
        sql = "SELECT COUNT(*) AS n FROM site_leads WHERE account_id = ? AND at >= ?"
        if unread:
            sql += " AND read_at IS NULL"
        return (self.one(sql, (account_id, since)) or {}).get("n") or 0

    def mark_leads_read(self, account_id: int, now: float) -> int:
        with self.tx() as c:
            return c.execute("UPDATE site_leads SET read_at = ? WHERE account_id = ? AND read_at IS NULL",
                             (now, account_id)).rowcount

    # ---------- sales ----------
    def add_sales(self, account_id: int, filename: str, rows: list[tuple], skipped: int, currency: str,
                  now: float) -> int:
        """One upload: the import and its rows, together, so a half-written file is never left behind."""
        with self.tx() as c:
            cur = c.execute("INSERT INTO sales_imports (account_id, filename, rows, skipped, currency, at) "
                            "VALUES (?, ?, ?, ?, ?, ?)",
                            (account_id, filename[:120], len(rows), skipped, currency, now))
            import_id = int(cur.lastrowid)
            c.executemany("INSERT INTO sales_rows (account_id, import_id, day, product, units, amount, cost) "
                          "VALUES (?, ?, ?, ?, ?, ?, ?)",
                          [(account_id, import_id, *r) for r in rows])
        return import_id

    def sales_imports(self, account_id: int, limit: int = 20) -> list[dict]:
        return self.all("SELECT * FROM sales_imports WHERE account_id = ? ORDER BY at DESC LIMIT ?",
                        (account_id, limit))

    def delete_sales_import(self, account_id: int, import_id: int) -> int:
        with self.tx() as c:
            n = c.execute("DELETE FROM sales_rows WHERE account_id = ? AND import_id = ?",
                          (account_id, import_id)).rowcount
            c.execute("DELETE FROM sales_imports WHERE account_id = ? AND id = ?", (account_id, import_id))
        return max(n, 0)

    def sales_by_day(self, account_id: int, first_day: int, last_day: int) -> list[dict]:
        return self.all("SELECT day, SUM(amount) AS revenue, SUM(cost * units) AS cost, SUM(units) AS units "
                        "FROM sales_rows WHERE account_id = ? AND day >= ? AND day <= ? "
                        "GROUP BY day ORDER BY day", (account_id, first_day, last_day))

    def sales_totals(self, account_id: int, first_day: int, last_day: int) -> dict:
        row = self.one("SELECT COUNT(*) AS orders, SUM(amount) AS revenue, SUM(cost * units) AS cost, "
                       "SUM(units) AS units FROM sales_rows WHERE account_id = ? AND day >= ? AND day <= ?",
                       (account_id, first_day, last_day)) or {}
        return {"orders": row.get("orders") or 0, "revenue": row.get("revenue") or 0.0,
                "cost": row.get("cost") or 0.0, "units": row.get("units") or 0}

    def top_products(self, account_id: int, first_day: int, last_day: int, limit: int = 3) -> list[dict]:
        return self.all("SELECT product, SUM(amount) AS revenue, SUM(units) AS units FROM sales_rows "
                        "WHERE account_id = ? AND day >= ? AND day <= ? AND product != '' "
                        "GROUP BY product ORDER BY revenue DESC LIMIT ?", (account_id, first_day, last_day, limit))

    def sales_span(self, account_id: int) -> dict:
        row = self.one("SELECT MIN(day) AS first, MAX(day) AS last, COUNT(*) AS rows, "
                       "(SELECT currency FROM sales_imports WHERE account_id = ? AND currency != '' "
                       " ORDER BY at DESC LIMIT 1) AS currency "
                       "FROM sales_rows WHERE account_id = ?", (account_id, account_id)) or {}
        return {"first": row.get("first"), "last": row.get("last"), "rows": row.get("rows") or 0,
                "currency": row.get("currency") or ""}

    # ---------- reading ----------
    def view_totals(self, account_id: int, first_day: int, last_day: int, slug: str | None = None) -> dict:
        where, args = self._scope(account_id, first_day, last_day, slug)
        row = self.one(f"SELECT COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors "
                       f"FROM site_views WHERE {where}", args)
        return {"views": (row or {}).get("views") or 0, "visitors": (row or {}).get("visitors") or 0}

    def views_by_day(self, account_id: int, first_day: int, last_day: int, slug: str | None = None) -> list[dict]:
        where, args = self._scope(account_id, first_day, last_day, slug)
        return self.all(f"SELECT day, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors "
                        f"FROM site_views WHERE {where} GROUP BY day ORDER BY day", args)

    def top_pages(self, account_id: int, first_day: int, last_day: int, limit: int = 3,
                  slug: str | None = None) -> list[dict]:
        where, args = self._scope(account_id, first_day, last_day, slug)
        return self.all(f"SELECT slug, page, COUNT(*) AS views FROM site_views WHERE {where} "
                        f"GROUP BY slug, page ORDER BY views DESC, page LIMIT ?", (*args, limit))

    def top_refs(self, account_id: int, first_day: int, last_day: int, limit: int = 3,
                 slug: str | None = None) -> list[dict]:
        where, args = self._scope(account_id, first_day, last_day, slug)
        return self.all(f"SELECT ref, COUNT(*) AS views FROM site_views WHERE {where} AND ref != '' "
                        f"GROUP BY ref ORDER BY views DESC, ref LIMIT ?", (*args, limit))

    def device_split(self, account_id: int, first_day: int, last_day: int, slug: str | None = None) -> dict:
        where, args = self._scope(account_id, first_day, last_day, slug)
        rows = self.all(f"SELECT device, COUNT(*) AS views FROM site_views WHERE {where} GROUP BY device", args)
        return {r["device"] or "unknown": r["views"] for r in rows}

    def first_view_day(self, account_id: int) -> int | None:
        row = self.one("SELECT MIN(day) AS day FROM site_views WHERE account_id = ?", (account_id,))
        return (row or {}).get("day")

    @staticmethod
    def _scope(account_id: int, first_day: int, last_day: int, slug: str | None) -> tuple[str, tuple]:
        where = "account_id = ? AND day >= ? AND day <= ?"
        args: tuple = (account_id, first_day, last_day)
        if slug is not None:
            where += " AND slug = ?"
            args = (*args, slug)
        return where, args

    # ---------- digests ----------
    def save_digest(self, account_id: int, week: int, body: str, facts: str = "",
                    now: float | None = None) -> int:
        now = time.time() if now is None else now
        with self.tx() as c:
            cur = c.execute("""
                INSERT INTO digests (account_id, week, body, facts, at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(account_id, week) DO UPDATE
                  SET body = excluded.body, facts = excluded.facts, at = excluded.at
            """, (account_id, week, body, facts, now))
            return cur.lastrowid

    def latest_digest(self, account_id: int) -> dict | None:
        row = self.one("SELECT * FROM digests WHERE account_id = ? ORDER BY week DESC, at DESC LIMIT 1",
                       (account_id,))
        return dict(row) if row else None

    def digest_for_week(self, account_id: int, week: int) -> dict | None:
        row = self.one("SELECT * FROM digests WHERE account_id = ? AND week = ?", (account_id, week))
        return dict(row) if row else None

    # ---------- housekeeping ----------
    def prune_analytics(self, raw_days: int, rollup_days: int, today: int) -> dict:
        """Drop raw views past the detail window and rollups past the history window."""
        with self.tx() as c:
            raw = c.execute("DELETE FROM site_views WHERE day < ?", (today - raw_days,)).rowcount
            rolled = c.execute("DELETE FROM site_daily WHERE day < ?", (today - rollup_days,)).rowcount
        return {"views": max(raw, 0), "daily": max(rolled, 0)}
