"""Tests for Veave Pharmacy & Medical Store feature (Phase 1).

Covers:
1. Business onboarding intent & pharmacy type detection
2. CSV inventory parsing & multi-item bulk setup
3. Chat inventory addition and inventory queries
4. Stock depletion alert ('Paracetamol got over') & proactive bulk distributor reordering
"""

import pytest
from test_sms import OWNER
from test_unified import u  # noqa: F401 - fixture

from weave.sms.pharmacy import (
    parse_business_onboarding_intent,
    parse_business_type,
    parse_csv_inventory,
    parse_inventory_update,
    parse_medicine_search_request,
    parse_single_item_addition,
)


def test_business_onboarding_parsers():
    assert parse_business_onboarding_intent("I want to integrate Veave into my business")
    assert parse_business_onboarding_intent("integrate veave with my business")
    assert parse_business_onboarding_intent("Can I integrate Veave into my shop?")
    assert parse_business_onboarding_intent("How to integrate Veave into my business")
    assert not parse_business_onboarding_intent("Hello how are you")

    assert parse_business_type("It's a pharmacy store") == "pharmacy"
    assert parse_business_type("medical store") == "pharmacy"
    assert parse_business_type("chemist shop") == "pharmacy"
    assert parse_business_type("pharmacy") == "pharmacy"
    assert parse_business_type("bakery") is None


def test_csv_inventory_parser():
    csv_content = """Item, Price, Stock, Threshold, Unit
Paracetamol 650mg, 20, 50, 5, strip
Dolo 650, 30, 100, 10, strip
Cough Syrup, 85, 20, 3, bottle
"""
    items = parse_csv_inventory(csv_content)
    assert len(items) == 3
    assert items[0]["item_name"] == "Paracetamol 650mg"
    assert items[0]["price_paise"] == 2000
    assert items[0]["stock_quantity"] == 50
    assert items[0]["low_stock_threshold"] == 5
    assert items[0]["unit"] == "strip"

    assert items[1]["item_name"] == "Dolo 650"
    assert items[1]["price_paise"] == 3000
    assert items[1]["stock_quantity"] == 100

    assert items[2]["item_name"] == "Cough Syrup"
    assert items[2]["price_paise"] == 8500
    assert items[2]["stock_quantity"] == 20
    assert items[2]["unit"] == "bottle"


def test_csv_headerless_parser():
    csv_content = """Paracetamol, 20, 50
Cetirizine 10mg, 15, 80, 5, strip
"""
    items = parse_csv_inventory(csv_content)
    assert len(items) == 2
    assert items[0]["item_name"] == "Paracetamol"
    assert items[0]["price_paise"] == 2000
    assert items[0]["stock_quantity"] == 50


def test_single_item_addition_parser():
    res1 = parse_single_item_addition("Add 50 strips of Paracetamol 650mg at ₹20 per strip, threshold 5")
    assert res1 is not None
    assert res1["item_name"] == "Paracetamol 650mg"
    assert res1["stock_quantity"] == 50
    assert res1["price_paise"] == 2000
    assert res1["low_stock_threshold"] == 5
    assert res1["unit"] == "strip"

    res2 = parse_single_item_addition("Add 20 bottles of Cough Syrup for 85 rupees")
    assert res2 is not None
    assert "Cough Syrup" in res2["item_name"]
    assert res2["stock_quantity"] == 20
    assert res2["price_paise"] == 8500
    assert res2["unit"] == "bottle"


def test_inventory_update_parser():
    item1, stock1 = parse_inventory_update("Paracetamol got over")
    assert item1 == "Paracetamol"
    assert stock1 == 0

    item2, stock2 = parse_inventory_update("Dolo 650 is out of stock")
    assert item2 == "Dolo 650"
    assert stock2 == 0

    item3, stock3 = parse_inventory_update("Paracetamol khatam ho gaya")
    assert item3 == "Paracetamol"
    assert stock3 == 0

    item4, stock4 = parse_inventory_update("Update Paracetamol stock to 15")
    assert item4 == "Paracetamol"
    assert stock4 == 15


def test_medical_store_onboarding_and_csv_upload_flow(u):
    # 1. User arrives and asks to integrate Veave into business
    u.text(OWNER, "I want to integrate Veave into my business")
    reply1 = u.last()
    assert "What type of business is it?" in reply1

    # 2. User specifies pharmacy store
    u.text(OWNER, "It's a pharmacy store")
    reply2 = u.last()
    assert "Welcome to Weave for Medical Stores!" in reply2
    assert "CSV file" in reply2 or "prices" in reply2

    # 3. User sends CSV with inventory
    csv_text = (
        "Item, Price, Stock, Threshold\n"
        "Paracetamol 650mg, 20, 50, 5\n"
        "Dolo 650, 30, 100, 10\n"
        "Cough Syrup, 85, 25, 3"
    )
    u.text(OWNER, csv_text)
    reply3 = u.last()
    assert "Added 3 items to your pharmacy inventory" in reply3
    assert "Paracetamol 650mg" in reply3
    assert "Dolo 650" in reply3

    # 4. User queries their inventory
    u.text(OWNER, "Check inventory")
    reply4 = u.last()
    assert "Inventory" in reply4
    assert "Paracetamol 650mg: 50" in reply4
    assert "Dolo 650: 100" in reply4


def test_medical_store_item_addition_out_of_stock_alert_and_bulk_reorder(u):
    # 1. Shopkeeper adds item directly via chat
    u.text(OWNER, "Add 50 strips of Paracetamol at ₹20 each, threshold 5")
    reply1 = u.last()
    assert "Added Paracetamol to inventory" in reply1
    assert "50 strips" in reply1
    assert "20" in reply1

    # 2. Suppose paracetamol got over -> triggers low stock alert and bulk suggestion
    u.text(OWNER, "paracetamol got over")
    reply2 = u.last()
    assert "less in the inventory" in reply2
    assert "bulk" in reply2
    assert "Paracetamol" in reply2

    # 3. Shopkeeper replies "YES" to approve bulk reorder
    u.text(OWNER, "YES")
    reply3 = u.last()
    assert "Bulk distributor order placed" in reply3
    assert "Paracetamol" in reply3
    assert "DIST-" in reply3


def test_flexible_intent_recognition_without_hard_presets():
    # Various natural language ways to express wanting to integrate Weave/the agent
    assert parse_business_onboarding_intent("How can I integrate this agent into my retail business?")
    assert parse_business_onboarding_intent("Can we connect Weave with our store?")
    assert parse_business_onboarding_intent("I want to onboard my shop onto Weave")
    assert parse_business_onboarding_intent("Automate my business using this bot")
    assert parse_business_onboarding_intent("I run a pharmacy store and want to use Weave")
    assert parse_business_onboarding_intent("Can I use this AI assistant for my medical shop?")
    assert parse_business_onboarding_intent("apne business me weave use karna hai")

    # Directly declaring pharmacy in initial request
    assert parse_business_type("I run a pharmacy store and want to use Weave") == "pharmacy"
    assert parse_business_type("medical store") == "pharmacy"
    assert parse_business_type("chemist") == "pharmacy"


def test_dual_agent_customer_search_order_and_manual_payment_flow(u):
    from test_unified import MEMBER

    # 1. Shopkeeper sets up pharmacy with Paracetamol inventory
    u.text(OWNER, "Add 50 strips of Paracetamol at ₹20 each, threshold 5")
    assert "Added Paracetamol to inventory" in u.last(to=OWNER)

    # 2. Customer user (with their own Weave agent) asks for medicine
    u.link_member(MEMBER)
    u.text(MEMBER, "I need two strips of paracetamol, where can I find it?")
    cust_reply1 = u.last(to=MEMBER)
    assert "Medical Store" in cust_reply1
    assert "Paracetamol" in cust_reply1
    assert "20" in cust_reply1
    assert "40" in cust_reply1
    assert "place an order" in cust_reply1

    # 3. Customer confirms order
    u.text(MEMBER, "Yes")
    cust_reply2 = u.last(to=MEMBER)
    assert "Order placed" in cust_reply2
    assert "2 strips" in cust_reply2
    assert "40" in cust_reply2

    # 4. Shopkeeper's agent notifies shopkeeper and asks if payment slip/link should be sent
    owner_alert = u.last(to=OWNER)
    assert "New Order" in owner_alert
    assert "2 strips" in owner_alert
    assert "40" in owner_alert
    assert "payment slip or payment link" in owner_alert

    # 5. Shopkeeper replies "Yes"
    u.text(OWNER, "Yes")
    owner_conf = u.last(to=OWNER)
    assert "Payment link sent to customer" in owner_conf

    # 6. Customer receives the payment link
    cust_link_msg = u.last(to=MEMBER)
    assert "Payment link" in cust_link_msg
    assert "/pay/pay_med_" in cust_link_msg

    # Extract payment token
    token = None
    for word in cust_link_msg.split():
        if "/pay/pay_med_" in word:
            token = word.split("/pay/")[-1].strip()
            break
    assert token is not None

    # Check checkout page renders properly
    resp = u.client.get(f"/pay/{token}")
    assert resp.status_code == 200
    assert "Medical Store" in resp.text
    assert "Paracetamol" in resp.text
    assert "40.00" in resp.text

    # 7. Customer completes payment
    resp_done = u.client.post(f"/pay/{token}/complete")
    assert resp_done.status_code == 200
    assert "Payment Received" in resp_done.text

    # 8. Check that customer is informed
    cust_paid_msg = u.last(to=MEMBER)
    assert "Payment of Rs. 40 confirmed" in cust_paid_msg
    assert "collect your order" in cust_paid_msg

    # 9. Verify CRUCIAL PROMPT REQUIREMENT:
    # Shopkeeper gets pinged that customer is on their way to collect order, please keep it ready!
    owner_pickup_msg = u.last(to=OWNER)
    assert "Payment received" in owner_pickup_msg
    assert "on their way to come and collect" in owner_pickup_msg
    assert "keep it ready" in owner_pickup_msg


def test_dual_agent_automated_payment_link_flow(u):
    from test_unified import MEMBER

    # 1. Shopkeeper sets up pharmacy inventory
    u.text(OWNER, "Add 50 strips of Paracetamol at ₹20 each, threshold 5")

    # 2. Shopkeeper enables automated payment links
    u.text(OWNER, "Automate payment links")
    reply_auto = u.last(to=OWNER)
    assert "Automated payment links enabled" in reply_auto

    # 3. Customer asks for paracetamol and confirms order
    u.link_member(MEMBER)
    u.text(MEMBER, "I need two strips of paracetamol, where can I find it?")
    u.text(MEMBER, "Yes")

    # 4. In automated mode, the customer IMMEDIATELY receives payment link without asking shopkeeper first!
    cust_msg = u.last(to=MEMBER)
    assert "Payment link" in cust_msg
    assert "/pay/pay_med_" in cust_msg

    # Shopkeeper is notified that link was automatically sent
    owner_msg = u.last(to=OWNER)
    assert "automatically sent to customer" in owner_msg


def test_pharmacy_dual_agent_flow_over_whatsapp(u):
    from test_unified import MEMBER

    wa_owner = "whatsapp:" + OWNER
    wa_member = "whatsapp:" + MEMBER

    # 1. Shopkeeper sets up inventory over WhatsApp
    u.text(wa_owner, "Add 50 strips of Paracetamol at ₹20 each, threshold 5")
    owner_reply = u.last(to=wa_owner)
    assert "Added Paracetamol to inventory" in owner_reply
    assert u.user(OWNER)["channel"] == "whatsapp"

    # 2. Customer links and searches for medicine over WhatsApp
    u.link_member(wa_member)
    u.text(wa_member, "I need two strips of paracetamol, where can I find it?")
    cust_reply = u.last(to=wa_member)
    assert "Medical Store" in cust_reply
    assert "Paracetamol" in cust_reply
    assert "20" in cust_reply
    assert "40" in cust_reply
    assert u.user(MEMBER)["channel"] == "whatsapp"

    # 3. Customer places order over WhatsApp
    u.text(wa_member, "Yes")
    cust_conf = u.last(to=wa_member)
    assert "Order placed" in cust_conf

    # 4. Shopkeeper gets WhatsApp alert
    owner_alert = u.last(to=wa_owner)
    assert "New Order" in owner_alert
    assert "2 strips" in owner_alert
    assert "payment slip or payment link" in owner_alert

    # 5. Shopkeeper sends payment link via WhatsApp
    u.text(wa_owner, "Yes")
    owner_link_conf = u.last(to=wa_owner)
    assert "Payment link sent to customer" in owner_link_conf

    # 6. Customer receives payment link over WhatsApp
    cust_link = u.last(to=wa_member)
    assert "/pay/pay_med_" in cust_link
    token = [w for w in cust_link.split() if "/pay/pay_med_" in w][0].split("/pay/")[-1]

    # 7. Customer pays via checkout page
    resp = u.client.post(f"/pay/{token}/complete")
    assert resp.status_code == 200

    # 8. Both parties get WhatsApp pickup alerts
    cust_pickup = u.last(to=wa_member)
    assert "Payment of Rs. 40 confirmed" in cust_pickup
    assert "collect your order" in cust_pickup

    owner_pickup = u.last(to=wa_owner)
    assert "Payment received" in owner_pickup
    assert "on their way to come and collect" in owner_pickup
    assert "keep it ready" in owner_pickup


def test_pharmacy_payment_completion_is_idempotent_no_duplicate_alerts(u):
    from test_unified import MEMBER

    u.text(OWNER, "Add 10 strips of Paracetamol at Rs. 20 each, threshold 2")
    u.link_member(MEMBER)
    u.text(MEMBER, "Where can I find 2 strips of Paracetamol?")
    u.text(MEMBER, "Yes")
    u.text(OWNER, "Yes")

    cust_msg = u.last(to=MEMBER)
    token = [w for w in cust_msg.split() if "/pay/pay_med_" in w][0].split("/pay/")[-1]

    # First completion
    resp1 = u.client.post(f"/pay/{token}/complete")
    assert resp1.status_code == 200
    owner_alerts_1 = len(u.all(to=OWNER))

    # Second completion (refresh / double tap)
    resp2 = u.client.post(f"/pay/{token}/complete")
    assert resp2.status_code == 200
    owner_alerts_2 = len(u.all(to=OWNER))

    # Must NOT have sent duplicate SMS alerts to owner
    assert owner_alerts_2 == owner_alerts_1


def test_pharmacy_low_stock_bulk_reorder_prompt_after_order_approval(u):
    from test_unified import MEMBER

    # Inventory with only 2 strips (threshold 3)
    u.text(OWNER, "Add 2 strips of Paracetamol at Rs. 20 each, threshold 3")
    u.link_member(MEMBER)
    u.text(MEMBER, "I need two strips of paracetamol, where can I find it?")
    u.text(MEMBER, "Yes")

    # Owner approves sending payment link
    u.text(OWNER, "Yes")
    reply = u.last(to=OWNER)
    assert "Payment link sent to customer" in reply
    assert "low in stock" in reply
    assert "bulk distributor reorder" in reply

    # Owner replies YES to order bulk reorder
    u.text(OWNER, "Yes")
    reorder_reply = u.last(to=OWNER)
    assert "Bulk distributor order placed" in reorder_reply
    assert "DIST-" in reorder_reply



