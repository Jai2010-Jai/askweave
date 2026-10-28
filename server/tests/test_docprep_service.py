"""End-to-End Service Tests for Government Form Photo & Document Resizer on WhatsApp / SMS."""

import io
from PIL import Image, ImageDraw
import pytest

from test_sms import OWNER
from test_unified import u  # noqa: F401 - fixture
from weave.sms.service import Inbound


def _create_portrait_jpeg(width: int = 800, height: int = 1000) -> bytes:
    img = Image.new("RGB", (width, height), (225, 235, 245))
    draw = ImageDraw.Draw(img)
    cx, cy, r = width // 2, height // 3, width // 4
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(210, 160, 130))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def test_docprep_single_turn_flow(u):
    """User uploads photo with caption: formatted immediately and link returned."""
    sample_jpeg = _create_portrait_jpeg()
    sid = "MM11112222333344445555666677778888"

    msg = Inbound(
        from_=OWNER,
        to="+12065550100",
        body="BPSC 70th photo under 50kb",
        sid=sid,
        num_media=1,
        media_data=sample_jpeg,
    )
    outcome = u.sms.service.handle(msg)
    assert outcome == "docprep_processed"

    reply = u.last()
    assert "Photo ready hai!" in reply
    assert "Direct download link:" in reply
    assert "/doc/" in reply

    # Extract download URL path and verify HTTP download works
    doc_path = None
    for word in reply.split():
        if "/doc/" in word:
            doc_path = "/doc/" + word.split("/doc/")[-1].strip()
            break
    assert doc_path is not None

    resp = u.client.get(doc_path)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/jpeg"
    assert len(resp.content) <= 50 * 1024
    assert len(resp.content) > 0


def test_docprep_two_turn_flow(u):
    """Turn 1: User uploads photo without text -> Weave stages and asks for exam.
    Turn 2: User names exam -> Weave completes processing and returns link."""
    sample_jpeg = _create_portrait_jpeg()
    sid = "MM99998888777766665555444433332222"

    # Turn 1: Media only
    msg = Inbound(
        from_=OWNER,
        to="+12065550100",
        body="[image]",
        sid=sid,
        num_media=1,
        media_data=sample_jpeg,
    )
    outcome1 = u.sms.service.handle(msg)
    assert outcome1 == "docprep_staged"

    prompt_reply = u.last()
    assert "Photo mil gayi!" in prompt_reply
    assert "Kiske liye format karni hai?" in prompt_reply

    # Verify user state is waiting for exam
    user = u.user(OWNER)
    assert user["pending_question"] == "docprep_exam"
    assert user["pending_text"] is not None

    # Turn 2: User responds with exam name / requirements
    outcome2 = u.text(OWNER, "under 50kb")
    assert outcome2.status_code == 200

    final_reply = u.last()
    assert "Photo ready hai!" in final_reply
    assert "/doc/" in final_reply

    # Verify pending state cleared
    user_after = u.user(OWNER)
    assert user_after["pending_question"] is None
    assert user_after["pending_text"] is None

    # Verify downloaded image is valid and under 50 KB
    for word in final_reply.split():
        if "/doc/" in word:
            doc_path = "/doc/" + word.split("/doc/")[-1].strip()
            resp = u.client.get(doc_path)
            assert resp.status_code == 200
            assert len(resp.content) <= 50 * 1024
            break


def test_docprep_spec_query_without_media(u):
    """User asks for guidelines/sizes for an exam without uploading an image."""
    resp = u.text(OWNER, "SSC CGL photo size kitna hona chahiye?")
    assert resp.status_code == 200

    reply = u.last()
    assert "requirements:" in reply
    assert "Photo:" in reply
    assert "Signature:" in reply
    assert "Apni photo ya signature yahan bhejo" in reply
