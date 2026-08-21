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
from coinswitch_trader import (place_option_order, execute_close_all,
                                execute_full_exit, log, MENTOR_BASE, _parse_expiry)
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

def _round_mult(raw: float) -> float:
    """Round multiplier to nearest 0.5 step, minimum 1.0: 0.8→1.0, 1.23→1.0, 1.78→1.5"""
    whole = int(raw)
    frac  = raw - whole
    return max(1.0, float(whole) if frac < 0.5 else whole + 0.5)


def load_accounts() -> list[dict]:
    """
    Load trading accounts from accounts.json.
    Blank api_key/secret → falls back to .env values.
    Multiplier = round(account_size / MENTOR_BASE) to nearest 0.5.
    """
    path = Path("accounts.json")
    if not path.exists():
        log("accounts.json not found — using single account from .env")
        return [{"name": "Main", "api_key": None, "api_secret": None, "multiplier": 1.0, "skip_expiry": None}]

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
            mult = _round_mult(float(acc["lot_multiplier"]))
            log(f"Account loaded: {acc.get('name')}  size={size}  multiplier={mult}x (manual override)")
        else:
            mult = _round_mult(size / MENTOR_BASE)
            log(f"Account loaded: {acc.get('name')}  size={size}  multiplier={mult}x")
        result.append({
            "name":        acc.get("name", "Account"),
            "api_key":     key,
            "api_secret":  secret,
            "multiplier":  mult,
            "skip_expiry": acc.get("skip_expiry"),
        })

    if not result:
        log("No active accounts found in accounts.json — using .env fallback")
        result = [{"name": "Main", "api_key": None, "api_secret": None, "multiplier": 1.0}]

    return result


ACCOUNTS = load_accounts()


# ── Signal handlers ───────────────────────────────────────────────────────────

async def execute_signal_for_all_accounts(signal: dict):
    """Dispatch signal to all accounts — handles normal, full_exit, and close_all."""
    # Reload accounts fresh so runtime changes (skip_expiry, active toggle) apply immediately
    accounts = load_accounts()
    sig_expiry_parsed = _parse_expiry(signal.get("expiry_date", "") or "")
    for acc in accounts:
        # Skip if account is set to skip this expiry (late-joiner protection)
        skip_expiry = acc.get("skip_expiry")
        if skip_expiry and sig_expiry_parsed and skip_expiry == sig_expiry_parsed:
            log(f"SKIP expiry {skip_expiry} — account joined mid-session, skipping this signal", acc["name"])
            continue

        if signal.get("close_all"):
            log(f"Close all {signal['option_type']} positions", acc["name"])
            await asyncio.to_thread(
                execute_close_all,
                signal["option_type"], acc["api_key"], acc["api_secret"],
                acc["multiplier"], acc["name"],
            )
        elif signal.get("full_exit"):
            log(
                f"Full exit: {signal['strike']} {signal['option_type']} "
                f"expiry={signal.get('expiry_date') or 'current'}",
                acc["name"],
            )
            await asyncio.to_thread(
                execute_full_exit,
                signal["strike"], signal["option_type"], signal.get("expiry_date"),
                acc["api_key"], acc["api_secret"], acc["multiplier"], acc["name"],
            )
        else:
            log(
                f"Executing: {signal['action'].upper()} {signal['lots']}x "
                f"{signal['strike']} {signal['option_type']} "
                f"expiry={signal.get('expiry_date', '?')}",
                acc["name"],
            )
            await asyncio.to_thread(
                place_option_order,
                signal, acc["api_key"], acc["api_secret"],
                acc["multiplier"], acc["name"],
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

        # Extract expiry from the FULL message first — so a date in a preamble
        # like "For 28th Sept\n\nsell 5 lots..." applies to all signal segments.
        global_expiry_raw = _extract_expiry_from_text(msg.text)
        global_expiry     = _validate_friday_expiry(global_expiry_raw) if global_expiry_raw else None
        if global_expiry:
            log(f"Global expiry from full message: {global_expiry}")

        segments = re.split(r"\s+and\s+|[&\n]+|\bthen\b", msg.text, flags=re.IGNORECASE)
        first    = None
        valid    = []
        for segment in segments:
            parsed = parse_text_signal(segment.strip(), inherit=first)
            if parsed and is_valid_text_signal(parsed):
                # Fill in global expiry if the segment itself had no date
                if global_expiry and not parsed.get("expiry_date"):
                    parsed["expiry_date"]   = global_expiry
                    parsed["expiry_source"] = "explicit"
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

_MONTHS_MAP = {
    "jan":"Jan","feb":"Feb","mar":"Mar","apr":"Apr","may":"May","jun":"Jun",
    "jul":"Jul","aug":"Aug","sep":"Sep","oct":"Oct","nov":"Nov","dec":"Dec"
}

_NUM_TO_MON = {1:"Jan",2:"Feb",3:"Mar",4:"Apr",5:"May",6:"Jun",
               7:"Jul",8:"Aug",9:"Sep",10:"Oct",11:"Nov",12:"Dec"}

def _extract_expiry_from_text(text: str) -> str | None:
    """
    Extract expiry hint from text. Handles:
      Text month : '28 sep', '28th sep', 'sep 28', 'sep 28th', '28/sep', 'sep-28'
                   'september 28', '28 sept' (partial match works)
      Numeric DD/MM: '28/09', '28-09', '28/9', '28.9'  (India format, day first)
    Returns a normalised '28 Sep' string for further validation.
    """
    t = text.lower()

    # ── Text month names (including abbreviated + partial like 'sept') ─────────
    for mon_key, mon_val in _MONTHS_MAP.items():
        m = re.search(rf"(\d{{1,2}})(?:st|nd|rd|th)?\s*[-/]?\s*{mon_key}", t)
        if m:
            return f"{m.group(1)} {mon_val}"
        m = re.search(rf"{mon_key}\s*[-/]?\s*(\d{{1,2}})(?:st|nd|rd|th)?", t)
        if m:
            return f"{m.group(1)} {mon_val}"

    # ── Numeric DD/MM (separator: / - .) ──────────────────────────────────────
    # Match DD[sep]MM (optionally followed by [sep]YY or [sep]YYYY)
    # Constraint: day 1-31, month 1-12; day > 12 makes it unambiguous.
    m = re.search(r"\b(\d{1,2})[/.\-](\d{1,2})(?:[/.\-]\d{2,4})?\b", t)
    if m:
        day_n, mon_n = int(m.group(1)), int(m.group(2))
        # If first number ≤ 12 AND second > 12, it could be MM/DD — swap
        if day_n <= 12 and mon_n > 12:
            day_n, mon_n = mon_n, day_n
        if 1 <= mon_n <= 12 and 1 <= day_n <= 31:
            return f"{day_n} {_NUM_TO_MON[mon_n]}"

    return None


def _validate_friday_expiry(expiry_str: str) -> str | None:
    """
    Return a confirmed Friday expiry string for the given date.

    If the date is already a Friday → return as-is.

    Typo-correction pass (before snapping):
      Check the same day-of-month in the previous and next calendar months.
      BTC options expire every Friday, and the same day-of-month cannot be a
      Friday in two adjacent months (months are 28–31 days, never an exact
      multiple of 7 — except February's 28-day edge case).  So if exactly one
      adjacent month's same date lands on a Friday it is almost certainly a
      mentor typo (e.g. "28 Sep" when Aug 28 is the expiry Friday) → use it.

    Last resort → snap to the nearest Friday to the stated date.
    """
    from datetime import date as _date, timedelta as _td
    from coinswitch_trader import _parse_expiry
    MONTHS = {"JAN":1,"FEB":2,"MAR":3,"APR":4,"MAY":5,"JUN":6,"JUL":7,"AUG":8,"SEP":9,"OCT":10,"NOV":11,"DEC":12}
    bybit = _parse_expiry(expiry_str)
    if not bybit:
        return None
    m = re.match(r"(\d{2})([A-Z]{3})(\d{2})", bybit)
    if not m:
        return None
    day_s, mon, yr_s = m.groups()
    mn = MONTHS.get(mon)
    if not mn:
        return None
    day_i = int(day_s)
    yr_i  = 2000 + int(yr_s)
    try:
        d = _date(yr_i, mn, day_i)
    except ValueError:
        return None

    if d.weekday() == 4:  # already Friday
        return expiry_str

    # ── Typo-correction pass ───────────────────────────────────────────────────
    # Same day-of-month in prev month and next month
    corrections: list[_date] = []
    for delta in (-1, +1):
        m2 = mn + delta
        y2 = yr_i
        if m2 == 0:
            m2, y2 = 12, y2 - 1
        elif m2 == 13:
            m2, y2 = 1, y2 + 1
        try:
            d2 = _date(y2, m2, day_i)
        except ValueError:
            continue  # day doesn't exist in that month (e.g. 31 in April)
        if d2.weekday() == 4:
            corrections.append(d2)

    if len(corrections) == 1:
        corrected = corrections[0]
        log(f"TYPO CORRECTION: '{expiry_str}' ({d.strftime('%A %d %b %y')}) → "
            f"{corrected.strftime('%d %b %y')} (same date is a Friday in adjacent month)")
        return corrected.strftime("%-d %b %y")

    # ── Fallback: nearest Friday to stated date ────────────────────────────────
    days_since = (d.weekday() - 4) % 7
    days_until = (4 - d.weekday()) % 7
    preceding  = d - _td(days=days_since)
    following  = d + _td(days=days_until)
    today      = _date.today()
    nearest    = preceding if preceding >= today else following
    log(f"INFO: '{expiry_str}' is a {d.strftime('%A')} — snapping to nearest Friday {nearest.strftime('%d %b %y')}")
    return nearest.strftime("%-d %b %y")


def is_valid_text_signal(signal: dict) -> bool:
    if not signal:
        return False
    if signal.get("confidence") != "high":
        return False
    if signal.get("action") not in ("sell", "buy", "exit"):
        return False
    if not signal.get("option_type"):
        return False
    if signal.get("close_all"):
        return True
    if signal.get("full_exit"):
        return signal.get("strike") is not None
    return signal.get("strike") is not None and (signal.get("lots") or 0) > 0


def parse_text_signal(text: str, inherit: dict = None) -> dict | None:
    """
    Parse a plain-text signal segment. Handles:
    - 'Sell 3 lots 60k PE' → normal entry
    - 'Exit 68k CE' / 'Buy 68k CE' → full exit (fetch from broker)
    - 'Exit 68k CE full' / 'Fully exit 68k CE' → full exit
    - 'Close all CE' / 'Exit all PE' → close every open CE/PE position
    - 'close' is treated as 'exit'
    - sell with no lots → warning + skip
    """
    t = text.lower().strip()
    if not t:
        return None

    # Action: sell | buy | exit | close (close → exit)
    action_match = re.search(r"\b(sell|buy|exit|close)\b", t)
    action_raw   = action_match.group(1) if action_match else None
    action       = "exit" if action_raw == "close" else (action_raw or (inherit or {}).get("action"))
    if not action:
        return None

    # Full exit keywords
    is_full = bool(re.search(r"\b(full|fully|all|complete|completely)\b", t))

    # Lots (explicit number only)
    lots_match = re.search(r"(\d+)\s*lots?\b", t)
    lots       = int(lots_match.group(1)) if lots_match else None
    if lots is None and not is_full:
        lots = (inherit or {}).get("lots")

    # sell with no lots → skip
    if action == "sell" and lots is None:
        log(f"WARNING: Sell with no lot count — skipping: '{text}'")
        return None

    # Strike
    strike_match = re.search(r"\b(\d+)\s*k\b", t) or re.search(r"\b(\d{5,})\b", t)

    # Option type
    type_match = re.search(r"\b(pe|ce)\b", t)
    if not type_match:
        return None

    # close_all: buy/exit with type but no specific strike
    close_all = (not strike_match) and action in ("buy", "exit")

    # full_exit: buy/exit with no lots (or explicit full/all keywords)
    full_exit = (not close_all) and action in ("buy", "exit") and (is_full or lots is None)

    # Expiry: extract and validate as Friday
    expiry_hint = _extract_expiry_from_text(t)
    if expiry_hint:
        expiry_hint = _validate_friday_expiry(expiry_hint)

    strike = None
    if strike_match:
        sr     = strike_match.group(1)
        strike = int(sr) * 1000 if int(sr) < 1000 else int(sr)

    return {
        "action":        action,
        "strike":        strike,
        "option_type":   type_match.group(1).upper(),
        "lots":          lots,
        "full_exit":     full_exit,
        "close_all":     close_all,
        "expiry_date":   expiry_hint,
        "expiry_source": "explicit" if expiry_hint else "unknown",
        "stop_loss":     None,
        "target":        None,
        "confidence":    "high",
        "raw_text":      text,
    }


# ── Main ──────────────────────────────────────────────────────────────────────

async def heartbeat():
    """Log every 10 min; send Telegram alert every 60 min (deletes previous)."""
    from coinswitch_trader import DRY_RUN
    mode    = "DRY RUN" if DRY_RUN else "LIVE TRADING"
    tick    = 0
    prev_id = None
    while True:
        await asyncio.sleep(600)
        tick += 1
        log(f"Heartbeat — bot alive | mode={mode} | accounts={[a['name'] for a in ACCOUNTS]}")
        if tick % 6 == 0:  # every 60 min
            prev_id = alert_heartbeat(mode, [a["name"] for a in ACCOUNTS], prev_msg_id=prev_id)


async def main():
    global client
    from coinswitch_trader import DRY_RUN
    log("Starting BTC Options Bot...")
    mode = "DRY RUN" if DRY_RUN else "LIVE TRADING ACTIVE"
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
