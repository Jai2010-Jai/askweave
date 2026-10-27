"""Outbound SMS copy. Kept short and in plain ASCII so each message stays within 1-3 GSM-7 segments
(160 characters each); non-GSM characters would force UCS-2 at 70 characters per segment."""

from __future__ import annotations

import unicodedata
from datetime import date as _date, timedelta as _timedelta

MAX_CHARS = 450  # three concatenated GSM-7 segments (153 chars each)
MAX_CHARS_CHAT = 1500  # WhatsApp and the web chat have no segment pricing

HELP = ("Just talk to me normally (text or voice note):\n"
        "- Describe an app to build it\n"
        "- Ask for changes: \"make the buttons bigger\"\n"
        "- \"how's it going?\" for progress\n"
        "- \"send the link\" to download\n"
        "- \"show my apps\" / \"switch to 2\"\n"
        "- \"how's my site doing?\" for visitor numbers\n"
        "- LEADS to read enquiries from your site\n"
        "- SALES for revenue and profit from your uploaded figures\n"
        "- \"cancel it\" or \"try again\"\n"
        "- INVITE to get a code for friends\n"
        "Say \"new app: <idea>\" to start a separate app.")

# Stage -> (progress key, text). Only "major" stages are sent with WEAVE_SMS_PROGRESS=major.
PROGRESS = {
    "generating": ("generating", True, "Understanding your idea and writing the app's code."),
    "validating": ("validating", False, "Checking the generated code for safety."),
    "building": ("building", True, "Compiling your app."),
    "repairing": ("repairing", True, "Found a build error. Fixing it automatically."),
    "verifying": ("verifying", False, "Testing the finished app package."),
}
WEB_PROGRESS = {
    "generating": ("generating", True, "Researching a design direction and writing your website."),
    "validating": ("validating", False, "Checking the generated website for safety."),
    "verifying": ("verifying", False, "Preparing your private preview link."),
}


def ascii_safe(text: str) -> str:
    """Replace characters outside GSM-7 (smart quotes, emoji) so messages don't switch to UCS-2."""
    text = (text.replace("‘", "'").replace("’", "'").replace("“", '"').replace("”", '"')
            .replace("–", "-").replace("—", "-").replace("…", "..."))
    text = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in text if ch == "\n" or 32 <= ord(ch) < 127)


def fit(text: str, limit: int = MAX_CHARS, unicode: bool = False) -> str:
    """Trim a message to `limit`. Plain SMS is also made GSM-7 safe (ASCII); WhatsApp and the web chat keep every
    character (Hindi, Telugu, Kannada and Tamil scripts, emoji), so pass unicode=True for those."""
    text = (text if unicode else ascii_safe(text)).strip()
    return text if len(text) <= limit else text[: limit - 3].rstrip() + "..."


SPARK = "_.-~=#"  # ASCII-safe daily bars; WhatsApp gets the block characters instead


def _spark(series: list, unicode: bool) -> str:
    """A week of daily visits as one small picture."""
    values = [v for _, v in series]
    if not values or not max(values):
        return ""
    blocks = "▁▂▃▅▆▇" if unicode else SPARK
    top = max(values)
    return "".join(blocks[min(len(blocks) - 1, round(v / top * (len(blocks) - 1)))] for v in values)


def analytics_text(facts: dict, site: str, limit: int = MAX_CHARS, unicode: bool = False,
                   dashboard: str = "") -> str:
    """How a site is doing, in one message.

    Assembled clause by clause and stopped before the limit rather than trimmed at the end: `fit` would
    happily cut "142 views" down to "14 views", and a wrong number is worse than a missing sentence.
    """
    if not facts["views"]:
        if facts.get("leads"):
            return f"No visits counted for {site} yet, but {facts['leads']} enquiries came in. Say LEADS to read them."
        return (f"No visits to {site} yet. Share the link and I'll start counting."
                if facts["seen_days"] else f"Nothing yet for {site} - I start counting from the first visit.")

    people = f"{facts['visitors']} {'person' if facts['visitors'] == 1 else 'people'}"
    head = f"{site}, last {facts['days']} days: {facts['views']} visits from {people}"
    # A percentage off two tiny numbers is noise dressed up as a trend.
    if facts["delta_pct"] is not None and not facts["low_data"]:
        head += f", {'up' if facts['delta_pct'] >= 0 else 'down'} {abs(facts['delta_pct'])}%"
    parts = [head + "."]

    extras = []
    if facts["busiest_day"]:
        extras.append(f"Busiest day {facts['busiest_day']}.")
    if facts["top_pages"]:
        extras.append(f"Most viewed: {facts['top_pages'][0]['label']}.")
    if facts["top_refs"]:
        extras.append(f"Most came from {facts['top_refs'][0]['host']}.")
    if facts.get("leads"):  # the thing an owner actually cares about, so it goes before the decorations
        n = facts["leads"]
        extras.insert(0, f"{n} {'enquiry' if n == 1 else 'enquiries'} this week - say LEADS to read them.")
    if unicode and (spark := _spark(facts["series"][-7:], unicode)):
        extras.append(f"Last 7 days: {spark}")
    if facts["low_data"]:
        extras.append("Early days yet - worth another look next week.")
    if dashboard:
        extras.append(f"Full charts: {dashboard}")

    for clause in extras:
        if len(" ".join([*parts, clause])) > limit:
            break
        parts.append(clause)
    return " ".join(parts)


def day_name(day: int) -> str:
    """A day number as "2 Mar", for naming a week that isn't the current one."""
    return (_date(1970, 1, 1) + _timedelta(days=int(day))).strftime("%-d %b")


def money(value: float, currency: str = "") -> str:
    """An amount as a shopkeeper would say it. No decimals: nobody wants "1250.00" in a text message."""
    sign = "-" if value < 0 else ""
    n = abs(value)
    body = f"{n:,.0f}" if n >= 100 else f"{n:,.2f}".rstrip("0").rstrip(".")
    return f"{sign}{SYMBOL.get(currency, currency + ' ' if currency else '')}{body}"


SYMBOL = {"INR": "Rs ", "USD": "$", "EUR": "EUR ", "GBP": "GBP ", "JPY": "JPY ", "NGN": "NGN ", "BRL": "BRL "}


def sales_text(f: dict, limit: int = MAX_CHARS, unicode: bool = False) -> str:
    """How the shop is doing, from their own numbers. Clause by clause, stopping before the limit."""
    if not f.get("has_sales"):
        return "No sales data yet. Upload a CSV of your sales on the dashboard and I'll work it out."
    cur = f.get("currency", "")
    week = f["this_week"]
    if f.get("stale"):
        head = f"Sales in the week of {day_name(f['week_start'])}"
    else:
        head = "Sales so far this week" if f.get("in_progress") else "Sales last week"
    parts = [f"{head}: {money(week['revenue'], cur)}"]
    if f["delta_pct"] is not None:
        same = " of last week" if f.get("in_progress") else " on the week before"
        parts[0] += f", {'up' if f['delta_pct'] >= 0 else 'down'} {abs(f['delta_pct'])}% on the same days{same}" \
            if f.get("in_progress") else \
            f", {'up' if f['delta_pct'] >= 0 else 'down'} {abs(f['delta_pct'])}% on the week before"
    parts[0] += "."

    extras = []
    # Without a cost column there is no profit to speak of, and guessing one would be inventing a number.
    if f["has_cost"]:
        word = "Loss" if f["losing_money"] else "Profit"
        extras.append(f"{word}: {money(abs(week['profit']), cur)}.")
    if f["top_products"]:
        extras.append(f"Best seller: {f['top_products'][0]['product']}.")
    if f["projection"] is not None:
        hedge = " (rough - not many weeks yet)" if f["low_confidence"] else ""
        extras.append(f"Next week looks like about {money(f['projection'], cur)}{hedge}.")
    for clause in extras:
        if len(" ".join([*parts, clause])) > limit:
            break
        parts.append(clause)
    return " ".join(parts)


def duration(hours: int) -> str:
    if hours % 24 == 0:
        days = hours // 24
        return f"{days} day{'s' if days != 1 else ''}"
    return f"{hours} hours"


def name_of(project: dict | None) -> str:
    if not project:
        return "your app"
    # Any script is fine here; plain SMS is made ASCII later, when the whole message is fitted.
    name = "".join(ch for ch in project.get("name") or "" if ch.isprintable()).strip().rstrip(".")
    if name:
        return name
    if project.get("kind") == "website":
        return "your website"
    return "your app"


def failure_reason(error: str | None) -> str:
    """A short, truthful summary of a Weave build error for SMS (full details stay in the build log)."""
    e = (error or "").lower()
    if "cancelled" in e:
        return "It was cancelled."
    if "quota" in e or "resource_exhausted" in e or "429" in e:
        return "The AI service is out of quota right now."
    if "temporarily unavailable" in e:
        return "The AI service is temporarily unavailable."
    if "gemini_api_key" in e or "api key" in e:
        return "The AI service isn't configured on the Weave server."
    if "prerequisites missing" in e:
        return "The build machine is missing part of its Android toolchain."
    if "failed validation" in e:
        return "The generated code didn't pass Weave safety checks."
    if "repair attempt" in e or "automatic repair failed" in e:
        return "The app didn't compile, even after automatic fixes."
    if "timed out" in e:
        return "The build took too long and was stopped."
    if "outside generated code" in e:
        return "The Android toolchain failed (not your app's code)."
    if "verification failed" in e:
        return "The app package failed verification."
    if "interrupted" in e:
        return "The Weave server restarted during the build."
    if "could not design the website" in e:
        return "The AI service is busy right now, so please wait a minute."
    if "website builder unavailable" in e:
        return "Website building isn't set up on the Weave server."
    if "did not apply the change" in e:
        return "The AI didn't apply the change to the website."
    if "website generation failed" in e or "did not produce the website" in e:
        return "The AI couldn't generate the website."
    if "website generation timed out" in e:
        return "Generating the website took too long and was stopped."
    if "netlify" in e:
        return "Netlify didn't accept the publish."
    if "sources of the previous build" in e:
        return "The previous version's code is no longer available."
    return "The build failed."
