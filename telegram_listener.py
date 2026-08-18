import asyncio
import json
import os
import re
from datetime import datetime
from pathlib import Path

from telethon import TelegramClient, events
from telethon.tl.types import MessageMediaPhoto, MessageMediaDocument
from dotenv import load_dotenv

from signal_parser import parse_signal, is_valid_signal, get_valid_signals
from coinswitch_trader import place_option_order, log, MENTOR_BASE
from alerts import (alert_signal_image, alert_signal_text, alert_no_signal,
                    alert_heartbeat, alert_error)

load_dotenv()

API_ID      = int(os.getenv("TELEGRAM_API_ID"))
API_HASH    = os.getenv("TELEGRAM_API_HASH")
CHANNEL_ID  = int(os.getenv("TELEGRAM_CHANNEL_ID"))
SIGNAL_MODE = os.getenv("SIGNAL_MODE", "image").lower()  # image | text | both

DOWNLOADS = Path("downloads")
DOWNLOADS.mkdir(exist_ok=True)

# Client is created inside main() to avoid Python 3.10+ event-loop issues at import time.
client: TelegramClient = None


# ── Account loader ────────────────────────────────────────────────────────────

def load_accounts() -> list[dict]:
    """
    Load trading accounts from accounts.json.
    Blank api_key/secret → falls back to .env values.
    Multiplier = account_size / MENTOR_BASE (mentor baseline 50k).
    """
    path = Path("accounts.json")
    if not path.exists():
        log("accounts.json not found — using single account from .env")
        return [{"name": "Main", "api_key": None, "api_secret": None, "multiplier": 1.0}]

    accounts = json.loads(path.read_text())
    result   = []
    for acc in accounts:
        if not acc.get("active", True):
            continue
        key    = acc.get("api_key") or None
        secret = acc.get("api_secret") or None
        size   = acc.get("account_size", MENTOR_BASE)
        # Explicit lot_multiplier overrides the size-based calculation
        if acc.get("lot_multiplier") is not None:
            mult = round(float(acc["lot_multiplier"]), 4)
            log(f"Account loaded: {acc.get('name')}  size={size}  multiplier={mult}x (manual override)")
        else:
            mult = round(size / MENTOR_BASE, 4)
            log(f"Account loaded: {acc.get('name')}  size={size}  multiplier={mult}x")
        result.append({
            "name":       acc.get("name", "Account"),
            "api_key":    key,
            "api_secret": secret,
            "multiplier": mult,
        })

    if not result:
        log("No active accounts found in accounts.json — using .env fallback")
        result = [{"name": "Main", "api_key": None, "api_secret": None, "multiplier": 1.0}]

    return result


ACCOUNTS = load_accounts()


# ── Signal handlers ───────────────────────────────────────────────────────────

async def execute_signal_for_all_accounts(signal: dict):
    """Place the same signal across all configured accounts."""
    for acc in ACCOUNTS:
        log(
            f"Executing: {signal['action'].upper()} {signal['lots']}x "
            f"{signal['strike']} {signal['option_type']} "
            f"expiry={signal.get('expiry_date', '?')}",
            acc["name"],
        )
        await asyncio.to_thread(
            place_option_order,
            signal,
            acc["api_key"],
            acc["api_secret"],
            acc["multiplier"],
            acc["name"],
        )


async def handle_new_message(event):
    msg = event.message
    log(f"New message in channel. Has media: {bool(msg.media)}")

    has_image = msg.media and isinstance(msg.media, (MessageMediaPhoto, MessageMediaDocument))
    image_path = None

    # ── Image flow ────────────────────────────────────────────────────────────
    if has_image and SIGNAL_MODE in ("image", "both"):
        ts         = datetime.now().strftime("%Y%m%d_%H%M%S")
        image_path = str(DOWNLOADS / f"signal_{ts}.jpg")
        await msg.download_media(file=image_path)
        log(f"Image downloaded: {image_path}")

        log("Sending image to Gemini Vision for parsing...")
        try:
            results = parse_signal(image_path)
        except Exception as e:
            log(f"Gemini error: {e}")
            alert_error("Gemini Vision", str(e))
            return

        signals = get_valid_signals(results)
        log(f"Found {len(signals)} valid signal(s) in image.")

        if not signals:
            raw = results[0].get("raw_text", "") if results else ""
            log(f"No valid signal. Raw text: {raw}")
            alert_no_signal()
            return

        alert_signal_image(signals, len(ACCOUNTS))
        for signal in signals:
            await execute_signal_for_all_accounts(signal)
        return

    # ── Text flow ─────────────────────────────────────────────────────────────
    if msg.text and SIGNAL_MODE in ("text", "both"):
        log(f"Text message: {msg.text[:200]}")
        segments = re.split(r"\s+and\s+|&", msg.text, flags=re.IGNORECASE)
        first    = None
        valid    = []
        for segment in segments:
            parsed = parse_text_signal(segment.strip(), inherit=first)
            if parsed and is_valid_signal(parsed):
                if first is None:
                    first = parsed
                valid.append(parsed)

        if not valid:
            log("No valid signal in text.")
            return

        alert_signal_text(valid, len(ACCOUNTS))
        for signal in valid:
            await execute_signal_for_all_accounts(signal)
        return

    if has_image and SIGNAL_MODE == "text":
        log(f"Signal mode=text — skipping image.")
    elif not has_image and SIGNAL_MODE == "image":
        log(f"Signal mode=image — skipping text-only message.")
    else:
        log("No actionable content in message.")


# ── Text-only fallback parser ─────────────────────────────────────────────────

def parse_text_signal(text: str, inherit: dict = None) -> dict | None:
    """
    Fallback for plain text: 'Sell 3 lots 58k PE', 'Exit 2 lots 68k CE', '69K CE'.
    All keywords (sell/buy/exit/pe/ce/k) are case-insensitive.
    `inherit` carries action/lots from a prior segment of the same message.
    """
    t            = text.lower()
    action_match = re.search(r"\b(sell|buy|exit)\b", t)
    lots_match   = re.search(r"(\d+)\s*lots?\b", t)
    # Strike: prefer explicit "NNk" format; fall back to bare 5-digit number
    strike_match = re.search(r"\b(\d+)\s*k\b", t) or re.search(r"\b(\d{5,})\b", t)
    type_match   = re.search(r"\b(pe|ce)\b", t)

    action = action_match.group(1) if action_match else (inherit or {}).get("action")
    lots   = int(lots_match.group(1)) if lots_match else (inherit or {}).get("lots")

    if not all([action, lots, type_match, strike_match]):
        return None

    strike_raw = strike_match.group(1)
    strike     = int(strike_raw) * 1000 if int(strike_raw) < 1000 else int(strike_raw)

    return {
        "action":      action,
        "strike":      strike,
        "option_type": type_match.group(1).upper(),
        "lots":        lots,
        "expiry_date": None,
        "stop_loss":   None,
        "target":      None,
        "confidence":  "high",
        "raw_text":    text,
    }


# ── Main ──────────────────────────────────────────────────────────────────────

async def heartbeat():
    """Log every 10 min; send Telegram alert every hour."""
    from coinswitch_trader import DRY_RUN, LIVE_FROM
    mode     = f"DRY RUN (live from {LIVE_FROM})" if DRY_RUN else "LIVE TRADING"
    tick     = 0
    while True:
        await asyncio.sleep(600)
        tick += 1
        log(f"Heartbeat — bot alive | mode={mode} | accounts={[a['name'] for a in ACCOUNTS]}")
        if tick % 6 == 0:  # every 60 min
            alert_heartbeat(mode, [a["name"] for a in ACCOUNTS])


async def main():
    global client
    from coinswitch_trader import DRY_RUN, LIVE_FROM
    log("Starting BTC Options Bot...")
    mode = f"DRY RUN — live trading starts {LIVE_FROM}" if DRY_RUN else "LIVE TRADING ACTIVE"
    log(f"Mode: {mode}")
    log(f"Accounts active: {[a['name'] for a in ACCOUNTS]}")

    client = TelegramClient("session/telegram_session", API_ID, API_HASH)
    await client.start()
    log(f"Telegram connected. Listening to channel ID: {CHANNEL_ID}")

    @client.on(events.NewMessage(chats=CHANNEL_ID))
    async def handler(event):
        await handle_new_message(event)

    log("Bot is live. Waiting for signals...")
    asyncio.ensure_future(heartbeat())
    await client.run_until_disconnected()


if __name__ == "__main__":
    asyncio.run(main())
