"""Udhar logic: UPI deep links, WhatsApp links, and Kirana voice/text entity extraction.

Handles NPCI UPI intent specifications, WhatsApp click-to-chat deep links, relative date
resolution (Hinglish/Hindi/English weekdays, 'parso', 'kal'), and deterministic parsing
for voice notes and text messages.
"""

from __future__ import annotations

import datetime
import re
import urllib.parse
from dataclasses import dataclass
from typing import Literal

from .udhar_store import normalize_customer_name

UPI_ID_RE = re.compile(r"\b([a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64})\b")
PHONE_10_RE = re.compile(r"\b(?:\+?91[\-\s]?)?([6-9]\d{9})\b")

# Vernacular numbers
HINDI_NUMBER_WORDS = {
    "ek": 1, "do": 2, "teen": 3, "char": 4, "chaar": 4, "paanch": 5, "panch": 5,
    "chhe": 6, "che": 6, "saat": 7, "aath": 8, "ath": 8, "nau": 9, "das": 10,
    "sau": 100, "so": 100, "hazaar": 1000, "hazar": 1000, "dedh": 1.5, "dhai": 2.5
}

WEEKDAYS_EN = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6}
WEEKDAYS_HI = {
    "somwar": 0, "somvaar": 0,
    "mangalwar": 1, "mangalvaar": 1, "mangal": 1,
    "budhwar": 2, "budhvaar": 2, "budh": 2,
    "guruwar": 3, "guruvaar": 3, "veervar": 3, "veervaar": 3, "brihaspatiwar": 3,
    "shukrawar": 4, "shukravaar": 4, "shukkar": 4,
    "shaniwar": 5, "shanivaar": 5, "shani": 5,
    "raviwar": 6, "ravivaar": 6, "itwar": 6, "itvaar": 6
}


def make_upi_deep_link(upi_id: str, payee_name: str, amount_paise: int, note: str = "") -> str:
    """NPCI UPI deep link intent URI: opens GPay, PhonePe, Paytm, BHIM, Cred directly on mobile."""
    clean_upi = upi_id.strip()
    clean_name = payee_name.strip()
    amount_inr = f"{amount_paise / 100:.2f}"
    params = {
        "pa": clean_upi,
        "pn": clean_name,
        "am": amount_inr,
        "cu": "INR",
        "tn": note or f"Udhar Settlement {clean_name}",
    }
    return "upi://pay?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)


def clean_indian_phone(phone: str) -> str:
    """Normalize Indian phone to E.164 (+91XXXXXXXXXX)."""
    digits = "".join(ch for ch in phone if ch.isdigit())
    if len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) == 10:
        return f"+91{digits}"
    if len(digits) == 12 and digits.startswith("91"):
        return f"+{digits}"
    return f"+{digits}" if digits else ""


def make_whatsapp_click_to_chat(phone: str, customer_name: str, store_name: str, amount_paise: int,
                                pay_url: str) -> str:
    """WhatsApp click-to-chat URL with pre-composed polite message and direct payment link."""
    clean_phone = clean_indian_phone(phone).lstrip("+")
    amount_inr = f"{amount_paise / 100:g}"
    message = (
        f"Namaste {customer_name} ji,\n\n"
        f"Aapka {store_name} ka ₹{amount_inr} ka udhar pending hai.\n"
        f"Aap niche diye gaye link se directly Google Pay, PhonePe ya Paytm se payment kar sakte hain:\n"
        f"{pay_url}\n\n"
        f"Dhanyawad!"
    )
    return f"https://wa.me/{clean_phone}?text={urllib.parse.quote(message)}"


def parse_due_day(text: str, now_ts: float) -> int:
    """Resolve due date to integer UTC days since epoch.

    Defaults to 7 days if no date/weekday is found.
    """
    now_dt = datetime.datetime.fromtimestamp(now_ts, tz=datetime.timezone.utc)
    today_day = int(now_ts // 86400)
    current_weekday = now_dt.weekday()  # 0=Monday, 6=Sunday
    lower = text.lower()

    # 1. Look for 'aaj' / 'today'
    if re.search(r"\b(aaj|today)\b", lower):
        return today_day

    # 2. Look for 'kal' / 'tomorrow'
    if re.search(r"\b(kal|tomorrow)\b", lower):
        return today_day + 1

    # 3. Look for 'parso' / 'day after tomorrow'
    if re.search(r"\b(parso|parson|day after tomorrow)\b", lower):
        return today_day + 2

    # 4. Look for 'tarso'
    if re.search(r"\b(tarso|tarson)\b", lower):
        return today_day + 3

    # 5. Look for 'in N days' / 'N din baad' / 'N days'
    days_match = re.search(r"\b(\d+)\s*(?:din|days?)(?:\s*baad|\s*later)?\b", lower)
    if days_match:
        return today_day + int(days_match.group(1))

    # 6. Look for English/Hindi weekdays
    target_weekday = None
    for name, wd in WEEKDAYS_EN.items():
        if re.search(rf"\b{name}\b", lower):
            target_weekday = wd
            break
    if target_weekday is None:
        for name, wd in WEEKDAYS_HI.items():
            if re.search(rf"\b{name}\b", lower):
                target_weekday = wd
                break

    if target_weekday is not None:
        days_ahead = (target_weekday - current_weekday) % 7
        if days_ahead == 0:  # If today is Tuesday and they say Tuesday, assume next Tuesday (+7)
            days_ahead = 7
        return today_day + days_ahead

    # 7. Look for day of month: "15 tarikh", "15th", "5 tareekh"
    tarikh_match = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:tarikh|tareekh|date)?\b", lower)
    if tarikh_match:
        try:
            day_num = int(tarikh_match.group(1))
            if 1 <= day_num <= 31:
                # If day_num is later this month:
                if day_num > now_dt.day:
                    target_dt = now_dt.replace(day=day_num)
                else:
                    # Next month
                    month = now_dt.month + 1 if now_dt.month < 12 else 1
                    year = now_dt.year if now_dt.month < 12 else now_dt.year + 1
                    target_dt = now_dt.replace(year=year, month=month, day=day_num)
                return int(target_dt.timestamp() // 86400)
        except (ValueError, OverflowError):
            pass

    # Default kirana credit cycle: 7 days
    return today_day + 7


def parse_amount_paise(text: str) -> int | None:
    """Extract money amount in paise from text or voice transcript."""
    lower = text.lower()

    # Pattern: ₹500, Rs 500, Rs. 500, 500 rs, 500 rupees, 500 rupay
    m = re.search(r"(?:₹|rs\.?|inr)\s*(\d+(?:\.\d{1,2})?)", lower)
    if m:
        return int(float(m.group(1)) * 100)

    m = re.search(r"(\d+(?:\.\d{1,2})?)\s*(?:₹|rs\.?|inr|rupees?|rupaye?|rupay|rp)", lower)
    if m:
        return int(float(m.group(1)) * 100)

    # Colloquial words: "paanch sau" (500), "do hazaar" (2000), "dedh hazaar" (1500)
    if "dedh hazar" in lower or "dedh hazaar" in lower:
        return 150000
    if "dhai hazar" in lower or "dhai hazaar" in lower:
        return 250000

    m_word = re.search(r"\b(ek|do|teen|chaar|char|paanch|panch|chhe|saat|aath|nau|das)\s*(sau|so|hazar|hazaar)\b", lower)
    if m_word:
        unit = HINDI_NUMBER_WORDS.get(m_word.group(1), 0)
        mult = 100 if m_word.group(2) in ("sau", "so") else 1000
        return int(unit * mult * 100)

    # Standalone 2 to 6 digit numbers if text mentions udhar/owes/baki/paid/settled/diye
    if re.search(r"\b(udhar|owes|debt|pending|baki|baaki|chahiye|dega|credit|paid|settle|settled|jama|diye|diya)\b", lower):
        m_num = re.search(r"\b(\d{2,6})\b", lower)
        if m_num:
            return int(int(m_num.group(1)) * 100)

    return None


@dataclass
class UdharParseResult:
    action: Literal["add_credit", "settle_payment", "check_balance", "total_summary", "set_upi",
                    "reminder_reply", "provide_phone", "none"]
    customer_name: str | None = None
    amount_paise: int | None = None
    due_day: int | None = None
    phone: str | None = None
    upi_id: str | None = None
    payee_name: str | None = None
    reminder_choice: str | None = None  # "send", "paid", "snooze"


def parse_udhar_message(text: str, now_ts: float) -> UdharParseResult:
    """Deterministic extractor for kirana credit instructions."""
    raw = text.strip()
    lower = raw.lower()

    # 1. Check for reminder direct responses: 1, 2, 3, SEND, PAID, SNOOZE
    if raw in ("1", "send", "send link", "bhejo", "link bhejo"):
        return UdharParseResult(action="reminder_reply", reminder_choice="send")
    if raw in ("2", "paid", "cash", "de diya", "jama", "settle"):
        return UdharParseResult(action="reminder_reply", reminder_choice="paid")
    if raw in ("3", "snooze", "wait", "baad me", "time do"):
        return UdharParseResult(action="reminder_reply", reminder_choice="snooze")

    # 2. Check for UPI setup: "Mera UPI ID hai gupta@okhdfcbank", "Set UPI to 9876543210@paytm"
    upi_match = UPI_ID_RE.search(raw)
    if upi_match and any(w in lower for w in ("upi", "vpa", "gpay", "phonepe", "paytm")):
        upi_id = upi_match.group(1)
        name_match = re.search(r"(?:name|shop|dukaan|dukandar|store)\s*(?:is|hai|:)?\s*([A-Za-z0-9\s]{3,30})", raw, re.I)
        payee = name_match.group(1).strip() if name_match else "Kirana Store"
        return UdharParseResult(action="set_upi", upi_id=upi_id, payee_name=payee)

    # 3. Check for standalone phone number provision (e.g. owner replying to "What is Rajesh's number?")
    phone_match = PHONE_10_RE.search(raw)
    if phone_match and len(raw.split()) <= 4 and not any(w in lower for w in ("owes", "udhar", "rs", "rupee")):
        return UdharParseResult(action="provide_phone", phone=phone_match.group(1))

    # 4. Check for total credit summary: "total udhar", "khata summary", "market me kitna baki hai"
    if re.search(r"\b(?:total\s+udhar|total\s+khata|khata\s+summary|sabka\s+baki|market\s+udhar|kitna\s+baki\s+hai)\b", lower):
        if not any(w in lower for w in ("owes", "ne diya", "ko diya")):
            return UdharParseResult(action="total_summary")

    # 5. Check for debt settlement: "Rajesh ne 500 de diye", "Rajesh paid 500", "Settled 500 for Rajesh"
    settle_patterns = [
        r"([a-zA-Z\s]{2,20}?)\s+(?:ne\s+)?(?:\d+\s*(?:rupaye?|rs|₹)?\s*)?(?:paid|settled|jama\s*kiye|jama|de\s*diye|wapas\s*diye|diye\b)",
        r"(?:paid|settled|received)\s+(?:from\s+)?([a-zA-Z\s]{2,20})",
    ]
    for pat in settle_patterns:
        m = re.search(pat, raw, re.I)
        if m:
            cust_name = normalize_customer_name(m.group(1))
            amt = parse_amount_paise(raw)
            return UdharParseResult(action="settle_payment", customer_name=cust_name, amount_paise=amt)

    # 6. Check for single customer query: "Rajesh ka kitna baki hai", "Rajesh khata", "Rajesh balance"
    query_match = re.search(r"([a-zA-Z\s]{2,20}?)\s*(?:ka|ki)?\s*(?:kitna\s+baki|khata|balance|udhar\s+batao|hisaab)", raw, re.I)
    if query_match and not any(w in lower for w in ("owes", "dega", "pay back")):
        cust_name = normalize_customer_name(query_match.group(1))
        return UdharParseResult(action="check_balance", customer_name=cust_name)

    # 7. Check for credit addition: "Rajesh owes me 500", "Rajesh bhaiya ko 500 udhar diya"
    credit_indicators = ("owes", "owe", "udhar", "baki", "credit", "gave", "diya")
    if any(ind in lower for ind in credit_indicators):
        amt = parse_amount_paise(raw)
        if amt:
            # Extract customer name
            cust_name = None
            m_owes = re.search(r"(?:mr\.?\s*)?([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20})?)\s+owes", raw, re.I)
            if m_owes:
                cust_name = m_owes.group(1).strip()
            else:
                m_ko = re.search(r"(?:mr\.?\s*)?([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20})?)\s*(?:ko|bhaiya|ji)?\s*(?:\d+|[₹\w\s]+)?\s*udhar", raw, re.I)
                if m_ko and m_ko.group(1).lower() not in ("ko", "ka", "ki", "me"):
                    cust_name = m_ko.group(1).strip()
                else:
                    m_diya = re.search(r"udhar\s+(?:diya\s+)?(?:to\s+|ko\s+)?([A-Za-z]{2,20})", raw, re.I)
                    if m_diya:
                        cust_name = m_diya.group(1).strip()

            if cust_name:
                cust_name = normalize_customer_name(cust_name)
                due_day = parse_due_day(raw, now_ts)
                phone = phone_match.group(1) if phone_match else None
                return UdharParseResult(
                    action="add_credit",
                    customer_name=cust_name,
                    amount_paise=amt,
                    due_day=due_day,
                    phone=phone,
                )

    return UdharParseResult(action="none")
