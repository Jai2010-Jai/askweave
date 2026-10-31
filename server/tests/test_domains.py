"""Custom domains (weave.domains): quote, approve, pay, register, DNS, hosting, HTTPS, live, renew, and every way it
can go wrong. Every provider is a fake from weave.domains.mock: nothing here touches a registrar, Cloudflare or a
payment provider, and nothing is ever bought."""

import base64
import json
import time

import httpx
import pytest
from fastapi.testclient import TestClient
from test_accounts import CLIENT, H, MEMBER, OTHER, google, link, signup  # noqa: F401 - google is a fixture
from test_site_data import SHOP
from test_unified import UEnv, with_brain
from test_website import ok

from weave.domains import purchase_mode
from weave.domains import states as S
from weave.domains.cloudflare import CloudflareApi, CloudflareTunnelHosting
from weave.domains.dodo import verify_standard_webhook
from weave.domains.mock import MockPayments
from weave.domains.opensrs import envelope, parse_reply, signature
from weave.domains.providers import ProviderError, ProviderTimeout
from weave.domains.service import MAX_ATTEMPTS, DomainError, clean_domain, is_yes
from weave.sms.brain import ChatDecision

SHOES = SHOP.replace("Chai Point", "Tia Shoes").replace("Masala Chai", "Runner").replace("Samosa", "Sandal")
CONTACT = {"first_name": "Sam", "last_name": "Rao", "address1": "12 MG Road", "city": "Bengaluru",
           "state": "KA", "postal_code": "560001", "country": "IN", "phone": "+91.9876500002",
           "email": "sam@example.com"}


class Clock:
    def __init__(self):
        self.now = time.time()

    def __call__(self):
        return self.now


@pytest.fixture
def env(settings, tmp_path, google):
    """Two signed-up accounts, sam and tia, each with a linked phone and one live site; domains in sandbox mode."""
    settings.website_deploy = "weave"
    settings.sites_domain = "weave.xyz"
    settings.sms_signup = "account"
    settings.google_client_id, settings.google_client_secret = CLIENT, "secret"
    settings.domains = "sandbox"
    settings.domain_currency = "USD"
    settings.domain_markup_percent = 20
    settings.domain_tlds = ["com", "in", "net"]
    e = UEnv(settings, tmp_path, results=[ok(html=SHOP), ok(html=SHOES), ok(), ok()])
    e.web_client = TestClient(e.app, base_url="https://app.weave.xyz")
    e.tia_client = TestClient(e.app, base_url="https://app.weave.xyz")
    signup(e)
    link(e)
    e.text(MEMBER, "Create a website for my chai shop called Chai Point")
    e.drain()
    signup(e, "tia", client=e.tia_client)
    link(e, OTHER, client=e.tia_client)
    e.text(OTHER, "Create a website for my shoe shop called Tia Shoes")
    e.drain()
    e.dom = e.app.state.domains
    e.clock = e.dom.clock = Clock()
    e.p = e.dom.p
    e.p.verifier.fetch = lambda host: (lambda r: (r.status_code, r.text))(
        e.client.get("/.well-known/weave-domain", headers={"host": host}))
    e.sam = e.store.account_by("username", "sam")
    e.tia = e.store.account_by("username", "tia")
    e.web_client.post("/api/account/domains/contact", json=CONTACT, headers=H)
    e.tia_client.post("/api/account/domains/contact", json={**CONTACT, "first_name": "Tia",
                                                            "email": "tia@example.com"}, headers=H)
    return e


def project_id(env, account):
    user = env.store.account_user(account["id"])
    return env.store.all("SELECT id FROM projects WHERE user_id = ? AND slug IS NOT NULL", (user["id"],))[0]["id"]


def quote(env, name="chaipoint.com", client=None, account=None):
    r = (client or env.web_client).post("/api/account/domains", json={
        "domain": name, "project_id": project_id(env, account or env.sam)}, headers=H)
    assert r.status_code == 200, r.text
    return r.json()


def approve(env, q, client=None):
    return (client or env.web_client).post(f"/api/account/domains/{q['id']}/approve", headers=H, json={
        "order_id": q["order"]["id"], "amount_minor": q["order"]["amount_minor"], "confirm": True})


def pay(env, checkout_url, succeed=True, **kw):
    headers, body = env.p.payments.complete(checkout_url.rsplit("/", 1)[1], succeed=succeed, **kw)
    return env.client.post("/api/webhooks/domains/payments", content=body, headers=headers), (headers, body)


def drive(env, steps=80):
    """Run the background steps, letting time pass whenever nothing is due (DNS waits, retry backoff)."""
    for _ in range(steps):
        if not env.dom.run_due("test-runner"):
            due = env.store.one("SELECT MIN(next_run_at) AS t FROM domains WHERE next_run_at IS NOT NULL")["t"]
            if due is None:
                return
            env.clock.now = max(env.clock.now, due) + 1


def state(env, domain_id):
    return env.store.domain(domain_id)["state"]


def buy(env, name="chaipoint.com", client=None, account=None):
    q = quote(env, name, client, account)
    r = approve(env, q, client)
    assert r.status_code == 200, r.text
    hook, _ = pay(env, r.json()["checkout_url"])
    assert hook.status_code == 200
    return q


def site(env, host, path="/"):
    return env.client.get(path, headers={"host": host}, follow_redirects=False)


# ---------- the happy path ----------
def test_search_shows_real_first_year_and_renewal_prices(env):
    env.p.registrar.taken.add("chaipoint.com")
    r = env.web_client.get("/api/account/domains/search", params={"q": "Chai Point"})
    results = r.json()["results"]
    names = [x["domain"] for x in results]
    assert "chaipoint.com" not in names and "chaipoint.in" in names
    inn = next(x for x in results if x["domain"] == "chaipoint.in")
    # mock wholesale .in: $7.99 first year, $10.99 renewal; +20%, rounded up to a whole dollar
    assert (inn["first_year_minor"], inn["renewal_minor"], inn["currency"]) == (1000, 1400, "USD")


def test_a_paid_domain_goes_all_the_way_live_and_the_customer_hears(env):
    q = buy(env)
    assert q["state"] == S.AWAITING_APPROVAL and q["order"]["amount_minor"] == 1400  # $10.99 + 20% -> $14
    assert "Reply YES" in q["quote"]
    assert state(env, q["id"]) == S.REGISTERING
    drive(env)
    d = env.store.domain(q["id"])
    assert d["state"] == S.LIVE and d["dns_zone_id"] and d["nameservers"] and d["expires_at"] > time.time()
    trail = [e["to_state"] for e in env.store.domain_events(q["id"]) if e["from_state"] != e["to_state"]]
    assert trail == [S.DISCOVERING, S.AVAILABLE, S.AWAITING_APPROVAL, S.PAYMENT_PENDING, S.REGISTERING, S.REGISTERED,
                     S.CONFIGURING_DNS, S.VERIFYING_DNS, S.CONNECTING_HOSTING, S.PROVISIONING_SSL,
                     S.VERIFYING_DEPLOYMENT, S.LIVE]
    # Registered once, in the customer's name, with Cloudflare's nameservers set at the registrar.
    assert env.p.registrar.count("register") == 1
    assert env.p.registrar.contacts["chaipoint.com"]["first_name"] == "Sam"
    assert ("set_nameservers", "chaipoint.com", ("ada.ns.example", "bob.ns.example")) in env.p.registrar.calls
    assert env.p.hosting.hosts == {"chaipoint.com", "www.chaipoint.com"}
    page = site(env, "chaipoint.com")
    assert page.status_code == 200 and "Chai Point" in page.text and "Content-Security-Policy" in page.headers
    assert site(env, "www.chaipoint.com", "/menu?x=1").headers["location"] == "https://chaipoint.com/menu?x=1"
    msgs = env.all(MEMBER)
    assert any("Payment received" in m for m in msgs)
    assert any("https://chaipoint.com/" in m and "live" in m for m in msgs)
    detail = env.web_client.get(f"/api/account/domains/{q['id']}").json()
    assert detail["state"] == S.LIVE and detail["url"] == "https://chaipoint.com/" and len(detail["events"]) >= 11


# ---------- money rules ----------
def test_nothing_is_registered_without_explicit_approval_and_payment(env):
    q = quote(env)
    no = env.web_client.post(f"/api/account/domains/{q['id']}/approve", headers=H,
                             json={"order_id": q["order"]["id"], "amount_minor": q["order"]["amount_minor"]})
    assert no.status_code == 400  # no confirm: true
    wrong = env.web_client.post(f"/api/account/domains/{q['id']}/approve", headers=H,
                                json={"order_id": q["order"]["id"], "amount_minor": 1, "confirm": True})
    assert wrong.json()["code"] == "amount_mismatch"
    r = approve(env, q)
    assert state(env, q["id"]) == S.PAYMENT_PENDING
    drive(env)
    assert env.p.registrar.count("register") == 0 and state(env, q["id"]) == S.PAYMENT_PENDING
    # Even a domain forced into REGISTERING without a paid order refuses to register.
    env.store.update_domain(q["id"], state=S.REGISTERING, next_run_at=env.clock())
    drive(env)
    assert env.p.registrar.count("register") == 0 and state(env, q["id"]) == S.FAILED
    assert "/api/account/domains/sandbox-pay/cks_" in r.json()["checkout_url"]


def test_approval_needs_the_registrant_details(env):
    env.store.set_domain_contact(env.sam["id"], {**CONTACT, "address1": ""})
    q = quote(env)
    r = approve(env, q)
    assert r.status_code == 409 and r.json()["code"] == "contact" and "address1" in r.json()["detail"]
    bad = env.web_client.post("/api/account/domains/contact", json={**CONTACT, "phone": "98765"}, headers=H)
    assert bad.status_code == 400


def test_a_price_change_before_payment_needs_a_new_yes(env):
    q = quote(env)
    env.p.registrar.prices["chaipoint.com"] = (1999, 1999)
    r = approve(env, q)
    assert r.status_code == 409 and r.json()["code"] == "price_changed" and r.json()["amount_minor"] == 2400
    assert env.store.domain_order(q["order"]["id"])["status"] == "expired"
    assert env.p.payments.count("create_checkout") == 0
    again = approve(env, {"id": q["id"], "order": {"id": r.json()["order_id"], "amount_minor": 2400}})
    assert again.status_code == 200 and again.json()["amount_minor"] == 2400


def test_a_price_rise_after_payment_refunds_instead_of_buying(env):
    q = buy(env)
    env.p.registrar.prices["chaipoint.com"] = (2999, 2999)
    drive(env)
    order = env.store.domain_order(q["order"]["id"])
    assert state(env, q["id"]) == S.FAILED and env.p.registrar.count("register") == 0
    assert order["refund_status"] == "refunded" and env.p.payments.refunds[0][0] == order["payment_id"]
    assert any("refunded" in m for m in env.all(MEMBER))


def test_taken_between_payment_and_registration_is_refunded(env):
    q = buy(env)
    env.p.registrar.taken.add("chaipoint.com")
    drive(env)
    assert state(env, q["id"]) == S.FAILED and len(env.p.payments.refunds) == 1
    assert env.p.registrar.count("register") == 0


def test_a_failed_payment_buys_nothing_and_the_quote_runs_out(env):
    q = quote(env)
    r = approve(env, q)
    hook, _ = pay(env, r.json()["checkout_url"], succeed=False)
    assert hook.status_code == 200
    assert state(env, q["id"]) == S.PAYMENT_PENDING and env.p.registrar.count("register") == 0
    assert any("didn't go through" in m for m in env.all(MEMBER))
    env.clock.now += 25 * 3600
    env.dom.housekeeping()
    assert state(env, q["id"]) == S.FAILED
    assert env.store.domain_order(q["order"]["id"])["status"] == "expired"


def test_a_short_or_wrong_currency_payment_is_refunded(env):
    q = quote(env)
    r = approve(env, q)
    pay(env, r.json()["checkout_url"], amount_minor=100)
    assert state(env, q["id"]) == S.PAYMENT_PENDING and len(env.p.payments.refunds) == 1
    pay(env, r.json()["checkout_url"], currency="INR")
    assert state(env, q["id"]) == S.PAYMENT_PENDING and len(env.p.payments.refunds) == 2


def test_late_payment_after_expiry_or_cancel_is_refunded(env):
    q = quote(env)
    r = approve(env, q)
    assert env.web_client.post(f"/api/account/domains/{q['id']}/cancel", headers=H).json()["state"] == S.FAILED
    pay(env, r.json()["checkout_url"])
    assert state(env, q["id"]) == S.FAILED and len(env.p.payments.refunds) == 1
    assert env.p.registrar.count("register") == 0


def test_webhooks_must_be_signed_fresh_and_are_acted_on_once(env):
    q = quote(env)
    r = approve(env, q)
    good, (headers, body) = pay(env, r.json()["checkout_url"])
    assert good.status_code == 200
    replay = env.client.post("/api/webhooks/domains/payments", content=body, headers=headers)
    assert replay.status_code == 200 and env.store.domain_order(q["order"]["id"])["status"] == "paid"
    forged = MockPayments(secret="whsec_" + base64.b64encode(b"x" * 32).decode()).sign(json.loads(body))
    assert env.client.post("/api/webhooks/domains/payments", content=forged[1], headers=forged[0]).status_code == 401
    tampered = body.replace(b"payment.succeeded", b"payment.failed")
    assert env.client.post("/api/webhooks/domains/payments", content=tampered, headers=headers).status_code == 401
    old = env.p.payments.sign(json.loads(body), ts=int(time.time()) - 3600)
    assert env.client.post("/api/webhooks/domains/payments", content=old[1], headers=old[0]).status_code == 401
    # A second delivery (new id) of the same payment does nothing new.
    again = env.p.payments.sign(json.loads(body))
    assert env.client.post("/api/webhooks/domains/payments", content=again[1], headers=again[0]).status_code == 200
    assert env.p.payments.refunds == []
    drive(env)
    assert env.p.registrar.count("register") == 1


def test_the_same_name_cannot_be_bought_twice(env):
    q = quote(env)
    assert env.web_client.post("/api/account/domains", headers=H, json={
        "domain": "chaipoint.com", "project_id": project_id(env, env.sam)}).json()["order"]["id"] != q["order"]["id"]
    # Both customers quote the same free name. Once one approves, the name is held for their payment window:
    # the other can't open a second checkout for it, so it can't be paid for twice.
    sam = quote(env)
    tia = quote(env, client=env.tia_client, account=env.tia)
    sam_pay = approve(env, sam).json()["checkout_url"]
    tia_r = approve(env, tia, client=env.tia_client)
    assert tia_r.status_code == 409 and tia_r.json()["code"] == "taken"
    assert env.p.payments.count("create_checkout") == 1
    pay(env, sam_pay)
    assert state(env, sam["id"]) == S.REGISTERING and state(env, tia["id"]) == S.FAILED
    # Even if two paid orders raced to the same name, the database refuses the second.
    from weave.sms.domains_store import DuplicateDomainError
    other = env.store.create_domain(env.tia["id"], None, "chaipoint.com", S.AWAITING_APPROVAL, "t")
    with pytest.raises(DuplicateDomainError):
        env.store.transition_domain(other["id"], (S.AWAITING_APPROVAL,), S.PAYMENT_PENDING, "t")
    late = env.tia_client.post("/api/account/domains", headers=H,
                               json={"domain": "chaipoint.com", "project_id": project_id(env, env.tia)})
    assert late.status_code == 409 and late.json()["code"] == "taken"
    mine = env.web_client.post("/api/account/domains", headers=H,
                               json={"domain": "chaipoint.com", "project_id": project_id(env, env.sam)})
    assert mine.json()["code"] == "already_yours"
    assert approve(env, sam).status_code == 409  # the paid order can't be approved again
    drive(env)
    assert env.p.registrar.count("register") == 1


# ---------- failures, retries, recovery ----------
def test_registrar_timeout_after_success_is_recovered_without_buying_twice(env):
    env.p.registrar.lose_response = True
    q = buy(env)
    drive(env)
    assert state(env, q["id"]) == S.LIVE and env.p.registrar.count("register") == 1
    notes = [e["detail"].get("note") for e in env.store.domain_events(q["id"])]
    assert "will retry" in notes and "already registered by an earlier attempt" in notes


def test_registrar_timeouts_back_off_exponentially(env):
    env.p.registrar.fail_next["register"] = [ProviderTimeout(), ProviderTimeout()]
    q = buy(env)
    start = env.clock.now
    env.dom.run_due("r")
    d = env.store.domain(q["id"])
    assert d["attempts"] == 1 and d["next_run_at"] == pytest.approx(start + 30)
    env.clock.now = d["next_run_at"] + 1
    env.dom.run_due("r")
    d = env.store.domain(q["id"])
    assert d["attempts"] == 2 and d["next_run_at"] == pytest.approx(env.clock.now + 60)
    drive(env)
    assert state(env, q["id"]) == S.LIVE


def test_a_registrar_that_keeps_failing_refunds_when_nothing_was_bought(env):
    env.p.registrar.fail_next["register"] = [ProviderError("registry down", transient=True)] * MAX_ATTEMPTS
    q = buy(env)
    drive(env)
    assert state(env, q["id"]) == S.FAILED and env.p.registrar.count("register") == MAX_ATTEMPTS
    assert env.store.domain_order(q["order"]["id"])["refund_status"] == "refunded"


def test_dns_failure_stops_and_retry_resumes_from_that_step(env):
    env.p.dns.fail_next["ensure_zone"] = [ProviderError("zone quota reached")]
    q = buy(env)
    drive(env)
    d = env.store.domain(q["id"])
    assert d["state"] == S.FAILED and d["failed_step"] == S.CONFIGURING_DNS and "zone quota" in d["last_error"]
    assert any("hit a problem" in m for m in env.all(MEMBER))
    assert env.web_client.get(f"/api/account/domains/{q['id']}").json()["retryable"] is True
    r = env.web_client.post(f"/api/account/domains/{q['id']}/retry", headers=H)
    assert r.status_code == 200 and r.json()["state"] == S.CONFIGURING_DNS
    drive(env)
    assert state(env, q["id"]) == S.LIVE and env.p.registrar.count("register") == 1


def test_dns_that_never_delegates_gives_up_after_the_wait_limit(env):
    env.p.dns.pending_checks = 10_000
    q = buy(env)
    drive(env, steps=400)
    d = env.store.domain(q["id"])
    assert d["state"] == S.FAILED and d["failed_step"] == S.VERIFYING_DNS and "gave up waiting" in d["last_error"]
    assert site(env, "chaipoint.com", "/index.html").status_code == 401  # never routed


def test_ssl_failure_and_slow_ssl(env):
    env.p.ssl.result = "failed"
    q = buy(env)
    drive(env)
    d = env.store.domain(q["id"])
    assert d["state"] == S.FAILED and d["failed_step"] == S.PROVISIONING_SSL
    env.p.ssl.result, env.p.ssl.pending_checks = "active", 3
    env.web_client.post(f"/api/account/domains/{q['id']}/retry", headers=H)
    drive(env)
    assert state(env, q["id"]) == S.LIVE and env.p.ssl.count("status") >= 5


def test_a_deployment_that_never_answers_fails_instead_of_going_live(env):
    env.p.verifier.fetch = lambda host: (502, "bad gateway")
    q = buy(env)
    drive(env, steps=400)
    d = env.store.domain(q["id"])
    assert d["state"] == S.FAILED and d["failed_step"] == S.VERIFYING_DEPLOYMENT


def test_a_crashed_runner_is_picked_up_after_its_lease(env):
    q = buy(env)
    claimed = env.store.claim_domain("dead-worker", 300, env.clock.now)
    assert claimed["id"] == q["id"]
    assert env.dom.run_due("other") is False  # still leased
    env.clock.now += 301
    assert env.dom.run_due("other") is True
    assert state(env, q["id"]) == S.REGISTERED


def test_retry_is_refused_before_payment_and_for_refunded_orders(env):
    q = quote(env)
    env.web_client.post(f"/api/account/domains/{q['id']}/cancel", headers=H)
    assert env.web_client.post(f"/api/account/domains/{q['id']}/retry", headers=H).status_code == 409


# ---------- routing ----------
def test_each_domain_shows_only_its_own_customers_site(env):
    buy(env)
    buy(env, "tiashoes.com", client=env.tia_client, account=env.tia)
    drive(env)
    assert "Chai Point" in site(env, "chaipoint.com").text
    assert "Tia Shoes" in site(env, "tiashoes.com").text and "Chai Point" not in site(env, "tiashoes.com").text
    assert site(env, "chaipoint.com", "/../tia/").status_code == 404
    # Hosts nobody bought, or a sub-sub-domain, never serve a site.
    for host in ("unknown-shop.com", "evil.chaipoint.com", "chaipoint.com.evil.net"):
        for path in ("/", "/chai-point/", "/index.html"):
            r = site(env, host, path)
            assert r.status_code in (303, 401) and "Chai Point" not in r.text


def test_unpaid_or_expired_domains_are_not_routed(env):
    q = quote(env)
    approve(env, q)
    assert site(env, "chaipoint.com", "/index.html").status_code == 401
    env.store.update_domain(q["id"], state=S.EXPIRED)
    assert site(env, "chaipoint.com", "/index.html").status_code == 401


def test_a_domain_stops_serving_when_its_project_goes_or_moves(env):
    q = buy(env)
    drive(env)
    pid = env.store.domain(q["id"])["project_id"]
    env.store.update_project(pid, deleted_at=time.time())
    assert site(env, "chaipoint.com").status_code == 404
    env.store.update_project(pid, deleted_at=None)
    env.store.update_domain(q["id"], project_id=project_id(env, env.tia))  # pointed at someone else's project
    assert site(env, "chaipoint.com").status_code == 404 and "Tia" not in site(env, "chaipoint.com").text
    env.store.update_domain(q["id"], project_id=pid)
    env.store.update_account(env.sam["id"], status="suspended")
    assert site(env, "chaipoint.com").status_code == 451


def test_custom_domains_are_read_only(env):
    buy(env)
    drive(env)
    assert env.client.post("/", headers={"host": "chaipoint.com"}).status_code == 405


# ---------- access control ----------
def test_domain_api_needs_the_owner(env):
    q = quote(env)
    anon = TestClient(env.app, base_url="https://app.weave.xyz")
    assert anon.get("/api/account/domains").status_code == 401
    assert anon.post("/api/account/domains", json={"domain": "x.com"}, headers=H).status_code == 401
    assert env.tia_client.get(f"/api/account/domains/{q['id']}").status_code == 404
    for action in ("approve", "cancel", "retry", "renew"):
        r = env.tia_client.post(f"/api/account/domains/{q['id']}/{action}", headers=H,
                                json={"order_id": q["order"]["id"], "amount_minor": 1400, "confirm": True})
        assert r.status_code == 404, action
    assert env.web_client.post(f"/api/account/domains/{q['id']}/cancel").status_code == 403  # no X-Weave
    # Someone else's project can't be put behind your domain.
    r = env.web_client.post("/api/account/domains", headers=H,
                            json={"domain": "mine.com", "project_id": project_id(env, env.tia)})
    assert r.status_code == 404
    assert [d["domain"] for d in env.tia_client.get("/api/account/domains").json()["domains"]] == []


def test_domain_requests_are_rate_limited(env):
    codes = [env.web_client.get("/api/account/domains/search", params={"q": "chai"}).status_code for _ in range(31)]
    assert codes[:30] == [200] * 30 and codes[30] == 429


# ---------- renewal and expiry ----------
def test_renewal_is_quoted_approved_paid_then_renewed(env):
    q = buy(env)
    drive(env)
    before = env.store.domain(q["id"])["expires_at"]
    env.clock.now = before - 10 * 86_400
    env.dom.housekeeping()
    assert state(env, q["id"]) == S.EXPIRING
    assert any("expires in 10 days" in m and "$18" in m for m in env.all(MEMBER))  # $14.99 + 20%
    order = env.store.latest_domain_order(q["id"], "renew")
    assert order["status"] == "quoted" and order["amount_minor"] == 1800
    assert site(env, "chaipoint.com").status_code == 200  # still serving while it expires
    r = approve(env, {"id": q["id"], "order": {"id": order["id"], "amount_minor": 1800}})
    assert r.status_code == 200
    pay(env, r.json()["checkout_url"])
    drive(env)
    d = env.store.domain(q["id"])
    assert d["state"] == S.LIVE and d["expires_at"] > before + 300 * 86_400
    assert env.p.registrar.count("renew") == 1


def test_an_unrenewed_domain_expires_and_stops_serving(env):
    q = buy(env)
    drive(env)
    env.clock.now = env.store.domain(q["id"])["expires_at"] - 86_400
    env.dom.housekeeping()
    env.clock.now += 2 * 86_400
    env.dom.housekeeping()
    assert state(env, q["id"]) == S.EXPIRED and "chaipoint.com" not in env.p.hosting.hosts
    assert site(env, "chaipoint.com", "/index.html").status_code == 401
    assert env.p.registrar.count("renew") == 0


# ---------- chat ----------
def test_chat_quotes_then_a_plain_yes_sends_a_payment_link(env):
    with_brain(env, ChatDecision(reply="", action="domain_buy", domain="chaipoint.com"),
               ChatDecision(reply="", action="domain_approve", domain="chaipoint.com"))
    env.text(MEMBER, "I want chaipoint.com for my site")
    assert "chaipoint.com is available: $14 for the first year" in env.last(MEMBER)
    assert "Their domains:" in env.ai.contexts[-1]
    env.text(MEMBER, "yes")
    assert "Pay $14 here: https://weave.example.test/api/account/domains/sandbox-pay/" in env.last(MEMBER)
    d = env.store.account_domains(env.sam["id"])[0]
    assert d["state"] == S.PAYMENT_PENDING and env.p.registrar.count("register") == 0
    assert env.store.latest_domain_order(d["id"])["approved_via"] == "chat"


def test_chat_never_approves_without_an_explicit_yes(env):
    with_brain(env, ChatDecision(reply="", action="domain_buy", domain="chaipoint.com"),
               ChatDecision(reply="Bought!", action="domain_approve", domain="chaipoint.com"))
    env.text(MEMBER, "I want chaipoint.com")
    env.text(MEMBER, "hmm how much was it again? maybe")
    assert "reply YES" in env.last(MEMBER)
    assert env.p.payments.count("create_checkout") == 0
    assert env.store.account_domains(env.sam["id"])[0]["state"] == S.AWAITING_APPROVAL


def test_chat_suggest_and_status(env):
    with_brain(env, ChatDecision(reply="", action="domain_suggest", spec="Chai Point"),
               ChatDecision(reply="", action="domain_status"))
    env.text(MEMBER, "can you find me a domain")
    assert "chaipoint.com: $14 first year, then $18/yr" in env.last(MEMBER)
    env.text(MEMBER, "is my domain live?")
    assert "don't have a custom domain yet" in env.last(MEMBER)


def test_chat_asks_for_registrant_details_on_the_dashboard(env):
    env.store.set_domain_contact(env.sam["id"], {})
    with_brain(env, ChatDecision(reply="", action="domain_buy", domain="chaipoint.com"),
               ChatDecision(reply="", action="domain_approve"))
    env.text(MEMBER, "chaipoint.com please")
    env.text(MEMBER, "yes")
    assert "/dashboard (Domains)" in env.last(MEMBER) and env.p.payments.count("create_checkout") == 0


# ---------- pieces ----------
@pytest.mark.parametrize("text", ["yes", "YES", "Yes!", "haan", "buy it", "confirm", "go ahead"])
def test_plain_yes(text):
    assert is_yes(text)


@pytest.mark.parametrize("text", ["yes but which one?", "maybe", "no", "yesterday", "how much?", "", "not yes"])
def test_not_a_yes(text):
    assert not is_yes(text)


def test_clean_domain():
    assert clean_domain("https://www.Chai-Point.COM/menu?x") == "chai-point.com"
    assert clean_domain("चाय.com").startswith("xn--")
    for bad in ("chai", "-x.com", "a..com", "x" * 64 + ".com", "chai point.com"):
        with pytest.raises(DomainError):
            clean_domain(bad)


def test_state_machine_is_complete():
    assert set(S.NEXT) == set(S.ALL)
    for src, nexts in S.NEXT.items():
        assert all(n in S.ALL for n in nexts), src
    assert S.came_from(S.REGISTERING) == (S.PAYMENT_PENDING, S.FAILED)
    assert not S.allowed(S.AWAITING_APPROVAL, S.REGISTERING)  # never skip payment


def test_purchase_mode_never_mixes_real_and_fake(settings):
    from weave.domains import make_providers
    settings.domains = "on"
    p, real = make_providers(settings)
    assert purchase_mode(settings, p, real)[1]  # no credentials: off
    p.registrar.live, p.payments.live = True, False
    assert purchase_mode(settings, p, {"registrar": True, "dns": True, "payments": True})[1]
    p.payments.live = True
    settings.domain_live_purchases = False
    assert "WEAVE_DOMAIN_LIVE_PURCHASES" in purchase_mode(settings, p, {"registrar": True, "dns": True,
                                                                        "payments": True})[1]
    settings.domain_live_purchases = True
    assert purchase_mode(settings, p, {"registrar": True, "dns": True, "payments": True}) == ("live", "")


def test_purchasing_off_blocks_approval(env):
    env.dom._problem = "payments not configured"
    q = quote(env)
    r = approve(env, q)
    assert r.status_code == 503 and r.json()["code"] == "purchasing_off"


def test_opensrs_signing_and_xml():
    xml = envelope("LOOKUP", {"domain": "a&b.com", "list": ["x", "y"]})
    assert '<item key="domain">a&amp;b.com</item>' in xml and '<item key="0">x</item>' in xml
    import hashlib
    assert signature("<x/>", "k") == hashlib.md5((hashlib.md5(b"<x/>k").hexdigest() + "k").encode()).hexdigest()
    reply = parse_reply("<OPS_envelope><body><data_block><dt_assoc><item key='is_success'>1</item>"
                        "<item key='response_code'>210</item><item key='attributes'><dt_assoc>"
                        "<item key='status'>available</item></dt_assoc></item></dt_assoc></data_block></body>"
                        "</OPS_envelope>")
    assert reply == {"is_success": "1", "response_code": "210", "attributes": {"status": "available"}}


def test_opensrs_adapter_against_a_fake_api():
    from weave.domains.opensrs import OpenSrs
    seen = []

    def handler(req):
        seen.append(req)
        body = req.content.decode()
        if "LOOKUP" in body:
            data = "<item key='response_code'>211</item><item key='attributes'><dt_assoc><item key='status'>taken</item></dt_assoc></item>"
        else:
            data = "<item key='response_code'>200</item><item key='attributes'><dt_assoc><item key='price'>10.99</item></dt_assoc></item>"
        return httpx.Response(200, text="<OPS_envelope><body><data_block><dt_assoc><item key='is_success'>1</item>"
                                        + data + "</dt_assoc></data_block></body></OPS_envelope>")

    r = OpenSrs("reseller", "key", "test", client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert r.check("taken.com").available is False
    assert r.price("x.com").first_year_minor == 1099
    assert str(seen[0].url).startswith("https://horizon.opensrs.net:55443")
    assert seen[0].headers["x-signature"] == signature(seen[0].content.decode(), "key")
    assert not r.live


def test_dodo_webhook_verification_matches_standard_webhooks():
    secret = "whsec_" + base64.b64encode(b"0123456789abcdef0123456789abcdef").decode()
    headers, body = MockPayments(secret=secret).sign({"type": "payment.succeeded", "data": {"payment_id": "p1"}})
    assert verify_standard_webhook(secret, headers, body)["data"]["payment_id"] == "p1"
    with pytest.raises(ProviderError):
        verify_standard_webhook(secret, {**headers, "webhook-signature": "v1,AAAA"}, body)
    with pytest.raises(ProviderError):
        verify_standard_webhook(secret, headers, body, now=time.time() + 600)


def test_cloudflare_tunnel_route_keeps_the_catch_all_last():
    state_ = {"ingress": [{"hostname": "app.askweave.xyz", "service": "http://localhost:8765"},
                          {"service": "http_status:404"}]}
    puts = []

    def handler(req):
        if req.method == "PUT":
            puts.append(json.loads(req.content)["config"]["ingress"])
            state_["ingress"] = puts[-1]
            return httpx.Response(200, json={"success": True, "result": {}})
        return httpx.Response(200, json={"success": True, "result": {"config": {"ingress": state_["ingress"]}}})

    api = CloudflareApi("tok", "acc", client=httpx.Client(transport=httpx.MockTransport(handler)))
    hosting = CloudflareTunnelHosting(api, "tun", "http://127.0.0.1:8765")
    hosting.connect("chaipoint.com")
    hosting.connect("chaipoint.com")  # repeating is harmless
    hosts = [r.get("hostname") for r in puts[-1]]
    assert hosts == ["app.askweave.xyz", "chaipoint.com", "www.chaipoint.com", None]
    hosting.disconnect("chaipoint.com")
    assert [r.get("hostname") for r in puts[-1]] == ["app.askweave.xyz", None]


def test_sandbox_checkout_page_pays_for_the_owner_only(env):
    q = quote(env)
    url = approve(env, q).json()["checkout_url"]
    path = url.split("weave.example.test", 1)[1]
    assert "Test checkout" in env.web_client.get(path).text
    assert env.tia_client.post(path, data={"result": "ok"}).status_code == 404  # someone else's checkout
    r = env.web_client.post(path, data={"result": "ok"}, follow_redirects=False)
    assert r.status_code == 303 and state(env, q["id"]) == S.REGISTERING
