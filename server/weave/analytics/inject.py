"""The small script added to hosted pages as they are served.

Hosted sites run in a CSP sandbox: `connect-src 'none'` blocks fetch and sendBeacon, and `form-action 'none'`
blocks form posts. Two things are still allowed, and the whole of this module is built on them:

  * an <img> may load from any https origin, which is how the page tells us it rendered; and
  * `allow-popups-to-escape-sandbox` lets a popup become an ordinary document on our own origin, which is how
    a contact form reaches us.

So nothing here needs the sandbox loosened. The script is spliced in at serve time rather than written into
anyone's files: every site already published gets it, the stored HTML stays exactly as it was generated, and
turning it off takes effect on the next request with no rebuild.
"""

from __future__ import annotations

import hashlib
import json
import threading
from collections import OrderedDict
from pathlib import Path

MAX_CACHED_PAGES = 64
MAX_CACHED_BYTES = 16_000_000
BODY_CLOSE = b"</body>"

# Kept deliberately small and dependency-free. It runs on a stranger's phone, on someone's business site.
SNIPPET = """<script>(function(){{
var P={px},C={contact};
try{{new Image().src=P+"?r="+Math.random().toString(36).slice(2);}}catch(e){{}}
document.addEventListener("submit",function(e){{
var f=e.target;
if(!f||f.tagName!=="FORM")return;
e.preventDefault();
var d={{}},i,el,n;
for(i=0;i<f.elements.length;i++){{
el=f.elements[i];n=(el.name||el.id||el.type||"").toLowerCase();
if(!n||el.type==="submit"||el.type==="button"||!el.value)continue;
d[n]=String(el.value).slice(0,2000);
}}
var w=window.open(C,"_blank");
if(!w){{return;}}
window.addEventListener("message",function(ev){{
if(ev.source===w&&ev.data==="weave-contact-ready"){{w.postMessage({{weave:"prefill",fields:d}},"*");}}
}});
}},true);
}})();</script>"""


def snippet_for(base_url: str, username: str, slug: str) -> bytes:
    """The script for one site. The values are JSON-encoded, so a slug can never break out of the string."""
    base = base_url.rstrip("/")
    return SNIPPET.format(px=json.dumps(f"{base}/px/{username}/{slug or '-'}.gif"),
                          contact=json.dumps(f"{base}/c/{username}/{slug or '-'}")).encode()


class PageCache:
    """Hosted pages split once at </body> and kept in memory, so serving a page with the script added costs a
    stat and a join rather than a read and a search. Keyed on the file's identity, so republishing a site
    invalidates its entry by itself."""

    def __init__(self, max_entries: int = MAX_CACHED_PAGES, max_bytes: int = MAX_CACHED_BYTES) -> None:
        self.max_entries, self.max_bytes = max_entries, max_bytes
        self._pages: OrderedDict[tuple, tuple[bytes, bytes]] = OrderedDict()
        self._bytes = 0
        self._lock = threading.Lock()

    def parts(self, path: Path, stat) -> tuple[bytes, bytes] | None:
        """(before </body>, from </body> onwards), or None if the page can't be read or has no </body>."""
        key = (str(path), stat.st_mtime_ns, stat.st_size)
        with self._lock:
            if (hit := self._pages.get(key)) is not None:
                self._pages.move_to_end(key)
                return hit
        try:
            html = path.read_bytes()
        except OSError:
            return None
        cut = html.rfind(BODY_CLOSE)
        if cut < 0:
            cut = html.rfind(BODY_CLOSE.upper())
        if cut < 0:
            return None  # nothing to splice into; the page is served untouched
        parts = (html[:cut], html[cut:])
        with self._lock:
            self._pages[key] = parts
            self._bytes += len(html)
            while self._pages and (len(self._pages) > self.max_entries or self._bytes > self.max_bytes):
                _, (head, tail) = self._pages.popitem(last=False)
                self._bytes -= len(head) + len(tail)
        return parts

    def clear(self) -> None:
        with self._lock:
            self._pages.clear()
            self._bytes = 0


def etag_for(stat, snippet: bytes) -> str:
    """A validator covering the file and the script added to it, so changing the script retires old copies."""
    base = f"{stat.st_mtime}-{stat.st_size}-{len(snippet)}".encode() + snippet[:64]
    return f'"{hashlib.md5(base, usedforsecurity=False).hexdigest()}"'
