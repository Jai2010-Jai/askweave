"""Weekly AI digest and business tips for small business owners.

Combines traffic, leads, and sales into a single aggregate fact sheet, generates
a deterministic fallback message with actionable tips, and presents it naturally via NLG.
Only aggregates are ever passed to the model — never rows, never customer names.
"""

from __future__ import annotations

import time

from ..sms import messages as M
from .collector import utc_day
from .metrics import sales_summary, traffic_summary, week_of


def select_tip(f: dict) -> str:
    """Constrained closing tip anchored strictly to what the facts support."""
    if f.get("losing_money"):
        return "Tip: Costs exceeded revenue this week — check margins on your top products."
    if f.get("leads", 0) > 0:
        n = f["leads"]
        word = "enquiry" if n == 1 else "enquiries"
        return f"Tip: You had {n} new {word} this week — following up promptly leads to the best response."
    if f.get("top_product"):
        prod = f["top_product"]
        return f"Tip: {prod} is your top seller — highlighting it on your home page can boost orders."
    if f.get("top_ref"):
        ref = f["top_ref"]
        return f"Tip: Most visitors came from {ref} — regular posts there can drive steady traffic."
    if f.get("mobile_pct") is not None and f["mobile_pct"] >= 70:
        return f"Tip: {f['mobile_pct']}% of visitors viewed your site on mobile — keep key details near the top of the page."
    if f.get("views", 0) == 0 and not f.get("has_sales"):
        return "Tip: Sharing your website link on your WhatsApp status is the easiest way to get initial visitors."
    return "Tip: Sharing regular updates or specials helps keep visitors returning."


def digest_facts(store, account_id: int, *, now: float | None = None) -> dict:
    """All metrics needed for a weekly digest, as numbers and category labels only."""
    now = time.time() if now is None else now
    today = utc_day(now)
    week = week_of(today)
    traffic = traffic_summary(store, account_id, days=7, now=now)
    leads_count = store.lead_count(account_id, since=now - 7 * 86_400)
    sales = sales_summary(store, account_id, now=now)

    has_traffic = traffic["views"] > 0
    has_sales = sales.get("has_sales", False)
    has_leads = leads_count > 0
    has_data = has_traffic or has_sales or has_leads

    f = {
        "week": week,
        "views": traffic["views"],
        "visitors": traffic["visitors"],
        "prev_views": traffic["prev_views"],
        "views_delta_pct": traffic["delta_pct"],
        "busiest_day": traffic["busiest_day"],
        "top_page": traffic["top_pages"][0]["label"] if traffic["top_pages"] else None,
        "top_ref": traffic["top_refs"][0]["host"] if traffic["top_refs"] else None,
        "mobile_pct": traffic["mobile_pct"],
        "low_data": traffic["low_data"],
        "seen_days": traffic["seen_days"],
        "leads": leads_count,
        "has_sales": has_sales,
        "has_data": has_data,
    }

    if has_sales:
        tw = sales["this_week"]
        f.update({
            "revenue": tw["revenue"],
            "currency": sales.get("currency", ""),
            "sales_delta_pct": sales.get("delta_pct"),
            "has_cost": sales.get("has_cost", False),
            "profit": tw.get("profit") if sales.get("has_cost") else None,
            "losing_money": sales.get("losing_money", False),
            "top_product": sales["top_products"][0]["product"] if sales.get("top_products") else None,
            "projection": sales.get("projection"),
        })

    f["tip"] = select_tip(f)
    return f


def digest_text(f: dict, limit: int = M.MAX_CHARS_CHAT, unicode: bool = True) -> str:
    """Deterministic summary and tip, built clause by clause so numbers are never chopped.

    Respects limit hard: clauses are dropped before the limit rather than truncated at the end.
    """
    clauses: list[str] = []

    # 1. Traffic clause
    if f.get("views"):
        people = f"{f['visitors']} {'person' if f['visitors'] == 1 else 'people'}"
        t_head = f"This week: {f['views']} visits from {people}"
        if f.get("views_delta_pct") is not None and not f.get("low_data"):
            pct = f["views_delta_pct"]
            t_head += f", {'up' if pct >= 0 else 'down'} {abs(pct)}% on last week"
        t_head += "."
        clauses.append(t_head)
    elif f.get("seen_days", 0) > 0 or f.get("has_data"):
        clauses.append("No website visits recorded this week.")

    # 2. Leads clause
    if f.get("leads"):
        n = f["leads"]
        word = "enquiry" if n == 1 else "enquiries"
        clauses.append(f"{n} new {word} came in.")

    # 3. Sales clause
    if f.get("has_sales"):
        cur = f.get("currency", "")
        s_head = f"Sales: {M.money(f['revenue'], cur)}"
        if f.get("sales_delta_pct") is not None:
            spct = f["sales_delta_pct"]
            s_head += f", {'up' if spct >= 0 else 'down'} {abs(spct)}% on last week"
        s_head += "."
        if f.get("has_cost") and f.get("profit") is not None:
            word = "Loss" if f.get("losing_money") else "Profit"
            s_head += f" {word}: {M.money(abs(f['profit']), cur)}."
        clauses.append(s_head)

    # 4. Secondary highlights
    if f.get("top_product"):
        clauses.append(f"Top seller: {f['top_product']}.")
    if f.get("top_ref"):
        clauses.append(f"Top source: {f['top_ref']}.")

    tip = f.get("tip") or select_tip(f)

    # If limit is large (chat / WhatsApp), format with paragraphs
    sep = "\n\n" if limit > 500 else " "
    summary_text = " ".join(clauses)

    if not summary_text:
        return tip if len(tip) <= limit else tip[:limit]

    combined = f"{summary_text}{sep}{tip}"
    if len(combined) <= limit:
        return combined

    # Under tight limits (SMS), selectively drop secondary highlights first, then tip if necessary
    trimmed_clauses = list(clauses)
    while trimmed_clauses and len(f"{' '.join(trimmed_clauses)} {tip}") > limit:
        trimmed_clauses.pop()

    if trimmed_clauses:
        candidate = f"{' '.join(trimmed_clauses)} {tip}"
        if len(candidate) <= limit:
            return candidate
        return " ".join(trimmed_clauses)

    return summary_text[:limit]


def generate_digest(store, account_id: int, nlg=None, now: float | None = None,
                    user_query: str = "", limit: int = M.MAX_CHARS_CHAT,
                    unicode: bool = True) -> tuple[dict, str]:
    """Produce the weekly digest: verified facts + natural language output."""
    facts = digest_facts(store, account_id, now=now)
    fallback = digest_text(facts, limit=limit, unicode=unicode)
    if nlg is not None:
        text = nlg.present("digest", facts, fallback, user_query=user_query)
    else:
        text = fallback
    return facts, text
