"""Each account's own data (products, menu, stock): seeding from a new site, the live page showing it, the
dashboard API, and changes from chat. Gemini, Gradle and the weave bridge are faked as in test_unified."""

import json

import pytest
from fastapi.testclient import TestClient
from test_accounts import CLIENT, H, MEMBER, google, link, signup  # noqa: F401 - google is a fixture
from test_unified import UEnv, with_brain
from test_website import ok

from weave.site.data import chat_change, data_snippet, lists_in, public_payload
from weave.sms.brain import ChatDecision

SHOP = """<!DOCTYPE html><html><head><title>Chai Point</title></head><body><h1>Chai Point</h1>
<section><div class="grid" data-weave-list="products">
  <article data-weave-item><img data-weave-field="image" src="https://images.unsplash.com/photo-1"
    alt="Chai"><h3 data-weave-field="name">Masala Chai</h3><p data-weave-field="description">Ginger and
    cardamom</p><span data-weave-field="price">₹30</span><span data-weave-field="stock">40</span></article>
  <article data-weave-item><img data-weave-field="image" src="https://images.unsplash.com/photo-2"
    alt="Samosa"><h3 data-weave-field="name">Samosa</h3><p data-weave-field="description">Two per plate</p>
    <span data-weave-field="price">Rs. 1,200.50</span><span data-weave-field="stock">3</span></article>
</div></section></body></html>"""


@pytest.fixture
def shop(settings, tmp_path, google):
    """A signed-up account with a linked phone and one live site, sam.weave.xyz/chai-point/, that lists products."""
    settings.website_deploy = "weave"
    settings.sites_domain = "weave.xyz"
    settings.sms_signup = "account"
    settings.google_client_id, settings.google_client_secret = CLIENT, "secret"
    env = UEnv(settings, tmp_path, results=[ok(html=SHOP), ok(html=SHOP), ok()])
    env.web_client = TestClient(env.app, base_url="https://app.weave.xyz")
    signup(env)
    link(env)
    env.text(MEMBER, "Create a website for my chai shop called Chai Point")
    env.drain()
    env.account_id = env.store.account_by("username", "sam")["id"]
    return env


def page(env):
    slug = env.store.all("SELECT slug FROM projects WHERE slug IS NOT NULL")[0]["slug"]
    return env.client.get(f"/{slug}/", headers={"host": "sam.weave.xyz"})


def products(env):
    t = env.store.data_table(env.account_id, "products")
    return t, env.store.data_rows(t["id"])


# ---------- reading a page ----------
def test_lists_are_read_from_the_page():
    found = lists_in(SHOP)
    assert [i["name"] for i in found["products"]] == ["Masala Chai", "Samosa"]
    assert found["products"][0] == {"image": "https://images.unsplash.com/photo-1", "name": "Masala Chai",
                                    "description": "Ginger and cardamom", "price": "₹30", "stock": "40"}
    assert lists_in("<p>no lists</p>") == {} and lists_in("<div data-weave-list='x'><b") == {}


# ---------- publishing ----------
def test_a_new_site_seeds_the_owners_products(shop):
    t, rows = products(shop)
    assert t["currency"] == "₹" and {f["key"]: f["type"] for f in t["fields"]}["price"] == "money"
    assert [r["data"]["name"] for r in rows] == ["Masala Chai", "Samosa"]
    assert rows[0]["data"]["price"] == 30 and rows[1]["data"]["price"] == 1200.5 and rows[1]["data"]["stock"] == 3


def test_a_rebuild_never_overwrites_the_owners_data(shop):
    t, rows = products(shop)
    shop.store.update_data_row(t["id"], rows[0]["id"], {**rows[0]["data"], "price": 35})
    shop.text(MEMBER, "make the header darker")
    shop.drain()
    _, again = products(shop)
    assert again[0]["data"]["price"] == 35 and len(again) == 2


# ---------- the live page ----------
def test_the_live_page_carries_the_data_and_follows_changes(shop):
    first = page(shop)
    assert first.status_code == 200 and "window.WEAVE_DATA=" in first.text and "data-weave-out" in first.text
    payload = json.loads(first.text.split("window.WEAVE_DATA=", 1)[1].split(";</script>", 1)[0])
    assert payload["products"]["rows"][0]["name"] == "Masala Chai" and payload["products"]["types"]["price"] == "money"

    t, rows = products(shop)
    shop.store.update_data_row(t["id"], rows[0]["id"], {**rows[0]["data"], "price": 45})
    second = page(shop)
    assert '"price":45' in second.text and second.headers["etag"] != first.headers["etag"]
    assert shop.client.get(first.request.url, headers={"host": "sam.weave.xyz",
                                                        "if-none-match": second.headers["etag"]}).status_code == 304


def test_private_tables_stay_off_the_site(shop):
    t, _ = products(shop)
    shop.store.update_data_table(t["id"], public=False)
    assert "WEAVE_DATA" not in page(shop).text


def test_data_cannot_break_out_of_the_script():
    blob = data_snippet({"products": {"currency": "₹", "types": {"name": "text"},
                                      "rows": [{"name": "</script><script>alert(1)</script>"}]}}, 1.0).decode()
    assert "</script><script>alert" not in blob and "\\u003c/script\\u003e" in blob


# ---------- dashboard API ----------
def test_dashboard_api(shop):
    c = shop.web_client
    assert [t["name"] for t in c.get("/api/account/data").json()["tables"]] == ["products"]
    menu = c.post("/api/account/data", json={"preset": "menu"}, headers=H).json()
    assert menu["name"] == "menu" and "available" in [f["key"] for f in menu["fields"]]
    assert c.post("/api/account/data", json={"preset": "menu"}, headers=H).status_code == 400  # already there
    assert c.post("/api/account/data", json={"preset": "menu"}).status_code == 403  # no X-Weave header

    row = c.post("/api/account/data/menu/rows", json={"data": {"name": "Thali", "price": "₹180", "available": "yes",
                                                                "image": "javascript:alert(1)", "junk": "x"}},
                 headers=H).json()["id"]
    got = c.get("/api/account/data/menu").json()["rows"][0]
    assert got["id"] == row and got["data"] == {"name": "Thali", "price": 180, "available": True, "image": ""}
    assert c.post(f"/api/account/data/menu/rows/{row}", json={"data": {"name": "Thali", "price": 200}},
                  headers=H).json() == {"ok": True}

    csv_text = c.get("/api/account/data/menu/export.csv").text
    assert csv_text.splitlines()[0] == "Dish,Price,Section,Description,Available,Photo" and "Thali,200" in csv_text
    r = c.post("/api/account/data/menu/import", content="Dish,Price\nDosa,90\nIdli,60\n".encode(),
               headers={**H, "Content-Type": "text/csv"})
    assert r.json() == {"rows": 2}
    assert [x["data"]["name"] for x in c.get("/api/account/data/menu").json()["rows"]] == ["Dosa", "Idli"]
    assert c.post("/api/account/data/menu/delete", json={}, headers=H).json() == {"ok": True}
    assert c.get("/api/account/data/menu").status_code == 404


def test_another_account_cannot_see_the_data(shop):
    other = TestClient(shop.app, base_url="https://app.weave.xyz")
    assert other.get("/api/account/data/products").status_code == 401


def test_deleting_the_account_deletes_its_data(shop):
    shop.web_client.post("/api/account/delete", json={"confirm": "sam"}, headers=H)
    assert shop.store.all("SELECT * FROM data_tables") == [] and shop.store.all("SELECT * FROM data_rows") == []


# ---------- chat ----------
def test_chat_changes(shop):
    a = shop.account_id
    assert "Samosa: 3 left" in chat_change(shop.store, a, "low", None, None, None, None)
    assert chat_change(shop.store, a, "stock_set", None, "masala chai", 12, None) == "Masala Chai: 12 in stock."
    assert chat_change(shop.store, a, "stock_remove", None, "chai", 20, None).startswith("Masala Chai: 0 in stock")
    assert chat_change(shop.store, a, "stock_add", None, "samosas", 5, None) == "Samosa: 8 in stock."
    assert "₹25" in chat_change(shop.store, a, "price", None, "chai", 25, None)
    assert "Added Veg Puff" in chat_change(shop.store, a, "add_item", None, "Veg Puff", 30, "40")
    assert "Veg Puff, ₹30, 40 left" in chat_change(shop.store, a, "list", None, None, None, None)
    assert "couldn't find" in chat_change(shop.store, a, "price", None, "pizza", 99, None)
    assert chat_change(shop.store, a, "remove_item", None, "veg puff", None, None).startswith("Removed Veg Puff")
    _, rows = products(shop)
    assert [(r["data"]["name"], r["data"]["stock"], r["data"]["price"]) for r in rows] == [
        ("Masala Chai", 0, 25), ("Samosa", 8, 1200.5)]


def test_stock_over_whatsapp_uses_what_really_changed(shop):
    with_brain(shop, ChatDecision(reply="Done, chai is 99 now!", action="stock", op="stock_set", item="chai",
                                  quantity=7))
    shop.text(MEMBER, "chai stock 7")
    assert shop.last(MEMBER) == "Masala Chai: 7 in stock."
    assert "- products (2 items; fields:" in shop.ai.contexts[-1] and "Masala Chai (7 left)" not in shop.ai.contexts[-1]


def test_the_page_payload_only_has_known_fields(shop):
    t, rows = products(shop)
    shop.store.update_data_row(t["id"], rows[0]["id"], {**rows[0]["data"], "secret": "x"})
    assert "secret" not in json.dumps(public_payload(shop.store, shop.account_id))


def test_disconnecting_stitch_keeps_the_data(shop):
    shop.web_client.post("/api/account/stitch/disconnect", json={}, headers=H)
    assert products(shop)[1]
