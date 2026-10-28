"""Tests for Docprep storage mixin, tokens, and /doc/ download route."""

import io
import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from weave.config import Settings
from weave.sms.routes import build_router
from weave.sms.store import SmsStore


@pytest.fixture
def store(tmp_path: Path) -> SmsStore:
    db_path = tmp_path / "sms.sqlite3"
    return SmsStore(db_path)


def test_save_and_retrieve_docprep_file(store: SmsStore, tmp_path: Path):
    """Ensure docprep file is written to disk and can be fetched via token."""
    raw_data = b"\xff\xd8\xff\xe0fake_jpeg_content"
    raw_token, row = store.save_docprep_file(
        phone="+919876543210",
        filename="bpsc_photo.jpg",
        doc_type="photo",
        data=raw_data,
        mime_type="image/jpeg",
        ttl_hours=72.0,
    )

    assert len(raw_token) >= 20
    assert row["filename"] == "bpsc_photo.jpg"
    assert row["doc_type"] == "photo"
    assert row["file_bytes"] == len(raw_data)

    # Check file exists on disk
    disk_file = tmp_path / row["file_path"]
    assert disk_file.is_file()
    assert disk_file.read_bytes() == raw_data

    # Fetch via token
    status, fetched = store.get_docprep_file(raw_token)
    assert status == "ok"
    assert fetched is not None
    assert fetched["downloads_count"] == 1

    # Fetch again: downloads_count increments
    status2, fetched2 = store.get_docprep_file(raw_token)
    assert status2 == "ok"
    assert fetched2["downloads_count"] == 2


def test_get_unknown_or_expired_docprep_file(store: SmsStore):
    """Ensure invalid token returns unknown, and expired token returns expired."""
    status, row = store.get_docprep_file("nonexistent_token_123456789")
    assert status == "unknown"
    assert row is None

    # Save with negative TTL (already expired)
    raw_token, _ = store.save_docprep_file(
        phone="+919876543210",
        filename="expired.jpg",
        doc_type="photo",
        data=b"test",
        mime_type="image/jpeg",
        ttl_hours=-1.0,
    )
    status_exp, row_exp = store.get_docprep_file(raw_token)
    assert status_exp == "expired"
    assert row_exp is not None


def test_purge_expired_docprep_files(store: SmsStore, tmp_path: Path):
    """Ensure housekeeping permanently deletes expired records and disk files."""
    # Active file
    t_active, r_active = store.save_docprep_file(
        phone="+919876543210",
        filename="active.jpg",
        doc_type="photo",
        data=b"active",
        mime_type="image/jpeg",
        ttl_hours=72.0,
    )
    # Expired file
    t_expired, r_expired = store.save_docprep_file(
        phone="+919876543210",
        filename="expired.jpg",
        doc_type="photo",
        data=b"expired",
        mime_type="image/jpeg",
        ttl_hours=-1.0,
    )

    f_active = tmp_path / r_active["file_path"]
    f_expired = tmp_path / r_expired["file_path"]
    assert f_active.is_file()
    assert f_expired.is_file()

    purged = store.purge_expired_docprep_files()
    assert purged == 1

    # Active remains, expired is gone
    assert f_active.is_file()
    assert not f_expired.is_file()
    assert store.get_docprep_file(t_active)[0] == "ok"
    assert store.get_docprep_file(t_expired)[0] == "unknown"


def test_docprep_fastapi_route(store: SmsStore, tmp_path: Path):
    """Test HTTP GET /doc/{token}/{filename} endpoint."""
    settings = Settings(data_dir=tmp_path, public_base_url="https://app.askweave.xyz")
    from unittest.mock import MagicMock
    mock_service = MagicMock()
    mock_provider = MagicMock()
    mock_builds = MagicMock()

    app = FastAPI()
    router = build_router(settings, store, mock_service, mock_provider, mock_builds)
    app.include_router(router)
    client = TestClient(app)

    # 1. Unknown token -> 404
    r_404 = client.get("/doc/unknown_token_1234567890/test.jpg")
    assert r_404.status_code == 404

    # 2. Save file and download -> 200
    jpeg_bytes = b"\xff\xd8\xff\xe0test_content_for_route"
    token, _ = store.save_docprep_file(
        phone="+919876543210",
        filename="ssc_cgl_photo.jpg",
        doc_type="photo",
        data=jpeg_bytes,
        mime_type="image/jpeg",
    )
    resp = client.get(f"/doc/{token}/ssc_cgl_photo.jpg")
    assert resp.status_code == 200
    assert resp.content == jpeg_bytes
    assert resp.headers["content-type"] == "image/jpeg"
    assert "private, no-store" in resp.headers["cache-control"]
    assert 'inline; filename="ssc_cgl_photo.jpg"' in resp.headers["content-disposition"]

    # 3. Expired token -> 410
    exp_token, _ = store.save_docprep_file(
        phone="+919876543210",
        filename="old.jpg",
        doc_type="photo",
        data=b"old",
        mime_type="image/jpeg",
        ttl_hours=-1.0,
    )
    r_410 = client.get(f"/doc/{exp_token}/old.jpg")
    assert r_410.status_code == 410
