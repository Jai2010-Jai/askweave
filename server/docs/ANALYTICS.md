# Visitor analytics

Weave counts visits to the websites it hosts, so a business owner can ask "is anyone actually seeing this?"
and get a real answer. The counting is ours: no Google Analytics, no Plausible, no third party of any kind,
and nothing about a visitor leaves the machine.

## What an owner sees

On WhatsApp, SMS or the web chat:

> **How's my site doing?**
>
> Bakery site, last 7 days: 42 visits from 31 people, up 20%. Busiest day Sat. Most viewed: the home page.

`STATS`, `ANALYTICS`, `VISITORS` and `TRAFFIC` do the same thing as exact commands, so it still works when the
AI is switched off or unreachable.

On the dashboard, a **Your visitors** section: visits and people this week, the top page, where people came
from, and a bar per day for the last fortnight.

## What is collected

Every request for a page on `<username>.<sites_domain>` records one row:

| Field | What it is |
|---|---|
| `account_id`, `slug`, `page` | whose site, which project, which page |
| `day`, `ts` | when |
| `visitor` | a keyed hash (see below) — not an identifier we can resolve to anyone |
| `device` | `mobile` or `desktop`, worked out from the user agent and then discarded |
| `country` | two letters, only when Cloudflare sends `CF-IPCountry` |
| `ref` | the **host** someone came from (`instagram.com`), never the full URL |

**Not collected, ever:** the IP address, the user-agent string, any cookie, anything typed into a page, and
anything that could follow a person from one customer's site to another's.

Requests that are not a visit are skipped: redirects, 404s, suspended accounts, and crawlers (matched on the
user agent — Googlebot, curl, link previewers and so on).

## How a visitor is counted without a cookie

Hosted sites are served inside a CSP sandbox with no `allow-same-origin`, which means the page has no
cookies and no local storage. So a visitor is identified by a hash instead:

```
visitor = blake2b(f"{ip}|{user_agent}|{username}", key=salt_for_today)[:16]
```

The salt is 32 random bytes held in the server process's memory. It is **never written to disk**, it is
replaced when the UTC day turns, and it is replaced again on every restart. Once the day is over, the key
that produced the day's hashes no longer exists anywhere, so they cannot be traced back to an address even
by someone holding the database and the source code.

Salting by `username` means the same person visiting two different customers' sites gets two unrelated
hashes. Cross-site tracking is not merely disallowed, it is not computable.

Two consequences to be honest about:

- **"Visitors" means distinct visitors within one UTC day.** We cannot tell that someone who came on Monday
  came back on Thursday, and we do not claim to. Weekly figures are labelled *visits*, not people.
- **A restart mid-day splits one visitor in two,** because the salt changes. Rare, and the alternative is
  persisting the key, which would undo everything above.

## How it is counted without slowing a page down

Serving a hosted page does no database writes. A visit is appended to a bounded in-memory buffer
(20,000 views) and the `sms-analytics` worker thread writes the batch every ten seconds in one transaction,
then recomputes the daily totals for the days it touched. The recompute is idempotent, so a replayed flush
cannot inflate anything. On shutdown the buffer is flushed once more; a hard crash loses at most ten seconds
of counts. If traffic ever outruns the writer, the oldest views are dropped and counted in
`sms.analytics_flush` — a flood costs us numbers, never the server.

Hosted pages are sent with `Cache-Control: no-cache` so the browser revalidates every visit and every visit
reaches us. The page body is not re-sent: an `If-None-Match` that matches gets a `304`.

## Enquiries from your site

The websites Weave generates come with a contact form. Until now that form did nothing: hosted sites are
served with `form-action 'none'`, so pressing Send was blocked and the enquiry vanished. Nobody found out.

Now, pressing Send opens a small window on `app.<domain>` carrying whatever the visitor already typed, they
confirm, and the enquiry arrives:

- in the `site_leads` table,
- as a WhatsApp message to the owner, straight away,
- on the dashboard under **Enquiries**, and
- in chat via `LEADS` (or `ENQUIRIES`).

The weekly traffic answer leads with the enquiry count when there is one, because an enquiry is worth more
to a business than a visit.

### Why a popup rather than a direct post

The sandbox on hosted pages is `allow-scripts allow-popups allow-popups-to-escape-sandbox`. That last token
means a popup opened from the page becomes an ordinary document on our own origin, where forms work
normally and the usual session and CSRF rules apply. So the enquiry reaches us without loosening the CSP by
one byte, it works on every site already published, and no site has to be rebuilt.

One header did have to change: hosted pages sent `Cross-Origin-Opener-Policy: same-origin`, which severs the
link to a cross-origin popup and would have silently broken the handover of what the visitor had typed.
They now send `same-origin-allow-popups`, which keeps that link while still preventing the page from being
opened by someone else. The page remains a sandboxed opaque origin with no cookies or storage, so there is
nothing in it for a popup to reach.

Abuse controls: a hidden field only a bot fills in (answered with a cheerful `{"ok": true}` and dropped), a
global rate limit, a per-account daily cap of 100, and length caps on every field.

## The beacon

The injected script also asks the browser for a 1x1 GIF at `/px/<username>/<slug>.gif` once the page has
rendered. That marks the matching visit `beacon = 1`.

It **never creates a view**. Beacons are applied after the views in the same flush and only ever update a
row that already exists, so the server-side count stays the single source of truth and there is no
double-counting to reconcile. A beacon with no matching visit — someone requesting the pixel directly — does
nothing at all.

### Where all of this runs

Everything — counting, flushing, rollups, CSV parsing, the chat reply — runs inside the single Weave server
process, on whichever machine runs it. There is no separate analytics service and nothing is sent anywhere.
The only code running elsewhere is the injected snippet, in a visitor's own browser, and all it does is
request a 1x1 image.

Counting a visit is split across two of those: the request thread appends to a `ViewBuffer` in memory, and
the `sms-analytics` thread writes it out every 10 seconds. **Those two halves have to be in the same
process**, because a `deque` cannot be shared between processes. So `start_analytics()` is deliberately not
grouped with the other background threads: with `WEAVE_SMS_WORKER=external` the build and outbox threads
move to a second process, and the flush thread stays behind in the web process with the buffer it drains.
Were it to follow them, every visit would pile up unwritten until the 20,000 cap and then be discarded, and
the dashboard would read zero for ever with no error to say so.

## Sales figures

An owner can upload a CSV of their sales on the dashboard, and Weave works out revenue, profit, what is
selling and roughly what next week looks like. `SALES` in chat, or "how are my sales doing?", gives the same
numbers in a sentence.

### Reading a real shop's file

Small-business exports are messy, so the parser (`weave/analytics/sales.py`, standard-library `csv`, no
pandas) expects mess:

- **Columns are matched by name**, with the everyday variants tills use — `Order Date`, `Item Name`, `Qty`,
  `Unit Cost`, `Total Amount`. Longer names win, so `Unit Cost` is read as a cost rather than a unit count.
  Only a date column and an amount column are required.
- **Amounts** cope with `Rs 1,250.00`, `$1,234.56`, European `1.234.567`, and `(45.00)` for a refund.
- **Rows that cannot be read are skipped, counted and described** by line number, up to five examples. A
  silent total is worse than a total with "4 rows skipped" next to it.

### Why uploading takes two steps

`03/04` is the 3rd of April in most of the world and the 4th of March in some of it. Picking one quietly
would move a month's takings into the wrong week with nothing to show for it. So the first POST only reads
the file and reports what it found — the column mapping, a five-row sample, the currency, how many rows were
skipped, and whether the dates are ambiguous. Nothing is stored until a second POST confirms.

**The uploaded file is never written to disk.** Only the rows read out of it are stored, in `sales_rows`.

### A week that hasn't finished

Weeks run Monday to Sunday. If the latest week is still running, it is **never** compared against a finished
one — someone uploading on a Tuesday would otherwise be told their takings had collapsed, when all that
happened is two days being measured against seven. A part-finished week is compared with the same number of
days of the week before, is labelled "so far this week", and is kept out of the forecast.

Figures more than ten days old are named by their date — "Sales in the week of 2 Mar" — rather than being
called "last week", so an upload of last spring's takings can't read as if it were current.

### The forecast

A straight line fitted through the finished weeks, clamped at zero. Deliberately the dullest forecast there
is: it is shown to someone deciding whether to buy stock, so it has to be explainable in one sentence —
"your last few weeks, continued". Below four weeks of data it is flagged `low_confidence` and every wording
calls it rough.

Where the file has no cost column, profit is **unknowable** and reported as `null` rather than as zero.
Nothing in the interface implies a profit we cannot calculate.

### The size carve-out

`MAX_BODY_BYTES = 16_000` in `weave/server.py` applies to every path, so the upload needed an exception:
`body_limit()` allows 2.2 MB for the single exact path `/api/account/sales/import` and 16 KB for everything
else. An exact match, never a prefix, and the route behind it is signed in and CSRF-checked.

### What the AI is given

Only `sales_summary()`'s output: a few hundred bytes of totals, a weekly series, the top three products and
the forecast. **No row, no customer, no line of the file.** That keeps the prompt inside Groq's
8,000-tokens-a-minute free tier and keeps the shop's records out of the model.

## Retention

| Data | Kept for | Setting |
|---|---|---|
| Single visits (`site_views`) | 35 days | `WEAVE_ANALYTICS_RAW_DAYS` |
| Enquiries (`site_leads`) | kept until the account is deleted | — |
| Sales rows (`sales_rows`) | kept until the owner removes the import | — |
| Daily totals (`site_daily`) | 400 days | `WEAVE_ANALYTICS_ROLLUP_DAYS` |

Both are pruned by the daily housekeeping pass, alongside the trash and the database backup.

## Switching it off

- **Whole server:** `WEAVE_ANALYTICS=off`. Nothing is counted and the dashboard endpoint returns 404.
- **One account:** `POST /api/account/analytics {"on": false}`. Takes effect on the next request, with no
  rebuild and no change to the published site.

## Behind a proxy

Production runs behind a Cloudflare tunnel, so every request arrives from `127.0.0.1`. Set
`WEAVE_TRUST_PROXY=on` or every visitor hashes identically and each day reports exactly one visitor.
`weave doctor` warns when `PUBLIC_BASE_URL` is https but `WEAVE_TRUST_PROXY` is off.

## Where the code is

| File | What |
|---|---|
| `weave/analytics/collector.py` | hashing, bot and device detection, the in-memory buffer |
| `weave/analytics/metrics.py` | the one place rows become the numbers people are shown |
| `weave/analytics/inject.py` | the script added at serve time, and the page cache behind it |
| `weave/analytics/sales.py` | reading a shop's CSV: columns, amounts, dates |
| `weave/analytics/digest.py` | weekly aggregate digest facts, deterministic copy, and tips |
| `weave/sms/analytics_store.py` | schema (`site_views`, `site_leads`, `sales_*`, `site_daily`, `digests`), writes, rollups, pruning |
| `weave/server.py` | `count_view` and `hosted_page`, on the hosted-site path |
| `weave/sms/worker.py` | `flush_analytics` and weekly Monday digest in `housekeeping` |
| `weave/site/routes.py` | dashboard endpoints (analytics, leads, sales, digest) |
| `weave/sms/service.py` | `_analytics`, `_leads`, `_sales`, `_digest` chat replies |
| `weave/static/site/contact.{html,js}` | the form the popup lands on |

Both the dashboard and the chat reply go through `traffic_summary` / `digest_facts`, so they cannot disagree. The AI is only
ever handed the output of that function — counts, never rows — and `NlgPresenter` reverts to the exact
wording if the model changes any number in it.

## Weekly AI digest and tips

On Monday mornings, the housekeeping pass compiles a weekly digest across traffic, leads, and sales for active accounts,
stored in the `digests` table and delivered via WhatsApp/SMS. It can also be asked for at any time by saying `DIGEST` or
"send me my weekly summary" on chat, or viewed and refreshed on the dashboard. Closing tips are strictly constrained to
concrete facts (e.g. mobile traffic proportion, top referrers, enquiry response, or cost margin warnings).

