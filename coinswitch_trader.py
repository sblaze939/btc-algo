"""
CoinSwitch DMA API — Options order execution.
Base URL: https://dma.coinswitch.co
Auth: Ed25519 signature (pynacl)
"""
import json
import math
import os
import time
import uuid
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

try:
    from nacl.signing import SigningKey
except ImportError:
    SigningKey = None

try:
    from alerts import alert_dry_run, alert_order_placed, alert_order_failed
except ImportError:
    def alert_dry_run(*a, **k): pass
    def alert_order_placed(*a, **k): pass
    def alert_order_failed(*a, **k): pass

load_dotenv()

BASE_URL   = "https://dma.coinswitch.co"
API_KEY    = os.getenv("COINSWITCH_API_KEY")
API_SECRET = os.getenv("COINSWITCH_API_SECRET")
LOGS_DIR   = Path("logs")
LOGS_DIR.mkdir(exist_ok=True)

# Mentor baseline account size (INR). Your multiplier = your_account / MENTOR_BASE.
MENTOR_BASE = 50_000

DRY_RUN = os.getenv("DRY_RUN", "false").strip().lower() == "true"


def _is_live_trading_allowed() -> bool:
    """Returns True only if DRY_RUN=false."""
    return not DRY_RUN


def log(msg: str, account: str = ""):
    tag  = f"[{account}] " if account else ""
    ts   = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {tag}{msg}"
    print(line)
    with open(LOGS_DIR / "trades.log", "a") as f:
        f.write(line + "\n")


# ── Auth / HTTP ──────────────────────────────────────────────────────────────

def _sign(method: str, endpoint: str, params: dict = None,
          api_key: str = None, api_secret: str = None) -> dict:
    if not SigningKey:
        raise ImportError("Run: pip install pynacl")
    api_key    = api_key    or API_KEY
    api_secret = api_secret or API_SECRET
    params     = params or {}
    epoch      = str(int(time.time()))
    ep         = endpoint
    if method == "GET" and params:
        sep  = "&" if "?" in ep else "?"
        ep  += sep + urllib.parse.urlencode(params)
    msg  = method + urllib.parse.unquote_plus(ep) + epoch
    key  = SigningKey(bytes.fromhex(api_secret))
    sig  = key.sign(msg.encode()).signature.hex()
    return {
        "X-AUTH-SIGNATURE": sig,
        "X-AUTH-APIKEY":    api_key,
        "X-AUTH-EPOCH":     epoch,
        "Content-Type":     "application/json",
    }


def _get(endpoint: str, params: dict = None,
         api_key: str = None, api_secret: str = None) -> dict:
    params = params or {}
    r = requests.get(
        BASE_URL + endpoint,
        headers=_sign("GET", endpoint, params, api_key, api_secret),
        params=params,
    )
    r.raise_for_status()
    return r.json()


def _post(endpoint: str, body: dict,
          api_key: str = None, api_secret: str = None) -> dict:
    r = requests.post(
        BASE_URL + endpoint,
        headers=_sign("POST", endpoint, api_key=api_key, api_secret=api_secret),
        json=body,
    )
    r.raise_for_status()
    return r.json()


# ── Fund transfer (one-time setup or top-up) ─────────────────────────────────

def activate_options_access(inr_amount: int = 5000,
                            api_key: str = None, api_secret: str = None):
    body = {
        "client_txn_id": str(uuid.uuid4()),
        "direction":     "IN",
        "inr_amount":    inr_amount,
    }
    result = _post("/dma/api/v1/funds/transfer", body, api_key, api_secret)
    log(f"Fund transfer result: {result}")
    return result


# ── Market data ───────────────────────────────────────────────────────────────

def get_btc_option_instruments(api_key: str = None, api_secret: str = None) -> list:
    result = _get("/v5/market/instruments-info", {
        "category": "option",
        "baseCoin": "BTC",
        "status":   "Trading",
    }, api_key, api_secret)
    return result.get("result", {}).get("list", [])


def _parse_expiry(expiry_hint: str) -> str | None:
    """
    Convert a human expiry string → Bybit format DMMMYY (e.g. '4SEP26', '21AUG26').
    Accepts: '21 Aug 26', '21 Aug 2026', '21AUG26', 'Aug 21', '4 Sep', etc.
    Days are NOT zero-padded — Bybit uses '4SEP26', not '04SEP26'.
    """
    if not expiry_hint:
        return None
    months = {"jan":"JAN","feb":"FEB","mar":"MAR","apr":"APR","may":"MAY","jun":"JUN",
               "jul":"JUL","aug":"AUG","sep":"SEP","oct":"OCT","nov":"NOV","dec":"DEC"}
    import re
    from datetime import date as _date
    s = expiry_hint.strip()
    # Already in Bybit format (with or without leading zero)
    if re.match(r"^\d{1,2}[A-Z]{3}\d{2}$", s):
        # Normalise: strip leading zero on day
        m = re.match(r"^0(\d[A-Z]{3}\d{2})$", s)
        return m.group(1) if m else s
    # ISO format YYYY-MM-DD (e.g. '2026-09-04' → '4SEP26')
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", s)
    if m:
        try:
            d = _date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            return f"{d.day}{d.strftime('%b').upper()}{str(d.year)[-2:]}"
        except ValueError:
            pass
    # Try to extract day, month, year
    parts = re.findall(r"[A-Za-z]+|\d+", s)
    day = month_str = year_str = None
    for p in parts:
        if p.lower() in months:
            month_str = months[p.lower()]
        elif len(p) == 4 and p.isdigit():
            year_str = p[-2:]
        elif len(p) <= 2 and p.isdigit():
            day = str(int(p))  # no zero-pad: "04" → "4", "21" stays "21"
    if day and month_str:
        if not year_str:
            year_str = str(datetime.now(timezone.utc).year)[-2:]
        return f"{day}{month_str}{year_str}"
    return None


def _expiry_in_symbol(bybit_expiry: str, symbol: str) -> bool:
    """
    Check whether bybit_expiry (e.g. '4SEP26') matches inside a symbol like
    'BTC-4SEP26-64000-P-USDT'.  Handles both zero-padded and non-padded days.
    Uses hyphen boundaries so '4SEP26' doesn't falsely match '14SEP26'.
    """
    if not bybit_expiry or not symbol:
        return False
    if f"-{bybit_expiry}-" in symbol:
        return True
    # Also check the zero-padded variant
    m = re.match(r"^(\d)([A-Z]{3}\d{2})$", bybit_expiry)
    if m:
        return f"-0{m.group(1)}{m.group(2)}-" in symbol
    # And the unpadded variant if we received a zero-padded string
    m2 = re.match(r"^0(\d[A-Z]{3}\d{2})$", bybit_expiry)
    if m2:
        return f"-{m2.group(1)}-" in symbol
    return False


def find_option_symbol(strike: int, option_type: str, expiry_hint: str = None,
                       strict: bool = False,
                       api_key: str = None, api_secret: str = None) -> str | None:
    """
    Resolve strike + option_type (+ optional expiry) to the correct BTC option symbol.
    Symbol format: BTC-21AUG26-58000-P-USDT

    strict=True  → explicit expiry given; return None if no exact contract found (no fallback).
    strict=False → no explicit expiry; prefer CURRENT_EXPIRY, then nearest as last resort.
    """
    side = "P" if option_type.upper() in ("PE", "P") else "C"
    target_expiry = _parse_expiry(expiry_hint)  # e.g. "04SEP26" or None

    instruments = get_btc_option_instruments(api_key, api_secret)

    # Filter by strike and type
    candidates = [
        inst for inst in instruments
        if inst["symbol"].endswith(f"-{side}-USDT") and str(strike) in inst["symbol"]
    ]

    if candidates:
        # 1. Exact match on explicit expiry
        if target_expiry:
            exact = [c for c in candidates if _expiry_in_symbol(target_expiry, c["symbol"])]
            if exact:
                log(f"Symbol (expiry-matched): {exact[0]['symbol']}")
                return exact[0]["symbol"]
            if strict:
                log(f"ABORT: No {strike}{option_type} contract for explicit expiry {target_expiry} — refusing nearest fallback")
                return None
            # Non-strict explicit: fall through to CURRENT_EXPIRY / nearest

        # 2. No explicit expiry → prefer CURRENT_EXPIRY before nearest
        if not target_expiry:
            cur = _get_current_expiry_date()
            if cur:
                cur_bybit = str(cur.day) + cur.strftime("%b%y").upper()  # e.g. "4SEP26"
                cur_exact = [c for c in candidates if _expiry_in_symbol(cur_bybit, c["symbol"])]
                if cur_exact:
                    log(f"Symbol (CURRENT_EXPIRY match): {cur_exact[0]['symbol']}")
                    return cur_exact[0]["symbol"]

        # 3. Last resort: nearest expiry
        candidates.sort(key=lambda x: int(x.get("deliveryTime", "9999999999999")))
        log(f"Symbol (nearest expiry — verify manually): {candidates[0]['symbol']}")
        return candidates[0]["symbol"]

    # No candidates at all — build symbol string directly
    if target_expiry:
        expiry_str = target_expiry
    else:
        today = datetime.now(timezone.utc)
        days_to_friday = (4 - today.weekday()) % 7 or 7
        expiry = today + timedelta(days=days_to_friday)
        expiry_str = expiry.strftime("%d%b%y").upper()

    symbol = f"BTC-{expiry_str}-{strike}-{side}-USDT"
    ticker = get_ticker(symbol, api_key, api_secret)
    if ticker:
        log(f"Symbol (fallback ticker): {symbol}")
        return symbol

    log(f"ERROR: Could not resolve symbol for {strike} {option_type} expiry={expiry_hint}")
    return None


def get_ticker(symbol: str, api_key: str = None, api_secret: str = None) -> dict:
    result = _get("/v5/market/tickers", {"category": "option", "symbol": symbol},
                  api_key, api_secret)
    items = result.get("result", {}).get("list", [])
    return items[0] if items else {}


# ── Expiry helpers ────────────────────────────────────────────────────────────

def _parse_symbol_expiry_date(symbol: str):
    """Extract expiry as date from symbol like BTC-4SEP26-68000-C-USDT or BTC-22AUG26-..."""
    from datetime import date as _date
    MONTHS = {"JAN":1,"FEB":2,"MAR":3,"APR":4,"MAY":5,"JUN":6,"JUL":7,"AUG":8,"SEP":9,"OCT":10,"NOV":11,"DEC":12}
    import re as _re
    m = _re.match(r"BTC-(\d{1,2})([A-Z]{3})(\d{2})-", symbol)
    if not m:
        return None
    day, mon, yr = m.groups()
    mn = MONTHS.get(mon)
    if not mn:
        return None
    try:
        return _date(2000 + int(yr), mn, int(day))
    except ValueError:
        return None


def _get_current_expiry_date():
    """Read CURRENT_EXPIRY (or LIVE_FROM fallback) from .env file fresh each call."""
    from datetime import date as _date
    env_path = Path(__file__).parent / ".env"
    val = ""
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("CURRENT_EXPIRY="):
                val = line.split("=", 1)[1].strip()
                break
        if not val:
            for line in env_path.read_text().splitlines():
                if line.startswith("LIVE_FROM="):
                    val = line.split("=", 1)[1].strip()
                    break
    if not val:
        val = os.getenv("CURRENT_EXPIRY") or os.getenv("LIVE_FROM", "")
    if not val:
        return None
    try:
        return datetime.strptime(val, "%Y-%m-%d").date()
    except ValueError:
        return None


def _update_current_expiry(date_str: str):
    """Write CURRENT_EXPIRY to .env and log."""
    env_path = Path(__file__).parent / ".env"
    lines = env_path.read_text().splitlines() if env_path.exists() else []
    replaced = False
    for i, ln in enumerate(lines):
        if ln.startswith("CURRENT_EXPIRY="):
            lines[i] = f"CURRENT_EXPIRY={date_str}"
            replaced = True
            break
    if not replaced:
        lines.append(f"CURRENT_EXPIRY={date_str}")
    env_path.write_text("\n".join(lines) + "\n")
    log(f"Current expiry auto-updated → {date_str}")


# ── Position helpers ──────────────────────────────────────────────────────────

def get_open_positions(api_key: str = None, api_secret: str = None) -> list:
    """Fetch all open BTC options positions."""
    try:
        result = _get("/v5/position/list", {"category": "option", "settleCoin": "USDT"}, api_key, api_secret)
        return result.get("result", {}).get("list", [])
    except Exception as e:
        log(f"ERROR fetching positions: {e}")
        return []


def get_positions_by_type(option_type: str, api_key: str = None, api_secret: str = None) -> list:
    """Return all open positions for CE or PE with size > 0."""
    suffix = "-C-USDT" if option_type.upper() in ("CE", "C") else "-P-USDT"
    return [p for p in get_open_positions(api_key, api_secret)
            if p.get("symbol", "").endswith(suffix) and float(p.get("size", 0)) > 0]


def get_position_lots_for_symbol(symbol: str, api_key: str = None, api_secret: str = None) -> float:
    """Return open position size (in BTC) for a specific symbol (0.0 if no position)."""
    for pos in get_open_positions(api_key, api_secret):
        if pos.get("symbol") == symbol:
            return float(pos.get("size", 0))
    return 0.0


def execute_close_all(option_type: str, api_key: str = None, api_secret: str = None,
                      multiplier: float = 1.0, account_name: str = "Main") -> int:
    """Close all open positions of given type (CE or PE). Returns orders placed count."""
    positions = get_positions_by_type(option_type, api_key, api_secret)
    if not positions:
        log(f"No open {option_type} positions to close", account_name)
        return 0
    count = 0
    for pos in positions:
        symbol = pos.get("symbol")
        size   = float(pos.get("size", 0))
        if size <= 0:
            continue
        log(f"Closing {size}x {symbol}", account_name)
        body = {
            "category":    "option",
            "symbol":      symbol,
            "side":        "Buy",
            "orderType":   "Market",
            "qty":         str(size),
            "timeInForce": "IOC",
            "orderLinkId": str(uuid.uuid4()),
        }
        if not _is_live_trading_allowed():
            log(f"[DRY RUN] Would close: {json.dumps(body)}", account_name)
            count += 1
            continue
        try:
            result = _post("/v5/order/create", body, api_key, api_secret)
            if result.get("retCode") == 0:
                log(f"Closed {symbol}: orderId={result['result']['orderId']}", account_name)
                count += 1
            else:
                log(f"Failed to close {symbol}: {result.get('retMsg')}", account_name)
        except Exception as e:
            log(f"ERROR closing {symbol}: {e}", account_name)
    return count


def execute_full_exit(strike: int, option_type: str, expiry_hint: str = None,
                      api_key: str = None, api_secret: str = None,
                      multiplier: float = 1.0, account_name: str = "Main") -> bool:
    """Exit the full open position for a specific strike."""
    symbol = find_option_symbol(strike, option_type, expiry_hint, api_key, api_secret)
    if not symbol:
        return False
    size = get_position_lots_for_symbol(symbol, api_key, api_secret)
    if size <= 0:
        log(f"No open position for {symbol} — skipping full exit", account_name)
        return False
    log(f"Full exit: {size}x {symbol}", account_name)
    body = {
        "category":    "option",
        "symbol":      symbol,
        "side":        "Buy",
        "orderType":   "Market",
        "qty":         str(size),
        "timeInForce": "IOC",
        "orderLinkId": str(uuid.uuid4()),
    }
    if not _is_live_trading_allowed():
        log(f"[DRY RUN] Would full-exit: {json.dumps(body)}", account_name)
        return True
    try:
        result = _post("/v5/order/create", body, api_key, api_secret)
        if result.get("retCode") == 0:
            log(f"Full exit placed: orderId={result['result']['orderId']}", account_name)
            return True
        else:
            log(f"Full exit failed: {result.get('retMsg')}", account_name)
            return False
    except Exception as e:
        log(f"ERROR full exit {symbol}: {e}", account_name)
        return False


# ── Order execution ───────────────────────────────────────────────────────────

def place_option_order(signal: dict,
                       api_key: str = None, api_secret: str = None,
                       multiplier: float = 1.0,
                       account_name: str = "Main") -> bool:
    """
    Execute a BTC options order.

    signal = { action: 'sell'|'buy'|'exit', strike, option_type, lots,
               expiry_date (optional), ... }

    action="exit" means close an existing short → places a Buy order.
    lots are scaled by multiplier (rounded to nearest whole lot).
    """
    strike      = int(signal["strike"])
    option_type = signal["option_type"].upper()
    action      = signal["action"].lower()
    raw_lots    = int(signal["lots"])
    expiry_hint = signal.get("expiry_date")

    # Scale lots by account multiplier — floor so we never over-trade; minimum 1
    lots = max(1, math.floor(raw_lots * multiplier))
    if multiplier != 1.0:
        log(f"Lot scaling: mentor={raw_lots} × {multiplier}x = {lots} lots (floor)", account_name)

    # "exit" = buy-back to close a short position
    if action == "exit":
        side = "Buy"
        log(f"EXIT signal: buying back {lots}x {strike} {option_type}", account_name)
    elif action == "sell":
        side = "Sell"
    else:
        side = "Buy"

    expiry_src = signal.get("expiry_source", "unknown")
    log(f"Signal: {side} {lots}x {strike} {option_type}  expiry={expiry_hint or 'current'} ({expiry_src})", account_name)

    # strict=True when the mentor explicitly stated an expiry — refuse nearest fallback
    symbol = find_option_symbol(strike, option_type, expiry_hint,
                                strict=(expiry_src == "explicit"),
                                api_key=api_key, api_secret=api_secret)
    if not symbol:
        if expiry_src == "explicit":
            reason = f"No contract for {strike}{option_type} expiry={expiry_hint} — trade aborted (explicit expiry not found)"
            alert_order_failed(account_name, f"{strike}{option_type}", reason)
        return False

    # ── Expiry gate ───────────────────────────────────────────────────────────
    symbol_expiry  = _parse_symbol_expiry_date(symbol)
    current_expiry = _get_current_expiry_date()
    if symbol_expiry and current_expiry:
        if symbol_expiry < current_expiry:
            log(f"SKIP: Contract expiry {symbol_expiry} < current expiry {current_expiry} — old contract", account_name)
            return False
        elif symbol_expiry > current_expiry:
            # Only auto-advance when the mentor explicitly stated this new expiry
            # AND the resolved symbol actually matched it (not a fallback).
            resolved_bybit = str(symbol_expiry.day) + symbol_expiry.strftime("%b%y").upper()
            explicit_bybit = _parse_expiry(expiry_hint) if expiry_hint else None
            if expiry_src == "explicit" and explicit_bybit and resolved_bybit == explicit_bybit:
                log(f"New expiry detected via explicit signal ({symbol_expiry}). Auto-updating current expiry.", account_name)
                _update_current_expiry(symbol_expiry.isoformat())
            else:
                log(f"WARN: {symbol} expiry {symbol_expiry} > CURRENT_EXPIRY {current_expiry} but signal had no explicit date — NOT auto-updating. Update CURRENT_EXPIRY in Settings if this is the new weekly expiry.", account_name)

    ticker = get_ticker(symbol, api_key, api_secret)
    if not ticker:
        log("ERROR: Ticker fetch failed", account_name)
        return False

    mark = ticker.get("markPrice", "0")
    bid  = ticker.get("bid1Price", mark)
    ask  = ticker.get("ask1Price", mark)

    # Sell at bid (collect premium); buy/exit at ask (pay to close)
    price = bid if side == "Sell" else ask
    if float(price) <= 0:
        # Bid/ask can be 0 in thin markets — fall back to mark price
        if float(mark) > 0:
            log(f"Bid/Ask is 0 for {symbol}, using markPrice={mark} as reference — proceeding", account_name)
        else:
            log(f"ERROR: No price for {symbol} (bid/ask/mark all 0)", account_name)
            return False

    log(f"Mark={mark}  Bid={bid}  Ask={ask}  → Market order", account_name)

    # CoinSwitch qty is in BTC (1 lot = 0.01 BTC)
    qty_btc = round(lots * 0.01, 4)
    order_link_id = str(uuid.uuid4())
    body = {
        "category":    "option",
        "symbol":      symbol,
        "side":        side,
        "orderType":   "Market",
        "qty":         str(qty_btc),
        "timeInForce": "IOC",
        "orderLinkId": order_link_id,
    }

    # ── Dry-run / pre-live gate ───────────────────────────────────────────────
    if not _is_live_trading_allowed():
        log(f"[DRY RUN] Would place: {json.dumps(body, indent=2)}", account_name)
        alert_dry_run(account_name, side, lots, symbol, str(price), raw_lots, multiplier)
        return True  # simulate success so caller logs it cleanly

    try:
        result = _post("/v5/order/create", body, api_key, api_secret)
        log(f"API response: {json.dumps(result)}", account_name)

        if result.get("retCode") == 0:
            order_id = result["result"]["orderId"]
            log(f"Order placed! orderId={order_id}", account_name)
            alert_order_placed(account_name, side, lots, symbol, str(price), order_id)
            record = {
                "timestamp":    datetime.now().isoformat(),
                "account":      account_name,
                "action":       action,
                "side":         side,
                "strike":       strike,
                "option_type":  option_type,
                "lots":         lots,
                "mentor_lots":  raw_lots,
                "multiplier":   multiplier,
                "symbol":       symbol,
                "price":        price,
                "order_id":     order_id,
                "link_id":      order_link_id,
            }
            with open(LOGS_DIR / "trade_history.json", "a") as f:
                f.write(json.dumps(record) + "\n")
            return True
        else:
            reason = result.get('retMsg', 'Unknown')
            log(f"Order failed: {reason}", account_name)
            alert_order_failed(account_name, symbol, reason)
            return False

    except requests.HTTPError as e:
        reason = f"HTTP {e.response.status_code}: {e.response.text[:200]}"
        log(f"HTTP error: {reason}", account_name)
        alert_order_failed(account_name, symbol, reason)
        return False
    except Exception as e:
        log(f"ERROR: {e}", account_name)
        alert_order_failed(account_name, symbol, str(e))
        return False
