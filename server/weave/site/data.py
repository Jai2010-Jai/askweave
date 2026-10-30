"""Each account's data on its live websites: products, menu items, services and stock the owner manages.

How a page uses it: the website generator marks a list of things the business sells like this

    <div data-weave-list="products">
      <article data-weave-item>
        <img data-weave-field="image" src="..."> <h3 data-weave-field="name">Masala chai</h3>
        <span data-weave-field="price">₹30</span>
      </article>
      ...
    </div>

When the site is first published, those items become the owner's "products" table (seed_from_site). From then
on, every time a page is served, the account's tables are added to it (data_snippet) and a small script redraws
each list from them: one copy of the first item per row, sold-out rows marked. Hosted pages stay sandboxed with
`connect-src 'none'`: the data travels inside the page, never through a request the page makes.
"""

from __future__ import annotations

import csv
import io
import json
import re
import threading
from html.parser import HTMLParser
from pathlib import Path

FIELD_TYPES = ("text", "number", "money", "image", "yesno")
MAX_TABLES = 20
MAX_ROWS = 2000
MAX_FIELDS = 30
MAX_VALUE = 2000
NAME_RE = re.compile(r"[a-z][a-z0-9_]{0,31}")

PRESETS = {
    "products": ("Products", [("name", "Name", "text"), ("price", "Price", "money"), ("stock", "Stock", "number"),
                              ("category", "Category", "text"), ("description", "Description", "text"),
                              ("image", "Photo", "image")]),
    "menu": ("Menu", [("name", "Dish", "text"), ("price", "Price", "money"), ("category", "Section", "text"),
                      ("description", "Description", "text"), ("available", "Available", "yesno"),
                      ("image", "Photo", "image")]),
    "services": ("Services", [("name", "Service", "text"), ("price", "Price", "money"),
                              ("duration", "Duration", "text"), ("description", "Description", "text"),
                              ("image", "Photo", "image")]),
}

_MONEY_KEYS = re.compile(r"price|cost|mrp|rate|fee|amount|charge", re.I)
_NUMBER_KEYS = re.compile(r"stock|qty|quantity|count|units|left", re.I)
_IMAGE_KEYS = re.compile(r"image|img|photo|picture|thumb|logo", re.I)
_YESNO_KEYS = re.compile(r"available|in_?stock|active|veg", re.I)
_CURRENCY = re.compile(r"(₹|Rs\.?|INR|\$|€|£)", re.I)
_SAFE_IMAGE = re.compile(r"(https://[^\s\"'<>()]+|(?!//)[\w./-]+\.(?:jpe?g|png|webp|gif|avif|svg))", re.I)


def fields_of(preset: str) -> list[dict]:
    return [{"key": k, "label": label, "type": t} for k, label, t in PRESETS[preset][1]]


def clean_name(text: str) -> str:
    """'Our Menu!' -> 'our_menu'. Raises ValueError when nothing usable is left."""
    name = re.sub(r"[^a-z0-9]+", "_", str(text or "").lower()).strip("_")
    if name and not name[0].isalpha():
        name = "t_" + name
    name = name[:32]
    if not NAME_RE.fullmatch(name):
        raise ValueError("Give the table a name made of letters and numbers.")
    return name


def guess_type(key: str) -> str:
    if _IMAGE_KEYS.search(key):
        return "image"
    if _MONEY_KEYS.search(key):
        return "money"
    if _NUMBER_KEYS.search(key):
        return "number"
    if _YESNO_KEYS.search(key):
        return "yesno"
    return "text"


def clean_fields(fields) -> list[dict]:
    out, seen = [], set()
    for f in fields if isinstance(fields, list) else []:
        if not isinstance(f, dict):
            continue
        try:
            key = clean_name(f.get("key") or f.get("label"))
        except ValueError:
            continue
        if key in seen:
            continue
        seen.add(key)
        kind = f.get("type") if f.get("type") in FIELD_TYPES else guess_type(key)
        out.append({"key": key, "label": str(f.get("label") or key.replace("_", " ").title())[:60], "type": kind})
    if not out:
        raise ValueError("A table needs at least one field.")
    return out[:MAX_FIELDS]


def to_number(value) -> float | int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else round(value, 2)
    m = re.search(r"-?\d[\d,]*(?:\.\d+)?", str(value))
    if not m:
        return None
    n = float(m.group(0).replace(",", ""))
    return int(n) if n.is_integer() else round(n, 2)


def to_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("1", "yes", "y", "true", "on", "available", "in stock", "haan", "ha")


def coerce(fields: list[dict], data: dict) -> dict:
    """Owner input -> a row: only known fields, each in its type. Unknown keys are dropped."""
    row = {}
    for f in fields:
        k, t = f["key"], f["type"]
        if k not in data:
            continue
        v = data[k]
        if t in ("number", "money"):
            row[k] = to_number(v)
        elif t == "yesno":
            row[k] = to_bool(v)
        elif t == "image":
            m = _SAFE_IMAGE.fullmatch(str(v or "").strip())
            row[k] = m.group(0) if m else ""
        else:
            row[k] = str(v if v is not None else "").strip()[:MAX_VALUE]
    return row


# ---------- CSV ----------
def export_csv(table: dict, rows: list[dict]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([f["label"] for f in table["fields"]])
    for r in rows:
        w.writerow(["" if r["data"].get(f["key"]) is None else
                    ("yes" if r["data"][f["key"]] is True else "no" if r["data"][f["key"]] is False else r["data"][f["key"]])
                    for f in table["fields"]])
    return buf.getvalue()


def import_csv(table: dict, raw: bytes) -> list[dict]:
    """A spreadsheet's rows, matched to the table's fields by column name (key or label, any case)."""
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        raise ValueError("That file is empty.")
    names = {}
    for f in table["fields"]:
        names[f["key"]] = f["key"]
        names[f["label"].strip().lower()] = f["key"]
        names[f["label"].strip().lower().replace(" ", "_")] = f["key"]
    cols = [names.get(h.strip().lower()) or names.get(h.strip().lower().replace(" ", "_")) for h in rows[0]]
    if not any(cols):
        raise ValueError("None of the columns match this table. Use the same column names as the export.")
    out = []
    for r in rows[1:]:
        if not any(c.strip() for c in r):
            continue
        out.append(coerce(table["fields"], {k: v for k, v in zip(cols, r) if k}))
    if len(out) > MAX_ROWS:
        raise ValueError(f"A table holds at most {MAX_ROWS} rows.")
    return out


# ---------- live pages ----------
RENDER_JS = r"""(function(){var D=window.WEAVE_DATA||{},d=document;
function money(v,c){var n=Number(v);if(v===""||v===null||v===undefined||isNaN(n))return "";return (c||"")+n.toLocaleString("en-IN",{maximumFractionDigits:2});}
function sold(r){return (r.stock!==undefined&&r.stock!==null&&r.stock!==""&&Number(r.stock)<=0)||r.available===false;}
function fill(n,r,t){[n].concat([].slice.call(n.querySelectorAll("[data-weave-field]"))).forEach(function(el){
var k=el.getAttribute("data-weave-field");if(!k)return;var v=r[k],ty=t.types[k];if(v===undefined||v===null)v="";
if(ty==="image"){if(v){if(el.tagName==="IMG"){el.src=v;el.removeAttribute("srcset");}else{el.style.backgroundImage="url(\""+String(v).replace(/["\\]/g,"")+"\")";}}return;}
el.textContent=ty==="money"?money(v,t.currency):ty==="yesno"?(v?"Yes":"No"):String(v);});
if(sold(r))n.setAttribute("data-weave-out","");else n.removeAttribute("data-weave-out");
[n].concat([].slice.call(n.querySelectorAll("[data-reveal]"))).forEach(function(e){if(e.hasAttribute&&e.hasAttribute("data-reveal"))e.classList.add("is-in");});}
d.querySelectorAll("[data-weave-list]").forEach(function(box){var t=D[box.getAttribute("data-weave-list")];if(!t)return;
var items=box.querySelectorAll("[data-weave-item]");if(!items.length)return;var tpl=items[0],parent=tpl.parentNode;
var w=(box.getAttribute("data-weave-where")||"").split("=");
t.rows.forEach(function(r){if(w.length===2&&String(r[w[0].trim()]||"").toLowerCase()!==w[1].trim().toLowerCase())return;
var n=tpl.cloneNode(true);fill(n,r,t);parent.insertBefore(n,tpl);});
[].forEach.call(items,function(i){if(i.parentNode)i.parentNode.removeChild(i);});});})();"""

STYLE = ("<style>[data-weave-out]{position:relative;opacity:.55}[data-weave-out]::after{content:\"Sold out\";"
         "position:absolute;top:12px;left:12px;z-index:2;background:#111;color:#fff;font:600 12px/1 system-ui,sans-serif;"
         "padding:6px 9px;border-radius:999px}</style>")


def public_payload(store, account_id: int) -> dict:
    out = {}
    for t in store.data_tables(account_id):
        if not t["public"]:
            continue
        keys = [f["key"] for f in t["fields"]]
        out[t["name"]] = {"currency": t["currency"], "types": {f["key"]: f["type"] for f in t["fields"]},
                          "rows": [{k: r["data"].get(k) for k in keys} for r in store.data_rows(t["id"])]}
    return out


def data_snippet(payload: dict, version: float) -> bytes:
    """What goes before </body>. Starts with the version so the page's cache validator changes with the data."""
    if not payload:
        return b""
    blob = json.dumps(payload, separators=(",", ":"))  # ASCII: ₹ survives even a page with no charset
    blob = blob.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")  # can't close the script
    return (f"<!--weave-data {version:.3f}-->{STYLE}<script>window.WEAVE_DATA={blob};</script>"
            f"<script>{RENDER_JS}</script>").encode()


class DataSnippets:
    """Per-account snippets, rebuilt only when the account's data changes (one cheap query per page view)."""

    def __init__(self, store) -> None:
        self.store = store
        self._cache: dict[int, tuple[float, bytes]] = {}
        self._lock = threading.Lock()

    def for_account(self, account_id: int) -> bytes:
        version = self.store.data_version(account_id)
        if not version:
            return b""
        with self._lock:
            hit = self._cache.get(account_id)
            if hit and hit[0] == version:
                return hit[1]
        snippet = data_snippet(public_payload(self.store, account_id), version)
        with self._lock:
            if len(self._cache) > 2000:
                self._cache.clear()
            self._cache[account_id] = (version, snippet)
        return snippet


# ---------- first publish: the site's own items become the owner's table ----------
class _Lists(HTMLParser):
    VOID = {"img", "source", "input", "br", "hr", "meta", "link", "area", "base", "col", "embed", "param", "track", "wbr"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.lists: dict[str, list[dict]] = {}
        self.stack: list[tuple[str, str | None, bool, str | None]] = []  # tag, list name, is item, field key
        self.list_name: str | None = None
        self.item: dict | None = None
        self.capture: list[tuple[str, list[str]]] = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        name = a.get("data-weave-list")
        is_item = "data-weave-item" in a
        key = a.get("data-weave-field")
        if name and self.list_name is None:
            self.list_name = name
            self.lists.setdefault(name, [])
        if is_item and self.list_name and self.item is None:
            self.item = {}
        if key and self.item is not None:
            if tag in ("img", "source"):
                self.item.setdefault(key, a.get("src") or "")
                key = None
            elif tag not in self.VOID:
                self.capture.append((key, []))
        if tag in self.VOID:
            return
        self.stack.append((tag, name if name and self.list_name == name else None, is_item and self.item is not None,
                           key if key and self.item is not None else None))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_data(self, data):
        for _, parts in self.capture:
            parts.append(data)

    def handle_endtag(self, tag):
        if tag in self.VOID:
            return
        while self.stack:
            t, name, is_item, key = self.stack.pop()
            if key and self.capture:
                k, parts = self.capture.pop()
                if self.item is not None:
                    self.item.setdefault(k, " ".join("".join(parts).split()))
            if is_item and self.item is not None:
                if self.item and self.list_name:
                    self.lists[self.list_name].append(self.item)
                self.item = None
            if name:
                self.list_name = None
            if t == tag:
                break


def lists_in(html: str) -> dict[str, list[dict]]:
    p = _Lists()
    try:
        p.feed(html)
        p.close()
    except Exception:  # noqa: BLE001 - a page we can't read just has no lists
        return {}
    return {k: v for k, v in p.lists.items() if v}


def seed_from_site(store, account_id: int, site_dir: Path) -> list[str]:
    """Create the owner's tables from the lists on a newly published site. Existing tables are never touched:
    once the owner has data, their data wins over whatever a rebuild wrote into the page."""
    found: dict[str, list[dict]] = {}
    for page in sorted(Path(site_dir).glob("*.html")):
        try:
            html = page.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for name, items in lists_in(html).items():
            found.setdefault(name, items)
    created = []
    existing = {t["name"] for t in store.data_tables(account_id)}
    for raw_name, items in found.items():
        try:
            name = clean_name(raw_name)
        except ValueError:
            continue
        if name in existing or len(existing) + len(created) >= MAX_TABLES:
            continue
        keys = []
        for it in items:
            keys += [k for k in it if k not in keys]
        if name in PRESETS:
            preset = fields_of(name)
            fields = preset + [f for f in clean_fields([{"key": k} for k in keys]) if f["key"] not in
                               {p["key"] for p in preset}]
        else:
            fields = clean_fields([{"key": k} for k in keys])
        currency = next((m.group(1) for it in items for v in it.values() if (m := _CURRENCY.search(str(v)))), "₹")
        currency = {"rs": "₹", "rs.": "₹", "inr": "₹"}.get(currency.lower(), currency)
        table = store.create_data_table(account_id, name, name.replace("_", " ").title(), fields, currency)
        store.add_data_rows(table["id"], [coerce(fields, it) for it in items[:MAX_ROWS]])
        created.append(name)
    return created


# ---------- WhatsApp ----------
def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(text or "").lower()).strip()


def find_row(rows: list[dict], item: str) -> dict | None:
    """The row whose name best matches what they typed: exact, then contained, then most shared words."""
    want = _norm(item)
    if not want:
        return None
    named = [(r, _norm(r["data"].get("name", ""))) for r in rows]
    for r, n in named:
        if n == want:
            return r
    for r, n in named:
        if n and (want in n or n in want):
            return r
    words = set(want.split())
    best = max(named, key=lambda rn: len(words & set(rn[1].split())), default=(None, ""))
    return best[0] if best[0] is not None and words & set(best[1].split()) else None


def chat_change(store, account_id: int, op: str, table: str | None, item: str | None,
                amount: float | None, value: str | None) -> str:
    """Run one inventory change asked for in chat and say exactly what happened (never what the AI guessed)."""
    tables = store.data_tables(account_id)
    if not tables:
        return ("You don't have any products or stock on Weave yet. Build a website that lists what you sell and "
                "I'll set it up, or add them on your dashboard.")
    t = next((x for x in tables if x["name"] == (table or "").strip().lower()), None) or next(
        (x for x in tables if any(f["key"] == "stock" for f in x["fields"])), None) or tables[0]
    rows = store.data_rows(t["id"])
    fields = t["fields"]
    keys = {f["key"] for f in fields}
    money = lambda v: f"{t['currency']}{v:,.0f}" if isinstance(v, (int, float)) else "-"  # noqa: E731

    if op == "low":
        if "stock" not in keys:
            return f"Your {t['label'] or t['name']} list doesn't track stock."
        low = [r for r in rows if isinstance(r["data"].get("stock"), (int, float)) and r["data"]["stock"] <= 5]
        if not low:
            return "Nothing is running low. Everything has more than 5 left."
        return "Running low:\n" + "\n".join(f"- {r['data'].get('name')}: {r['data']['stock']} left" for r in low[:20])
    if op == "list":
        if not rows:
            return f"Your {t['label'] or t['name']} list is empty."
        lines = []
        for r in rows[:30]:
            d = r["data"]
            bits = [str(d.get("name") or "?")]
            if "price" in keys:
                bits.append(money(d.get("price")))
            if "stock" in keys and d.get("stock") is not None:
                bits.append(f"{d['stock']} left")
            lines.append("- " + ", ".join(bits))
        more = f"\n...and {len(rows) - 30} more on your dashboard." if len(rows) > 30 else ""
        return f"{t['label'] or t['name']} ({len(rows)}):\n" + "\n".join(lines) + more
    if not item:
        return "Which item? Tell me its name, like \"masala chai stock 20\"."
    if op == "add_item":
        if find_row(rows, item) and _norm(find_row(rows, item)["data"].get("name")) == _norm(item):
            return f"{item} is already on your list."
        if len(rows) >= MAX_ROWS:
            return f"Your list is full ({MAX_ROWS} items)."
        data = {"name": item.strip()[:120]}
        if "price" in keys and amount is not None:
            data["price"] = amount
        if "stock" in keys and value and to_number(value) is not None:
            data["stock"] = to_number(value)
        store.add_data_rows(t["id"], [coerce(fields, data)])
        return f"Added {item.strip()} to your {t['label'] or t['name']}. It's on your live site now."
    row = find_row(rows, item)
    if row is None:
        return f"I couldn't find \"{item}\" in your {t['label'] or t['name']}. Say \"show my products\" to see the list."
    d = dict(row["data"])
    name = d.get("name") or item
    if op == "remove_item":
        store.delete_data_row(t["id"], row["id"])
        return f"Removed {name}. It's gone from your live site."
    if op == "price":
        if "price" not in keys or amount is None:
            return "Tell me the new price, like \"chai price 25\"."
        d["price"] = amount
        store.update_data_row(t["id"], row["id"], coerce(fields, d))
        return f"{name} now costs {money(to_number(amount))} on your site."
    if op in ("stock_set", "stock_add", "stock_remove", "sold_out", "available"):
        if op in ("sold_out", "available") and "stock" not in keys and "available" in keys:
            d["available"] = op == "available"
            store.update_data_row(t["id"], row["id"], coerce(fields, d))
            return f"{name} is now shown as {'available' if op == 'available' else 'sold out'}."
        if "stock" not in keys:
            return f"Your {t['label'] or t['name']} list doesn't track stock."
        now = d.get("stock") if isinstance(d.get("stock"), (int, float)) else 0
        n = to_number(amount) or 0
        if op == "available" and not n:
            return f"How many {name} do you have now? Say it like \"{name} stock 20\"."
        new = {"stock_set": n, "stock_add": now + n, "stock_remove": max(0, now - n), "sold_out": 0,
               "available": n}[op]
        d["stock"] = new
        if "available" in keys:
            d["available"] = new > 0
        store.update_data_row(t["id"], row["id"], coerce(fields, d))
        return f"{name}: {new} in stock" + (" (shown as sold out on your site)." if new <= 0 else ".")
    return "I can change stock, prices, add or remove items, or show what's low."


def chat_summary(store, account_id: int) -> list[str]:
    """Lines for the chat AI's context: which tables exist and a few item names, so it can match what they say."""
    lines = []
    for t in store.data_tables(account_id)[:6]:
        rows = store.data_rows(t["id"])[:25]
        names = ", ".join(str(r["data"].get("name") or "?") +
                          (f" ({r['data']['stock']} left)" if isinstance(r["data"].get("stock"), (int, float)) else "")
                          for r in rows)
        lines.append(f"- {t['name']} ({t['row_count']} items; fields: {', '.join(f['key'] for f in t['fields'])}): {names}")
    return lines
