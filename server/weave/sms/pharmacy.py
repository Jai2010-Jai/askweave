"""Natural language parsing and business logic for Medical Store / Pharmacy workflows.

Supports:
1. Flexible business onboarding intent & pharmacy type detection (no rigid presets)
2. CSV inventory parsing & multi-line item intake
3. Conversational stock addition and stock depletion ("got over")
4. Proactive low-stock alerts & bulk distributor reorders
5. Cross-store medicine discovery and dual-agent order lifecycle
6. Automated vs manual payment link toggling
"""

from __future__ import annotations

import csv
import io
import math
import re
from dataclasses import dataclass
from typing import Any

# Number word dictionary for natural conversational requests ("two strips", "5 bottles")
WORD_TO_NUMBER = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "hundred": 100,
    "ek": 1, "do": 2, "teen": 3, "char": 4, "chaar": 4, "paanch": 5, "panch": 5, "das": 10
}

INTEGRATE_VERBS = r"(?:integrate|integration|onboard|onboarding|connect|connection|setup|set\s+up|automate|automating|adopt|plug|bring|link|partner|use|using|run)"
AGENT_TARGETS = r"(?:weave|veave|agent|bot|ai|assistant|system|tool|this|platform|app)"
BUSINESS_NOUNS = r"(?:business|biz|shop|store|dukan|firm|company|retail|operations?|outlet|pharmacy|chemist)"

PHARMACY_BUSINESS_RE = re.compile(
    r"\b(?:pharmacy|medical\s*store|chemist|medicine\s*shop|medical\s*shop|pharma|apothecary|drug\s*store|dawa(?:i)?\s*(?:ki\s+)?dukan)\b",
    re.I,
)

# "paracetamol got over", "dolo 650 is out of stock", "paracetamol khatam ho gaya"
OUT_OF_STOCK_RE = re.compile(
    r"^(?:suppose\s+)?(?P<item>.+?)\s+(?:got\s+over|is\s+over|is\s+finished|is\s+empty|is\s+out\s+of\s+stock|out\s+of\s+stock|khatam\s+ho\s+gaya|khatam)[\s.!?]*$",
    re.I,
)

UPDATE_STOCK_RE = re.compile(
    r"\b(?:update|set|change)\s+(?P<item>.+?)\s+(?:stock|quantity|qty|count)\s+(?:to|=)\s+(?P<qty>\d+)\b",
    re.I,
)

INVENTORY_QUERY_RE = re.compile(
    r"\b(?:inventory|stock|items?|medicines?)\b.*\b(?:list|show|check|what|status|count)\b"
    r"|^(?:check\s+inventory|show\s+inventory|inventory|stock|show\s+stock|check\s+stock)\??$",
    re.I,
)

AUTO_PAY_ENABLE_RE = re.compile(
    r"\b(?:automate|enable\s+auto(?:mated)?|turn\s+on\s+auto(?:mated)?)\s+(?:payment\s+links?|pay\s+links?|payment)\b"
    r"|\bauto\s+(?:payment|pay)\s+link\s+on\b",
    re.I,
)

AUTO_PAY_DISABLE_RE = re.compile(
    r"\b(?:disable|turn\s+off|manual)\s+(?:auto(?:mated)?\s+)?(?:payment\s+links?|pay\s+links?)\b"
    r"|\bauto\s+(?:payment|pay)\s+link\s+off\b",
    re.I,
)

PAID_CONFIRM_RE = re.compile(
    r"\b(?:paid|payment\s+done|completed\s+payment|i\s+have\s+paid|bill\s+paid)\b.{0,30}?(?:#?MED-\d+)?",
    re.I,
)

SOFTWARE_WORDS_RE = re.compile(
    r"\b(?:apps?|application|web\s*sites?|web\s*pages?|landing\s+pages?|home\s*pages?|portfolio(?:\s+site)?|"
    r"trackers?|calculators?|planners?|journals?|timers?|counters?|games?|organizers?|"
    r"flashcards?|quizzes?|to-?do(?:\s+list)?|notes?\s+app|diaries|budgeting|apk|domain|seo)\b",
    re.I,
)

MEDICINE_UNIT_RE = re.compile(
    r"\b(?:strips?|bottles?|tablets?|boxes?|packs?|capsules?|vials?|pills?|syrups?|drops|ointments?|injections?|doses?|mg|ml)\b",
    re.I,
)

MEDICINE_QUERY_PHRASE_RE = re.compile(
    r"\b(?:where\s+can\s+i\s+(?:find|get|buy)|where\s+to\s+(?:get|find|buy)|"
    r"where\s+is\s+it\s+available|kahan\s+milega|mil\s+sakta\s+hai|"
    r"(?:medical\s+stores?|pharmacy|chemist|dawakhana|chemist\s+shop))\b",
    re.I,
)

KNOWN_MEDICINES_RE = re.compile(
    r"\b(?:paracetamol|dolo(?:[\s-]?650)?|crocin|aspirin|ibuprofen|amoxicillin|azithromycin|"
    r"cough\s+syrup|cetirizine|combiflam|pan-?d|pantocid|antacid|bandaid|vicks|insulin|"
    r"metformin|atorvastatin|augmentin|allegra|disprin|gelusil|digene)\b",
    re.I,
)

KNOWN_AREAS: dict[str, tuple[float, float]] = {
    "indiranagar": (12.9784, 77.6408),
    "koramangala": (12.9352, 77.6245),
    "whitefield": (12.9698, 77.7500),
    "hsr layout": (12.9121, 77.6446),
    "hsr": (12.9121, 77.6446),
    "jayanagar": (12.9308, 77.5838),
    "mg road": (12.9756, 77.6066),
    "marathahalli": (12.9591, 77.6974),
    "bellandur": (12.9304, 77.6784),
    "jp nagar": (12.9063, 77.5857),
    "electronic city": (12.8452, 77.6602),
    "bandra": (19.0596, 72.8295),
    "andheri": (19.1136, 72.8697),
    "connaught place": (28.6304, 77.2177),
    "bangalore": (12.9716, 77.5946),
    "bengaluru": (12.9716, 77.5946),
    "mumbai": (19.0760, 72.8777),
    "delhi": (28.6139, 77.2090),
}

LOCATION_COORD_RE = re.compile(
    r"(?:location(?:\s*pin)?|lat(?:itude)?|my\s+location|loc|q=)?\s*[:=]?\s*(-?\d{1,2}\.\d{2,8})\s*,\s*(-?\d{1,3}\.\d{2,8})",
    re.I,
)

LOCATION_MAPS_RE = re.compile(
    r"(?:maps\.google\.com|google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps)[^ \n]*[?&@q=]+(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)",
    re.I,
)


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great-circle distance between two points in kilometers."""
    R = 6371.0  # Earth's radius in kilometers
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2.0) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return round(R * c, 2)


def parse_location_pin(text: str) -> tuple[float | None, float | None, str]:
    """Parse geographic location from WhatsApp pin, Google Maps URL, coordinates, or area text.

    Returns (latitude, longitude, address/label).
    """
    clean = text.strip()
    if SOFTWARE_WORDS_RE.search(clean):
        return (None, None, "")

    # 1. Explicit LOCATION prefix from WhatsApp webhook or SMS (e.g. "LOCATION:12.9716,77.5946")
    if clean.upper().startswith("LOCATION:"):
        rest = clean[9:].strip()
        parts = rest.split(":", 1)
        coords = parts[0].strip()
        addr = parts[1].strip() if len(parts) > 1 else ""
        if "," in coords:
            lat_str, lng_str = coords.split(",", 1)
            try:
                lat = float(lat_str.strip())
                lng = float(lng_str.strip())
                return (lat, lng, addr or f"{lat:.4f}, {lng:.4f}")
            except ValueError:
                pass

    # 2. Google Maps URL
    m_maps = LOCATION_MAPS_RE.search(clean)
    if m_maps:
        try:
            return (float(m_maps.group(1)), float(m_maps.group(2)), clean)
        except ValueError:
            pass

    # 3. Direct coordinates (e.g. "12.9716, 77.5946" or "Location: 12.9716, 77.5946")
    m_coord = LOCATION_COORD_RE.search(clean)
    if m_coord:
        try:
            lat = float(m_coord.group(1))
            lng = float(m_coord.group(2))
            return (lat, lng, f"{lat:.4f}, {lng:.4f}")
        except ValueError:
            pass

    # 4. Known named areas
    clean_lower = clean.lower()
    words = clean_lower.split()
    for area, (a_lat, a_lng) in KNOWN_AREAS.items():
        if re.search(rf"\b{re.escape(area)}\b", clean_lower):
            if len(words) <= 6 or re.search(r"\b(?:location|area|living in|near|at|pin|around)\b", clean_lower):
                return (a_lat, a_lng, clean)

    # 5. Address text without coordinates
    has_addr_word = bool(re.search(r"\b(?:road|street|layout|nagar|sector|lane|circle)\b", clean_lower))
    has_loc_word = bool(re.search(r"\b(?:location|pin)\b", clean_lower))
    if (len(words) <= 8 and has_addr_word) or has_loc_word:
        return (12.9716, 77.5946, clean)

    return (None, None, "")




def parse_business_onboarding_intent(text: str) -> bool:
    """Detect if the user intends to integrate Weave or the agent into their business/shop.

    Flexible and semantic: avoids brittle presets, recognizing diverse phrasings in English and Hinglish.
    """
    clean = text.strip().lower()
    if re.search(rf"\b{INTEGRATE_VERBS}\b.{{0,40}}?\b(?:into\s+|with\s+|for\s+)?(?:my\s+|our\s+)?{BUSINESS_NOUNS}\b", clean, re.I):
        return True
    if re.search(rf"\b{INTEGRATE_VERBS}\b.{{0,30}}?\b{AGENT_WORDS}\b" if "AGENT_WORDS" in globals() else rf"\b{INTEGRATE_VERBS}\b.{{0,30}}?\b{AGENT_TARGETS}\b", clean, re.I):
        return True
    if re.search(rf"\b{AGENT_TARGETS}\b.{{0,30}}?\b{INTEGRATE_VERBS}\b", clean, re.I):
        return True
    if re.search(rf"\b(?:want|need|wish|like|how|can|could|help|start)\b.{{0,30}}?\b{AGENT_TARGETS}\b.{{0,30}}?\b{BUSINESS_NOUNS}\b", clean, re.I):
        return True
    if re.search(rf"\b(?:business|dukan|shop)\b.{{0,30}}?\b(?:weave|veave|agent|bot|ai|integrate|automation)\b", clean, re.I):
        return True
    return False


def parse_business_type(text: str) -> str | None:
    """Check if the user declared a pharmacy or medical store business."""
    clean = text.strip()
    if PHARMACY_BUSINESS_RE.search(clean):
        return "pharmacy"
    return None


def parse_amount_paise(raw: str) -> int:
    """Extract price in paise from strings like '₹20', '20 rs', 'Rs 20.50', '20'."""
    clean = raw.strip()
    m = re.search(r"(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d{1,2})?)\s*(?:rs|rupees|inr)?", clean, re.I)
    if m:
        try:
            return int(float(m.group(1)) * 100)
        except ValueError:
            return 0
    return 0


def parse_csv_inventory(csv_text: str) -> list[dict]:
    """Parse CSV text rows into structured inventory item dicts.

    Accepts header row or headerless lines:
    Item, Price, Stock, Threshold, Unit
    Paracetamol 650mg, 20, 50, 5, strip
    """
    lines = [ln.strip() for ln in csv_text.strip().splitlines() if ln.strip()]
    if not lines:
        return []

    # Check if first line contains column names
    first_row_cells = [c.strip().lower() for c in lines[0].split(",")]
    has_header = any(h in ("item", "name", "medicine", "price", "stock", "qty") for h in first_row_cells)

    reader = csv.reader(lines)
    rows = list(reader)
    if has_header and len(rows) > 1:
        headers = [c.strip().lower() for c in rows[0]]
        data_rows = rows[1:]
    else:
        headers = []
        data_rows = rows

    items: list[dict] = []
    for r in data_rows:
        if not r or not any(cell.strip() for cell in r):
            continue
        item_name = ""
        price_paise = 0
        stock = 0
        threshold = 5
        unit = "strip"

        if headers:
            for idx, h in enumerate(headers):
                if idx >= len(r):
                    break
                val = r[idx].strip()
                if "item" in h or "name" in h or "medicine" in h:
                    item_name = val
                elif "price" in h or "rate" in h or "cost" in h or "mrp" in h:
                    price_paise = parse_amount_paise(val)
                elif "stock" in h or "qty" in h or "quantity" in h:
                    digits = re.search(r"\d+", val)
                    stock = int(digits.group(0)) if digits else 0
                elif "threshold" in h or "min" in h or "reorder" in h:
                    digits = re.search(r"\d+", val)
                    threshold = int(digits.group(0)) if digits else 5
                elif "unit" in h:
                    unit = val.lower() or "strip"
        else:
            # Positional fallback: Item, Price, Stock, Threshold, Unit
            item_name = r[0].strip()
            if len(r) > 1:
                price_paise = parse_amount_paise(r[1])
            if len(r) > 2:
                digits = re.search(r"\d+", r[2])
                stock = int(digits.group(0)) if digits else 0
            if len(r) > 3:
                digits = re.search(r"\d+", r[3])
                threshold = int(digits.group(0)) if digits else 5
            if len(r) > 4:
                unit = r[4].strip().lower() or "strip"

        if item_name and price_paise > 0:
            items.append({
                "item_name": item_name,
                "price_paise": price_paise,
                "stock_quantity": stock,
                "low_stock_threshold": threshold,
                "unit": unit,
            })
    return items


def parse_single_item_addition(text: str) -> dict | None:
    """Parse single natural item additions:

    'Add 50 strips of Paracetamol 650mg at ₹20 per strip, threshold 5'
    'Add 100 strips of Dolo 650 at ₹30 each'
    'Add 20 bottles of Cough Syrup for 85 rupees'
    """
    clean = text.strip()
    if SOFTWARE_WORDS_RE.search(clean):
        return None
    if not re.search(r"\b(?:add|insert|include)\b", clean, re.I):
        return None

    # Threshold
    thresh_m = re.search(r"\b(?:threshold|min|reorder\s*level)(?:\s*(?:of|is|:|=))?\s*(\d+)\b", clean, re.I)
    threshold = int(thresh_m.group(1)) if thresh_m else 5

    # Price
    price_m = re.search(r"(?:at|for|@)\s*(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d{1,2})?)\s*(?:rs|rupees|inr|per|\/|each)?", clean, re.I)
    if not price_m:
        price_m = re.search(r"(?:₹|rs\.?)\s*(\d+(?:\.\d{1,2})?)", clean, re.I)
    if not price_m:
        return None
    price_paise = int(float(price_m.group(1)) * 100)

    # Quantity & Unit
    # e.g. "50 strips", "20 bottles", "100 tablets"
    qty_m = re.search(r"\b(\d+)\s*(strips?|bottles?|tablets?|boxes?|packs?|vials?|capsules?)\b", clean, re.I)
    if qty_m:
        qty = int(qty_m.group(1))
        unit = qty_m.group(2).lower().rstrip("s")
    else:
        # Check digit alone
        qty_alone = re.search(r"\badd\s+(\d+)\b", clean, re.I)
        qty = int(qty_alone.group(1)) if qty_alone else 10
        unit = "strip"

    # Extract item name between 'of' and 'at'/'for'
    # 'Add 50 strips of Paracetamol 650mg at ₹20 per strip'
    name_m = re.search(r"(?:of\s+)(.+?)(?=\s+(?:at|for|@|threshold|min|,|\.|\$|₹|rs\.?|\d+\s*rs))", clean, re.I)
    if name_m:
        item_name = name_m.group(1).strip()
    else:
        # 'Add Paracetamol 50 strips at 20 rs'
        name_m2 = re.search(r"add\s+(.+?)(?=\s+(\d+|at|for))", clean, re.I)
        item_name = name_m2.group(1).strip() if name_m2 else ""

    item_name = re.sub(r"\b(?:strips?|bottles?|tablets?|boxes?)\b", "", item_name, flags=re.I).strip()
    if item_name and price_paise > 0:
        return {
            "item_name": item_name,
            "price_paise": price_paise,
            "stock_quantity": qty,
            "low_stock_threshold": threshold,
            "unit": unit,
        }
    return None


def parse_inventory_update(text: str) -> tuple[str | None, int | None]:
    """Parse out of stock alerts or stock updates:

    'Paracetamol got over' -> ('Paracetamol', 0)
    'Update Paracetamol stock to 15' -> ('Paracetamol', 15)
    """
    clean = text.strip()
    m_out = OUT_OF_STOCK_RE.match(clean)
    if m_out:
        item = m_out.group("item").strip(" .!?")
        if item.lower().startswith("suppose "):
            item = item[8:].strip()
        return (item, 0)

    m_up = UPDATE_STOCK_RE.search(clean)
    if m_up:
        item = m_up.group("item").strip(" .!?")
        qty = int(m_up.group("qty"))
        return (item, qty)

    return (None, None)


def parse_medicine_search_request(text: str) -> dict | None:
    """Parse customer query looking for medicine:

    'I need two strips of paracetamol, where can I find it?'
    'Where can I find 2 strips of paracetamol?'
    'Where can I get paracetamol?'
    'Need 2 strips of paracetamol'
    """
    clean = text.strip()
    if parse_business_onboarding_intent(clean):
        return None
    if re.search(r"\b(?:add|insert|include)\b", clean, re.I):
        return None
    if OUT_OF_STOCK_RE.match(clean) or UPDATE_STOCK_RE.search(clean):
        return None

    # Never intercept software / app / website requests
    if SOFTWARE_WORDS_RE.search(clean):
        return None
    try:
        from .intent import APP_NOUNS, NEW_APP, NEW_SITE, WEBSITE_WORDS, WEB_APP
        if NEW_APP.search(clean) or NEW_SITE.search(clean) or WEB_APP.search(clean) or APP_NOUNS.search(clean) or WEBSITE_WORDS.search(clean):
            return None
    except ImportError:
        pass

    # Must have a pharmaceutical signal: unit, pharmacy query phrase, or known medicine
    has_unit = bool(MEDICINE_UNIT_RE.search(clean))
    has_phrase = bool(MEDICINE_QUERY_PHRASE_RE.search(clean))
    has_known_med = bool(KNOWN_MEDICINES_RE.search(clean))
    has_med_word = bool(re.search(r"\b(?:medicines?|dawa(?:i)?|prescription)\b", clean, re.I))

    if not (has_unit or has_phrase or has_known_med or has_med_word):
        return None

    # Quantity & Unit
    qty = 1
    unit = "strip"
    m_qty_unit = re.search(r"\b(" + "|".join(WORD_TO_NUMBER.keys()) + r"|\d+)\s+(strips?|bottles?|tablets?|boxes?|packs?|capsules?|vials?|pills?)\b", clean, re.I)
    if m_qty_unit:
        val = m_qty_unit.group(1).lower()
        qty = int(val) if val.isdigit() else WORD_TO_NUMBER.get(val, 1)
        unit = m_qty_unit.group(2).lower().rstrip("s")
    else:
        m_word_qty = re.search(r"\b(" + "|".join(WORD_TO_NUMBER.keys()) + r"|[1-9])\s+(?:of\s+)?(?=" + KNOWN_MEDICINES_RE.pattern + r")", clean, re.I)
        if m_word_qty:
            val = m_word_qty.group(1).lower()
            qty = int(val) if val.isdigit() else WORD_TO_NUMBER.get(val, 1)

    # Extract medicine name
    # Pattern 1: e.g. "two strips of paracetamol", "strips of Dolo 650"
    medicine = ""
    m1 = re.search(r"\b(?:strips?|bottles?|tablets?|boxes?|packs?|vials?|capsules?|pills?)\s+(?:of\s+)?([a-zA-Z0-9\s\.\-]+?)(?=[,\.\?!]|\s+where|\s+can|\s+kahan|\s+chahiye|\s+for|\s+at|$)", clean, re.I)
    if m1 and m1.group(1).strip():
        medicine = m1.group(1).strip()
    else:
        # Pattern 2: e.g. "where can I find/get/buy [paracetamol]" or "find [paracetamol]"
        m2 = re.search(r"\b(?:find|get|buy|have|search|available|need|want|chahiye)\s+(?:some\s+|any\s+)?([a-zA-Z0-9\s\.\-]+?)(?=[,\.\?!]|\s+where|\s+can|\s+kahan|\s+chahiye|\s+for|\s+in|\s+at|$)", clean, re.I)
        medicine = m2.group(1).strip() if m2 else ""

    if not medicine:
        # Pattern 3: Medicine before query verb, e.g. "paracetamol kahan milega"
        m3 = re.search(r"^([a-zA-Z0-9\s\.\-]+?)\s+(?:kahan\s+milega|chahiye|where\s+can|is\s+available)", clean, re.I)
        if m3:
            medicine = m3.group(1).strip()

    if not medicine and has_known_med:
        m_known = KNOWN_MEDICINES_RE.search(clean)
        if m_known:
            medicine = m_known.group(0)

    # Filler words - do NOT strip dosage numbers (e.g. 650, 625)! Only number words or single digit quantities
    filler = r"\b(?:two|three|four|five|six|seven|eight|nine|ten|one|[1-9]\b|strips?|bottles?|tablets?|boxes?|packs?|it|some|any|a|an|the|please|pls|bro|me|mujhe|urgent|urgently|kahan|milega|store|medical|pharmacy|chemist)\b"
    medicine = re.sub(filler, "", medicine, flags=re.I).strip(" ,.?!-")
    medicine = re.sub(r"\b(?:near|around|close\s+to|at|in)\s+(?:loc(?:ation)?(?:\s*pin)?|lat)?.*$", "", medicine, flags=re.I).strip(" ,.?!-")

    # Reject software or generic command keywords
    non_medicines = {"app", "new app", "web app", "website", "site", "page", "help", "status", "build", "link", "change", "project", "code", "repo", "account", "info", "test", "demo"}
    if medicine.lower() in non_medicines:
        return None

    if medicine and len(medicine) >= 3:
        lat, lon, addr = parse_location_pin(clean)
        return {
            "query": medicine,
            "quantity": max(1, qty),
            "unit": unit,
            "latitude": lat,
            "longitude": lon,
            "address": addr,
        }
    return None
