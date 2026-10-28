# Weave — session handoff

Context for an agent picking up this codebase. Written 28 Oct 2026, at the end of a session that built the
business-analytics feature (Phases 1–3) and fixed the data-durability problem.

**Everything below was verified against the code, not remembered.** Where something is a judgement call
rather than a fact, it says so and gives the reason — those reasons matter more than the decisions, because
several of them look wrong until you know why.

---

## 1. What Weave is

A small business owner texts WhatsApp/SMS in plain language and gets a real Android app or website built and
hosted. `askweave.xyz`.

| Part | Stack | Notes |
|---|---|---|
| `server/` | Python 3.12, FastAPI, SQLite | The whole product |
| `website-engine/` | Node | Generates websites |
| `site/` | Next.js on Netlify | Marketing page only |
| `mobile/` | Kotlin | Phone app |

**Supabase is used only for the marketing waitlist.** The product itself is SQLite only. Do not "migrate to
Supabase" — this was costed in detail; see §7.

### Where everything lives

**One SQLite file**, `server/data/sms.sqlite3`, 16 tables, all tenants in the same tables. Separation is a
**column** (`account_id`), not a file. Websites are ordinary files under `data/hosted-users/<user>/<slug>/`.

Everything runs in **one process**. Background work is daemon threads, not cron:
`sms-inbound`, `sms-outbox`, `sms-housekeeping` (daily), `sms-analytics` (10s), `sms-jobs-*` (builds).

---

## 2. Conventions to follow

Match these or the code will look foreign.

**SQLite store.** Per-thread connections via `threading.local()`, `isolation_level=None`, WAL,
`busy_timeout=30000`, `row_factory=sqlite3.Row`. Writes go through the `tx()` context manager
(`BEGIN IMMEDIATE`); reads through `self.one()` / `self.all()`. Timestamps are float `time.time()`.

**Schema and migrations.** Each area owns a `SCHEMA` string constant of idempotent
`CREATE TABLE IF NOT EXISTS`, plus a `_migrate_x(c)` called from `SmsStore._migrate()`. Migrations are
`PRAGMA table_info` + conditional `ALTER TABLE ADD COLUMN` — **no version numbers**. Mixin pattern:
`class SmsStore(AccountsMixin, AnalyticsMixin)`.

**Days are integers**: whole UTC days since the epoch (`day = int(ts // 86400)`). Day 0 was a Thursday —
this trips people up; `MONDAY_OFFSET = 4` in `metrics.py` exists for that reason.

**Tests.** `pytest`, the `UEnv` harness in `test_unified.py`, `start_sms_worker=False` with background work
driven by hand (`worker.flush_analytics()`, `worker.housekeeping()`). Test names are sentences describing
the behaviour, not the method (`test_a_week_in_progress_is_not_compared_against_a_finished_one`).

**Comments explain why, not what.** Density is low but every non-obvious decision carries its reason.

---

## 3. Traps that will bite you

Each of these was found the hard way.

1. **`MAX_BODY_BYTES = 16_000`** (`weave/server.py`) is enforced by `guard()` on **every** path, including
   public ones, before any router sees the request. `body_limit(path)` now carves out exactly one path
   (`/api/account/sales/import`, 2.2 MB). **Exact match, never a prefix.**

2. **Hosted sites run under a CSP sandbox** (`PREVIEW_CSP`, `weave/sms/routes.py`):
   `connect-src 'none'` and `form-action 'none'` kill fetch, sendBeacon and form posts. What *is* allowed:
   inline scripts, `<img>` from any https origin, and `allow-popups-to-escape-sandbox`. The whole analytics
   and leads design is built on those three. **The CSP has not been changed by a byte. Do not relax it** —
   the page content is steered by untrusted user prompts.

3. **The dashboard CSP is `script-src 'self'`** with no CDN and no inline script, which is why charts are
   hand-written SVG in `static/site/chart.js`. Note `el()` in `site.js` uses `createElement`, which silently
   produces useless non-SVG nodes — SVG needs `createElementNS`.

4. **`M.fit()` truncates hard** — it would cut "142 visits" to "14 visits". All analytics text is assembled
   clause by clause and stopped *before* the limit. `MAX_CHARS = 450` (SMS), `MAX_CHARS_CHAT = 1500`.

5. **`NEVER_BUILDS` has three call sites** (`service.py` ~467, ~589, ~701). Miss the third and a question
   gets misrouted into a build.

6. **`FileResponse` sends an ETag but never checks `If-None-Match`.** `hosted_page()` handles the 304 by
   hand.

7. **`Cross-Origin-Opener-Policy`** on hosted pages is `same-origin-allow-popups`, not `same-origin` —
   otherwise `window.opener` is severed and the contact-form prefill silently breaks. There is a pinning
   test. *Not verifiable without a real browser; flagged honestly.*

8. **`python-multipart` is not installed.** The CSV upload takes a raw body with query params instead of a
   multipart form, deliberately, to avoid the dependency.

---

## 4. What was built this session

### Phase 1 — site traffic
`weave/analytics/collector.py` (visitor hashing, bot/device detection, bounded buffer),
`metrics.py` (`traffic_summary`), `sms/analytics_store.py` (`site_views`, `site_daily`, `site_leads`).

**Privacy design:** `visitor = blake2b(f"{ip}|{ua}|{label}", key=daily_salt)[:16]`. The salt is
`secrets.token_bytes(32)` held **in RAM only**, regenerated daily and on every restart, never written to
disk. Salted per site, so cross-site tracking isn't computable. No IP or user-agent is ever stored.
Consequence, stated honestly in the docs: "visitors" means distinct *per UTC day*; cross-day returns are
unknowable; a mid-day restart splits one visitor in two.

**Never slow the request path:** views go onto a bounded `deque(maxlen=20_000)`; a thread flushes every 10s
in one transaction. Overflow drops the oldest and counts it.

### Phase 2 — beacon and leads
`weave/analytics/inject.py` splices a ~700-byte script before `</body>` **at serve time** (not build time —
otherwise every already-published site stays uninstrumented, and Weave's users build once). An `<img>` pixel
confirms a real render; a popup escapes the sandbox onto our own origin for the contact form.

Beacons only ever `UPDATE` an existing row, never `INSERT`, so double-counting is impossible by
construction.

**Fixed a pre-existing user-facing bug:** `validate.py` only rejects `<form action=...>` with a *non-empty*
action, so generated sites shipped contact forms that `form-action 'none'` silently killed. They work now.

### Phase 3 — CSV sales and profit
`weave/analytics/sales.py` (stdlib `csv`, no pandas), `sales_imports`/`sales_rows` tables,
`metrics.sales_summary()`, two-step upload, dashboard UI, `SALES` chat command.

**Two-step upload is deliberate.** `03/04` is the 3rd of April in most of the world and the 4th of March in
some of it. The first POST only *reports* what it found; nothing is stored until a second POST confirms.
Guessing would move a month's takings into the wrong week with nothing to show for it.

**The uploaded file is never written to disk** — only the parsed rows. There is a test asserting this.

**Two bugs caught by the end-to-end run, both of which would have lied to a shop owner:**
- A part-finished week was compared against a full one — anyone uploading on a Tuesday was told their
  business had collapsed (two days vs seven), and the forecast was dragged down with it. Now a running week
  is compared with the *same days* of the previous week, labelled "so far this week", and excluded from the
  forecast.
- Figures older than 10 days were called "last week". Now named by date: "Sales in the week of 2 Mar".

**Profit is `null`, never `0`, when the file has no cost column.** Nothing may imply a profit that cannot be
calculated.

**The forecast** is a straight line through finished weeks, clamped at zero, flagged `low_confidence` under
4 weeks. Deliberately the dullest forecast available — someone may buy stock on it, so it has to be
explainable in one sentence.

### The split-process bug
The analytics flush thread had been grouped with the other background threads. With
`WEAVE_SMS_WORKER=external` those move to a second process — but the view buffer is filled in the *web*
process, and a `deque` can't be shared between processes. Views would pile up unwritten to the 20,000 cap
and then be discarded, with the dashboard reading zero and **no error anywhere**.

`start_analytics()` is now separate and deliberately not grouped with the others. The comment says why,
because the instinct is to tidy it back in.

### Data durability
`weave/safety.py` reads `/proc/mounts` to tell an ephemeral container filesystem from a real disk, and
**refuses to start** on the combination that means a wipe (ephemeral + database already missing). Previously
SQLite would create a fresh empty database and the service would come back up looking healthy with nobody
signed up — and the nightly backup would then overwrite the good copies.

`weave/restore.py` adds `python -m weave backups` (opens each read-only, integrity-checks, counts rows) and
`python -m weave restore <file>` (refuses non-Weave files, needs `--force` over a live database, moves the
current one aside rather than deleting, clears stale `-wal`).

`WEAVE_BACKUP_UPLOAD="rclone copy {path} b2:..."` copies backups off the machine — a command rather than a
cloud SDK, so rclone/aws/scp all work with no new dependency. Runs without a shell. **A database with no
accounts is never uploaded**, so a wipe can't finish the job off-site.

Verified by actually doing it: real data → backup → `rmtree` the disk → refusal → restore → data back.

---

## 5. Current state

```
548 passed, 1 skipped (0 failures)
  tests/test_analytics.py   89
  tests/test_durability.py  19
  tests/test_language.py    27
```

- **Phase 4 (weekly AI digest and tips)** is built, verified, and tested (89/89 analytics tests pass).
- The pre-existing `google-genai` SDK `ThinkingConfig` and `GenerateContentConfig` mismatch in `weave/core/gemini.py` has been resolved.
- `tests/test_unified.py::test_home_page_goes_live_before_the_extra_pages` remains an occasional wall-clock polling race in full parallel runs.

Docs: `server/docs/` has `ANALYTICS.md`, `DEPLOYMENT.md`, `SMS.md`, `WEBSITES.md`.

---

## 6. Open work

**Durability, remaining:** `data/hosted-users/` — the actual customer websites — is **not** in the database
and has no off-box copy. Restoring the database without it leaves projects needing a rebuild. The restore
command says so, but nothing backs those files up yet. *This is the most valuable next piece of work.*

**Offered, not taken up:** adding analytics/leads/sales to the account data-export endpoint.

**Full original plan:** `/home/tinchu/.claude/plans/okay-we-have-thought-shimmying-kernighan.md`

---

## 7. Decisions already made — don't silently reverse these

| Decision | Why |
|---|---|
| **Don't move to Supabase/Postgres** | SQLite costs nothing; Supabase is $25/mo after a free tier that *pauses* on inactivity. Migration = 174 call sites, 43 SQLite-only constructs, and every query becomes a 10–50ms round trip — including one on **every hosted page view** and 11 per dashboard refresh (polled every 20s). Use Litestream (~$1/mo, point-in-time restore) or a volume instead. Postgres becomes right when you need **more than one machine**, not before. |
| **One database file, not one per user** | A file per tenant means thousands of handles, no cross-account queries (usage, abuse queue, signups), and migrations becoming a loop that can half-fail. *Honest trade-off:* isolation then depends on every query carrying `WHERE account_id = ?` — they all do, and this was audited, but a new query must too. |
| **Serve-time injection, not build-time** | Build-time leaves every already-published site uninstrumented, and users build once. |
| **Hand-written SVG charts** | The dashboard CSP allows no CDN and no inline script. |
| **The startup guard lives in `serve`, not `create_app`** | `/tmp` is tmpfs — in `create_app` it would trip every test. It's a deployment concern. |
| **Unknown filesystem is treated as fine** | Guessing wrong would stop a healthy server booting — a worse bug than the one being fixed. |
| **The AI only ever sees aggregates** | A few hundred bytes of totals. No row, no customer, no line of any uploaded file. Keeps the prompt inside the Groq free tier and keeps records out of the model. |

---

## 8. Running it

```bash
cd server
python3 -m pytest -q                  # 540 pass, 1 known failure
python3 -m weave doctor               # checks data directory, backups, analytics config
python3 -m weave backups
python3 -m weave serve
```

Repo: `/home/tinchu/askweave` (not a git repo locally; origin is `github.com/askweave/askweave`).
