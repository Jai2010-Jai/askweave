"""Tests for the Universal Image Constraint Solver (weave.docprep.solver)."""

import io
from PIL import Image, ImageDraw

import pytest
from weave.docprep.solver import SolveResult, process_media


def _create_test_image(width: int = 1200, height: int = 1600, color: str = "rgb", pattern: str = "portrait") -> bytes:
    """Helper to synthesize test images of various textures and sizes."""
    if pattern == "portrait":
        # Simulate a person portrait: background + head circle + body rectangle
        img = Image.new("RGB", (width, height), (220, 230, 242))  # light blue wall
        draw = ImageDraw.Draw(img)
        # Face / head
        cx, cy = width // 2, height // 3
        r = width // 4
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(210, 160, 130))  # skin tone
        # Hair
        draw.arc([cx - r, cy - r, cx + r, cy], 180, 360, fill=(40, 30, 20), width=width // 15)
        # Eyes
        eye_y = cy - r // 8
        draw.ellipse([cx - r // 2, eye_y, cx - r // 3, eye_y + r // 6], fill=(20, 20, 20))
        draw.ellipse([cx + r // 3, eye_y, cx + r // 2, eye_y + r // 6], fill=(20, 20, 20))
        # Shirt / body
        draw.rectangle([cx - width // 2, cy + r, cx + width // 2, height], fill=(50, 70, 120))
    elif pattern == "signature":
        # Simulate signature on paper: dim paper background with dark blue ink strokes
        img = Image.new("RGB", (width, height), (235, 230, 220))  # slightly dim off-white paper
        draw = ImageDraw.Draw(img)
        # Draw some curved strokes mimicking a cursive signature
        points = [
            (width * 0.2, height * 0.5),
            (width * 0.35, height * 0.25),
            (width * 0.45, height * 0.7),
            (width * 0.6, height * 0.35),
            (width * 0.75, height * 0.6),
            (width * 0.85, height * 0.45),
        ]
        draw.line(points, fill=(15, 25, 75), width=max(3, width // 100))
        # Add underline stroke
        draw.line([(width * 0.2, height * 0.75), (width * 0.85, height * 0.75)], fill=(15, 25, 75), width=max(2, width // 120))
    elif pattern == "document":
        # Simulate marksheet / text document
        img = Image.new("RGB", (width, height), (245, 245, 245))
        draw = ImageDraw.Draw(img)
        # Draw text lines
        for y in range(int(height * 0.1), int(height * 0.9), max(10, height // 30)):
            draw.line([(width * 0.1, y), (width * 0.9, y)], fill=(60, 60, 60), width=max(1, height // 400))
    else:
        img = Image.new("RGB", (width, height), (200, 200, 200))

    if color == "rgba":
        img = img.convert("RGBA")

    buf = io.BytesIO()
    img.save(buf, format="PNG" if color == "rgba" else "JPEG", quality=90)
    return buf.getvalue()


def test_photo_compression_within_strict_bounds():
    """Ensure a large photo strictly hits between min_kb and max_kb."""
    raw = _create_test_image(width=2000, height=2500, pattern="portrait")
    res = process_media(raw, doc_type="photo", min_kb=20, max_kb=50, aspect_ratio=(3.5, 4.5))

    assert isinstance(res, SolveResult)
    assert res.format == "jpeg"
    assert res.mime_type == "image/jpeg"
    # Guaranteed bounds check
    assert 20 * 1024 <= res.file_bytes <= 50 * 1024
    assert res.dpi == 200
    # Check aspect ratio proportion 3.5:4.5 ~ 0.777
    ratio = res.width / res.height
    assert abs(ratio - (3.5 / 4.5)) < 0.05


def test_photo_with_exact_pixel_dimensions():
    """Ensure exact pixel dimensions (e.g. IBPS 200x230 px) are respected."""
    raw = _create_test_image(width=1000, height=1200, pattern="portrait")
    res = process_media(
        raw,
        doc_type="photo",
        min_kb=20,
        max_kb=50,
        target_width=200,
        target_height=230,
    )

    assert res.width == 200
    assert res.height == 230
    assert res.file_bytes <= 50 * 1024


def test_photo_name_and_date_banner():
    """Ensure name and date strip renders on the photo."""
    raw = _create_test_image(width=600, height=800, pattern="portrait")
    res = process_media(
        raw,
        doc_type="photo",
        min_kb=20,
        max_kb=60,
        name_on_photo="Rahul Sharma",
        date_on_photo="15/10/2026",
    )

    assert res.file_bytes <= 60 * 1024
    # Load processed image and verify bottom strip is white with text
    processed_img = Image.open(io.BytesIO(res.data))
    w, h = processed_img.size
    # Bottom strip pixels should contain white pixels
    bottom_pixel = processed_img.getpixel((w - 5, h - 5))
    assert bottom_pixel[0] > 200 and bottom_pixel[1] > 200 and bottom_pixel[2] > 200


def test_signature_bounding_box_and_whitening():
    """Ensure signature is cropped to ink strokes, paper is whitened, and size is in [10, 20] KB."""
    raw = _create_test_image(width=1200, height=600, pattern="signature")
    res = process_media(
        raw,
        doc_type="signature",
        min_kb=10,
        max_kb=20,
        aspect_ratio=(4.0, 2.0),
    )

    assert res.doc_type == "signature"
    assert 10 * 1024 <= res.file_bytes <= 20 * 1024
    # Loaded image should have clean white background near edges
    processed_img = Image.open(io.BytesIO(res.data))
    corner = processed_img.getpixel((5, 5))
    assert corner == (255, 255, 255)


def test_signature_exact_dimensions():
    """Ensure signature with exact dimensions (e.g. Parivahan 256x64 px)."""
    raw = _create_test_image(width=1000, height=500, pattern="signature")
    res = process_media(
        raw,
        doc_type="signature",
        min_kb=10,
        max_kb=20,
        target_width=256,
        target_height=64,
    )

    assert res.width == 256
    assert res.height == 64
    assert res.file_bytes <= 20 * 1024


def test_document_to_pdf_conversion():
    """Ensure document converts to PDF and strictly stays under max_kb (e.g. 200 KB)."""
    raw = _create_test_image(width=1800, height=2400, pattern="document")
    res = process_media(
        raw,
        doc_type="document",
        min_kb=50,
        max_kb=200,
        output_format="pdf",
    )

    assert res.format == "pdf"
    assert res.mime_type == "application/pdf"
    assert res.file_bytes <= 200 * 1024
    # Check PDF header
    assert res.data.startswith(b"%PDF")


def test_transparent_png_input_handles_gracefully():
    """Ensure PNGs with transparency composite onto pure white without black artifacts."""
    raw_rgba = _create_test_image(width=500, height=500, color="rgba", pattern="portrait")
    res = process_media(raw_rgba, doc_type="photo", min_kb=10, max_kb=40)

    assert res.format == "jpeg"
    assert res.file_bytes <= 40 * 1024
    processed_img = Image.open(io.BytesIO(res.data))
    assert processed_img.mode == "RGB"


def test_invalid_inputs_raise_value_errors():
    """Check defensive validation for bad inputs."""
    with pytest.raises(ValueError, match="empty"):
        process_media(b"")

    with pytest.raises(ValueError, match="max_kb must be greater than 0"):
        process_media(b"fake", max_kb=0)

    with pytest.raises(ValueError, match="Could not decode image file"):
        process_media(b"not an image file content", max_kb=50)


def test_solver_swaps_inverted_kb_bounds():
    """If user or caller provides min_kb > max_kb, solver handles gracefully."""
    raw = _create_test_image(width=600, height=800, pattern="portrait")
    res = process_media(raw, min_kb=50, max_kb=20)
    assert 20 * 1024 <= res.file_bytes <= 50 * 1024


def test_zero_min_kb_under_ceiling_only():
    """When user requests 'under 50 KB' (min_kb=0), ensure it never exceeds max_kb."""
    raw = _create_test_image(width=1500, height=2000, pattern="portrait")
    res = process_media(raw, min_kb=0, max_kb=50)
    assert res.file_bytes <= 50 * 1024
    assert res.file_bytes > 0


def test_huge_phone_photo_compression():
    """Simulate a modern 4000x3000 high-res camera photo compressing strictly into [20, 50] KB."""
    raw = _create_test_image(width=4000, height=3000, pattern="portrait")
    res = process_media(raw, min_kb=20, max_kb=50)
    assert 20 * 1024 <= res.file_bytes <= 50 * 1024
    # Loaded image is intact
    img = Image.open(io.BytesIO(res.data))
    assert img.size[0] > 0 and img.size[1] > 0

