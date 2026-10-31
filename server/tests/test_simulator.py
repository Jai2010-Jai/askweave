"""WhatsApp simulator: local-only, goes through the real WhatsApp queue, and never sends to a real provider."""

import pytest
from fastapi.testclient import TestClient
from test_chat import TUNNEL
from test_sms import Env


@pytest.fixture
def env(settings):
    return Env(settings)


def test_only_the_weave_computer_can_use_it(env):
    remote = TestClient(env.app, base_url="https://weave.example.test", headers=TUNNEL)
    for path in ("/wa", "/wa/app.js", "/api/wa/chats"):
        assert remote.get(path).status_code in (401, 404), path
    local = TestClient(env.app)
    page = local.get("/wa")
    assert page.status_code == 200 and "default-src 'self'" in page.headers["content-security-policy"]
    assert local.get("/wa/app.js").status_code == 200 and local.get("/wa/nope.js").status_code == 404


def test_new_number_talks_to_weave_like_whatsapp(env):
    c = TestClient(env.app)
    phone = c.post("/api/wa/chats").json()["phone"]
    assert phone == "+15550100001"
    assert c.post("/api/wa/messages", json={"phone": phone, "text": "hi"}).json() == {"ok": True}
    assert c.get("/api/wa/messages", params={"phone": phone}).json()["typing"] is True

    env.drain()
    state = c.get("/api/wa/messages", params={"phone": phone}).json()
    assert state["typing"] is False
    assert [m["from"] for m in state["messages"]][:2] == ["me", "weave"]
    assert state["messages"][0]["status"] == "received" and state["messages"][1]["status"] == "delivered"
    assert env.provider.sent == []  # replies to simulator numbers never reach Twilio or Meta

    chats = c.get("/api/wa/chats").json()["chats"]
    assert [ch["phone"] for ch in chats] == [phone]
    assert c.post("/api/wa/chats").json()["phone"] == "+15550100002"


def test_link_owner_uses_a_real_link_code(env):
    c = TestClient(env.app)
    phone = c.post("/api/wa/chats").json()["phone"]
    assert c.post("/api/wa/link-owner", json={"phone": phone}).status_code == 200
    env.drain()
    assert env.user(phone)["role"] == "owner"
    first = c.get("/api/wa/messages", params={"phone": phone}).json()["messages"][0]
    assert first["text"].startswith("LINK ")


def test_only_simulator_numbers_are_accepted(env):
    c = TestClient(env.app)
    for bad in ("+919999999999", "+15550100", "whatsapp:+15550100001", ""):
        assert c.post("/api/wa/messages", json={"phone": bad, "text": "hi"}).status_code == 422
        assert c.get("/api/wa/messages", params={"phone": bad}).status_code == 422
    assert c.post("/api/wa/messages", json={"phone": "+15550100001", "text": " "}).status_code == 422


def test_sign_up_links_the_number_to_a_new_account(env):
    c = TestClient(env.app)
    phone = c.post("/api/wa/chats").json()["phone"]
    assert c.post("/api/wa/sign-up", json={"phone": phone}).json() == {"ok": True, "username": "sim-0001"}
    env.drain()
    account = env.store.account_by("username", "sim-0001")
    assert env.user(phone)["account_id"] == account["id"]
    assert env.provider.sent == []


def test_dashboard_opens_for_a_signed_up_number(env):
    c = TestClient(env.app)
    phone = c.post("/api/wa/chats").json()["phone"]
    assert c.get("/wa/dashboard", params={"phone": phone}, follow_redirects=False).status_code == 404
    c.post("/api/wa/sign-up", json={"phone": phone})
    env.drain()
    r = c.get("/wa/dashboard", params={"phone": phone}, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/dashboard"
    assert c.get("/api/account/me").json()["username"] == "sim-0001"
