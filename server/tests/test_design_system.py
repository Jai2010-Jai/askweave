"""The website engine's design system: hand-tuned palettes stay readable, and the clean-up pass removes the usual
signs of an AI-made page (stock colours, gradient text, emoji, invented image URLs) without touching real content."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ENGINE = Path(__file__).resolve().parents[2] / "website-engine" / "src" / "portfolio" / "designSystem.js"
needs_node = pytest.mark.skipif(not shutil.which("node"), reason="Node.js is not installed")


def run(js: str):
    code = f"import * as ds from {json.dumps(ENGINE.as_uri())};\n{js}"
    p = subprocess.run(["node", "--input-type=module", "-e", code], capture_output=True, text=True, timeout=30)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def contrast(a: str, b: str) -> float:
    def lum(h):
        rgb = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
        rgb = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
        return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    hi, lo = sorted((lum(a), lum(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


@needs_node
def test_every_palette_is_readable():
    palettes = run("console.log(JSON.stringify(ds.PALETTES))")
    for name, p in palettes.items():
        assert contrast(p["ink"], p["bg"]) >= 7, name
        assert contrast(p["muted"], p["bg"]) >= 4.5, name
        assert contrast(p["onAccent"], p["accent"]) >= 3, name  # buttons: large, bold text
        assert contrast(p["onDeep"], p["deep"]) >= 4.5, name


@needs_node
def test_cleanup_removes_ai_tells_and_pins_photos():
    body = ('<header class="site-header"><a href="index.html">Lakshmi</a></header>'
            '<h1 class="display bg-clip-text text-transparent bg-gradient-to-r from-purple-500 to-pink-500">Fresh 🚀 every day</h1>'
            '<p class="text-slate-500 md:text-gray-400 text-muted">Open 7am – 10pm © Lakshmi</p>'
            '<img src="https://example.com/fake.jpg"><img src="https://images.unsplash.com/photo-1542838132-92c53300491e?w=10" alt="Shelves">'
            '<script>alert(1)</script><footer>bye</footer>')
    out = run(f"""
const system = ds.resolveSystem({{ typePair: 'young-manrope', palette: 'saffron', layout: 'storefront' }});
const photos = ds.pickPhotos(['grocery', 'spices'], 4, 'Lakshmi');
const html = ds.assemblePage({{ body: {json.dumps(body)}, system, brandName: 'Lakshmi', title: 'Lakshmi', description: 'x', photos }});
console.log(JSON.stringify({{ html, photos, again: ds.systemOf(html) && ds.systemOf(html).paletteId }}))""")
    html, photos = out["html"], out["photos"]
    assert photos and all("grocery" in p["url"] or "photo-" in p["url"] for p in photos)
    for tell in ("bg-clip-text", "text-transparent", "from-purple-500", "text-slate-500", "md:text-gray-400", "🚀",
                 "example.com", "alert(1)"):
        assert tell not in html, tell
    assert "Fresh every day" in html and "© Lakshmi" in html and "text-muted" in html
    assert html.count("images.unsplash.com/photo-") >= 2 and 'alt="Shelves"' in html
    assert 'fetchpriority="high"' in html  # the first image loads first
    assert out["again"] == "saffron"  # changes and extra pages keep the design
    assert "data-nav-toggle" not in html or "site-header" in html


@needs_node
def test_photo_choice_is_stable_and_relevant():
    out = run("console.log(JSON.stringify([ds.pickPhotos(['salon'], 3, 'A'), ds.pickPhotos(['salon'], 3, 'A'), "
              "ds.pickPhotos(['nothing-like-this'], 3, 'A')]))")
    first, again, none = out
    assert first == again and len(first) == 3 and none == []
