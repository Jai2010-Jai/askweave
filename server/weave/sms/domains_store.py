"""Custom domains: the domains customers buy through Weave, the orders that pay for them, and every state change.

A domain row follows one name through weave.domains.states, from the first availability check to LIVE (or
FAILED / EXPIRED). An order is one paid action on it (the registration, or a renewal) and carries the exact quote
the customer approved, the payment that proved it, and an idempotency key, so a retried step can never buy twice.
domain_events is append-only: every transition, with who caused it.

The long steps run in the background (weave.domains.runner): due rows are claimed with a lease, like the build
queue in store.py, so a crashed worker's step is picked up again once its lease runs out."""

from __future__ import annotations

import json
import secrets
import sqlite3
import time
from typing import Any

DOMAINS_SCHEMA = """
CREATE TABLE IF NOT EXISTS domains (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    project_id INTEGER REFERENCES projects(id),  -- the hosted project this domain shows
    name TEXT NOT NULL,                          -- lower-case ASCII (punycode), no trailing dot
    state TEXT NOT NULL,                         -- weave.domains.states
    failed_step TEXT,                            -- the state that failed, to resume from on retry
    years INTEGER NOT NULL DEFAULT 1,
    currency TEXT NOT NULL DEFAULT 'USD',        -- what the customer pays in
    first_year_minor INTEGER,                    -- customer price, smallest unit (cents, paise)
    renewal_minor INTEGER,
    cost_currency TEXT,                          -- what the registrar charges us
    first_year_cost_minor INTEGER,
    renewal_cost_minor INTEGER,
    registrar TEXT NOT NULL DEFAULT '',
    registrar_order_id TEXT,
    dns_zone_id TEXT,
    nameservers TEXT NOT NULL DEFAULT '[]',
    hosting_ref TEXT,
    ssl_status TEXT,
    verify_token TEXT NOT NULL,                  -- served at /.well-known/weave-domain to prove routing works
    expires_at REAL,
    attempts INTEGER NOT NULL DEFAULT 0,         -- failed tries of the current step
    next_run_at REAL,                            -- NULL = nothing to do in the background
    step_started_at REAL,
    lease_owner TEXT,
    lease_until REAL NOT NULL DEFAULT 0,
    last_error TEXT,
    live_at REAL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS domains_account ON domains(account_id, created_at);
CREATE INDEX IF NOT EXISTS domains_due ON domains(next_run_at) WHERE next_run_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS domains_name ON domains(name);
-- One customer per name once money is involved: a second purchase of the same name can't even be recorded.
CREATE UNIQUE INDEX IF NOT EXISTS domains_owned ON domains(name)
    WHERE state NOT IN ('DISCOVERING', 'AVAILABLE', 'AWAITING_APPROVAL', 'FAILED', 'EXPIRED');
CREATE TABLE IF NOT EXISTS domain_orders (
    id INTEGER PRIMARY KEY,
    domain_id INTEGER NOT NULL REFERENCES domains(id),
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    kind TEXT NOT NULL,                          -- register | renew
    years INTEGER NOT NULL DEFAULT 1,
    amount_minor INTEGER NOT NULL,               -- the quote the customer approves and pays
    currency TEXT NOT NULL,
    renewal_minor INTEGER,
    cost_minor INTEGER,
    cost_currency TEXT,
    quote_expires_at REAL NOT NULL,
    status TEXT NOT NULL,                        -- quoted | awaiting_payment | paid | fulfilled | cancelled | expired | failed
    approved_at REAL,
    approved_via TEXT,                           -- dashboard | chat
    approval_text TEXT,                          -- what the customer said or clicked
    registrant TEXT,                             -- JSON contact snapshot taken at approval
    idempotency_key TEXT NOT NULL UNIQUE,
    payment_provider TEXT,
    checkout_id TEXT,
    checkout_url TEXT,
    payment_id TEXT UNIQUE,
    paid_minor INTEGER,
    paid_at REAL,
    refund_status TEXT,                          -- NULL | requested | refunded | failed
    error TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS domain_orders_domain ON domain_orders(domain_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS domain_orders_checkout ON domain_orders(checkout_id) WHERE checkout_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS domain_events (
    id INTEGER PRIMARY KEY,
    domain_id INTEGER NOT NULL REFERENCES domains(id),
    order_id INTEGER,
    from_state TEXT,
    to_state TEXT NOT NULL,
    actor TEXT NOT NULL,                         -- customer | chat | runner | webhook | system
    detail TEXT NOT NULL DEFAULT '{}',
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS domain_events_domain ON domain_events(domain_id, id);
CREATE TABLE IF NOT EXISTS domain_contacts (
    account_id INTEGER PRIMARY KEY REFERENCES accounts(id),
    contact TEXT NOT NULL,                       -- JSON registrant: the customer, never Weave
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS domain_webhooks (
    webhook_id TEXT PRIMARY KEY,                 -- each signed delivery is acted on once
    received_at REAL NOT NULL
);
"""


def _domain(row: dict | None) -> dict | None:
    if row is None:
        return None
    return {**row, "nameservers": json.loads(row["nameservers"] or "[]")}


def _order(row: dict | None) -> dict | None:
    if row is None:
        return None
    return {**row, "registrant": json.loads(row["registrant"]) if row.get("registrant") else None}


class DuplicateDomainError(Exception):
    """The name is already being bought or owned by someone (the domains_owned index)."""


class DomainsMixin:
    """Domain methods for SmsStore (uses its tx/one/all helpers)."""

    def _migrate_domains(self, c) -> None:
        c.executescript(DOMAINS_SCHEMA)

    # ---------- domains ----------
    def create_domain(self, account_id: int, project_id: int | None, name: str, state: str, actor: str) -> dict:
        now = time.time()
        with self.tx() as c:
            cur = c.execute("INSERT INTO domains (account_id, project_id, name, state, verify_token, created_at, "
                            "updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                            (account_id, project_id, name, state, secrets.token_urlsafe(18), now, now))
            c.execute("INSERT INTO domain_events (domain_id, from_state, to_state, actor, created_at) "
                      "VALUES (?, NULL, ?, ?, ?)", (cur.lastrowid, state, actor, now))
        return self.domain(cur.lastrowid)  # type: ignore[return-value]

    def domain(self, domain_id: int) -> dict | None:
        return _domain(self.one("SELECT * FROM domains WHERE id = ?", (domain_id,)))

    def account_domain(self, account_id: int, domain_id: int) -> dict | None:
        """A domain, only if it belongs to this account (every API lookup goes through here)."""
        return _domain(self.one("SELECT * FROM domains WHERE id = ? AND account_id = ?", (domain_id, account_id)))

    def account_domains(self, account_id: int) -> list[dict]:
        return [_domain(r) for r in self.all("SELECT * FROM domains WHERE account_id = ? ORDER BY id DESC",
                                             (account_id,))]

    def open_domain(self, account_id: int, name: str) -> dict | None:
        """This account's newest row for a name that hasn't ended (FAILED / EXPIRED rows are history)."""
        return _domain(self.one("SELECT * FROM domains WHERE account_id = ? AND name = ? "
                                "AND state NOT IN ('FAILED', 'EXPIRED') ORDER BY id DESC LIMIT 1", (account_id, name)))

    def domain_owner(self, name: str) -> dict | None:
        """The row holding a name past payment, whoever's it is."""
        return _domain(self.one("SELECT * FROM domains WHERE name = ? AND state NOT IN "
                                "('DISCOVERING', 'AVAILABLE', 'AWAITING_APPROVAL', 'FAILED', 'EXPIRED')", (name,)))

    def update_domain(self, domain_id: int, **fields: Any) -> None:
        if "nameservers" in fields:
            fields["nameservers"] = json.dumps(fields["nameservers"])
        cols = ", ".join(f"{k} = ?" for k in fields)
        with self.tx() as c:
            c.execute(f"UPDATE domains SET {cols}, updated_at = ? WHERE id = ?",
                      (*fields.values(), time.time(), domain_id))

    def transition_domain(self, domain_id: int, expected: tuple[str, ...], to_state: str, actor: str,
                          order_id: int | None = None, detail: dict | None = None, **fields: Any) -> bool:
        """Move a domain to `to_state` only if it is in one of `expected` (compare-and-set), and record the event in
        the same transaction. False when another worker or request got there first."""
        if "nameservers" in fields:
            fields["nameservers"] = json.dumps(fields["nameservers"])
        now = time.time()
        sets = "".join(f", {k} = ?" for k in fields)
        marks = ",".join("?" * len(expected))
        try:
            with self.tx() as c:
                row = c.execute(f"SELECT state FROM domains WHERE id = ? AND state IN ({marks})",
                                (domain_id, *expected)).fetchone()
                if row is None:
                    return False
                c.execute(f"UPDATE domains SET state = ?, updated_at = ?{sets} WHERE id = ?",
                          (to_state, now, *fields.values(), domain_id))
                c.execute("INSERT INTO domain_events (domain_id, order_id, from_state, to_state, actor, detail, "
                          "created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                          (domain_id, order_id, row["state"], to_state, actor, json.dumps(detail or {}), now))
        except sqlite3.IntegrityError as e:
            raise DuplicateDomainError(str(e)) from None
        return True

    def domain_event(self, domain_id: int, actor: str, note: str, order_id: int | None = None,
                     detail: dict | None = None) -> None:
        """An event that isn't a state change (a retry, a failed payment, a price check), kept for the record."""
        d = self.one("SELECT state FROM domains WHERE id = ?", (domain_id,))
        with self.tx() as c:
            c.execute("INSERT INTO domain_events (domain_id, order_id, from_state, to_state, actor, detail, created_at) "
                      "VALUES (?, ?, ?, ?, ?, ?, ?)",
                      (domain_id, order_id, d["state"] if d else None, d["state"] if d else "?", actor,
                       json.dumps({"note": note, **(detail or {})}), time.time()))

    def domain_events(self, domain_id: int, limit: int = 200) -> list[dict]:
        rows = self.all("SELECT * FROM domain_events WHERE domain_id = ? ORDER BY id LIMIT ?", (domain_id, limit))
        return [{**r, "detail": json.loads(r["detail"] or "{}")} for r in rows]

    # ---------- background steps ----------
    def claim_domain(self, owner: str, lease_s: float, now: float | None = None) -> dict | None:
        """The next domain with a step due, leased to `owner`."""
        now = time.time() if now is None else now
        with self.tx() as c:
            row = c.execute("SELECT id FROM domains WHERE next_run_at IS NOT NULL AND next_run_at <= ? "
                            "AND lease_until < ? ORDER BY next_run_at LIMIT 1", (now, now)).fetchone()
            if row is None:
                return None
            c.execute("UPDATE domains SET lease_owner = ?, lease_until = ? WHERE id = ?",
                      (owner, now + lease_s, row["id"]))
        return self.domain(row["id"])

    def release_domain(self, domain_id: int, owner: str) -> None:
        with self.tx() as c:
            c.execute("UPDATE domains SET lease_owner = NULL, lease_until = 0 WHERE id = ? AND lease_owner = ?",
                      (domain_id, owner))

    def domains_in(self, states: tuple[str, ...]) -> list[dict]:
        marks = ",".join("?" * len(states))
        return [_domain(r) for r in self.all(f"SELECT * FROM domains WHERE state IN ({marks})", states)]

    # ---------- orders ----------
    def create_domain_order(self, domain_id: int, account_id: int, kind: str, years: int, amount_minor: int,
                            currency: str, renewal_minor: int | None, cost_minor: int | None,
                            cost_currency: str | None, quote_ttl_s: float, now: float | None = None) -> dict:
        now = time.time() if now is None else now
        with self.tx() as c:
            # A new quote replaces any older one for the same domain that was never paid.
            c.execute("UPDATE domain_orders SET status = 'expired', updated_at = ? WHERE domain_id = ? "
                      "AND kind = ? AND status IN ('quoted', 'awaiting_payment')", (now, domain_id, kind))
            cur = c.execute("INSERT INTO domain_orders (domain_id, account_id, kind, years, amount_minor, currency, "
                            "renewal_minor, cost_minor, cost_currency, quote_expires_at, status, idempotency_key, "
                            "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'quoted', ?, ?, ?)",
                            (domain_id, account_id, kind, years, amount_minor, currency, renewal_minor, cost_minor,
                             cost_currency, now + quote_ttl_s, f"dom-{domain_id}-{kind}-{secrets.token_hex(8)}",
                             now, now))
        return self.domain_order(cur.lastrowid)  # type: ignore[return-value]

    def domain_order(self, order_id: int) -> dict | None:
        return _order(self.one("SELECT * FROM domain_orders WHERE id = ?", (order_id,)))

    def domain_order_by(self, field: str, value: str) -> dict | None:
        if field not in ("checkout_id", "payment_id", "idempotency_key"):
            raise ValueError(field)
        return _order(self.one(f"SELECT * FROM domain_orders WHERE {field} = ?", (value,)))

    def latest_domain_order(self, domain_id: int, kind: str | None = None) -> dict | None:
        if kind:
            return _order(self.one("SELECT * FROM domain_orders WHERE domain_id = ? AND kind = ? "
                                   "ORDER BY id DESC LIMIT 1", (domain_id, kind)))
        return _order(self.one("SELECT * FROM domain_orders WHERE domain_id = ? ORDER BY id DESC LIMIT 1", (domain_id,)))

    def domain_orders(self, domain_id: int) -> list[dict]:
        return [_order(r) for r in self.all("SELECT * FROM domain_orders WHERE domain_id = ? ORDER BY id", (domain_id,))]

    def update_domain_order(self, order_id: int, expected: tuple[str, ...] | None = None, **fields: Any) -> bool:
        """Update an order; with `expected`, only if its status is one of them (compare-and-set)."""
        if "registrant" in fields and fields["registrant"] is not None:
            fields["registrant"] = json.dumps(fields["registrant"])
        cols = ", ".join(f"{k} = ?" for k in fields)
        args: tuple = (*fields.values(), time.time(), order_id)
        where = "id = ?"
        if expected:
            where += f" AND status IN ({','.join('?' * len(expected))})"
            args += expected
        with self.tx() as c:
            cur = c.execute(f"UPDATE domain_orders SET {cols}, updated_at = ? WHERE {where}", args)
        return bool(cur.rowcount)

    def stale_domain_orders(self, now: float) -> list[dict]:
        return [_order(r) for r in self.all("SELECT * FROM domain_orders WHERE status IN ('quoted', "
                                            "'awaiting_payment') AND quote_expires_at < ?", (now,))]

    # ---------- registrant contact ----------
    def domain_contact(self, account_id: int) -> dict | None:
        row = self.one("SELECT contact FROM domain_contacts WHERE account_id = ?", (account_id,))
        return json.loads(row["contact"]) if row else None

    def set_domain_contact(self, account_id: int, contact: dict) -> None:
        with self.tx() as c:
            c.execute("INSERT INTO domain_contacts (account_id, contact, updated_at) VALUES (?, ?, ?) "
                      "ON CONFLICT(account_id) DO UPDATE SET contact = excluded.contact, updated_at = excluded.updated_at",
                      (account_id, json.dumps(contact), time.time()))

    # ---------- webhooks ----------
    def domain_webhook_seen(self, webhook_id: str) -> bool:
        return self.one("SELECT 1 AS x FROM domain_webhooks WHERE webhook_id = ?", (webhook_id,)) is not None

    def first_domain_webhook(self, webhook_id: str) -> bool:
        """True the first time a signed delivery id is seen; False for a replay or a provider retry."""
        with self.tx() as c:
            cur = c.execute("INSERT OR IGNORE INTO domain_webhooks (webhook_id, received_at) VALUES (?, ?)",
                            (webhook_id, time.time()))
        return bool(cur.rowcount)

    # ---------- routing ----------
    def domain_route(self, host: str, states: tuple[str, ...]) -> dict | None:
        """The domain serving `host` (the name itself or its www.), joined with its account and project, if it is in
        one of `states`. A host nobody bought returns None, never someone else's site."""
        name = host.removeprefix("www.")
        marks = ",".join("?" * len(states))
        return self.one(f"SELECT d.id AS domain_id, d.name, d.state, d.verify_token, d.project_id, "
                        f"a.id AS account_id, a.username, a.status AS account_status, p.slug, p.user_id, "
                        f"p.deleted_at FROM domains d JOIN accounts a ON a.id = d.account_id "
                        f"LEFT JOIN projects p ON p.id = d.project_id "
                        f"WHERE d.name = ? AND d.state IN ({marks}) ORDER BY d.id DESC LIMIT 1", (name, *states))
