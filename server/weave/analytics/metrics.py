"""The numbers we show people, worked out in one place.

Both the dashboard and the chat reply go through `traffic_summary`, so they can never disagree, and the AI
is only ever handed what comes out of here: counts, never rows.
"""

from __future__ import annotations

import time

from .collector import utc_day

WINDOWS = (7, 14, 30)       # what the dashboard may ask for; all inside the raw-view retention window
LOW_DATA_VIEWS = 20         # below this, say "early days" rather than quoting a trend
LOW_DATA_DAYS = 7
WEEKDAYS = ("Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed")  # day 0 (1 Jan 1970) was a Thursday


def weekday(day: int) -> str:
    return WEEKDAYS[day % 7]


def _pct_change(now: int, before: int) -> int | None:
    """Percentage change, or None when there is no honest comparison to make."""
    if before <= 0:
        return None
    return round((now - before) / before * 100)


def page_label(slug: str, page: str) -> str:
    """How a page is named to a business owner, who has never heard of index.html."""
    name = page[:-5] if page.endswith(".html") else page
    if name in ("index", ""):
        return f"{slug} home page" if slug else "home page"
    return f"{slug}/{name}" if slug else name


def traffic_summary(store, account_id: int, *, days: int = 7, slug: str | None = None,
                    now: float | None = None, series_days: int = 14) -> dict:
    """Everything said about one account's traffic: this window, the window before it, and a daily series."""
    now = time.time() if now is None else now
    today = utc_day(now)
    first = today - days + 1
    totals = store.view_totals(account_id, first, today, slug)
    before = store.view_totals(account_id, first - days, first - 1, slug)
    by_day = {r["day"]: r["views"] for r in store.views_by_day(account_id, first, today, slug)}
    series = [[d, by_day.get(d, 0)] for d in range(today - series_days + 1, today + 1)]
    devices = store.device_split(account_id, first, today, slug)
    mobile, known = devices.get("mobile", 0), devices.get("mobile", 0) + devices.get("desktop", 0)
    busiest = max(by_day.items(), key=lambda kv: (kv[1], kv[0]), default=None)
    first_day = store.first_view_day(account_id)

    seen_days = today - first_day + 1 if first_day is not None else 0
    return {
        "days": days,
        "views": totals["views"],
        "visitors": totals["visitors"],
        "prev_views": before["views"],
        "delta_pct": _pct_change(totals["views"], before["views"]),
        "busiest_day": weekday(busiest[0]) if busiest and busiest[1] else "",
        "busiest_views": busiest[1] if busiest else 0,
        "top_pages": [{"slug": r["slug"], "page": r["page"], "views": r["views"],
                       "label": page_label(r["slug"], r["page"])}
                      for r in store.top_pages(account_id, first, today, 3, slug)],
        "top_refs": [{"host": r["ref"], "views": r["views"]}
                     for r in store.top_refs(account_id, first, today, 3, slug)],
        "mobile_pct": round(mobile / known * 100) if known else None,
        "series": series,
        "seen_days": seen_days,
        "low_data": totals["views"] < LOW_DATA_VIEWS or seen_days < LOW_DATA_DAYS,
    }


# Weeks run Monday to Sunday. Day 0 of the epoch was a Thursday, so Monday sits 4 days in.
MONDAY_OFFSET = 4
SALES_WEEKS = 8
MIN_WEEKS_TO_PROJECT = 4
STALE_AFTER_DAYS = 10


def week_of(day: int) -> int:
    return (day - MONDAY_OFFSET) // 7


def week_start(week: int) -> int:
    return week * 7 + MONDAY_OFFSET


def project_next(values: list[float]) -> float | None:
    """Next week's takings, as a straight line fitted through the weeks we have.

    Deliberately the dullest forecast there is. It is shown to someone deciding whether to buy more stock,
    so it must be explainable in one sentence - "your last few weeks, continued" - and never go below zero.
    """
    n = len(values)
    if n < 2:
        return None
    mean_x = (n - 1) / 2
    mean_y = sum(values) / n
    spread = sum((i - mean_x) ** 2 for i in range(n))
    if not spread:
        return max(0.0, mean_y)
    slope = sum((i - mean_x) * (v - mean_y) for i, v in enumerate(values)) / spread
    return max(0.0, mean_y + slope * (n - mean_x))


def sales_summary(store, account_id: int, *, now: float | None = None, weeks: int = SALES_WEEKS) -> dict:
    """What their sales did, as numbers only. This is the whole of what any model is ever shown."""
    now = time.time() if now is None else now
    span = store.sales_span(account_id)
    if not span["rows"]:
        return {"has_sales": False, "rows": 0}

    # Measured from their last sale, not from today: a file uploaded on Friday covering last month should
    # talk about last month, not report four empty weeks.
    last_week = week_of(span["last"])
    first_day = week_start(last_week - weeks + 1)
    by_day = {r["day"]: r for r in store.sales_by_day(account_id, first_day, week_start(last_week) + 6)}

    series = []
    for w in range(last_week - weeks + 1, last_week + 1):
        start = week_start(w)
        days = [by_day[d] for d in range(start, start + 7) if d in by_day]
        revenue = sum(d["revenue"] or 0 for d in days)
        cost = sum(d["cost"] or 0 for d in days)
        series.append({"week_start": start, "revenue": round(revenue, 2), "cost": round(cost, 2),
                       "profit": round(revenue - cost, 2), "units": sum(d["units"] or 0 for d in days)})

    # A week still running must never be compared against a finished one. Someone who uploads on Tuesday
    # would be told their takings had collapsed, when all that happened is that two days were measured
    # against seven. So a part-finished week is compared with the same number of days of the week before,
    # is labelled as being in progress, and is kept out of the forecast entirely.
    today = utc_day(now)
    complete = week_start(last_week) + 6 < today
    this_week, prior = series[-1], series[-2] if len(series) > 1 else None
    if not complete:
        days_in = min(span["last"], today) - week_start(last_week) + 1
        this_week = dict(this_week, days_in=days_in, in_progress=True)
        if prior is not None:
            start = week_start(last_week - 1)
            same = [by_day[d] for d in range(start, start + days_in) if d in by_day]
            prior = dict(prior, revenue=round(sum(d["revenue"] or 0 for d in same), 2),
                         part_week=True, days_in=days_in)

    finished = series[:-1] if not complete else series
    counted = [w for w in finished if w["revenue"]]
    projection = project_next([w["revenue"] for w in finished]) if len(counted) >= 2 else None
    totals = store.sales_totals(account_id, span["first"], span["last"])
    has_cost = totals["cost"] > 0

    return {
        "has_sales": True,
        "rows": span["rows"],
        "currency": span["currency"],
        "first_day": span["first"],
        "last_day": span["last"],
        "weeks": series,
        "this_week": this_week,
        "last_week": prior,
        "in_progress": not complete,   # the headline week hasn't finished yet; say "so far" when telling them
        "week_start": this_week["week_start"],
        # A file of last spring's takings is still worth reading, but calling its final week "last week"
        # would be a lie. When the figures are old, they get named by their date instead.
        "stale": week_start(last_week) + 6 < today - STALE_AFTER_DAYS,
        "delta_pct": _pct_change(round(this_week["revenue"]), round(prior["revenue"])) if prior else None,
        "has_cost": has_cost,              # without a cost column, profit is unknowable - never imply it
        "profit": this_week["profit"] if has_cost else None,
        "losing_money": bool(has_cost and this_week["revenue"] and this_week["profit"] < 0),
        "top_products": [{"product": r["product"], "revenue": round(r["revenue"] or 0, 2),
                          "units": r["units"] or 0}
                         for r in store.top_products(account_id, span["first"], span["last"], 3)],
        "projection": round(projection, 2) if projection is not None else None,
        "method": "a straight line through the weeks so far",
        "low_confidence": len(counted) < MIN_WEEKS_TO_PROJECT,
    }


def __getattr__(name: str):
    if name in ("digest_facts", "digest_text", "generate_digest", "select_tip"):
        from . import digest
        return getattr(digest, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

