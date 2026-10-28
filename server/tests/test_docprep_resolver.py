"""Unit tests for the Specification Resolver (weave.docprep.resolver)."""

import sqlite3
import time
from unittest.mock import MagicMock, patch

import pytest
from weave.docprep.resolver import (
    CACHE_SCHEMA,
    ExamSpecs,
    ItemSpec,
    fetch_search_snippets,
    parse_explicit_numbers,
    resolve_specs,
)


def test_regex_fast_path_ranges():
    """Verify numeric ranges in English & Hinglish are parsed instantly (0 tokens)."""
    # 20 to 50 kb
    s1 = parse_explicit_numbers("bhai ye photo 20 to 50 kb me chahiye")
    assert s1 is not None
    assert s1.photo.min_kb == 20
    assert s1.photo.max_kb == 50

    # 20-50 kb
    s2 = parse_explicit_numbers("size 20-50 kb")
    assert s2 is not None
    assert s2.photo.min_kb == 20
    assert s2.photo.max_kb == 50

    # Hinglish 'se'
    s3 = parse_explicit_numbers("20 se 50 kb kardo")
    assert s3 is not None
    assert s3.photo.min_kb == 20
    assert s3.photo.max_kb == 50


def test_regex_fast_path_max_ceilings():
    """Verify 'under', 'below', 'se kam', 'max' expressions."""
    s1 = parse_explicit_numbers("photo under 50 kb")
    assert s1 is not None
    assert s1.photo.max_kb == 50

    s2 = parse_explicit_numbers("50 kb se kam")
    assert s2 is not None
    assert s2.photo.max_kb == 50

    s3 = parse_explicit_numbers("maximum 100 kb")
    assert s3 is not None
    assert s3.photo.max_kb == 100


def test_regex_fast_path_dimensions():
    """Verify exact pixel dimensions (e.g. 200x230)."""
    s = parse_explicit_numbers("photo 200x230 px and 20 to 50 kb")
    assert s is not None
    assert s.photo.target_width == 200
    assert s.photo.target_height == 230
    assert s.photo.min_kb == 20
    assert s.photo.max_kb == 50


def test_regex_fast_path_signature_and_pdf():
    """Verify signature vs document/PDF intent routing."""
    # Signature
    s1 = parse_explicit_numbers("signature 10-20 kb")
    assert s1 is not None
    assert s1.signature.min_kb == 10
    assert s1.signature.max_kb == 20

    # PDF Document
    s2 = parse_explicit_numbers("marksheet pdf under 200 kb")
    assert s2 is not None
    assert s2.document.max_kb == 200
    assert s2.document.format == "pdf"


def test_regex_fast_path_ignores_named_exams():
    """If user specifies an exam name (e.g. 'SSC CGL 50kb'), fast-path returns None so resolver searches/caches."""
    assert parse_explicit_numbers("SSC CGL photo 50 kb") is None
    assert parse_explicit_numbers("UPSC prelims signature") is None
    assert parse_explicit_numbers("BPSC 70th 20 to 50 kb") is None


def test_sqlite_30_day_cache_hits():
    """Verify SQLite cache stores and retrieves specs with 0 tokens and no search."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(CACHE_SCHEMA)

    # 1. Store mock specs in cache
    now = time.time()
    mock_specs = ExamSpecs(
        exam_name="bpsc 70th",
        photo=ItemSpec(doc_type="photo", min_kb=25, max_kb=100, aspect_ratio=[3.5, 4.5]),
        signature=ItemSpec(doc_type="signature", min_kb=10, max_kb=30, aspect_ratio=[4.0, 2.0]),
        source_note="Cached Official Notice",
    )
    conn.execute(
        "INSERT INTO exam_specs_cache (query_key, specs_json, source_title, created_at, expires_at) "
        "VALUES (?, ?, ?, ?, ?)",
        ("bpsc 70th", mock_specs.model_dump_json(), "Cached Notice", now, now + (30 * 86400)),
    )

    # 2. Resolve specs: should hit cache with no AI call
    mock_ai = MagicMock()
    result = resolve_specs("BPSC 70th ke liye photo resize kar do", ai=mock_ai, db=conn)

    assert result.photo.min_kb == 25
    assert result.photo.max_kb == 100
    assert result.signature.min_kb == 10
    assert result.signature.max_kb == 30
    assert result.source_note == "Cached Official Notice"
    # Ensure AI was never called (0 tokens)
    mock_ai.ask.assert_not_called()


def test_ai_extraction_and_cache_population():
    """When cache misses, AI is invoked to extract specs from search and populates cache."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(CACHE_SCHEMA)

    mock_ai = MagicMock()
    extracted_specs = ExamSpecs(
        exam_name="navy agniveer",
        photo=ItemSpec(doc_type="photo", min_kb=10, max_kb=50),
        signature=ItemSpec(doc_type="signature", min_kb=10, max_kb=20),
        source_note="Extracted from Navy Agniveer Guidelines",
    )
    mock_ai.ask.return_value = (extracted_specs, {"seconds": 0.5})

    with patch("weave.docprep.resolver.fetch_search_snippets", return_value="Photo 10-50 KB, Signature 10-20 KB"):
        res = resolve_specs("Navy Agniveer GD form", ai=mock_ai, db=conn)

    assert res.photo.min_kb == 10
    assert res.photo.max_kb == 50
    mock_ai.ask.assert_called_once()

    # Verify it was cached in SQLite
    row = conn.execute("SELECT * FROM exam_specs_cache WHERE query_key = 'navy agniveer'").fetchone()
    assert row is not None


def test_resolver_fallback_defaults_when_offline():
    """When search and AI are unavailable, return sensible official Indian defaults."""
    res = resolve_specs("Unknown State Exam 2026", ai=None, db=None)
    assert res.photo.min_kb == 20
    assert res.photo.max_kb == 50
    assert res.signature.min_kb == 10
    assert res.signature.max_kb == 20
    assert res.document.max_kb == 200
