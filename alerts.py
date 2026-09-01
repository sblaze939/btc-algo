"""
Telegram alert notifications via Bot API.
Sends readable trade alerts to a configured chat/channel.
"""
import os
import requests
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv

IST = timezone(timedelta(hours=5, minutes=30))

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
        expiry = s.get("expiry_date") or "nearest"
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
        expiry  = s.get("expiry_date") or "current"
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
                       price: str, order_id: str):
    send_alert(
        f"✅ <b>Order Placed · {account}</b>\n"
        f"{side} {lots}x {symbol} @ {price}\n"
        f"ID: {order_id}"
    )


def alert_order_failed(account: str, symbol: str, reason: str):
    send_alert(
        f"❌ <b>Order Failed · {account}</b>\n"
        f"{reason}\n"
        f"Symbol: {symbol}"
    )


def alert_heartbeat(mode: str, accounts: list[str], prev_msg_id: int | None = None, orders_today: int = 0) -> int | None:
    """Send heartbeat, deleting the previous one first. Returns new message_id."""
    if prev_msg_id:
        delete_alert(prev_msg_id)
    now_ist = datetime.now(IST).strftime('%I:%M %p IST')
    master  = accounts[0] if accounts else "—"
    children = accounts[1:] if len(accounts) > 1 else []
    children_line = f"\n👥 Children: {', '.join(children)}" if children else ""
    return send_alert(
        f"🟢 <b>Kirasha BTC Algo — Alive</b>\n\n"
        f"🕐 {now_ist}\n"
        f"⚡ Mode: {mode}\n"
        f"📊 Orders today: {orders_today}\n"
        f"👤 Master: {master}"
        f"{children_line}"
    )


def alert_error(context: str, error: str):
    send_alert(f"🚨 <b>Bot Error · {context}</b>\n{error}")
