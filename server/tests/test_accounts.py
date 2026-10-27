"""askweave.xyz accounts: sign-up, WhatsApp linking, <username>.<domain>/<project> hosting, the dashboard API,
delete/restore, takedowns and abuse reports. Gemini, Gradle and the weave bridge are faked as in test_unified."""

from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient
from test_sms import OWNER
from test_unified import UEnv
from test_website import PAGE, ok

from weave.site.names import clean_call_sign, username_problem
from weave.web.validate import public_problem

MEMBER = "+919876500002"
OTHER = "+919876500003"
H = {"X-Weave": "1"}
CLIENT = "client-123.apps.googleusercontent.com"


class Resp:
    def __init__(self, status, data):
        self.status_code, self._data = status, data
        self.headers = {"content-type": "application/json"}

    def json(self):
        return self._data

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("bad", request=None, response=None)


class FakeGoogle:
    """Google's token and tokeninfo endpoints. The authorization code picks the Google account: "abc" is
    sam@gmail.com, any other code is <code>@example.com."""

    def __init__(self):
        self.calls = []

    def __call__(self, *a, **kw):  # stands in for httpx.Client(...)
        return self

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def post(self, url, data=None, **kw):
        self.calls.append((url, dict(data or {})))
        return Resp(200, {"id_token": "idt-" + data["code"]})

    def get(self, url, params=None, **kw):
        code = (params or {}).get("id_token", "idt-abc").removeprefix("idt-")
        who = {"email": "sam@gmail.com", "name": "Sam Rao", "sub": "g-1"} if code == "abc" else \
            {"email": f"{code}@example.com", "name": code.title(), "sub": f"g-{code}"}
        return Resp(200, {"aud": CLIENT, "iss": "https://accounts.google.com", "email_verified": "true", **who})


@pytest.fixture
def google(monkeypatch):
    fake = FakeGoogle()
    monkeypatch.setattr(httpx, "Client", fake)
    return fake


@pytest.fixture
def acc(settings, tmp_path, google):
    settings.website_deploy = "weave"
    settings.sites_domain = "weave.xyz"
    settings.sms_signup = "account"
    settings.google_client_id, settings.google_client_secret = CLIENT, "secret"
    env = UEnv(settings, tmp_path, results=[ok(), ok(html=PAGE.replace("Brew Haven", "Brew Haven v2")), ok(), ok()])
    env.web_client = TestClient(env.app, base_url="https://app.weave.xyz")
    return env


def consent(client, start, code="abc"):
    """Follow a /auth/... start to Google and come back as if the person agreed."""
    r = client.get(start, follow_redirects=False)
    assert r.status_code == 303, r.text
    q = parse_qs(urlparse(r.headers["location"]).query)
    back = client.get(f"/auth/google/callback?code={code}&state={q['state'][0]}", follow_redirects=False)
    return q, back


def signup(env, username="sam", client=None, google_account=None, **kw):
    """Continue with Google (as <google_account or username>@example.com), then pick the username."""
    client = client or env.web_client
    consent(client, "/auth/google", code=google_account or username)
    data = {"username": username, "call_sign": "Sam", "terms": True, **kw}
    return client.post("/api/account/signup", json=data, headers=H)


def link(env, phone=MEMBER, client=None):
    code = (client or env.web_client).post("/api/account/phone-code", headers=H).json()["code"]
    env.text(phone, f"LINK {code}")
    return code


def site(env, path, host="sam.weave.xyz"):
    return env.client.get(path, headers={"host": host}, follow_redirects=False)


# ---------- names ----------
@pytest.mark.parametrize("name", ["admin", "www", "paypal", "paypa1", "pay-pal", "rnetflix", "g00gle", "sbi-help",
                                  "fuckit", "ab", "-sam", "sam-", "Sam", "sam--x", "a" * 21])
def test_bad_usernames_are_refused(name):
    assert username_problem(name)


@pytest.mark.parametrize("name", ["sam", "bakery-by-ana", "sbiswas", "jai2010"])
def test_ordinary_usernames_are_fine(name):
    assert username_problem(name) == ""


def test_call_signs():
    assert clean_call_sign("  Jai  K ") == "Jai K"
    assert clean_call_sign("visit http://x.co") == "" and clean_call_sign("<b>") == ""


# ---------- sign-up and sign-in ----------
def test_unknown_number_gets_the_sign_up_link_once(acc):
    acc.text(MEMBER, "build me a website for my bakery")
    assert "https://weave.example.test/start" in acc.last(MEMBER) and acc.user(MEMBER) is None
    acc.text(MEMBER, "please build it")
    assert len(acc.all(MEMBER)) == 1  # at most once a day...
    acc.text(MEMBER, "hi")
    assert len(acc.all(MEMBER)) == 2  # ...unless they say hi


def test_signup_rules(acc):
    assert signup(acc, "admin").status_code == 400
    assert signup(acc, "paypa1").status_code == 400
    assert signup(acc, terms=False).status_code == 400
    fresh = TestClient(acc.app, base_url="https://app.weave.xyz")
    no_google = fresh.post("/api/account/signup", json={"username": "sam", "call_sign": "Sam", "terms": True}, headers=H)
    assert no_google.status_code == 400  # accounts are Google-only
    assert acc.web_client.post("/api/account/signup", json={"username": "sam"}).status_code == 403  # no X-Weave
    r = signup(acc)
    assert r.status_code == 200
    cookie = r.headers["set-cookie"]
    assert "HttpOnly" in cookie and "Domain" not in cookie  # host-only: never sent to customer subdomains
    me = acc.web_client.get("/api/account/me").json()
    assert me["username"] == "sam" and me["address"] == "https://sam.weave.xyz/" and me["phone"] is None
    other = TestClient(acc.app, base_url="https://app.weave.xyz")
    assert signup(acc, "sam", client=other, google_account="x").status_code == 400  # name taken
    assert signup(acc, "sam2", client=other, google_account="sam").status_code in (303, 400)  # Google account taken
    assert acc.web_client.get("/api/account/username?name=sam").json()["ok"] is False


def test_sign_in_again_with_google_and_logout(acc):
    signup(acc)
    acc.web_client.post("/api/account/logout", headers=H)
    assert acc.web_client.get("/api/account/me").status_code == 401
    _, back = consent(acc.web_client, "/auth/google", code="sam")  # the same Google account signs straight in
    assert back.headers["location"] == "/dashboard" and acc.web_client.get("/api/account/me").status_code == 200
    assert acc.web_client.post("/api/account/login", json={"email": "sam@example.com", "password": "x"},
                               headers=H).status_code in (404, 405)  # no email sign-in any more


def test_google_sign_in_asks_only_for_name_and_email(acc):
    q, back = consent(acc.web_client, "/auth/google")
    assert q["scope"] == ["openid email profile"] and "access_type" not in q  # nothing kept for later
    assert back.headers["location"] == "/start?google=1"
    assert acc.web_client.get("/api/account/config").json()["google_pending"]["email"] == "sam@gmail.com"


def test_pages_and_front_door(acc):
    for path in ("/start", "/dashboard", "/terms", "/privacy", "/report", "/site/site.css", "/site/dashboard.js"):
        r = acc.web_client.get(path)
        assert r.status_code == 200, path
    assert "script-src 'self'" in acc.web_client.get("/start").headers["content-security-policy"]
    assert acc.web_client.get("/", follow_redirects=False).headers["location"] == "/start"


# ---------- WhatsApp linking ----------
def test_link_from_whatsapp_then_build_goes_live_under_the_username(acc):
    signup(acc)
    link(acc)
    assert "You're in, Sam!" in acc.last(MEMBER) and "sam.weave.xyz" in acc.last(MEMBER)
    assert acc.user(MEMBER)["account_id"]
    assert acc.web_client.get("/api/account/me").json()["phone"]
    acc.text(MEMBER, "Create a premium website for my coffee brand")
    acc.drain()
    assert "https://sam.weave.xyz/brew-haven/" in acc.last(MEMBER)
    assert site(acc, "/brew-haven").status_code == 308
    page = site(acc, "/brew-haven/")
    assert page.status_code == 200 and "Brew Haven" in page.text
    assert page.headers["content-security-policy"].startswith("sandbox")
    home = site(acc, "/")
    assert home.status_code == 200 and 'href="/brew-haven/"' in home.text
    assert site(acc, "/brew-haven/../../x").status_code == 404
    me = acc.web_client.get("/api/account/me").json()
    assert me["projects"][0]["url"] == "https://sam.weave.xyz/brew-haven/" and me["usage"]["today"]["builds"] == 1
    files = acc.web_client.get(f"/api/account/projects/{me['projects'][0]['id']}/files").json()
    assert [f["name"] for f in files["files"]] == ["index.html"] and "/preview/" in files["preview"]
    dl = acc.web_client.get(f"/api/account/projects/{me['projects'][0]['id']}/files/index.html")
    assert dl.status_code == 200 and "attachment" in dl.headers["content-disposition"]


def test_renaming_a_live_website_moves_its_address(acc):
    signup(acc)
    link(acc)
    acc.text(MEMBER, "Create a premium website for my coffee brand")
    acc.drain()
    pid = acc.web_client.get("/api/account/me").json()["projects"][0]["id"]
    r = acc.web_client.post(f"/api/account/projects/{pid}/rename", json={"name": "Morning Roast"}, headers=H)
    assert r.status_code == 200 and r.json()["url"] == "https://sam.weave.xyz/morning-roast/"
    assert site(acc, "/morning-roast/").status_code == 200 and site(acc, "/brew-haven/").status_code == 404
    me = acc.web_client.get("/api/account/me").json()
    assert me["projects"][0]["name"] == "Morning Roast" and me["projects"][0]["url"].endswith("/morning-roast/")
    # A change after the rename is published at the new address.
    acc.text(MEMBER, "make the hero darker")
    acc.drain()
    assert "https://sam.weave.xyz/morning-roast/" in acc.last(MEMBER) and site(acc, "/morning-roast/").status_code == 200
    assert acc.web_client.post(f"/api/account/projects/{pid}/rename", json={"name": "<b>"}, headers=H).status_code == 400


def test_renaming_from_chat(acc):
    from test_unified import with_brain

    from weave.sms.brain import ChatDecision

    signup(acc)
    link(acc)
    acc.text(MEMBER, "Create a premium website for my coffee brand")
    acc.drain()
    with_brain(acc, ChatDecision(reply="", action="rename", spec="Bean There"))
    acc.text(MEMBER, "call the site Bean There instead")
    assert "Renamed it to Bean There" in acc.last(MEMBER) and "https://sam.weave.xyz/bean-there/" in acc.last(MEMBER)
    assert site(acc, "/bean-there/").status_code == 200
    assert "Live at: https://sam.weave.xyz/bean-there/" in acc.sms.service._chat_context(acc.user(MEMBER), "hi")


def test_greeting_and_call_me(acc):
    signup(acc)
    link(acc)
    acc.text(MEMBER, "hi")
    assert acc.last(MEMBER).startswith("Hey Sam!")
    acc.text(MEMBER, "call me Captain")
    assert "Captain" in acc.last(MEMBER)
    assert acc.web_client.get("/api/account/me").json()["call_sign"] == "Captain"


def test_one_number_per_account_and_changing_number(acc):
    signup(acc)
    link(acc)
    acc.text(MEMBER, "Create a premium website for my coffee brand")
    acc.drain()
    other = TestClient(acc.app, base_url="https://app.weave.xyz")
    signup(acc, "ana", client=other)
    link(acc, MEMBER, client=other)
    assert "different Weave account" in acc.last(MEMBER)
    link(acc, OTHER)  # sam moves to a new number
    assert "projects came with you" in acc.last(OTHER)
    assert acc.user(OTHER)["account_id"] and len(acc.projects(OTHER)) == 1


def test_users_without_an_account_are_sent_to_sign_up(acc):
    code = acc.store.create_link_code("member")  # an old-style member made before accounts
    acc.settings.sms_signup = "link"
    acc.text(MEMBER, f"LINK {code}")
    acc.settings.sms_signup = "account"
    acc.text(MEMBER, "hi there")
    assert "/start" in acc.last(MEMBER) and acc.jobs(MEMBER) == []


# ---------- delete, restore, limits ----------
def test_delete_needs_yes_and_can_be_restored(acc):
    signup(acc)
    link(acc)
    acc.text(MEMBER, "Create a premium website for my coffee brand")
    acc.drain()
    acc.text(MEMBER, "DELETE 1")
    assert "Reply YES" in acc.last(MEMBER)
    acc.text(MEMBER, "no")
    assert "kept" in acc.last(MEMBER) and site(acc, "/brew-haven/").status_code == 200
    acc.text(MEMBER, "DELETE 1")
    acc.text(MEMBER, "yes")
    assert "Deleted" in acc.last(MEMBER) and site(acc, "/brew-haven/").status_code == 404
    me = acc.web_client.get("/api/account/me").json()
    assert me["projects"] == [] and len(me["trash"]) == 1
    r = acc.web_client.post(f"/api/account/projects/{me['trash'][0]['id']}/restore", headers=H)
    assert r.status_code == 200 and site(acc, "/brew-haven/").status_code == 200


def test_project_limit(acc):
    acc.settings.max_projects = 1
    signup(acc)
    link(acc)
    acc.text(MEMBER, "Create a premium website for my coffee brand")
    acc.drain()
    acc.text(MEMBER, "new: Create a premium website for my tea shop")
    assert "Delete one first" in acc.last(MEMBER)


def test_phishing_shaped_pages_stay_private(acc, tmp_path):
    d = tmp_path / "s"
    d.mkdir()
    (d / "index.html").write_text("<html><body><input name=email><input type=password></body></html>")
    assert "password" in public_problem(d)
    (d / "index.html").write_text("<html><body><input name=email><input name=pinCode><textarea></textarea></body></html>")
    assert public_problem(d) == ""


# ---------- abuse ----------
def test_report_and_takedown(acc):
    signup(acc)
    link(acc)
    acc.text(MEMBER, "Create a premium website for my coffee brand")
    acc.drain()
    anon = TestClient(acc.app, base_url="https://app.weave.xyz")
    r = anon.post("/api/report", json={"site": "https://sam.weave.xyz/brew-haven/", "reason": "phishing"}, headers=H)
    assert r.status_code == 200
    acc.text(OWNER, "hi")  # the owner exists once they've texted
    anon.post("/api/report", json={"site": "https://sam.weave.xyz/brew-haven/", "reason": "phishing"}, headers=H)
    assert "Abuse report" in acc.last(OWNER)
    acc.text(OWNER, "TAKEDOWN sam")
    assert "Suspended sam" in acc.last(OWNER)
    assert site(acc, "/brew-haven/").status_code == 451
    assert acc.web_client.get("/api/account/me").status_code == 401  # signed out
    before = len(acc.all(MEMBER))
    acc.text(MEMBER, "Create a website for my bakery")
    assert len(acc.all(MEMBER)) == before and len(acc.jobs(MEMBER)) == 1
    acc.text(OWNER, "REINSTATE sam")
    assert site(acc, "/brew-haven/").status_code == 200


def test_delete_account_retires_the_username(acc):
    signup(acc)
    link(acc)
    assert acc.web_client.post("/api/account/delete", json={"confirm": "wrong"}, headers=H).status_code == 400
    assert acc.web_client.post("/api/account/delete", json={"confirm": "sam"}, headers=H).status_code == 200
    assert acc.web_client.get("/api/account/me").status_code == 401
    other = TestClient(acc.app, base_url="https://app.weave.xyz")
    assert signup(acc, "sam", client=other).status_code == 400
    acc.text(MEMBER, "hi")
    assert "/start" in acc.last(MEMBER)  # the number is free to join again


def test_export(acc):
    signup(acc)
    link(acc)
    r = acc.web_client.get("/api/account/export")
    assert r.status_code == 200 and r.json()["account"]["username"] == "sam" and r.json()["phone"] == MEMBER


def test_housekeeping_backs_up_and_purges(acc):
    out = acc.sms.housekeeping()
    assert out["backup"].is_file() and out["purged"] == 0
