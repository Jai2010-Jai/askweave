"""Visitor analytics: counting visits to hosted sites, what is and isn't stored, the dashboard endpoint and
the chat reply. Gemini, Gradle and the weave bridge are faked as in test_unified."""

import threading
import time

import pytest
from fastapi.testclient import TestClient
from test_accounts import CLIENT, H, MEMBER, google, link, signup  # noqa: F401 - google is a fixture
from test_unified import UEnv
from test_website import PAGE, ok

from weave.analytics import collector
from weave.analytics.collector import View, ViewBuffer, client_ip, device_class, is_bot, ref_host, visitor_hash
from weave.analytics.metrics import page_label, project_next, traffic_summary, weekday
from weave.analytics.sales import date_ambiguity, parse_amount, read_csv, sniff_columns
from weave.server import CSV_BODY_BYTES, MAX_BODY_BYTES, body_limit
from weave.sms import messages as M
from weave.sms.intent import classify

PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Safari/604.1"
LAPTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36"
CRAWLER = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"


@pytest.fixture
def acc(settings, tmp_path, google):
    """A signed-up account with a linked phone and one live website at sam.weave.xyz/brew-haven/."""
    settings.website_deploy = "weave"
    settings.sites_domain = "weave.xyz"
    settings.sms_signup = "account"
    settings.trust_proxy = True  # the tests send an X-Forwarded-For, as the tunnel does in production
    settings.google_client_id, settings.google_client_secret = CLIENT, "secret"
    env = UEnv(settings, tmp_path, results=[ok(), ok(html=PAGE.replace("Brew Haven", "Brew Haven v2")), ok(), ok()])
    env.web_client = TestClient(env.app, base_url="https://app.weave.xyz")
    signup(env)
    link(env)
    env.text(MEMBER, "Create a premium website for my coffee brand")
    env.drain()
    return env


def visit(env, path="/brew-haven/", ip="203.0.113.7", ua=PHONE, **headers):
    return env.client.get(path, headers={"host": "sam.weave.xyz", "x-forwarded-for": ip,
                                         "user-agent": ua, **headers}, follow_redirects=False)


def rows(env):
    return env.store.all("SELECT * FROM site_views ORDER BY id")


# ---------- the pieces ----------
def test_bots_are_recognised():
    assert is_bot(CRAWLER) and is_bot("curl/8.4.0") and is_bot("")
    assert not is_bot(PHONE) and not is_bot(LAPTOP)


def test_device_class():
    assert device_class(PHONE) == "mobile" and device_class(LAPTOP) == "desktop" and device_class("") == ""


def test_referrer_keeps_the_host_and_drops_our_own():
    assert ref_host("https://www.google.com/search?q=coffee+shop", "sam.weave.xyz") == "google.com"
    assert ref_host("https://sam.weave.xyz/brew-haven/", "sam.weave.xyz") == ""  # a page of the same site
    assert ref_host("", "sam.weave.xyz") == "" and ref_host("not a url", "sam.weave.xyz") == ""


def test_client_ip_needs_the_proxy_header_to_be_trusted():
    headers = {"cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.4, 10.0.0.1"}
    assert client_ip(headers, "127.0.0.1", trust_proxy=True) == "203.0.113.7"
    assert client_ip({"x-forwarded-for": "198.51.100.4, 10.0.0.1"}, "127.0.0.1", True) == "198.51.100.4"
    assert client_ip(headers, "127.0.0.1", trust_proxy=False) == "127.0.0.1"


def test_visitor_hash_is_per_site_and_per_day():
    now = 1_700_000_000.0
    same = visitor_hash("203.0.113.7", PHONE, "sam", now)
    assert visitor_hash("203.0.113.7", PHONE, "sam", now) == same          # same person, same day
    assert visitor_hash("203.0.113.7", PHONE, "ana", now) != same          # another site: unlinkable
    assert visitor_hash("203.0.113.8", PHONE, "sam", now) != same          # another person
    assert visitor_hash("203.0.113.7", PHONE, "sam", now + 86_400) != same  # tomorrow


def test_the_hashing_key_is_never_kept_beyond_its_day(monkeypatch):
    monkeypatch.setattr(collector, "_salts", {})
    now = 1_700_000_000.0
    visitor_hash("203.0.113.7", PHONE, "sam", now)
    visitor_hash("203.0.113.7", PHONE, "sam", now + 86_400)
    # Yesterday's key is gone, so yesterday's hashes can never be recomputed from an IP.
    assert list(collector._salts) == [collector.utc_day(now + 86_400)]


def test_buffer_is_bounded_and_counts_what_it_drops():
    buf = ViewBuffer(maxlen=3)
    for i in range(5):
        buf.record(View(account_id=1, slug="s", page=f"{i}.html", day=1, ts=0.0, visitor="v"))
    assert buf.stats()["dropped"] == 2
    assert [v.page for v in buf.drain()] == ["2.html", "3.html", "4.html"]  # the oldest went
    assert buf.stats()["buffered"] == 0


# ---------- counting a real visit ----------
def test_a_visit_is_buffered_then_written(acc):
    assert visit(acc).status_code == 200
    assert rows(acc) == []  # nothing touches the database on the request path
    assert acc.sms.flush_analytics()["rows"] == 1
    (row,) = rows(acc)
    assert row["slug"] == "brew-haven" and row["page"] == "index.html" and row["device"] == "mobile"


def test_no_ip_or_user_agent_is_ever_stored(acc):
    visit(acc, ip="203.0.113.7", ua=PHONE, referer="https://www.instagram.com/brew")
    acc.sms.flush_analytics()
    dump = str(rows(acc))
    assert "203.0.113.7" not in dump and "iPhone" not in dump and PHONE not in dump
    assert "instagram.com" in dump  # the host we came from is kept; the full URL is not
    assert "/brew" not in dump


def test_one_person_many_pages_is_one_visitor(acc):
    for _ in range(3):
        visit(acc)
    visit(acc, ip="198.51.100.4", ua=LAPTOP)
    acc.sms.flush_analytics()
    account = acc.store.account_by("username", "sam")
    facts = traffic_summary(acc.store, account["id"], days=7)
    assert facts["views"] == 4 and facts["visitors"] == 2 and facts["mobile_pct"] == 75


def test_crawlers_are_not_counted(acc):
    visit(acc, ua=CRAWLER)
    visit(acc, ua=PHONE)
    acc.sms.flush_analytics()
    assert len(rows(acc)) == 1 and rows(acc)[0]["device"] == "mobile"


def test_a_revalidated_visit_still_counts(acc):
    first = visit(acc)
    etag = first.headers.get("etag")
    assert etag and first.headers["cache-control"] == "no-cache"
    again = visit(acc, **{"if-none-match": etag})
    assert again.status_code == 304  # no body is re-sent...
    acc.sms.flush_analytics()
    assert len(rows(acc)) == 2  # ...but the visit is still ours to count


def test_redirects_and_missing_pages_are_not_visits(acc):
    assert visit(acc, "/brew-haven").status_code == 308
    assert visit(acc, "/nope/").status_code == 404
    acc.sms.flush_analytics()
    assert rows(acc) == []


def test_the_account_index_page_is_counted_under_no_slug(acc):
    assert visit(acc, "/").status_code == 200
    acc.sms.flush_analytics()
    assert rows(acc)[0]["slug"] == "" and rows(acc)[0]["page"] == "index.html"


def test_a_suspended_account_is_not_counted(acc):
    acc.store.update_account(acc.store.account_by("username", "sam")["id"], status="suspended")
    assert visit(acc).status_code == 451
    acc.sms.flush_analytics()
    assert rows(acc) == []


# ---------- flushing, rollups and pruning ----------
def test_rolling_up_twice_does_not_double_the_totals(acc):
    visit(acc)
    visit(acc, ip="198.51.100.4")
    acc.sms.flush_analytics()
    day = rows(acc)[0]["day"]
    acc.store.roll_up_days([day])  # a replayed flush
    daily = acc.store.all("SELECT * FROM site_daily")
    assert len(daily) == 1 and daily[0]["views"] == 2 and daily[0]["visitors"] == 2


def test_stopping_the_worker_writes_what_is_buffered(acc):
    visit(acc)
    acc.sms.stop()
    assert len(rows(acc)) == 1


def test_housekeeping_prunes_old_views(acc):
    visit(acc)
    acc.sms.flush_analytics()
    old = rows(acc)[0]["day"] - acc.settings.analytics_raw_days - 1
    acc.store._conn().execute("UPDATE site_views SET day = ?", (old,))
    acc.sms.housekeeping()
    assert rows(acc) == []


def test_counting_can_be_switched_off_per_account(acc):
    acc.web_client.post("/api/account/analytics", json={"on": False}, headers=H)
    visit(acc)
    acc.sms.flush_analytics()
    assert rows(acc) == []
    assert acc.web_client.get("/api/account/analytics").json()["counting"] is False


def test_counting_can_be_switched_off_for_the_whole_server(settings, tmp_path, google):
    settings.analytics = False
    settings.website_deploy, settings.sites_domain = "weave", "weave.xyz"
    settings.google_client_id, settings.google_client_secret = CLIENT, "secret"
    env = UEnv(settings, tmp_path, results=[ok()])
    env.web_client = TestClient(env.app, base_url="https://app.weave.xyz")
    signup(env)
    assert env.sms.views is None
    assert env.web_client.get("/api/account/analytics").status_code == 404


# ---------- the dashboard ----------
def test_the_dashboard_needs_a_session(acc):
    anon = TestClient(acc.app, base_url="https://app.weave.xyz")
    assert anon.get("/api/account/analytics").status_code == 401


def test_the_dashboard_shows_the_week(acc):
    visit(acc, referer="https://www.instagram.com/brew")
    visit(acc, ip="198.51.100.4", ua=LAPTOP)
    acc.sms.flush_analytics()
    t = acc.web_client.get("/api/account/analytics?days=7").json()
    assert t["views"] == 2 and t["visitors"] == 2 and t["counting"] is True
    assert t["top_pages"][0]["label"] == "brew-haven home page"
    assert t["top_refs"][0]["host"] == "instagram.com"
    assert len(t["series"]) == 14 and t["series"][-1][1] == 2
    assert t["low_data"] is True  # two visits is not a trend


def test_one_account_never_sees_another(acc):
    visit(acc)
    acc.sms.flush_analytics()
    other = TestClient(acc.app, base_url="https://app.weave.xyz")
    signup(acc, "ana", client=other)
    assert other.get("/api/account/analytics").json()["views"] == 0


def test_the_chart_script_is_served(acc):
    assert acc.web_client.get("/site/chart.js").status_code == 200


# ---------- what people are told ----------
def test_weekday_and_page_names():
    assert weekday(0) == "Thu" and weekday(3) == "Sun"
    assert page_label("brew-haven", "index.html") == "brew-haven home page"
    assert page_label("brew-haven", "menu.html") == "brew-haven/menu"


def test_the_sms_reply_fits_and_keeps_its_numbers():
    facts = {"days": 7, "views": 142, "visitors": 86, "prev_views": 115, "delta_pct": 23,
             "busiest_day": "Tue", "busiest_views": 31, "low_data": False, "seen_days": 30,
             "top_pages": [{"label": "menu", "views": 60}], "top_refs": [{"host": "instagram.com", "views": 40}],
             "mobile_pct": 68, "series": [[d, 5] for d in range(14)]}
    text = M.analytics_text(facts, "Bakery site", M.MAX_CHARS, dashboard="https://weave.example.test/dashboard")
    assert len(text) <= M.MAX_CHARS and text == M.ascii_safe(text)
    assert "142 visits from 86 people" in text and "up 23%" in text


def test_a_long_reply_drops_clauses_rather_than_cutting_a_number():
    facts = {"days": 7, "views": 142, "visitors": 86, "prev_views": 115, "delta_pct": 23,
             "busiest_day": "Tue", "busiest_views": 31, "low_data": False, "seen_days": 30,
             "top_pages": [{"label": "x" * 200, "views": 60}], "top_refs": [{"host": "y" * 200, "views": 40}],
             "mobile_pct": 68, "series": [[d, 5] for d in range(14)]}
    text = M.analytics_text(facts, "Bakery site", 120)
    assert len(text) <= 120 and text.endswith(".") and "142 visits from 86 people" in text


def test_a_quiet_week_says_so_rather_than_quoting_a_trend():
    facts = {"days": 7, "views": 0, "visitors": 0, "prev_views": 0, "delta_pct": None, "busiest_day": "",
             "busiest_views": 0, "low_data": True, "seen_days": 3, "top_pages": [], "top_refs": [],
             "mobile_pct": None, "series": []}
    assert "No visits" in M.analytics_text(facts, "Bakery site")


# ---------- chat ----------
def test_asking_on_whatsapp_gives_the_numbers(acc):
    visit(acc)
    visit(acc, ip="198.51.100.4")
    acc.sms.flush_analytics()
    acc.text(MEMBER, "how's my site doing?")
    reply = acc.last(MEMBER)
    assert "2 visits from 2 people" in reply


def test_the_stats_command_works_without_the_ai(acc):
    visit(acc)
    acc.sms.flush_analytics()
    acc.text(MEMBER, "STATS")
    assert "1 visit" in acc.last(MEMBER)


def test_someone_with_no_site_is_told_so(acc):
    acc.store._conn().execute("UPDATE projects SET deploy_url = NULL")
    acc.text(MEMBER, "STATS")
    assert "don't have a website live yet" in acc.last(MEMBER)


def test_visitor_questions_are_told_apart_from_build_progress():
    kinds = lambda t: classify(t, has_projects=True, has_active=True).kind  # noqa: E731
    assert kinds("how's my site doing?") == "analytics"
    assert kinds("how many people visited my website") == "analytics"
    assert kinds("is anyone visiting my site") == "analytics"
    assert kinds("stats") == "analytics"
    # ...but a question about the build in progress is still that
    assert kinds("how's it going?") == "status"
    assert kinds("is it ready yet") == "status"


# ---------- the script added to hosted pages ----------
def test_the_script_is_added_when_the_page_is_served(acc):
    page = visit(acc)
    assert "/px/sam/brew-haven.gif" in page.text and "/c/sam/brew-haven" in page.text
    assert page.text.index("weave-contact-ready") < page.text.index("</body>")


def test_the_published_files_are_left_alone(acc):
    on_disk = (acc.settings.user_sites_dir / "sam" / "brew-haven" / "index.html").read_text()
    assert "px/sam" not in on_disk and "<script>" not in on_disk


def test_the_script_is_dropped_when_counting_is_off(acc):
    acc.web_client.post("/api/account/analytics", json={"on": False}, headers=H)
    assert "/px/sam/" not in visit(acc).text


def test_a_page_without_a_body_tag_is_still_served(acc):
    (acc.settings.user_sites_dir / "sam" / "brew-haven" / "index.html").write_text("<h1>No body here</h1>")
    page = visit(acc)
    assert page.status_code == 200 and "No body here" in page.text and "px/sam" not in page.text


def test_republishing_a_page_invalidates_the_cached_copy(acc):
    assert "Brew Haven" in visit(acc).text
    f = acc.settings.user_sites_dir / "sam" / "brew-haven" / "index.html"
    time.sleep(0.01)
    f.write_text("<html><body><h1>Second Cup</h1></body></html>")
    page = visit(acc)
    assert "Second Cup" in page.text and "Brew Haven" not in page.text and "/px/sam/" in page.text


def test_the_etag_changes_when_the_page_does(acc):
    first = visit(acc).headers["etag"]
    f = acc.settings.user_sites_dir / "sam" / "brew-haven" / "index.html"
    time.sleep(0.01)
    f.write_text("<html><body><h1>Second Cup</h1></body></html>")
    assert visit(acc).headers["etag"] != first


# ---------- the beacon ----------
def test_the_beacon_confirms_a_visit_without_adding_one(acc):
    visit(acc)
    r = acc.client.get("/px/sam/brew-haven.gif", headers={"host": "app.weave.xyz", "x-forwarded-for": "203.0.113.7",
                                                          "user-agent": PHONE})
    assert r.status_code == 200 and r.headers["content-type"] == "image/gif"
    assert r.headers["cache-control"] == "no-store" and len(r.content) < 100
    out = acc.sms.flush_analytics()
    assert out["rows"] == 1 and out["beacons"] == 1  # one visit, flagged - not two visits
    assert rows(acc)[0]["beacon"] == 1


def test_a_beacon_with_no_matching_visit_changes_nothing(acc):
    acc.client.get("/px/sam/brew-haven.gif", headers={"host": "app.weave.xyz", "x-forwarded-for": "198.51.100.9",
                                                      "user-agent": LAPTOP})
    assert acc.sms.flush_analytics()["beacons"] == 0
    assert rows(acc) == []


def test_a_beacon_for_an_unknown_site_is_harmless(acc):
    r = acc.client.get("/px/nobody/whatever.gif", headers={"host": "app.weave.xyz"})
    assert r.status_code == 200 and acc.sms.flush_analytics()["beacons"] == 0


# ---------- enquiries ----------
def lead(env, **kw):
    payload = {"name": "Priya", "contact": "priya@example.com", "message": "Do you do birthday cakes?", **kw}
    return env.client.post("/api/leads/sam/brew-haven", json=payload,
                           headers={"host": "app.weave.xyz", **H})


def test_an_enquiry_reaches_the_owner_on_whatsapp(acc):
    assert lead(acc).status_code == 200
    reply = acc.last(MEMBER)
    assert "New enquiry on brew-haven" in reply and "Priya" in reply and "birthday cakes" in reply
    rows_ = acc.store.leads(acc.store.account_by("username", "sam")["id"])
    assert len(rows_) == 1 and rows_[0]["contact"] == "priya@example.com"


def test_the_contact_page_is_served_for_a_real_site(acc):
    assert acc.client.get("/c/sam/brew-haven", headers={"host": "app.weave.xyz"}).status_code == 200
    assert acc.client.get("/c/nobody/x", headers={"host": "app.weave.xyz"}).status_code == 404
    who = acc.client.get("/api/leads/sam/brew-haven", headers={"host": "app.weave.xyz"}).json()
    assert who["owner"] == "Sam" and who["site"] == "brew-haven"


def test_the_honeypot_is_answered_but_not_stored(acc):
    assert lead(acc, website="http://spam.example").status_code == 200
    assert acc.store.leads(acc.store.account_by("username", "sam")["id"]) == []


def test_an_enquiry_needs_a_message_and_a_way_to_reply(acc):
    assert lead(acc, message="").status_code == 400
    assert lead(acc, contact="").status_code == 400


def test_an_enquiry_for_an_unknown_site_is_refused(acc):
    r = acc.client.post("/api/leads/nobody/x", json={"contact": "a@b.c", "message": "hi"},
                        headers={"host": "app.weave.xyz", **H})
    assert r.status_code == 404


def test_enquiries_show_on_the_dashboard_and_can_be_marked_read(acc):
    lead(acc)
    data = acc.web_client.get("/api/account/leads").json()
    assert data["unread"] == 1 and data["leads"][0]["message"].startswith("Do you do")
    acc.web_client.post("/api/account/leads/read", json={}, headers=H)
    assert acc.web_client.get("/api/account/leads").json()["unread"] == 0


def test_one_account_never_sees_another_account_enquiries(acc):
    lead(acc)
    other = TestClient(acc.app, base_url="https://app.weave.xyz")
    signup(acc, "ana", client=other)
    assert other.get("/api/account/leads").json()["leads"] == []


def test_the_leads_command_lists_them(acc):
    lead(acc)
    acc.text(MEMBER, "LEADS")
    assert "Priya" in acc.last(MEMBER) and "birthday cakes" in acc.last(MEMBER)


def test_leads_says_so_when_there_are_none(acc):
    acc.text(MEMBER, "LEADS")
    assert "No enquiries yet" in acc.last(MEMBER)


def test_enquiries_are_mentioned_in_the_weekly_answer(acc):
    visit(acc)
    acc.sms.flush_analytics()
    lead(acc)
    acc.text(MEMBER, "STATS")
    assert "1 enquiry this week" in acc.last(MEMBER)


def test_a_hosted_page_can_still_talk_to_the_popup_it_opens(acc):
    # Plain "same-origin" would sever window.opener for a popup on app.<domain>, and the contact form's
    # prefill would quietly stop working with nothing to show for it in any test but a real browser.
    assert visit(acc).headers["cross-origin-opener-policy"] == "same-origin-allow-popups"


# ---------- reading a sales file ----------
SALES = (b"Order Date,Item Name,Qty,Unit Cost,Total Amount\n"
         b"25/03/2026,Croissant,3,Rs 30.00,\"Rs 1,250.00\"\n"
         b"26/03/2026,Birthday Cake,1,Rs 400.00,Rs 1500\n"
         b"27/03/2026,Refund,1,0,(200.00)\n")


def test_columns_are_recognised_by_their_everyday_names():
    cols = sniff_columns(["Order Date", "Item Name", "Qty", "Unit Cost", "Total Amount"])
    assert cols == {"date": 0, "cost": 3, "amount": 4, "quantity": 2, "product": 1}
    # "Unit Cost" is a cost, not a unit count: the longer, more specific name has to win.
    assert sniff_columns(["date", "units", "unit cost", "total"])["quantity"] == 1


def test_money_is_read_the_way_shops_write_it():
    assert parse_amount("Rs 1,250.00") == (1250.0, "INR")
    assert parse_amount("$1,234.56") == (1234.56, "USD")
    assert parse_amount("(45.00)")[0] == -45.0          # parentheses mean a refund
    assert parse_amount("1.234.567")[0] == 1234567.0    # thousands written the European way
    assert parse_amount("")[0] is None and parse_amount("n/a")[0] is None


def test_ambiguous_dates_are_detected_not_guessed():
    assert date_ambiguity(["25/03/2026"]) == "day"       # 25 can only be a day
    assert date_ambiguity(["03/25/2026"]) == "month"
    assert date_ambiguity(["01/02/2026", "03/04/2026"]) == "unclear"  # both readings work


def test_the_same_file_reads_differently_when_the_date_order_changes():
    rows = b"Date,Amount\n03/04/2026,100\n"
    day_first = read_csv(rows, dayfirst=True).rows[0][0]
    month_first = read_csv(rows, dayfirst=False).rows[0][0]
    assert day_first != month_first  # exactly why we ask instead of picking one


def test_unreadable_rows_are_skipped_and_explained():
    p = read_csv(SALES + b"not a date,Broken,1,0,Rs 10\n")
    assert len(p.rows) == 3 and p.skipped == 1
    assert "Line 5" in p.problems[0] and "date" in p.problems[0]


def test_a_file_with_no_usable_columns_is_refused():
    with pytest.raises(ValueError, match="date column"):
        read_csv(b"Colour,Size\nred,large\n")
    with pytest.raises(ValueError, match="empty"):
        read_csv(b"")


def test_a_file_that_is_too_big_is_refused():
    with pytest.raises(ValueError, match="MB"):
        read_csv(b"Date,Amount\n" + b"01/01/2026,1\n" * 200_000)


# ---------- storing and summarising ----------
def upload(env, data=SALES, confirm=True, dayfirst="true"):
    qs = f"?filename=sales.csv&dayfirst={dayfirst}" + ("&confirm=1" if confirm else "")
    return env.web_client.post("/api/account/sales/import" + qs, content=data,
                               headers={**H, "Content-Type": "text/csv"})


def test_an_upload_previews_before_it_saves(acc):
    r = upload(acc, confirm=False)
    assert r.status_code == 200 and r.json()["stored"] is False
    assert r.json()["rows"] == 3 and r.json()["columns"]["amount"] == "Total Amount"
    assert acc.web_client.get("/api/account/sales").json()["has_sales"] is False  # nothing stored yet
    assert upload(acc).json()["stored"] is True
    assert acc.web_client.get("/api/account/sales").json()["rows"] == 3


def test_the_summary_adds_up(acc):
    upload(acc)
    f = acc.web_client.get("/api/account/sales").json()
    assert f["has_sales"] and f["currency"] == "INR"
    assert round(f["this_week"]["revenue"]) == 2550      # 1250 + 1500 - 200
    assert round(f["this_week"]["cost"]) == 490          # 3 x 30 + 1 x 400
    assert round(f["this_week"]["profit"]) == 2060
    assert f["top_products"][0]["product"] == "Birthday Cake"


def test_profit_is_left_blank_when_the_file_has_no_costs(acc):
    upload(acc, b"Date,Amount\n25/03/2026,100\n26/03/2026,150\n")
    f = acc.web_client.get("/api/account/sales").json()
    assert f["has_cost"] is False and f["profit"] is None  # never imply a profit we can't know


def test_a_projection_needs_more_than_one_week(acc):
    upload(acc)
    assert acc.web_client.get("/api/account/sales").json()["projection"] is None
    rows = b"Date,Amount\n" + b"".join(
        f"{2 + 7 * w:02d}/03/2026,{100 * (w + 1)}\n".encode() for w in range(4))
    upload(acc, rows)
    f = acc.web_client.get("/api/account/sales").json()
    assert f["projection"] is not None and f["projection"] >= 0


def test_a_projection_from_thin_data_says_so(acc):
    upload(acc, b"Date,Amount\n02/03/2026,100\n09/03/2026,120\n")
    f = acc.web_client.get("/api/account/sales").json()
    assert f["projection"] is not None and f["low_confidence"] is True


def test_a_projection_never_goes_below_zero():
    assert project_next([500.0, 300.0, 100.0]) == 0.0
    assert project_next([100.0]) is None


def test_an_import_can_be_removed(acc):
    import_id = upload(acc).json()["import_id"]
    acc.web_client.post(f"/api/account/sales/{import_id}/delete", json={}, headers=H)
    f = acc.web_client.get("/api/account/sales").json()
    assert f["has_sales"] is False and f["imports"] == []


def test_one_account_never_sees_another_account_sales(acc):
    upload(acc)
    other = TestClient(acc.app, base_url="https://app.weave.xyz")
    signup(acc, "ana", client=other)
    assert other.get("/api/account/sales").json()["has_sales"] is False
    # ...and cannot delete someone else's import either
    import_id = acc.web_client.get("/api/account/sales").json()["imports"][0]["id"]
    assert other.post(f"/api/account/sales/{import_id}/delete", json={}, headers=H).json()["removed"] == 0
    assert acc.web_client.get("/api/account/sales").json()["rows"] == 3


def test_uploading_needs_a_session(acc):
    anon = TestClient(acc.app, base_url="https://app.weave.xyz")
    r = anon.post("/api/account/sales/import?confirm=1", content=SALES,
                  headers={**H, "Content-Type": "text/csv"})
    assert r.status_code == 401


def test_the_raw_file_is_never_written_to_disk(acc):
    upload(acc)
    holding = {p.name for p in acc.settings.data_dir.rglob("*")
               if p.is_file() and "Croissant" in p.read_bytes().decode("utf-8", "replace")}
    # The rows live in the database (or its write-ahead log until the next checkpoint) and nowhere else:
    # no copy of the upload, no temp file, nothing named after it.
    assert holding and holding <= {"sms.sqlite3", "sms.sqlite3-wal", "sms.sqlite3-journal"}
    assert not list(acc.settings.data_dir.rglob("*.csv"))


# ---------- the size carve-out in the middleware ----------
def test_a_sales_upload_may_be_larger_than_other_requests():
    assert body_limit("/api/account/sales/import") == CSV_BODY_BYTES
    assert body_limit("/api/account/me") == MAX_BODY_BYTES
    assert body_limit("/api/account/sales/importX") == MAX_BODY_BYTES   # exact path, never a prefix
    assert body_limit("/api/report") == MAX_BODY_BYTES


def test_an_oversized_upload_is_refused_by_the_middleware(acc):
    big = b"Date,Amount\n" + b"01/01/2026,1\n" * 200_000
    assert len(big) > CSV_BODY_BYTES
    r = acc.web_client.post("/api/account/sales/import?confirm=1", content=big,
                            headers={**H, "Content-Type": "text/csv"})
    assert r.status_code == 413


def test_other_endpoints_keep_the_small_cap(acc):
    r = acc.web_client.post("/api/report", content=b"x" * 20_000,
                            headers={**H, "Content-Type": "application/json"})
    assert r.status_code == 413


# ---------- what people are told ----------
def test_the_sales_reply_fits_and_keeps_its_numbers():
    f = {"has_sales": True, "currency": "INR", "delta_pct": 18, "has_cost": True, "losing_money": False,
         "this_week": {"revenue": 48200.0, "profit": 12400.0, "cost": 35800.0, "units": 310},
         "top_products": [{"product": "Birthday Cake", "revenue": 18000, "units": 12}],
         "projection": 51000.0, "low_confidence": False}
    text = M.sales_text(f)
    assert len(text) <= M.MAX_CHARS and text == M.ascii_safe(text)
    assert "48,200" in text and "up 18%" in text and "12,400" in text


def test_a_loss_is_called_a_loss():
    f = {"has_sales": True, "currency": "", "delta_pct": -30, "has_cost": True, "losing_money": True,
         "this_week": {"revenue": 500.0, "profit": -200.0, "cost": 700.0, "units": 10},
         "top_products": [], "projection": None, "low_confidence": True}
    text = M.sales_text(f)
    assert "down 30%" in text and "Loss: 200" in text


def test_asking_about_sales_in_chat(acc):
    upload(acc)
    acc.text(MEMBER, "SALES")
    assert "2,550" in acc.last(MEMBER)
    acc.text(MEMBER, "how are my sales doing?")
    assert "2,550" in acc.last(MEMBER)


def test_sales_questions_fall_back_to_the_website_when_there_are_no_figures(acc):
    visit(acc)
    acc.sms.flush_analytics()
    acc.text(MEMBER, "how's my business doing?")
    assert "visit" in acc.last(MEMBER)  # no sales uploaded, so it answers about the site


def test_without_an_upload_sales_explains_how(acc):
    acc.text(MEMBER, "SALES")
    assert "Upload a CSV" in acc.last(MEMBER)


def test_a_week_in_progress_is_not_compared_against_a_finished_one(acc):
    """Uploading on a Tuesday must not look like the business collapsed: two days against seven."""
    from weave.analytics.metrics import MONDAY_OFFSET, sales_summary, week_start

    # "Now" is the Tuesday of the latest week, so that week has two days in it and is still running.
    account = acc.store.account_by("username", "sam")["id"]
    this_monday = week_start(2_900)
    rows = [(this_monday - 7 + d, "Bun", 1, 100.0, 0.0) for d in range(7)]      # a full week: 700
    rows += [(this_monday + d, "Bun", 1, 100.0, 0.0) for d in range(2)]         # two days so far: 200
    acc.store.add_sales(account, "t.csv", rows, 0, "INR", time.time())
    f = sales_summary(acc.store, account, now=(this_monday + 1) * 86_400)

    assert f["in_progress"] is True
    assert f["this_week"]["revenue"] == 200
    assert f["last_week"]["revenue"] == 200   # the same two days of last week, not all seven
    assert f["delta_pct"] == 0                # flat, which is the truth - not "down 71%"
    assert "so far this week" in M.sales_text(f)


def test_the_forecast_ignores_a_week_that_has_not_finished(acc):
    from weave.analytics.metrics import sales_summary, week_start

    account = acc.store.account_by("username", "sam")["id"]
    monday = week_start(2_900)
    rows = [(monday - 7 * w + d, "Bun", 1, 1000.0, 0.0) for w in range(1, 5) for d in range(7)]
    rows += [(monday, "Bun", 1, 50.0, 0.0)]   # one slow day of the week in progress
    acc.store.add_sales(account, "t.csv", rows, 0, "INR", time.time())
    f = sales_summary(acc.store, account, now=monday * 86_400)
    # A single quiet day must not drag the forecast down towards it.
    assert f["projection"] > 5_000


def test_old_figures_are_named_by_their_date_not_called_last_week(acc):
    """A file of last spring's takings must not be reported as if it were this week's."""
    from weave.analytics.metrics import sales_summary, week_start

    account = acc.store.account_by("username", "sam")["id"]
    spring = week_start(2_880)
    acc.store.add_sales(account, "t.csv", [(spring + d, "Bun", 1, 100.0, 0.0) for d in range(7)],
                        0, "INR", time.time())
    f = sales_summary(acc.store, account, now=(spring + 120) * 86_400)
    assert f["stale"] is True and f["in_progress"] is False
    text = M.sales_text(f)
    assert "week of" in text and "last week" not in text


# ---------- the flush thread has to live where the views are ----------
def test_views_are_still_written_when_the_worker_runs_in_another_process(settings, tmp_path):
    """With WEAVE_SMS_WORKER=external the build threads move to a second process, but visits are buffered
    in this one. If the writer went with them, every visit would pile up unwritten and the dashboard would
    quietly read zero for ever - with no error anywhere to say so."""
    from weave.server import create_app

    settings.website_deploy, settings.sites_domain = "weave", "weave.xyz"
    settings.trust_proxy = True
    settings.sms_worker = "external"          # the build and outbox threads belong to another process now
    settings.analytics_flush_seconds = 1

    app = create_app(settings)                 # start_sms_worker left alone, as in production
    store = app.state.sms.store
    store.create_account(username="sam", call_sign="Sam", email="sam@example.com")
    site = settings.user_sites_dir / "sam" / "brew-haven"
    site.mkdir(parents=True)
    (site / "index.html").write_text("<html><body>hi</body></html>")

    with TestClient(app) as live:              # entering the context runs the app's startup
        names = {t.name for t in threading.enumerate()}
        assert "sms-analytics" in names                            # stayed behind with the buffer...
        assert not any(n.startswith("sms-jobs") for n in names)    # ...while the build lanes did not

        live.get("/brew-haven/", headers={"host": "sam.weave.xyz", "x-forwarded-for": "203.0.113.7",
                                          "user-agent": PHONE})
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and not store.all("SELECT * FROM site_views"):
            time.sleep(0.2)
        assert len(store.all("SELECT * FROM site_views")) == 1


def test_the_flush_thread_is_only_started_once(acc):
    acc.sms.start_analytics()
    acc.sms.start_analytics()
    assert sum(1 for t in acc.sms._threads if t.name == "sms-analytics") == 1
    acc.sms.stop()


# ---------- Phase 4: weekly AI digest and tips ----------
def test_digest_facts_merges_traffic_leads_and_sales_without_raw_rows(acc):
    """The digest receives only merged aggregates - never a raw row or customer name."""
    from weave.analytics.digest import digest_facts
    from weave.analytics.metrics import week_start

    account = acc.store.account_by("username", "sam")["id"]
    now = 1_700_000_000.0
    acc.sms.views.record(View(account_id=account, slug="brew-haven", page="index.html",
                              day=collector.utc_day(now), ts=now, visitor="v1", device="mobile"))
    acc.sms.views.record(View(account_id=account, slug="brew-haven", page="index.html",
                              day=collector.utc_day(now), ts=now + 1, visitor="v2", device="mobile",
                              ref="instagram.com"))
    acc.sms.flush_analytics()

    acc.store.add_lead(account, "brew-haven", "Alice", "alice@example.com", "Need coffee for event", now)
    w = collector.utc_day(now)
    acc.store.add_sales(account, "sales.csv", [(w, "Espresso", 10, 50.0, 2.0)], 0, "USD", now)

    f = digest_facts(acc.store, account, now=now)
    assert f["views"] == 2
    assert f["visitors"] == 2
    assert f["leads"] == 1
    assert f["has_sales"] is True
    assert f["revenue"] == 50.0
    assert f["profit"] == 30.0
    assert f["top_product"] == "Espresso"
    assert f["top_ref"] == "instagram.com"
    assert "Alice" not in str(f)
    assert "alice@example.com" not in str(f)
    assert "v1" not in str(f)


def test_select_tip_anchored_strictly_to_facts():
    """Tips must be constrained to facts and never invent advice."""
    from weave.analytics.digest import select_tip

    assert "Costs exceeded revenue" in select_tip({"losing_money": True})
    assert "enquir" in select_tip({"losing_money": False, "leads": 2})
    assert "Mocha" in select_tip({"losing_money": False, "leads": 0, "top_product": "Mocha"})
    assert "mobile" in select_tip({"losing_money": False, "leads": 0, "mobile_pct": 85})


def test_digest_text_never_chops_numbers_under_tight_limits():
    """Hard truncation like M.fit would cut 1500 to 15; digest_text drops clauses cleanly."""
    from weave.analytics.digest import digest_text

    facts = {
        "views": 150, "visitors": 120, "views_delta_pct": 25, "low_data": False,
        "leads": 12, "has_sales": True, "currency": "USD", "revenue": 12500.0,
        "sales_delta_pct": 15, "has_cost": True, "profit": 4500.0, "losing_money": False,
        "top_product": "Premium Beans", "top_ref": "instagram.com", "has_data": True,
        "tip": "Tip: Most visitors came from instagram.com — regular posts there can drive steady traffic."
    }
    short = digest_text(facts, limit=120)
    assert len(short) <= 120
    for word in short.replace("$", "").replace(",", "").split():
        if word.isdigit():
            assert int(word) in (150, 120, 25, 12, 12500, 15, 4500)


def test_housekeeping_runs_weekly_digest_on_monday_and_is_idempotent(acc):
    """Weekly digest only runs on Monday (day % 7 == 4 since day 0 was Thursday), and running twice does not duplicate."""
    from weave.analytics.metrics import MONDAY_OFFSET, week_of, week_start

    account = acc.store.account_by("username", "sam")["id"]
    monday_day = week_start(2000)
    monday_ts = monday_day * 86_400 + 3600.0
    tuesday_ts = (monday_day + 1) * 86_400 + 3600.0

    acc.sms.views.record(View(account_id=account, slug="brew-haven", page="index.html",
                              day=monday_day - 2, ts=monday_ts - 86_400, visitor="v1", device="desktop"))
    acc.sms.flush_analytics()

    res_tue = acc.sms.housekeeping(now=tuesday_ts)
    assert res_tue["digests"] == 0
    assert acc.store.latest_digest(account) is None

    res_mon = acc.sms.housekeeping(now=monday_ts)
    assert res_mon["digests"] == 1
    d = acc.store.latest_digest(account)
    assert d is not None
    assert d["week"] == week_of(monday_day)
    assert "visits" in d["body"]

    res_mon2 = acc.sms.housekeeping(now=monday_ts)
    assert res_mon2["digests"] == 0


def test_digest_command_in_chat(acc):
    """Sending DIGEST or asking for weekly tips returns the digest on chat."""
    account = acc.store.account_by("username", "sam")["id"]
    now = time.time()
    acc.sms.views.record(View(account_id=account, slug="brew-haven", page="index.html",
                              day=collector.utc_day(now), ts=now, visitor="v1", device="mobile"))
    acc.sms.flush_analytics()

    acc.text(MEMBER, "DIGEST")
    acc.drain()
    last = acc.store.conversation(acc.store.account_user(account)["id"])[-1]
    assert "visits" in last["body"] or "week" in last["body"].lower()

    acc.text(MEMBER, "send me my weekly digest")
    acc.drain()
    last2 = acc.store.conversation(acc.store.account_user(account)["id"])[-1]
    assert "Tip:" in last2["body"] or "visits" in last2["body"]


def test_digest_api_endpoints(acc):
    """GET /api/account/digest returns latest digest; POST /api/account/digest/generate refreshes it."""
    account = acc.store.account_by("username", "sam")["id"]
    now = time.time()
    acc.sms.views.record(View(account_id=account, slug="brew-haven", page="index.html",
                              day=collector.utc_day(now), ts=now, visitor="v1", device="desktop"))
    acc.sms.flush_analytics()

    res = acc.web_client.get("/api/account/digest", headers=H)
    assert res.status_code == 200
    assert res.json()["has_digest"] is False

    res_gen = acc.web_client.post("/api/account/digest/generate", headers=H)
    assert res_gen.status_code == 200
    data = res_gen.json()
    assert data["has_digest"] is True
    assert "visits" in data["body"]

    res_after = acc.web_client.get("/api/account/digest", headers=H)
    assert res_after.status_code == 200
    assert res_after.json()["has_digest"] is True
    assert res_after.json()["body"] == data["body"]


def test_nlg_number_preservation_guard_reverts_if_model_rounds_numbers(settings):
    """If the LLM rounds 42 to 40 or alters any multi-digit number, NlgPresenter reverts to deterministic copy."""
    from types import SimpleNamespace
    from weave.sms.nlg import NlgPresenter
    from weave.analytics.digest import generate_digest

    class RoundingAi:
        configured = True
        def _structured(self, system, prompt, schema, attempts, model, timeout):
            return SimpleNamespace(message="Here is your update: about 40 visits this week."), {}

    settings.nlg_enabled = True
    ai = RoundingAi()
    nlg = NlgPresenter(settings, ai)

    class DummyStore:
        def view_totals(self, *a): return {"views": 42, "visitors": 30}
        def views_by_day(self, *a): return []
        def device_split(self, *a): return {}
        def first_view_day(self, *a): return 100
        def top_pages(self, *a): return []
        def top_refs(self, *a): return []
        def lead_count(self, *a, **k): return 0
        def sales_span(self, *a): return {"rows": 0}

    facts, text = generate_digest(DummyStore(), 1, nlg=nlg, limit=1500, unicode=True)
    assert "42 visits" in text
    assert "about 40" not in text


