"""Reading a shop's sales spreadsheet.

Small business exports are messy: the columns are named whatever the till called them, amounts arrive as
"Rs 1,250.00" or "(45.00)" for a refund, and 03/04 means the 3rd of April in most of the world and the 4th
of March in some of it. Guessing that last one silently would put a month's takings in the wrong week, so
this module only ever *proposes* a reading, and the person confirms it before anything is stored.

Parsing is deliberately plain: the standard library's csv module, no pandas (not a dependency, and not worth
becoming one for this).
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from datetime import date, datetime

MAX_BYTES = 2_000_000
MAX_ROWS = 20_000
MAX_COLS = 64
MAX_PROBLEMS = 5          # enough to see the shape of a problem, not a wall of text
SAMPLE_ROWS = 5

# Column roles, and the names tills and spreadsheets actually use for them. Longest match wins, so
# "unit cost" is read as cost rather than as a unit count.
HEADERS: dict[str, tuple[str, ...]] = {
    "date": ("date", "day", "order date", "sale date", "transaction date", "invoice date", "datetime",
             "timestamp", "created", "created at", "when", "tarikh"),
    "cost": ("cost", "cogs", "cost price", "unit cost", "purchase price", "buy price", "expense", "expenses",
             "cost of goods", "cost of goods sold", "wholesale"),
    "amount": ("amount", "revenue", "total", "sales", "sale", "price", "value", "gross", "net", "subtotal",
               "total amount", "sale amount", "order total", "line total", "paid", "takings"),
    "quantity": ("qty", "quantity", "units", "unit", "count", "pieces", "pcs", "items", "no of items",
                 "number sold"),
    "product": ("product", "item", "item name", "product name", "name", "description", "sku", "category",
                "title", "service"),
}
ROLES = tuple(HEADERS)

CURRENCY = {"₹": "INR", "rs": "INR", "inr": "INR", "$": "USD", "usd": "USD", "€": "EUR",
            "eur": "EUR", "£": "GBP", "gbp": "GBP", "¥": "JPY", "₦": "NGN", "r$": "BRL"}
_CURRENCY_RE = re.compile(r"[₹$€£¥₦]|\b(?:rs|inr|usd|eur|gbp|jpy|ngn)\b\.?", re.I)
_NUMBER_RE = re.compile(r"-?\d[\d,.\s]*")

DATE_FORMATS = ("%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y", "%d/%m/%Y", "%m-%d-%Y", "%m/%d/%Y",
                "%d-%m-%y", "%d/%m/%y", "%m-%d-%y", "%m/%d/%y", "%d %b %Y", "%d %B %Y",
                "%b %d %Y", "%B %d %Y", "%d.%m.%Y", "%Y.%m.%d")
_SLASHED = re.compile(r"^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$")
EPOCH = date(1970, 1, 1)


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", (name or "").strip().lower()).strip()


def sniff_columns(headers: list[str]) -> dict[str, int | None]:
    """Guess which column is which. Returns a role -> column index map, with None for roles not found."""
    clean = [_norm(h) for h in headers]
    found: dict[str, int | None] = {role: None for role in ROLES}
    used: set[int] = set()
    # Exact names first, then "contains", so a column literally called "cost" wins over "cost centre".
    for match_exactly in (True, False):
        for role in ROLES:
            if found[role] is not None:
                continue
            for want in sorted(HEADERS[role], key=len, reverse=True):
                for i, name in enumerate(clean):
                    if i in used or not name:
                        continue
                    if name == want if match_exactly else want in name:
                        found[role], _ = i, used.add(i)
                        break
                if found[role] is not None:
                    break
    return found


def parse_amount(raw: str) -> tuple[float | None, str]:
    """A money column as a number, plus the currency it was written in if it said. "(45.00)" is a refund."""
    text = (raw or "").strip()
    if not text:
        return None, ""
    currency = ""
    for token in _CURRENCY_RE.findall(text.lower()) or []:
        currency = CURRENCY.get(token.strip(". "), "") or currency
    if (symbol := _CURRENCY_RE.search(text)) is not None and not currency:
        currency = CURRENCY.get(symbol.group(0).lower().strip(". "), "")
    negative = text.startswith("(") and text.endswith(")")
    body = _CURRENCY_RE.sub("", text).strip(" () ")
    if not (m := _NUMBER_RE.search(body)):
        return None, currency
    number = re.sub(r"[,\s ]", "", m.group(0))
    if number.count(".") > 1:  # 1.234.567 is thousands written the European way
        number = number.replace(".", "")
    try:
        value = float(number)
    except ValueError:
        return None, currency
    return (-value if negative and value > 0 else value), currency


def date_ambiguity(values: list[str]) -> str:
    """Whether d/m/y and m/d/y would read this column differently: "day", "month" or "unclear"."""
    first_over_12 = second_over_12 = False
    for raw in values:
        if (m := _SLASHED.match((raw or "").strip())) is None:
            continue
        a, b = int(m.group(1)), int(m.group(2))
        first_over_12 |= a > 12
        second_over_12 |= b > 12
    if first_over_12 and not second_over_12:
        return "day"      # 25/03 can only be day first
    if second_over_12 and not first_over_12:
        return "month"    # 03/25 can only be month first
    return "unclear"      # every row works both ways; the person has to tell us


def parse_date(raw: str, dayfirst: bool) -> date | None:
    text = (raw or "").strip()
    if not text:
        return None
    if " " in text and len(text) > 10:  # a timestamp: keep the date part
        text = text.split()[0]
    if (m := _SLASHED.match(text)) is not None:
        a, b, c = (int(g) for g in m.groups())
        day, month = (a, b) if dayfirst else (b, a)
        if day > 12 >= month and not dayfirst:
            day, month = month, day  # the data disagrees with the setting; believe the data
        year = c + (2000 if c < 70 else 1900) if c < 100 else c
        try:
            return date(year, month, day)
        except ValueError:
            return None
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def to_day(value: date) -> int:
    return (value - EPOCH).days


@dataclass
class Parsed:
    """What one upload turned into, before anything is stored."""
    columns: dict[str, int | None]
    headers: list[str]
    rows: list[tuple] = field(default_factory=list)   # (day, product, units, amount, cost)
    sample: list[dict] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)
    skipped: int = 0
    currency: str = ""
    ambiguity: str = "unclear"
    dayfirst: bool = True

    @property
    def ok(self) -> bool:
        return bool(self.rows)


def read_csv(data: bytes, *, dayfirst: bool | None = None,
             columns: dict[str, int | None] | None = None) -> Parsed:
    """Turn an uploaded file into rows we could store. Never raises on bad input: unreadable lines are
    counted and described, so the person is told what was ignored rather than being handed a silent total."""
    if len(data) > MAX_BYTES:
        raise ValueError(f"That file is larger than {MAX_BYTES // 1_000_000} MB.")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("latin-1", errors="replace")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text, newline=""), dialect)

    try:
        headers = next(reader)
    except StopIteration:
        raise ValueError("That file is empty.") from None
    if len(headers) > MAX_COLS:
        raise ValueError(f"That file has more than {MAX_COLS} columns.")

    found = columns or sniff_columns(headers)
    if found.get("date") is None or found.get("amount") is None:
        raise ValueError("I couldn't find a date column and an amount column. "
                         f"The columns I can see are: {', '.join(h for h in headers if h.strip()) or 'none'}.")

    body = [row for row in reader if any((cell or "").strip() for cell in row)]
    if len(body) > MAX_ROWS:
        raise ValueError(f"That file has more than {MAX_ROWS:,} rows. Split it and upload the parts.")

    date_col = found["date"]
    ambiguity = date_ambiguity([r[date_col] for r in body if len(r) > date_col])
    if dayfirst is None:
        dayfirst = ambiguity != "month"

    out = Parsed(columns=found, headers=headers, ambiguity=ambiguity, dayfirst=dayfirst)
    cell = lambda row, role: (row[i].strip() if (i := found.get(role)) is not None and len(row) > i else "")  # noqa: E731

    for line, row in enumerate(body, start=2):
        when = parse_date(cell(row, "date"), dayfirst)
        amount, currency = parse_amount(cell(row, "amount"))
        if when is None or amount is None:
            out.skipped += 1
            if len(out.problems) < MAX_PROBLEMS:
                bad = "date" if when is None else "amount"
                out.problems.append(f"Line {line}: couldn't read the {bad} ({cell(row, bad)!r}) - skipped.")
            continue
        out.currency = out.currency or currency
        units, _ = parse_amount(cell(row, "quantity"))
        cost, _ = parse_amount(cell(row, "cost"))
        product = cell(row, "product")[:80]
        out.rows.append((to_day(when), product, int(units) if units and units > 0 else 1,
                         amount, cost or 0.0))
        if len(out.sample) < SAMPLE_ROWS:
            out.sample.append({"date": when.isoformat(), "product": product,
                               "units": int(units) if units and units > 0 else 1,
                               "amount": round(amount, 2), "cost": round(cost or 0.0, 2)})

    if not out.rows:
        raise ValueError("I couldn't read a single row of that file. "
                         + (out.problems[0] if out.problems else "Check the date and amount columns."))
    if out.skipped and len(out.problems) == MAX_PROBLEMS:
        out.problems.append(f"...and {out.skipped - MAX_PROBLEMS} more rows skipped.")
    return out
