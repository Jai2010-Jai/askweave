"""Tests for Kirana Udhar (credit ledger), voice note extraction, proactive reminders,
and UPI WhatsApp payment deep links.
"""

import time
import pytest
from test_sms import OWNER
from test_unified import u  # noqa: F401 - fixture

from weave.sms.udhar import (
    clean_indian_phone,
    make_upi_deep_link,
    make_whatsapp_click_to_chat,
    parse_amount_paise,
    parse_due_day,
    parse_udhar_message,
)
from weave.sms.udhar_store import normalize_customer_name


# ---------- customer normalization & upi formatting ----------
def test_customer_name_normalization():
    assert normalize_customer_name("Mr. Rajesh") == "Rajesh"
    assert normalize_customer_name("Mr Rajesh") == "Rajesh"
    assert normalize_customer_name("Rajesh ji") == "Rajesh"
    assert normalize_customer_name("rajesh bhaiya") == "Rajesh"
    assert normalize_customer_name("Shri Ramesh Uncle") == "Ramesh"


def test_clean_indian_phone():
    assert clean_indian_phone("9876543210") == "+919876543210"
    assert clean_indian_phone("+91-9876543210") == "+919876543210"
    assert clean_indian_phone("09876543210") == "+919876543210"


def test_make_upi_deep_link():
    link = make_upi_deep_link("gupta@okaxis", "Gupta General Store", 50000, note="Udhar Rajesh")
    assert link.startswith("upi://pay?")
    assert "pa=gupta%40okaxis" in link
    assert "pn=Gupta%20General%20Store" in link
    assert "am=500.00" in link
    assert "cu=INR" in link


def test_make_whatsapp_click_to_chat():
    wa_url = make_whatsapp_click_to_chat("9876543210", "Rajesh", "Gupta Store", 50000, "https://askweave.xyz/pay/pay_123")
    assert wa_url.startswith("https://wa.me/919876543210?text=")
    assert "Rajesh" in wa_url
    assert "500" in wa_url
    assert "askweave.xyz" in wa_url


# ---------- date & amount parsing ----------
def test_parse_amount_paise():
    assert parse_amount_paise("500 rupees") == 50000
    assert parse_amount_paise("₹450") == 45000
    assert parse_amount_paise("Rs. 1200") == 120000
    assert parse_amount_paise("paanch sau") == 50000
    assert parse_amount_paise("dedh hazar") == 150000
    assert parse_amount_paise("Rajesh owes 300") == 30000


def test_parse_due_day():
    now_ts = 1700000000.0  # reference time
    today = int(now_ts // 86400)
    assert parse_due_day("kal dega", now_ts) == today + 1
    assert parse_due_day("tomorrow", now_ts) == today + 1
    assert parse_due_day("parso lotayega", now_ts) == today + 2
    assert parse_due_day("in 5 days", now_ts) == today + 5
    assert parse_due_day("10 din baad", now_ts) == today + 10


def test_parse_udhar_message_intents():
    now_ts = 1700000000.0
    # Add credit
    res1 = parse_udhar_message("Mr. Rajesh owes me 500 rupees, and he told me that he'll pay me back by next Tuesday", now_ts)
    assert res1.action == "add_credit"
    assert res1.customer_name == "Rajesh"
    assert res1.amount_paise == 50000

    # Add credit Hindi
    res2 = parse_udhar_message("Rajesh bhaiya ko 350 ka udhar diya hai", now_ts)
    assert res2.action == "add_credit"
    assert res2.customer_name == "Rajesh"
    assert res2.amount_paise == 35000

    # Settlement
    res3 = parse_udhar_message("Rajesh ne 500 de diye", now_ts)
    assert res3.action == "settle_payment"
    assert res3.customer_name == "Rajesh"
    assert res3.amount_paise == 50000

    # Khata query
    res4 = parse_udhar_message("Rajesh ka hisaab batao", now_ts)
    assert res4.action == "check_balance"
    assert res4.customer_name == "Rajesh"

    # Total summary
    res5 = parse_udhar_message("total udhar kitna hai", now_ts)
    assert res5.action == "total_summary"

    # Set UPI
    res6 = parse_udhar_message("Mera UPI ID hai guptastore@okhdfcbank", now_ts)
    assert res6.action == "set_upi"
    assert res6.upi_id == "guptastore@okhdfcbank"

    # Reminder quick replies
    assert parse_udhar_message("1", now_ts).action == "reminder_reply"
    assert parse_udhar_message("2", now_ts).action == "reminder_reply"
    assert parse_udhar_message("3", now_ts).action == "reminder_reply"


# ---------- end-to-end service & worker integration ----------
def test_kirana_owner_records_credit_and_queries_khata(u):
    # 1. Store owner sets up their UPI ID
    u.text(OWNER, "Mera UPI ID hai gupta@okhdfcbank store Gupta General Store")
    reply1 = u.last()
    assert "gupta@okhdfcbank" in reply1
    assert "Gupta General Store" in reply1

    # 2. Store owner records voice note transcript of debtor
    u.text(OWNER, "Mr. Rajesh owes me 500 rupees, and he told me that he'll pay me back by next Tuesday")
    reply2 = u.last()
    assert "Noted" in reply2
    assert "500" in reply2
    assert "Rajesh" in reply2

    # 3. Store owner queries Rajesh's balance
    u.text(OWNER, "Rajesh ka hisaab batao")
    reply3 = u.last()
    assert "Rajesh" in reply3
    assert "500" in reply3

    # 4. Store owner queries total market udhar
    u.text(OWNER, "Total udhar kitna hai")
    reply4 = u.last()
    assert "500" in reply4


def test_proactive_due_date_reminder_and_whatsapp_link_flow(u):
    # 1. Setup store UPI
    u.text(OWNER, "Mera UPI ID hai kirana@paytm")

    # 2. Add udhar with phone number in note or text
    now = time.time()
    today = int(now // 86400)
    u.text(OWNER, "Mr. Rajesh owes me 500 rupees kal dega 9876543210")
    assert "Noted" in u.last()

    # 3. Simulate arrival of due date (tomorrow)
    due_day = today + 1
    notified = u.sms.check_udhar_reminders(current_day=due_day)
    assert notified == 1

    # Check alert sent to store owner FIRST
    owner_alert = u.last()
    assert "Khata Reminder" in owner_alert
    assert "Rajesh" in owner_alert
    assert "500" in owner_alert
    assert "Send WhatsApp Pay Link" in owner_alert

    # 4. Store owner replies "1" (send link to customer)
    u.text(OWNER, "1")
    link_reply = u.last()
    assert "Payment link for Rajesh" in link_reply
    assert "/pay/pay_" in link_reply
    assert "https://wa.me/919876543210" in link_reply

    # Extract payment token and verify public checkout page works
    token = None
    for word in link_reply.split():
        if "/pay/pay_" in word:
            token = word.split("/pay/")[-1].strip()
            break
    assert token is not None

    resp = u.client.get(f"/pay/{token}")
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    assert "500.00" in resp.text
    assert "upi://pay?" in resp.text
    assert "kirana%40paytm" in resp.text


def test_settle_udhar_flow(u):
    u.text(OWNER, "Rajesh owes me 500 rupees")
    assert "500" in u.last()

    # Settle payment
    u.text(OWNER, "Rajesh ne 500 de diye")
    settle_reply = u.last()
    assert "received from Rajesh" in settle_reply or "settled for Rajesh" in settle_reply
    assert "500" in settle_reply
    assert "Remaining balance:" in settle_reply and "0" in settle_reply


def test_reminder_prompts_for_phone_if_unknown(u):
    u.text(OWNER, "Mera UPI ID hai dukandar@okhdfcbank")
    now = time.time()
    today = int(now // 86400)
    # Recorded without customer phone number
    u.text(OWNER, "Mr. Rajesh owes me 400 rupees kal dega")
    assert "Noted" in u.last()

    # Due date tomorrow
    due_day = today + 1
    u.sms.check_udhar_reminders(current_day=due_day)
    assert "Khata Reminder" in u.last()

    # Owner replies 1 (send link)
    u.text(OWNER, "1")
    reply = u.last()
    assert "WhatsApp number kya hai" in reply

    # Owner provides 10-digit phone
    u.text(OWNER, "9820098200")
    reply_phone = u.last()
    assert "Saved number for Rajesh" in reply_phone
    assert "https://wa.me/919820098200" in reply_phone
    assert "/pay/pay_" in reply_phone


def test_reminder_snooze_flow(u):
    now = time.time()
    today = int(now // 86400)
    u.text(OWNER, "Rajesh owes me 250 rupees kal dega")
    assert "Noted" in u.last()

    # Due date tomorrow
    due_day = today + 1
    u.sms.check_udhar_reminders(current_day=due_day)
    assert "Khata Reminder" in u.last()

    # Owner replies 3 (snooze)
    u.text(OWNER, "3")
    assert "Snoozed for 3 days" in u.last()

    # Checking tomorrow again should NOT notify because it's snoozed
    assert u.sms.check_udhar_reminders(current_day=due_day) == 0

    # 3 days later, it alerts again
    assert u.sms.check_udhar_reminders(current_day=due_day + 3) == 1
    assert "Khata Reminder" in u.last()


def test_balance_accumulates_across_multiple_entries(u):
    u.text(OWNER, "Rajesh owes me 300 rupees")
    assert "Total balance: 300" in u.last()

    u.text(OWNER, "Rajesh owes me 200 rupees")
    assert "Total balance: 500" in u.last()

    u.text(OWNER, "Rajesh ka hisaab")
    assert "500" in u.last()


def test_voice_note_udhar_entry(u):
    from weave.sms.service import Inbound
    msg = Inbound(
        from_=OWNER,
        to="",
        body="Mr. Rajesh owes me 600 rupees, and he told me that he'll pay me back by next Tuesday",
        sid="MM" + "a" * 32,
        heard=True,
    )
    outcome = u.sms.service.handle(msg)
    assert outcome == "udhar_added"
    assert "Noted" in u.last()
    assert "600" in u.last()
