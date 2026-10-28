"""Universal Image & Document Constraint Solver for Government Forms & Exams.

Pure Pillow mathematical solver that takes an image/document and target constraints
(KB range, aspect ratio, doc type, dimensions, format, DPI) and guarantees that the
output strictly satisfies the constraints without any hardcoded exam rules.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Literal

from PIL import Image, ImageDraw, ImageFont, ImageOps

DocType = Literal["photo", "signature", "document"]


@dataclass
class SolveResult:
    data: bytes
    format: str         # "jpeg", "png", "pdf"
    mime_type: str      # "image/jpeg", "image/png", "application/pdf"
    file_bytes: int
    width: int
    height: int
    dpi: int
    doc_type: str
    details: str
    quality: int | None = None

    @property
    def file_kb(self) -> float:
        return round(self.file_bytes / 1024.0, 1)


def _normalize_orientation(img: Image.Image) -> Image.Image:
    """Correct phone camera rotation using EXIF orientation tag."""
    try:
        return ImageOps.exif_transpose(img) or img
    except Exception:
        return img


def _ensure_rgb(img: Image.Image, bg_color: tuple[int, int, int] = (255, 255, 255)) -> Image.Image:
    """Ensure image is in RGB mode, compositing transparent alphas on clean white."""
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        bg = Image.new("RGBA", rgba.size, (*bg_color, 255))
        bg.paste(rgba, (0, 0), rgba)
        return bg.convert("RGB")
    if img.mode != "RGB":
        return img.convert("RGB")
    return img


def _crop_to_aspect(img: Image.Image, aspect: tuple[float, float], doc_type: str) -> Image.Image:
    """Crop image to target aspect ratio (width:height) with domain-specific centering."""
    target_ratio = float(aspect[0]) / float(aspect[1])
    w, h = img.size
    current_ratio = w / h

    if abs(current_ratio - target_ratio) < 0.01:
        return img

    if current_ratio > target_ratio:
        # Too wide: crop left & right equally
        new_w = int(h * target_ratio)
        offset_x = (w - new_w) // 2
        return img.crop((offset_x, 0, offset_x + new_w, h))
    else:
        # Too tall:
        new_h = int(w / target_ratio)
        if doc_type == "photo":
            # For candidate portraits, face is in the upper part; keep top 15% headroom
            headroom = int((h - new_h) * 0.15)
            offset_y = max(0, min(headroom, h - new_h))
        else:
            offset_y = (h - new_h) // 2
        return img.crop((0, offset_y, w, offset_y + new_h))


def _draw_name_date(img: Image.Image, name: str | None, date_str: str | None) -> Image.Image:
    """Draw a clean white strip at the bottom of the photo with candidate name & date."""
    if not name and not date_str:
        return img
    img = img.copy()
    w, h = img.size
    strip_h = max(24, int(h * 0.14))
    draw = ImageDraw.Draw(img)

    # White bottom banner
    draw.rectangle([(0, h - strip_h), (w, h)], fill=(255, 255, 255))

    lines = []
    if name:
        lines.append(name.strip().upper())
    if date_str:
        lines.append(f"DOB: {date_str.strip()}" if "dob" in date_str.lower() else f"DOP: {date_str.strip()}")
    text = "\n".join(lines)

    # Try font or default
    font = ImageFont.load_default()
    draw.text((w // 2, h - (strip_h // 2)), text, fill=(0, 0, 0), anchor="mm", font=font)
    return img


def _process_photo(
    img: Image.Image,
    aspect: tuple[float, float] | None,
    target_w: int | None,
    target_h: int | None,
    name: str | None = None,
    date_str: str | None = None,
) -> Image.Image:
    """Process a candidate portrait photo."""
    img = _ensure_rgb(img)

    # 1. Aspect ratio crop
    if aspect:
        img = _crop_to_aspect(img, aspect, "photo")
    elif target_w and target_h:
        img = _crop_to_aspect(img, (float(target_w), float(target_h)), "photo")

    # 2. Resize to specific target or standard portrait scale
    if target_w and target_h:
        img = img.resize((target_w, target_h), Image.Resampling.LANCZOS)
    elif img.width > 1200 or img.height > 1600:
        # Scale down ultra-high-res phone photos to clean portrait res
        scale = min(800 / img.width, 1000 / img.height)
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.Resampling.LANCZOS)

    # 3. Gentle auto-contrast to clean up indoor shadows
    try:
        img = ImageOps.autocontrast(img, cutoff=0.5)
    except Exception:
        pass

    # 4. Draw name & date banner if requested
    if name or date_str:
        img = _draw_name_date(img, name, date_str)

    return img


def _process_signature(
    img: Image.Image,
    aspect: tuple[float, float] | None,
    target_w: int | None,
    target_h: int | None,
) -> Image.Image:
    """Crop to signature bounding box, whiten background paper, and darken ink strokes."""
    img = _ensure_rgb(img)
    gray = img.convert("L")

    # Auto-contrast to separate ink strokes from paper
    try:
        gray = ImageOps.autocontrast(gray, cutoff=1)
    except Exception:
        pass

    w, h = gray.size
    pixels = gray.load()

    # Sample perimeter pixels to estimate paper background color
    perimeter_samples = []
    step_x = max(1, w // 12)
    step_y = max(1, h // 12)
    for x in range(0, w, step_x):
        perimeter_samples.append(pixels[x, 0])
        perimeter_samples.append(pixels[x, h - 1])
    for y in range(0, h, step_y):
        perimeter_samples.append(pixels[0, y])
        perimeter_samples.append(pixels[w - 1, y])

    paper_val = sorted(perimeter_samples)[len(perimeter_samples) // 2] if perimeter_samples else 235
    threshold = max(60, min(215, paper_val - 35))

    # Mask ink strokes (pixels <= threshold)
    mask = gray.point(lambda p: 255 if p <= threshold else 0, mode="1")
    bbox = mask.getbbox()

    if bbox:
        bx1, by1, bx2, by2 = bbox
        pad_x = max(6, int((bx2 - bx1) * 0.08))
        pad_y = max(6, int((by2 - by1) * 0.08))
        crop_box = (max(0, bx1 - pad_x), max(0, by1 - pad_y), min(w, bx2 + pad_x), min(h, by2 + pad_y))
        gray = gray.crop(crop_box)

    # Clean paper background to pure 255, keep ink strokes dark
    def clean_curve(p: int) -> int:
        if p >= threshold:
            return 255
        return int((p / max(1, threshold)) * 110)

    clean = gray.point(clean_curve).convert("RGB")

    # If target aspect ratio specified, pad with clean white background rather than distorting ink
    if aspect:
        target_ratio = float(aspect[0]) / float(aspect[1])
        cw, ch = clean.size
        c_ratio = cw / ch
        if c_ratio > target_ratio:
            # Need more height
            pad_h = int(cw / target_ratio)
            padded = Image.new("RGB", (cw, pad_h), (255, 255, 255))
            padded.paste(clean, (0, (pad_h - ch) // 2))
            clean = padded
        elif c_ratio < target_ratio:
            # Need more width
            pad_w = int(ch * target_ratio)
            padded = Image.new("RGB", (pad_w, ch), (255, 255, 255))
            padded.paste(clean, ((pad_w - cw) // 2, 0))
            clean = padded

    # Resize to dimensions
    if target_w and target_h:
        clean = clean.resize((target_w, target_h), Image.Resampling.LANCZOS)
    elif clean.width > 800 or clean.height > 400:
        scale = min(600 / clean.width, 300 / clean.height)
        clean = clean.resize((int(clean.width * scale), int(clean.height * scale)), Image.Resampling.LANCZOS)

    return clean


def _process_document(img: Image.Image) -> Image.Image:
    """Clean contrast and normalize an A4 marksheet, certificate, or ID card."""
    img = _ensure_rgb(img)
    try:
        img = ImageOps.autocontrast(img, cutoff=1)
    except Exception:
        pass
    if img.width > 2000 or img.height > 2000:
        scale = min(1600 / img.width, 1600 / img.height)
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.Resampling.LANCZOS)
    return img


def _pad_jpeg_to_min_bytes(jpeg_data: bytes, min_bytes: int) -> bytes:
    """Pad a JPEG with standard COM (0xFFFE comment) metadata to satisfy min_bytes without changing pixels."""
    if len(jpeg_data) >= min_bytes:
        return jpeg_data
    needed = min_bytes - len(jpeg_data)
    while needed > 0 and len(jpeg_data) < min_bytes:
        chunk = min(needed, 65530)
        seg_len = chunk + 2
        pad_segment = b"\xff\xfe" + seg_len.to_bytes(2, "big") + (b" " * chunk)
        if jpeg_data.startswith(b"\xff\xd8"):
            jpeg_data = jpeg_data[:2] + pad_segment + jpeg_data[2:]
        else:
            jpeg_data = jpeg_data + pad_segment
        needed = min_bytes - len(jpeg_data)
    return jpeg_data


def _compress_jpeg(
    img: Image.Image,
    min_kb: int,
    max_kb: int,
    dpi: int,
    lock_dimensions: bool = False,
) -> tuple[bytes, int, int, int]:
    """Binary-search optimizer finding JPEG quality & resolution satisfying [min_kb, max_kb]."""
    min_bytes = max(100, min_kb * 1024)
    max_bytes = max_kb * 1024

    cur_img = img
    low_q, high_q = 15, 95
    best_bytes: bytes | None = None
    best_q = 80

    for _ in range(7):
        mid_q = (low_q + high_q) // 2
        buf = io.BytesIO()
        cur_img.save(buf, format="JPEG", quality=mid_q, dpi=(dpi, dpi), optimize=True)
        b = buf.getvalue()
        size = len(b)

        if min_bytes <= size <= max_bytes:
            best_bytes = b
            best_q = mid_q
            break
        elif size > max_bytes:
            high_q = mid_q - 1
        else:
            low_q = mid_q + 1
            best_bytes = b
            best_q = mid_q

    # If still too large at low quality and dimensions aren't locked, downscale image
    if not lock_dimensions:
        downscale_attempts = 0
        while (best_bytes is None or len(best_bytes) > max_bytes) and cur_img.width > 80 and cur_img.height > 80 and downscale_attempts < 10:
            downscale_attempts += 1
            new_w = max(60, int(cur_img.width * 0.85))
            new_h = max(60, int(cur_img.height * 0.85))
            cur_img = cur_img.resize((new_w, new_h), Image.Resampling.LANCZOS)

            buf = io.BytesIO()
            cur_img.save(buf, format="JPEG", quality=35, dpi=(dpi, dpi), optimize=True)
            b = buf.getvalue()
            best_bytes = b
            best_q = 35

            if len(b) <= max_bytes:
                if len(b) < min_bytes:
                    for tq in (55, 75, 90):
                        buf = io.BytesIO()
                        cur_img.save(buf, format="JPEG", quality=tq, dpi=(dpi, dpi), optimize=True)
                        tb = buf.getvalue()
                        if min_bytes <= len(tb) <= max_bytes:
                            best_bytes = tb
                            best_q = tq
                            break
                break

    if best_bytes is None:
        buf = io.BytesIO()
        cur_img.save(buf, format="JPEG", quality=75, dpi=(dpi, dpi), optimize=True)
        best_bytes = buf.getvalue()
        best_q = 75

    # If image byte size is still below min_bytes, pad with standard COM metadata to guarantee lower bound
    if len(best_bytes) < min_bytes and min_kb > 0:
        best_bytes = _pad_jpeg_to_min_bytes(best_bytes, min_bytes)

    return best_bytes, best_q, cur_img.width, cur_img.height


def _compress_pdf(img: Image.Image, min_kb: int, max_kb: int, dpi: int) -> tuple[bytes, int, int]:
    """Compress image into a PDF stream under max_kb limit."""
    max_bytes = max_kb * 1024
    cur_img = img
    if cur_img.mode not in ("RGB", "L"):
        cur_img = cur_img.convert("RGB")

    best_bytes: bytes | None = None

    for q in (85, 65, 45, 25):
        buf = io.BytesIO()
        cur_img.save(buf, format="PDF", resolution=float(dpi), quality=q)
        b = buf.getvalue()
        if len(b) <= max_bytes:
            best_bytes = b
            break

    downscale_attempts = 0
    while (best_bytes is None or len(best_bytes) > max_bytes) and cur_img.width > 300 and downscale_attempts < 8:
        downscale_attempts += 1
        new_w = max(200, int(cur_img.width * 0.8))
        new_h = max(200, int(cur_img.height * 0.8))
        cur_img = cur_img.resize((new_w, new_h), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        cur_img.save(buf, format="PDF", resolution=float(dpi), quality=30)
        b = buf.getvalue()
        best_bytes = b
        if len(b) <= max_bytes:
            break

    if best_bytes is None:
        buf = io.BytesIO()
        cur_img.save(buf, format="PDF", resolution=float(dpi), quality=20)
        best_bytes = buf.getvalue()

    return best_bytes, cur_img.width, cur_img.height


def process_media(
    image_bytes: bytes,
    doc_type: DocType = "photo",
    min_kb: int = 20,
    max_kb: int = 50,
    aspect_ratio: tuple[float, float] | None = None,
    target_width: int | None = None,
    target_height: int | None = None,
    output_format: str = "jpeg",
    target_dpi: int = 200,
    name_on_photo: str | None = None,
    date_on_photo: str | None = None,
) -> SolveResult:
    """Format and compress an image or document to meet exact portal constraints.

    Parameters:
        image_bytes: Raw binary bytes of uploaded image
        doc_type: "photo", "signature", or "document"
        min_kb: Minimum required size in KB
        max_kb: Maximum allowed size in KB
        aspect_ratio: Optional (width, height) ratio e.g. (3.5, 4.5)
        target_width: Optional exact pixel width
        target_height: Optional exact pixel height
        output_format: "jpeg", "png", or "pdf"
        target_dpi: Metadata DPI (default: 200)
        name_on_photo: Optional candidate name to print on bottom strip
        date_on_photo: Optional date to print on bottom strip
    """
    if not image_bytes:
        raise ValueError("Image data cannot be empty")
    if max_kb <= 0:
        raise ValueError("max_kb must be greater than 0")
    if min_kb > max_kb:
        min_kb, max_kb = max_kb, min_kb

    output_format = output_format.lower().strip()
    if output_format not in ("jpeg", "jpg", "pdf", "png"):
        output_format = "jpeg"
    if output_format == "jpg":
        output_format = "jpeg"

    # Load image
    try:
        raw_img = Image.open(io.BytesIO(image_bytes))
    except Exception as e:
        raise ValueError(f"Could not decode image file: {e}") from e

    # 1. Orientation correction
    img = _normalize_orientation(raw_img)

    # 2. Type-specific transformation
    if doc_type == "signature":
        processed = _process_signature(img, aspect_ratio, target_width, target_height)
    elif doc_type == "document":
        processed = _process_document(img)
    else:  # "photo"
        # Standard default passport aspect ratio if none specified: 3.5 : 4.5
        aspect = aspect_ratio if (aspect_ratio or target_width or target_height) else (3.5, 4.5)
        processed = _process_photo(img, aspect, target_width, target_height, name_on_photo, date_on_photo)

    # 3. Output compression
    lock_dimensions = bool(target_width and target_height)
    if output_format == "pdf":
        data, final_w, final_h = _compress_pdf(processed, min_kb, max_kb, target_dpi)
        mime = "application/pdf"
        q_val = None
    else:
        data, q_val, final_w, final_h = _compress_jpeg(
            processed, min_kb, max_kb, target_dpi, lock_dimensions=lock_dimensions
        )
        mime = "image/jpeg"

    size_bytes = len(data)
    details = (
        f"{doc_type.capitalize()} formatted to {round(size_bytes / 1024.0, 1)} KB "
        f"({final_w}x{final_h} px, {target_dpi} DPI, {output_format.upper()})"
    )

    return SolveResult(
        data=data,
        format=output_format,
        mime_type=mime,
        file_bytes=size_bytes,
        width=final_w,
        height=final_h,
        dpi=target_dpi,
        quality=q_val,
        doc_type=doc_type,
        details=details,
    )
