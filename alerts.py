"""
Telegram alert notifications via Bot API.
Sends readable trade alerts to a configured chat/channel.
"""
import os
import requests
from dotenv import load_dotenv

load_dotenv()

_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
_CHAT_ID   = os.getenv("TELEGRAM_ALERT_CHAT_ID", "")
_API_URL   = f"https://api.telegram.org/bot{_BOT_TOKEN}/sendMessage"


def send_alert(message: str) -> int | None:
    """Send a Telegram alert. Returns message_id for later deletion."""
    if not _BOT_TOKEN or not _CHAT_ID:
        return None
    try:
        resp = requests.post(
            _API_URL,
            json={"chat_id": _CHAT_ID, "text": message, "parse_mode": "HTML"},
            timeout=8,
        )
        return resp.json().get("result", {}).get("message_id")
    except Exception:
        return None


def delete_alert(message_id: int) -> None:
    """Delete a previously sent alert by message_id."""
    if not _BOT_TOKEN or not _CHAT_ID or not message_id:
        return
    try:
        requests.post(
            f"https://api.telegram.org/bot{_BOT_TOKEN}/deleteMessage",
            json={"chat_id": _CHAT_ID, "message_id": message_id},
            timeout=8,
        )
    except Exception:
        pass


# ── Pre-formatted alert builders ─────────────────────────────────────────────

def alert_signal_image(signals: list[dict], account_count: int):
    if not signals:
        return
    lines = ["📊 <b>Signal received (image)</b>"]
    for s in signals:
        expiry = s.get("expiry_date") or "current expiry"
        src    = s.get("expiry_source", "")
        src_tag = f" · {src}" if src and src != "unknown" else ""
        lines.append(f"  {s['action'].upper()} {s['lots']}x {s['strike']} {s['option_type']}  expiry: {expiry}{src_tag}")
    lines.append(f"Processing for {account_count} account(s)...")
    send_alert("\n".join(lines))


def alert_signal_text(signals: list[dict], account_count: int):
    if not signals:
        return
    lines = ["📊 <b>Signal received (text)</b>"]
    for s in signals:
        expiry  = s.get("expiry_date") or "current expiry"
        src     = s.get("expiry_source", "")
        src_tag = f" · {src}" if src and src != "unknown" else ""
        lines.append(f"  {s['action'].upper()} {s['lots']}x {s['strike']} {s['option_type']}  expiry: {expiry}{src_tag}")
    lines.append(f"Processing for {account_count} account(s)...")
    send_alert("\n".join(lines))


def alert_no_signal():
    send_alert("⚠️ <b>No valid signal</b>\nImage received but couldn't parse a trade signal.")


def alert_dry_run(account: str, side: str, lots: int, symbol: str, price: str,
                  mentor_lots: int, multiplier: float):
    mult_tag = f"\nMentor {mentor_lots} lots × {multiplier}x" if multiplier != 1.0 else ""
    send_alert(
        f"🔵 <b>DRY RUN · {account}</b>\n"
        f"{side} {lots}x {symbol} @ {price}{mult_tag}"
    )


def alert_order_placed(account: str, side: str, lots: int, symbol: str,
                       price: str, order_id: str, margin_im: str | None = None,
                       exec_fee: str | None = None):
    meta_parts = []
    if margin_im:
        meta_parts.append(f"Margin: ${margin_im} IM")
    if exec_fee:
        meta_parts.append(f"Fee: ${exec_fee}")
    meta_line = ("\n" + "  |  ".join(meta_parts)) if meta_parts else ""
    send_alert(
        f"✅ <b>Order Placed · {account}</b>\n"
        f"{side} {lots}x {symbol} @ {price}{meta_line}\n"
        f"ID: {order_id}"
    )


def alert_order_failed(account: str, symbol: str, reason: str):
    send_alert(
        f"❌ <b>Order Failed · {account}</b>\n"
        f"{reason}\n"
        f"Symbol: {symbol}"
    )


def alert_heartbeat(mode: str, accounts: list[str], prev_msg_id: int | None = None) -> int | None:
    """Send heartbeat, deleting the previous one first. Returns new message_id."""
    from datetime import datetime, timezone, timedelta
    ist = datetime.now(timezone(timedelta(hours=5, minutes=30))).strftime("%I:%M %p IST")
    if prev_msg_id:
        delete_alert(prev_msg_id)
    return send_alert(
        f"🟢 <b>KiraFX BTC Algo — Alive</b>\n\n"
        f"🕐 {ist}\n"
        f"Mode: {mode}\n"
        f"Accounts: {', '.join(accounts)}"
    )


def alert_error(context: str, error: str):
    send_alert(f"🚨 <b>Bot Error · {context}</b>\n{error}")
