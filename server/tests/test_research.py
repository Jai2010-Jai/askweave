"""Website research: Gemini researches the idea, the owner answers its questions, then the design starts."""

import time

import httpx
from test_sms import OWNER
from test_unified import u  # noqa: F401 - fixture

from weave.web.research import Research, Researcher, parse


class FakeResearcher:
    def __init__(self, found):
        self.found = found

    def research(self, idea):
        return self.found


def wait_for(u, text):
    deadline = time.monotonic() + 3
    while text not in (u.last() or "") and time.monotonic() < deadline:
        time.sleep(0.02)
    return u.last()


def test_parse():
    r = parse("**BRIEF:**\nCafe in Pune\nAvg coffee Rs 180\nQUESTIONS:\n1. What's the cafe called?\n2) Which area?\n")
    assert r == Research("Cafe in Pune\nAvg coffee Rs 180", ["What's the cafe called?", "Which area?"])
    assert parse("no format") is None


def test_research_uses_google_search():
    def handler(request):
        assert b'"google_search"' in request.content and "gemini-2.5-flash" in str(request.url)
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [
            {"text": "BRIEF:\nfacts\nQUESTIONS:\n1. Name?"}]}}]})

    r = Researcher("k", "gemini-2.5-flash", http=httpx.Client(transport=httpx.MockTransport(handler)))
    assert r.research("bakery site") == Research("facts", ["Name?"])


def test_questions_then_build_with_answers(u):  # noqa: F811
    u.settings.website_ask_style = True
    u.sms.service.researcher = FakeResearcher(Research("Bakeries in Pune sell cakes", ["What's it called?", "Area?"]))
    u.text(OWNER, "Create a website for my bakery")
    assert "1. What's it called?" in wait_for(u, "What's it called")
    u.text(OWNER, "Sweet Crumbs, Baner")
    prompt = u.store.all("SELECT prompt FROM jobs ORDER BY id DESC LIMIT 1")[0]["prompt"]
    assert "Sweet Crumbs, Baner" in prompt and "Bakeries in Pune sell cakes" in prompt


def test_failed_research_falls_back_to_style_question(u):  # noqa: F811
    u.settings.website_ask_style = True
    u.sms.service.researcher = FakeResearcher(None)
    u.text(OWNER, "Create a website for my bakery")
    assert "Which style" in wait_for(u, "Which style")
