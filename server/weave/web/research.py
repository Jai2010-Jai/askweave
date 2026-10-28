"""Researches a website request on the web before designing it: Gemini with Google Search finds out about the
business and its market, then writes a few short questions for the owner. The brief and their answers go into the
design prompt (and into Stitch's prompt when they have it connected)."""

from __future__ import annotations

import re
import time
from dataclasses import dataclass

import httpx

RETRY_WAITS = (0, 3, 8)
API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
PROMPT = """A customer asked for this website over WhatsApp:
"{idea}"

Search the web and research it like a senior brand designer before a kickoff call: what this kind of business
is, who its customers are, what the best sites in this space show (sections, offers, imagery, tone), typical local
prices and what makes one stand out. If a real business is named, find its actual details (location, menu or
services, hours, reviews).

Reply in exactly this format, plain text, no markdown:
BRIEF:
<8-14 short factual lines a designer can build from>
QUESTIONS:
1. <question>
2. <question>
3. <question>
4. <question>
(Exactly 4 questions only you can't find out yourself and that change the design: e.g. name, location, top items and
prices, the feel they want. Each under 15 words, friendly, simple English.)"""


@dataclass
class Research:
    brief: str
    questions: list[str]


class Researcher:
    def __init__(self, api_key: str, model: str, timeout: float = 60.0, http: httpx.Client | None = None):
        self.key, self.model = api_key, model
        self.http = http or httpx.Client(timeout=timeout)

    def research(self, idea: str) -> Research | None:
        """None when Gemini fails or its reply has no questions; the caller then asks the plain style question."""
        body = {"contents": [{"role": "user", "parts": [{"text": PROMPT.format(idea=idea[:1500])}]}],
                "tools": [{"google_search": {}}], "generationConfig": {"temperature": 0.4}}
        for wait in RETRY_WAITS:  # Gemini is often briefly "busy" (503/429): try again before giving up
            time.sleep(wait)
            try:
                r = self.http.post(API.format(model=self.model), headers={"x-goog-api-key": self.key}, json=body)
                if r.status_code in (429, 500, 503):
                    continue
                r.raise_for_status()
                parts = r.json()["candidates"][0]["content"]["parts"]
            except (httpx.HTTPError, KeyError, IndexError, ValueError):
                continue
            found = parse("".join(p.get("text", "") for p in parts))
            if found is not None:
                return found
        return None


def parse(text: str) -> Research | None:
    m = re.search(r"BRIEF:\s*(.*?)\s*QUESTIONS:\s*(.*)", text.replace("*", ""), re.S | re.I)
    if not m:
        return None
    questions = [q.strip() for q in re.findall(r"^\s*\d+[.)]\s*(.+)$", m.group(2), re.M) if q.strip()][:4]
    brief = m.group(1).strip()[:1800]
    return Research(brief, questions) if questions and brief else None
