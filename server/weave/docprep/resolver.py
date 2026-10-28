"""Specification Resolver for Government Forms and Exams.

Resolves file size (KB), aspect ratio, dimensions, and format using:
1. Fast-path regex for direct user numbers ("under 50kb", "20-50 kb") -> 0 tokens.
2. 30-day SQLite cache for previously searched exams -> 0 tokens.
3. Live web search snippets + AI extraction for any named exam -> ~400 tokens.
4. Robust fallbacks for offline / rate-limited situations.
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Literal
from urllib.parse import quote_plus

import httpx
from pydantic import BaseModel, Field

log = logging.getLogger("weave.docprep.resolver")


class ItemSpec(BaseModel):
    doc_type: str = Field(default="photo", description="'photo', 'signature', or 'document'")
    min_kb: int = Field(default=20, ge=0, description="Minimum allowed size in KB")
    max_kb: int = Field(default=50, ge=1, description="Maximum allowed size in KB")
    aspect_ratio: list[float] | None = Field(default=None, description="[width, height] ratio e.g. [3.5, 4.5]")
    target_width: int | None = Field(default=None, description="Exact target width in pixels")
    target_height: int | None = Field(default=None, description="Exact target height in pixels")
    format: str = Field(default="jpeg", description="'jpeg' or 'pdf'")
    dpi: int = Field(default=200, description="Target DPI")


class ExamSpecs(BaseModel):
    exam_name: str | None = Field(default=None, description="Name of the exam/portal or null")
    photo: ItemSpec = Field(default_factory=lambda: ItemSpec(doc_type="photo", min_kb=20, max_kb=50, aspect_ratio=[3.5, 4.5]))
    signature: ItemSpec = Field(default_factory=lambda: ItemSpec(doc_type="signature", min_kb=10, max_kb=20, aspect_ratio=[4.0, 2.0]))
    document: ItemSpec = Field(default_factory=lambda: ItemSpec(doc_type="document", min_kb=50, max_kb=200, format="pdf"))
    source_note: str | None = Field(default=None, description="Explanation or citation of the specification")


# ---------- 1. Fast-Path Regex Matchers (0 Tokens) ----------

RANGE_RE = re.compile(
    r"\b(\d{1,4})\s*(?:-|to|se|aur|and)\s*(\d{1,4})\s*(?:k[bB]|kilo\s*bytes?)\b",
    re.I,
)

MAX_ONLY_RE = re.compile(
    r"\b(?:under|below|max|maximum|less\s+than|<|upto|up\s+to|se\s+kam|tak)\s*(\d{1,4})\s*(?:k[bB]|kilo\s*bytes?)\b"
    r"|\b(\d{1,4})\s*(?:k[bB]|kilo\s*bytes?)\s*(?:max|maximum|se\s+kam|tak|under|below)\b",
    re.I,
)

EXACT_DIMS_RE = re.compile(
    r"\b(\d{2,4})\s*(?:x|\*|by)\s*(\d{2,4})\s*(?:px|pixels?)?\b",
    re.I,
)

ASPECT_RE = re.compile(
    r"\b(\d+(?:\.\d+)?)\s*(?::|x|\*)\s*(\d+(?:\.\d+)?)\s*(?:cm|mm)?\b",
    re.I,
)

EXAM_HINT_WORDS = re.compile(
    r"\b(ssc|cgl|chsl|mts|gd|upsc|nda|cds|cse|ias|ips|ibps|sbi|po|clerk|rrb|railway|ntpc|"
    r"parivahan|sarathi|rto|driving\s+license|dl|passport|visa|nta|neet|jee|cuet|ugc|net|"
    r"bpsc|uppsc|mpsc|kpsc|rpsc|patwari|police|constable|agniveer|army|navy|airforce|"
    r"fssai|udyam|msme|gate|cat)\b",
    re.I,
)


def parse_explicit_numbers(text: str) -> ExamSpecs | None:
    """Fast regex parse for direct numerical constraints in English/Hinglish.
    Returns ExamSpecs if purely explicit numbers without ambiguous exam names.
    """
    if not text or not text.strip():
        return None

    cleaned = text.strip()

    # If the user mentioned an exam name, don't do pure-regex shortcut (let search/cache handle)
    if EXAM_HINT_WORDS.search(cleaned):
        return None

    # Check for dimension (e.g. 200x230)
    dims_match = EXACT_DIMS_RE.search(cleaned)
    target_w, target_h = None, None
    if dims_match:
        w_val, h_val = int(dims_match.group(1)), int(dims_match.group(2))
        if 40 <= w_val <= 4000 and 40 <= h_val <= 4000:
            target_w, target_h = w_val, h_val

    # Check for Range: e.g. 20-50 kb
    range_match = RANGE_RE.search(cleaned)
    if range_match:
        lo = int(range_match.group(1))
        hi = int(range_match.group(2))
        min_kb, max_kb = (lo, hi) if lo <= hi else (hi, lo)

        is_sig = bool(re.search(r"\b(sign|signature|hastakshar)\b", cleaned, re.I))
        is_doc = bool(re.search(r"\b(pdf|doc|document|certificate|marksheet|aadhaar)\b", cleaned, re.I))

        specs = ExamSpecs(source_note="Explicit range in user request")
        if is_sig:
            specs.signature.min_kb = min_kb
            specs.signature.max_kb = max_kb
            specs.signature.target_width = target_w
            specs.signature.target_height = target_h
        elif is_doc:
            specs.document.min_kb = min_kb
            specs.document.max_kb = max_kb
            specs.document.format = "pdf" if "pdf" in cleaned.lower() else "jpeg"
        else:
            specs.photo.min_kb = min_kb
            specs.photo.max_kb = max_kb
            specs.photo.target_width = target_w
            specs.photo.target_height = target_h
        return specs

    # Check for Max Only: e.g. under 50 kb
    max_match = MAX_ONLY_RE.search(cleaned)
    if max_match:
        val_str = max_match.group(1) or max_match.group(2)
        max_kb = int(val_str)
        min_kb = max(0, int(max_kb * 0.4)) if max_kb > 30 else 0

        is_sig = bool(re.search(r"\b(sign|signature|hastakshar)\b", cleaned, re.I))
        is_doc = bool(re.search(r"\b(pdf|doc|document|certificate|marksheet|aadhaar)\b", cleaned, re.I))

        specs = ExamSpecs(source_note="Explicit maximum in user request")
        if is_sig:
            specs.signature.min_kb = min(10, min_kb)
            specs.signature.max_kb = max_kb
            specs.signature.target_width = target_w
            specs.signature.target_height = target_h
        elif is_doc:
            specs.document.min_kb = 0
            specs.document.max_kb = max_kb
            specs.document.format = "pdf" if "pdf" in cleaned.lower() else "jpeg"
        else:
            specs.photo.min_kb = min_kb
            specs.photo.max_kb = max_kb
            specs.photo.target_width = target_w
            specs.photo.target_height = target_h
        return specs

    return None


# ---------- 2. Live Web Search Snippet Fetcher ----------

SEARCH_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}


def fetch_search_snippets(exam_query: str, timeout_s: float = 6.0) -> str:
    """Fetch search result text snippets from DuckDuckGo for the exam notification.
    Zero API keys, completely free, fast (~0.5s).
    """
    clean_q = f"{exam_query} official notification photo signature size dimensions specifications"
    url = "https://html.duckduckgo.com/html/"
    try:
        with httpx.Client(timeout=timeout_s, follow_redirects=True) as client:
            resp = client.post(url, data={"q": clean_q}, headers=SEARCH_HEADERS)
            if resp.status_code != 200:
                log.warning("DuckDuckGo search returned %d for %s", resp.status_code, exam_query)
                return ""
            html = resp.text
            # Extract result snippets
            raw_snippets = re.findall(r"<a class=\"result__snippet\"[^>]*>(.*?)</a>", html, re.DOTALL)
            clean_snippets = []
            for s in raw_snippets[:4]:
                text = re.sub(r"<[^>]+>", "", s).strip()
                if text:
                    clean_snippets.append(text)
            return "\n\n".join(clean_snippets)
    except Exception as e:
        log.warning("Web search failed for query '%s': %s", exam_query, e)
        return ""


# ---------- 3. AI Extraction Prompt ----------

AI_SYSTEM = """You are an expert assistant that extracts Indian government recruitment and exam portal upload specifications.
Given search snippets or user text, extract the exact file size limits (KB), dimensions, aspect ratio, and formats for:
1. Photograph (photo)
2. Signature (signature)
3. Document/Certificate (document)

Rules:
- min_kb and max_kb must be integers in kilobytes.
- If an exact range is given (e.g. "20 to 50 KB"), set min_kb=20, max_kb=50.
- If only "under 50 KB" is stated, set min_kb=10 (or 20 for photos), max_kb=50.
- Aspect ratio for standard Indian passport photos is usually [3.5, 4.5] unless square [1.0, 1.0].
- Signature aspect ratio is typically [4.0, 2.0] or [140, 60].
- Documents are typically PDF under 200 KB or 300 KB.
- If any detail is missing from the text, supply standard Indian official defaults rather than null.
- Provide a short 1-line source_note summarizing the official guidelines found.
Answer with valid JSON matching the schema."""


# ---------- 4. SQLite Cache Helper ----------

CACHE_SCHEMA = """
CREATE TABLE IF NOT EXISTS exam_specs_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query_key TEXT UNIQUE NOT NULL,
    specs_json TEXT NOT NULL,
    source_title TEXT,
    created_at REAL NOT NULL,
    expires_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exam_specs_query ON exam_specs_cache(query_key);
"""


def _normalize_query_key(text: str) -> str:
    """Normalize exam name for cache lookup (e.g. 'BPSC 70th Prelims' -> 'bpsc 70th')."""
    t = text.lower()
    # Strip common conversational / filler words
    t = re.sub(
        r"\b(ke|liye|photo|signature|sign|form|resize|kardo|kar|bana|banao|do|de|dijiye|chahiye|size|ka|ki|ko|me|mein|under|please|plz)\b",
        " ",
        t,
    )
    # Collapse whitespace and punctuation
    t = re.sub(r"[^\w\s]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t[:80]


# ---------- 5. Main Unified Resolver ----------

def resolve_specs(
    text: str,
    ai=None,
    db=None,
    doc_type_hint: str = "photo",
) -> ExamSpecs:
    """Resolve upload specifications for any user request or exam name.

    1. Fast-path: Check explicit regex numbers (0 tokens).
    2. Cache-path: Check SQLite 30-day cache for the exam (0 tokens).
    3. Web-path: Live search + AI snippet extraction (~400 tokens).
    4. Fallback: Sensible official Indian portal defaults.
    """
    cleaned = (text or "").strip()

    # 1. Direct numbers fast-path
    explicit = parse_explicit_numbers(cleaned)
    if explicit is not None:
        return explicit

    # 2. Extract potential exam name
    norm_key = _normalize_query_key(cleaned)
    now = time.time()

    # 3. Check SQLite cache (exact or substring match)
    if db is not None and norm_key:
        try:
            row = db.execute(
                "SELECT specs_json, expires_at FROM exam_specs_cache "
                "WHERE query_key = ? OR ? LIKE ('%' || query_key || '%') "
                "ORDER BY length(query_key) DESC LIMIT 1",
                (norm_key, norm_key),
            ).fetchone()
            if row:
                exp = row["expires_at"] if isinstance(row, dict) or hasattr(row, "keys") else row[1]
                raw_json = row["specs_json"] if isinstance(row, dict) or hasattr(row, "keys") else row[0]
                if exp > now:
                    data = json.loads(raw_json)
                    return ExamSpecs.model_validate(data)
        except Exception as e:
            log.warning("Cache lookup failed for %s: %s", norm_key, e)

    # 4. Search web snippets
    snippets = ""
    if norm_key:
        snippets = fetch_search_snippets(cleaned)

    # 5. Extract with AI if available
    if ai is not None:
        user_prompt = f"Exam/Request: {cleaned}\n\nSearch Snippets from Official Guidelines:\n{snippets or 'None available'}"
        try:
            specs, _ = ai.ask(
                AI_SYSTEM,
                user_prompt,
                ExamSpecs,
                title="Exam Specs Resolver",
                timeout=10,
            )
            # Save to cache if we have a db
            if db is not None and norm_key:
                cache_key = _normalize_query_key(specs.exam_name) if specs.exam_name else norm_key
                cache_key = cache_key or norm_key
                try:
                    db.execute(
                        "INSERT OR REPLACE INTO exam_specs_cache "
                        "(query_key, specs_json, source_title, created_at, expires_at) "
                        "VALUES (?, ?, ?, ?, ?)",
                        (cache_key, specs.model_dump_json(), specs.source_note, now, now + (30 * 86400)),
                    )
                except Exception as e:
                    log.warning("Failed to cache specs for %s: %s", cache_key, e)
            return specs
        except Exception as e:
            log.warning("AI extraction failed for %s: %s", cleaned, e)

    # 6. Fallback defaults if no AI or network
    return ExamSpecs(
        exam_name=cleaned or "General Portal",
        photo=ItemSpec(doc_type="photo", min_kb=20, max_kb=50, aspect_ratio=[3.5, 4.5]),
        signature=ItemSpec(doc_type="signature", min_kb=10, max_kb=20, aspect_ratio=[4.0, 2.0]),
        document=ItemSpec(doc_type="document", min_kb=50, max_kb=200, format="pdf"),
        source_note="Standard Indian government portal defaults (Photo: 20-50 KB, Signature: 10-20 KB, Doc: <200 KB PDF)",
    )
