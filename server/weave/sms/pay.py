"""Self-contained UPI payment checkout page for customer credit settlements.

Renders an instant mobile-optimized payment screen with:
1. 1-tap deep link into Google Pay, PhonePe, Paytm, BHIM, Cred
2. Auto-launch intent for mobile devices
3. Offline-generated PNG data-URI QR code for desktop scanning
4. Paid / Settled state screen
"""

from __future__ import annotations

import base64
import html
import io
import time
from typing import Any

from .udhar import make_upi_deep_link


def render_pay_page(entry: dict, upi_settings: dict | None) -> str:
    """Render the self-contained HTML payment landing page."""
    payee_name = (upi_settings.get("payee_name") if upi_settings else None) or "Kirana Store"
    upi_id = (upi_settings.get("upi_id") if upi_settings else None) or ""
    amount_paise = entry["amount_paise"]
    amount_inr = f"{amount_paise / 100:.2f}"
    customer_name = entry.get("customer_name") or "Customer"
    status = entry.get("status") or "pending"
    items = entry.get("items_summary") or ""

    safe_payee = html.escape(payee_name)
    safe_cust = html.escape(customer_name)
    safe_items = html.escape(items)
    safe_upi = html.escape(upi_id)

    if status == "settled":
        return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Payment Completed - {safe_payee}</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f4f6f8; margin: 0; padding: 24px; display: flex; justify-content: center; align-items: center; min-height: 90vh; }}
  .card {{ background: #fff; max-width: 400px; width: 100%; border-radius: 16px; padding: 32px 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); text-align: center; }}
  .badge {{ width: 64px; height: 64px; border-radius: 50%; background: #e6f4ea; color: #137333; display: flex; align-items: center; justify-content: center; font-size: 32px; margin: 0 auto 16px; }}
  h1 {{ font-size: 20px; color: #202124; margin: 0 0 8px; }}
  .amount {{ font-size: 32px; font-weight: 700; color: #137333; margin: 12px 0; }}
  p {{ color: #5f6368; font-size: 14px; margin: 4px 0; }}
  .footer {{ margin-top: 24px; font-size: 12px; color: #9aa0a6; border-top: 1px solid #f1f3f4; padding-top: 16px; }}
</style>
</head>
<body>
<div class="card">
  <div class="badge">✓</div>
  <h1>Payment Received</h1>
  <p>To <strong>{safe_payee}</strong></p>
  <div class="amount">₹{amount_inr}</div>
  <p>Bill for {safe_cust} has been settled.</p>
  <div class="footer">Thank you! Powered by Weave Khata</div>
</div>
</body>
</html>"""

    # Generate UPI intent URI
    upi_uri = make_upi_deep_link(upi_id, payee_name, amount_paise, note=f"Udhar - {customer_name}") if upi_id else ""

    # Generate QR Code image as data URI
    qr_data_uri = ""
    if upi_uri:
        try:
            import qrcode
            qr = qrcode.QRCode(box_size=6, border=2)
            qr.add_data(upi_uri)
            qr.make(fit=True)
            img = qr.make_image(fill_color="black", back_color="white")
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            qr_data_uri = f"data:image/png;base64,{b64}"
        except Exception:
            qr_data_uri = ""

    upi_button = f"""
      <a href="{html.escape(upi_uri)}" class="pay-btn" id="pay-btn">
        Pay ₹{amount_inr} via UPI
      </a>
      <p class="subtext">Opens Google Pay, PhonePe, Paytm, or BHIM</p>
    """ if upi_uri else """
      <div class="notice">The store owner has not linked their UPI ID yet.<br>Please pay in cash at the store.</div>
    """

    qr_section = f"""
      <div class="qr-container">
        <img src="{qr_data_uri}" alt="UPI QR Code" width="200" height="200">
        <div class="scan-hint">Scan with any UPI app</div>
      </div>
    """ if qr_data_uri else ""

    copy_section = f"""
      <div class="vpa-box">
        <span>UPI ID: <strong>{safe_upi}</strong></span>
      </div>
    """ if upi_id else ""

    items_row = f'<div class="row"><span>Items</span><strong>{safe_items}</strong></div>' if items else ""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pay ₹{amount_inr} to {safe_payee}</title>
<style>
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #f8fafc;
    margin: 0;
    padding: 16px;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 95vh;
  }}
  .card {{
    background: #ffffff;
    max-width: 420px;
    width: 100%;
    border-radius: 20px;
    padding: 28px 24px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.05), 0 2px 6px rgba(0,0,0,0.03);
    text-align: center;
    box-sizing: border-box;
  }}
  .shop-icon {{
    width: 54px;
    height: 54px;
    border-radius: 14px;
    background: #eff6ff;
    color: #2563eb;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    margin: 0 auto 12px;
  }}
  h1 {{ font-size: 20px; color: #0f172a; margin: 0 0 4px; font-weight: 700; }}
  .subtitle {{ color: #64748b; font-size: 13px; margin: 0 0 16px; }}
  .amount-card {{
    background: #f1f5f9;
    border-radius: 16px;
    padding: 16px;
    margin-bottom: 20px;
  }}
  .amount-label {{ font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }}
  .amount-val {{ font-size: 34px; font-weight: 800; color: #0f172a; margin: 4px 0 0; }}
  .details {{
    text-align: left;
    border-top: 1px dashed #e2e8f0;
    border-bottom: 1px dashed #e2e8f0;
    padding: 12px 0;
    margin-bottom: 20px;
    font-size: 13px;
  }}
  .row {{ display: flex; justify-content: space-between; padding: 4px 0; }}
  .row span {{ color: #64748b; }}
  .row strong {{ color: #1e293b; font-weight: 600; }}
  .pay-btn {{
    display: block;
    width: 100%;
    background: #16a34a;
    color: #ffffff;
    font-size: 16px;
    font-weight: 700;
    text-decoration: none;
    padding: 14px 0;
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(22, 163, 74, 0.25);
    transition: background 0.15s ease;
    box-sizing: border-box;
  }}
  .pay-btn:hover {{ background: #15803d; }}
  .subtext {{ color: #64748b; font-size: 12px; margin: 8px 0 16px; }}
  .qr-container {{
    margin: 16px auto 0;
    padding: 12px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    display: inline-block;
  }}
  .qr-container img {{ display: block; margin: 0 auto; }}
  .scan-hint {{ font-size: 11px; color: #64748b; margin-top: 6px; font-weight: 500; }}
  .vpa-box {{
    margin-top: 14px;
    font-size: 12px;
    color: #475569;
    background: #f8fafc;
    border-radius: 8px;
    padding: 8px;
  }}
  .notice {{ background: #fef3c7; color: #92400e; padding: 12px; border-radius: 10px; font-size: 13px; }}
  .footer {{ margin-top: 20px; font-size: 11px; color: #94a3b8; }}
</style>
</head>
<body>
<div class="card">
  <div class="shop-icon">🏪</div>
  <h1>{safe_payee}</h1>
  <div class="subtitle">Direct UPI Payment</div>

  <div class="amount-card">
    <div class="amount-label">Amount Payable</div>
    <div class="amount-val">₹{amount_inr}</div>
  </div>

  <div class="details">
    <div class="row"><span>Customer</span><strong>{safe_cust}</strong></div>
    {items_row}
    <div class="row"><span>Purpose</span><strong>Khata / Udhar Settlement</strong></div>
  </div>

  {upi_button}
  {qr_section}
  {copy_section}

  <div class="footer">Secure payment directly to merchant via UPI NPCI</div>
</div>

<script>
  // On mobile browsers, auto-trigger the UPI application intent
  if ({"true" if upi_uri else "false"} && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {{
    // Short timeout to allow page paint
    setTimeout(function() {{
      var btn = document.getElementById("pay-btn");
      if (btn && btn.href) {{
        window.location.href = btn.href;
      }}
    }}, 400);
  }}
</script>
</body>
</html>"""


def render_pharmacy_pay_page(order: dict, store: dict | None) -> str:
    """Render payment landing page for pharmacy medicine order."""
    store_name = (store.get("name") if store else None) or "Medical Store"
    upi_id = (store.get("upi_id") if store else None) or ""
    amount_paise = order["total_amount_paise"]
    amount_inr = f"{amount_paise / 100:.2f}"
    item_desc = f"{order['quantity']} {order['unit']}s of {order['item_name']}"
    status = order.get("status") or "payment_pending"
    order_ref = order.get("order_ref") or "MED-ORDER"

    safe_store = html.escape(store_name)
    safe_item = html.escape(item_desc)
    safe_ref = html.escape(order_ref)

    if status in ("paid_ready_for_pickup", "completed"):
        return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Order Confirmed - {safe_store}</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f4f6f8; margin: 0; padding: 24px; display: flex; justify-content: center; align-items: center; min-height: 90vh; }}
  .card {{ background: #fff; max-width: 420px; width: 100%; border-radius: 16px; padding: 32px 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); text-align: center; }}
  .badge {{ width: 64px; height: 64px; border-radius: 50%; background: #e6f4ea; color: #137333; display: flex; align-items: center; justify-content: center; font-size: 32px; margin: 0 auto 16px; }}
  h1 {{ font-size: 20px; color: #202124; margin: 0 0 8px; }}
  .amount {{ font-size: 32px; font-weight: 700; color: #137333; margin: 12px 0; }}
  .order-box {{ background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; margin: 16px 0; text-align: left; font-size: 14px; }}
  .footer {{ margin-top: 24px; font-size: 12px; color: #9aa0a6; border-top: 1px solid #f1f3f4; padding-top: 16px; }}
</style>
</head>
<body>
<div class="card">
  <div class="badge">✓</div>
  <h1>Payment Received!</h1>
  <p>To <strong>{safe_store}</strong></p>
  <div class="amount">₹{amount_inr}</div>
  <div class="order-box">
    <div><strong>Order:</strong> #{safe_ref}</div>
    <div><strong>Items:</strong> {safe_item}</div>
    <div style="color: #137333; margin-top: 8px;"><strong>Status:</strong> Ready for pickup. The store has been notified to keep it ready!</div>
  </div>
  <div class="footer">Powered by Weave</div>
</div>
</body>
</html>"""

    upi_uri = make_upi_deep_link(upi_id, store_name, amount_paise, note=f"Order {order_ref}") if upi_id else ""
    qr_data_uri = ""
    if upi_uri:
        try:
            import qrcode
            qr = qrcode.QRCode(box_size=6, border=2)
            qr.add_data(upi_uri)
            qr.make(fit=True)
            img = qr.make_image(fill_color="black", back_color="white")
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            qr_data_uri = f"data:image/png;base64,{b64}"
        except Exception:
            qr_data_uri = ""

    token = order.get("payment_token") or ""
    upi_html = f"<a href='{html.escape(upi_uri)}' class='pay-btn' id='pay-btn'>Pay ₹{amount_inr} via UPI</a>" if upi_uri else ""
    qr_html = f"<div class='qr-container'><img src='{qr_data_uri}' width='150' height='150'/><div style='font-size:11px;color:#64748b;margin-top:4px;'>Scan QR with any UPI App</div></div>" if qr_data_uri else ""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Medicine Order Payment - {safe_store}</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; margin: 0; padding: 20px; display: flex; justify-content: center; align-items: center; min-height: 90vh; }}
  .card {{ background: #ffffff; max-width: 420px; width: 100%; border-radius: 20px; padding: 28px 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.06); text-align: center; }}
  .shop-icon {{ font-size: 36px; margin-bottom: 8px; }}
  h1 {{ font-size: 20px; color: #0f172a; margin: 0 0 4px; }}
  .subtitle {{ font-size: 13px; color: #64748b; margin-bottom: 20px; }}
  .amount-card {{ background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 14px; margin-bottom: 16px; }}
  .amount-label {{ font-size: 12px; color: #166534; font-weight: 500; text-transform: uppercase; }}
  .amount-val {{ font-size: 32px; font-weight: 800; color: #15803d; margin-top: 4px; }}
  .details {{ background: #f8fafc; border-radius: 12px; padding: 12px; margin-bottom: 20px; text-align: left; font-size: 13px; }}
  .row {{ display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f1f5f9; }}
  .row:last-child {{ border-bottom: none; }}
  .row span {{ color: #64748b; }}
  .row strong {{ color: #1e293b; }}
  .pay-btn {{ display: block; background: #16a34a; color: #ffffff; font-weight: 600; text-decoration: none; padding: 14px 20px; border-radius: 12px; margin-top: 14px; font-size: 16px; border: none; width: 100%; cursor: pointer; box-sizing: border-box; }}
  .pay-btn:hover {{ background: #15803d; }}
  .confirm-btn {{ display: block; background: #0284c7; color: #ffffff; font-weight: 600; padding: 14px 20px; border-radius: 12px; margin-top: 10px; font-size: 15px; border: none; width: 100%; cursor: pointer; }}
  .confirm-btn:hover {{ background: #0369a1; }}
  .subtext {{ color: #64748b; font-size: 12px; margin: 8px 0; }}
  .qr-container {{ margin: 12px auto 0; padding: 10px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; display: inline-block; }}
  .footer {{ margin-top: 20px; font-size: 11px; color: #94a3b8; }}
</style>
</head>
<body>
<div class="card">
  <div class="shop-icon">💊</div>
  <h1>{safe_store}</h1>
  <div class="subtitle">Medicine Order Checkout</div>

  <div class="amount-card">
    <div class="amount-label">Total Amount</div>
    <div class="amount-val">₹{amount_inr}</div>
  </div>

  <div class="details">
    <div class="row"><span>Order Ref</span><strong>#{safe_ref}</strong></div>
    <div class="row"><span>Medicine</span><strong>{safe_item}</strong></div>
    <div class="row"><span>Store Pickup</span><strong>Direct Collection</strong></div>
  </div>

  {upi_html}
  {qr_html}

  <form action="/pay/{html.escape(token)}/complete" method="POST" style="margin-top:14px;">
    <button type="submit" class="confirm-btn">✓ I Have Completed Payment</button>
  </form>
  <div class="subtext">Clicking confirm will alert the store owner to keep your order ready for collection.</div>

  <div class="footer">Powered by Weave</div>
</div>
</body>
</html>"""
