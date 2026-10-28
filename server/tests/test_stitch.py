"""Google Stitch in each customer's own account: connecting it (with Google sign-up or one dashboard button), the
encrypted refresh token, the per-build access token, and the bridge designing in Stitch and coding with the AI.
Google and Stitch are faked; nothing leaves the machine."""

import json
import threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient
from test_accounts import H, signup
from test_unified import UEnv
from test_website import FakeRunner, build, fake_engine, needs_node, ok, run_bridge, web_settings  # noqa: F401

from weave.core.schemas import BuildRequest
from weave.site.stitch import SCOPE, StitchLinks
from weave.web.builder import WebsiteBuilder

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
    """Google's token, tokeninfo and revoke endpoints."""

    def __init__(self):
        self.scopes = f"openid email profile {SCOPE}"
        self.refresh_ok = True
        self.calls = []

    def __call__(self, *a, **kw):  # stands in for httpx.Client(...)
        return self

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def post(self, url, data=None, **kw):
        self.calls.append((url, dict(data or {})))
        if url.endswith("/revoke"):
            return Resp(200, {})
        if data.get("grant_type") == "refresh_token":
            if not self.refresh_ok:
                return Resp(400, {"error": "invalid_grant"})
            return Resp(200, {"access_token": f"ya29.access-for-{data['refresh_token']}", "expires_in": 3600})
        return Resp(200, {"id_token": "idt", "refresh_token": "1//refresh-" + data["code"], "scope": self.scopes})

    def get(self, url, params=None, **kw):
        return Resp(200, {"aud": CLIENT, "iss": "https://accounts.google.com", "email_verified": "true",
                          "email": "sam@gmail.com", "name": "Sam Rao", "sub": "g-1"})


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
    settings.stitch = True
    env = UEnv(settings, tmp_path, results=[ok()])
    env.web_client = TestClient(env.app, base_url="https://app.weave.xyz")
    return env


def consent(client, start, code="abc"):
    """Follow a /auth/... start to Google and come back as if the person agreed."""
    r = client.get(start, follow_redirects=False)
    assert r.status_code == 303, r.text
    q = parse_qs(urlparse(r.headers["location"]).query)
    back = client.get(f"/auth/google/callback?code={code}&state={q['state'][0]}", follow_redirects=False)
    return q, back


def test_google_sign_up_connects_stitch_in_the_same_consent(acc, google):
    q, back = consent(acc.web_client, "/auth/google?stitch=1")
    assert SCOPE in q["scope"][0] and q["access_type"] == ["offline"] and "consent" in q["prompt"][0]
    assert back.headers["location"] == "/start?google=1"
    assert acc.web_client.get("/api/account/config").json()["google_pending"]["stitch"] is True
    assert acc.web_client.post("/api/account/signup", json={"username": "sam", "call_sign": "Sam", "terms": True},
                               headers=H).status_code == 200
    st = acc.web_client.get("/api/account/me").json()["stitch"]
    assert st == {"available": True, "connected": True, "email": "sam@gmail.com", "problem": None}
    row = acc.store.one("SELECT refresh_token FROM stitch_links")
    assert "refresh-abc" not in row["refresh_token"]  # stored encrypted


def test_plain_google_sign_in_does_not_ask_for_stitch(acc):
    q, _ = consent(acc.web_client, "/auth/google")
    assert q["scope"] == ["openid email profile"] and "access_type" not in q


def test_dashboard_button_connects_and_disconnects(acc, google):
    assert signup(acc).status_code == 200
    assert acc.web_client.get("/api/account/me").json()["stitch"]["connected"] is False
    q, back = consent(acc.web_client, "/auth/stitch", code="dash")
    assert q["login_hint"] == ["sam@gmail.com"]
    assert back.headers["location"] == "/dashboard?stitch=connected"
    assert acc.web_client.get("/api/account/me").json()["stitch"]["connected"] is True
    assert acc.web_client.post("/api/account/stitch/disconnect", json={}, headers=H).status_code == 200
    assert acc.web_client.get("/api/account/me").json()["stitch"]["connected"] is False
    assert any(url.endswith("/revoke") and data["token"] == "1//refresh-dash" for url, data in google.calls)


def test_unticking_stitch_on_googles_page_connects_nothing(acc, google):
    assert signup(acc).status_code == 200
    google.scopes = "openid email profile"
    _, back = consent(acc.web_client, "/auth/stitch")
    assert back.headers["location"] == "/dashboard?stitch=missing"
    assert acc.web_client.get("/api/account/me").json()["stitch"]["connected"] is False


def test_cancelling_on_google_goes_back_to_the_dashboard(acc):
    assert signup(acc).status_code == 200
    r = acc.web_client.get("/auth/stitch", follow_redirects=False)
    state = parse_qs(urlparse(r.headers["location"]).query)["state"][0]
    back = acc.web_client.get(f"/auth/google/callback?error=access_denied&state={state}", follow_redirects=False)
    assert back.headers["location"] == "/dashboard?stitch=cancelled"


def test_connect_needs_sign_in(acc):
    assert acc.web_client.get("/auth/stitch", follow_redirects=False).status_code in (303, 401)
    assert acc.web_client.get("/api/account/me").status_code == 401


# ---------- the stored link ----------
class Store:
    def __init__(self):
        self.rows, self.errors = {}, {}

    def save_stitch_link(self, account_id, email, token):
        self.rows[account_id] = {"email": email, "refresh_token": token, "error": None}

    def stitch_link(self, account_id):
        return self.rows.get(account_id)

    def mark_stitch_link(self, account_id, error):
        if account_id in self.rows:
            self.rows[account_id]["error"] = error

    def delete_stitch_link(self, account_id):
        self.rows.pop(account_id, None)


def test_access_tokens_are_refreshed_cached_and_never_stored(settings, google):
    settings.google_client_id, settings.google_client_secret, settings.stitch = CLIENT, "secret", True
    store = Store()
    links = StitchLinks(settings, store, http=google)
    links.save(7, "a@b.c", "1//r")
    creds = links.credentials(7)
    assert creds["access_token"] == "ya29.access-for-1//r" and creds["timeout_ms"] == settings.stitch_timeout * 1000
    links.credentials(7)
    assert sum(1 for _, d in google.calls if d.get("grant_type") == "refresh_token") == 1  # cached
    assert "ya29" not in json.dumps(store.rows) and "1//r" not in json.dumps(store.rows)
    assert links.credentials(8) is None


def test_revoked_access_is_flagged_for_reconnecting(settings, google):
    settings.google_client_id, settings.google_client_secret, settings.stitch = CLIENT, "secret", True
    store = Store()
    links = StitchLinks(settings, store, http=google)
    links.save(7, "a@b.c", "1//r")
    google.refresh_ok = False
    assert links.credentials(7) is None
    assert "connect Stitch again" in links.status(7)["problem"]


def test_stitch_off_or_google_not_set_up_means_no_credentials(settings, google):
    settings.google_client_id, settings.google_client_secret, settings.stitch = CLIENT, "secret", False
    links = StitchLinks(settings, Store(), http=google)
    links.save(7, None, "1//r")
    assert links.available is False and links.credentials(7) is None


# ---------- the build ----------
def test_builder_hands_the_token_to_the_bridge_only(web_settings):
    runner = FakeRunner([ok(designer="stitch")])
    builder = WebsiteBuilder(web_settings, runner=runner)
    builder.design_credentials = lambda account_id: {"access_token": "ya29.secret", "quota_project": "",
                                                      "timeout_ms": 1000} if account_id == 5 else None
    job = builder.create_job(BuildRequest(prompt="A site for my bakery"), account_id=5)
    done = builder.run_existing(job["id"])
    assert runner.requests[0]["stitch"]["access_token"] == "ya29.secret"
    assert done["designer"] == "stitch"
    saved = [f for f in Path(web_settings.sites_dir).rglob("*") if f.is_file()]
    assert saved and all("ya29.secret" not in f.read_text(errors="ignore") for f in saved)
    assert "ya29.secret" not in json.dumps(builder.store.get(job["id"]))


def test_builds_without_a_connected_account_skip_stitch(web_settings):
    runner = FakeRunner([ok()])
    builder = WebsiteBuilder(web_settings, runner=runner)
    builder.design_credentials = lambda account_id: None
    build(builder)
    assert "stitch" not in runner.requests[0]


# ---------- the bridge against a fake Stitch ----------
class FakeStitch(BaseHTTPRequestHandler):
    fail = False
    seen: list = []

    def log_message(self, *a):
        pass

    def _send(self, status, body, ctype="application/json"):
        data = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # the design's HTML: only with the owner's token
        if self.headers.get("Authorization") != "Bearer ya29.owner":
            return self._send(401, "no")
        self._send(200, json.dumps({"html": "<!DOCTYPE html><html><body><h1>stitch hero</h1></body></html>"}))

    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        tool = req["params"]["name"]
        type(self).seen.append((tool, self.headers.get("Authorization"), req["params"]["arguments"]))
        if self.fail:
            return self._send(403, '{"error": "Stitch API has not been used in project"}')
        if tool == "download_file":
            assert req["params"]["arguments"] == {"name": "projects/42/files/h1"}
            if self.server.wrapper_only:  # the tool fails: fall back to the URL's JSON wrapper
                return self._send(200, json.dumps({"jsonrpc": "2.0", "id": req["id"], "result": {
                    "isError": True, "content": [{"type": "text", "text": "unavailable"}]}}))
            return self._send(200, json.dumps({"jsonrpc": "2.0", "id": req["id"], "result": {"structuredContent": {
                "html": "<!DOCTYPE html><html><body><h1>stitch hero</h1></body></html>"}}}))
        if tool == "create_project":
            return self._send(200, json.dumps({"jsonrpc": "2.0", "id": req["id"],
                                               "result": {"structuredContent": {"name": "projects/42"}}}))
        port = self.server.server_address[1]
        screen = {"outputComponents": [{"design": {"screens": [{"name": "projects/42/screens/1",
                  "htmlCode": {"name": "projects/42/files/h1", "downloadUrl": f"http://127.0.0.1:{port}/design.html"}}]}}]}
        rpc = {"jsonrpc": "2.0", "id": req["id"], "result": {"content": [{"type": "text", "text": json.dumps(screen)}]}}
        self._send(200, f"event: message\ndata: {json.dumps(rpc)}\n\n", "text/event-stream")


@pytest.fixture
def stitch_server():
    FakeStitch.fail, FakeStitch.seen = False, []
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeStitch)
    server.wrapper_only = False
    threading.Thread(target=server.serve_forever, daemon=True).start()
    server.url = f"http://127.0.0.1:{server.server_address[1]}/mcp"
    yield server
    server.shutdown()


STITCH_REQ = {"access_token": "ya29.owner", "quota_project": "", "timeout_ms": 10_000}


@needs_node
def test_bridge_designs_in_stitch_then_the_ai_codes_it(settings, tmp_path, fake_engine, stitch_server):
    result, out = run_bridge(settings, tmp_path, {"op": "generate", "engine_dir": str(fake_engine), "prompt": "bakery",
                                                  "stitch": STITCH_REQ}, extra_env={"STITCH_SERVER_URL": stitch_server.url})
    assert result["ok"] is True, result
    assert result["designer"] == "stitch" and "stitch_error" not in result
    assert (out / "index.html").read_text() == "<!DOCTYPE html><html><body>coded from the design</body></html>"
    assert [c["phase"] for c in result["calls"]] == ["research", "stitch", "html-1"]
    tools = [t for t, _, _ in FakeStitch.seen]
    assert tools == ["create_project", "generate_screen_from_text", "download_file"]
    assert all(auth == "Bearer ya29.owner" for _, auth, _ in FakeStitch.seen)
    args = FakeStitch.seen[1][2]
    assert args["projectId"] == "42" and args["deviceType"] == "DESKTOP" and "Brew Haven" in args["prompt"]
    assert "ya29.owner" not in json.dumps(result)


@needs_node
def test_bridge_falls_back_to_the_ai_when_stitch_fails(settings, tmp_path, fake_engine, stitch_server):
    FakeStitch.fail = True
    result, out = run_bridge(settings, tmp_path, {"op": "generate", "engine_dir": str(fake_engine), "prompt": "bakery",
                                                  "stitch": STITCH_REQ}, extra_env={"STITCH_SERVER_URL": stitch_server.url})
    assert result["ok"] is True, result
    assert result["designer"] == "ai" and "403" in result["stitch_error"]
    assert "model page" in (out / "index.html").read_text()


@needs_node
def test_bridge_without_stitch_never_calls_it(settings, tmp_path, fake_engine, stitch_server):
    result, _ = run_bridge(settings, tmp_path, {"op": "generate", "engine_dir": str(fake_engine), "prompt": "bakery"},
                           extra_env={"STITCH_SERVER_URL": stitch_server.url})
    assert result["ok"] is True and result["designer"] == "ai" and FakeStitch.seen == []


@needs_node
def test_bridge_reads_the_download_urls_json_wrapper_when_download_file_fails(settings, tmp_path, fake_engine,
                                                                             stitch_server):
    stitch_server.wrapper_only = True
    result, out = run_bridge(settings, tmp_path, {"op": "generate", "engine_dir": str(fake_engine), "prompt": "bakery",
                                                  "stitch": STITCH_REQ}, extra_env={"STITCH_SERVER_URL": stitch_server.url})
    assert result["ok"] is True and result["designer"] == "stitch", result
    assert (out / "index.html").read_text() == "<!DOCTYPE html><html><body>coded from the design</body></html>"
