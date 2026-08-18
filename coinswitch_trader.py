"""
CoinSwitch DMA API — Options order execution.
Base URL: https://dma.coinswitch.co
Auth: Ed25519 signature (pynacl)
"""
import json
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

DRY_RUN   = os.getenv("DRY_RUN", "false").strip().lower() == "true"
LIVE_FROM = os.getenv("LIVE_FROM", "")  # YYYY-MM-DD; empty = no gate


def _is_live_trading_allowed() -> bool:
    """Returns True only if DRY_RUN=false AND today >= LIVE_FROM."""
    if DRY_RUN:
        return False
    if LIVE_FROM:
        try:
            gate = datetime.strptime(LIVE_FROM, "%Y-%m-%d").date()
            if datetime.now(timezone.utc).date() < gate:
                return False
        except ValueError:
            pass
    return True


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
    Convert a human expiry string → Bybit format DDMMMYY (e.g. '21AUG26').
    Accepts: '21 Aug 26', '21 Aug 2026', '21AUG26', 'Aug 21', etc.
    """
    if not expiry_hint:
        return None
    months = {"jan":"JAN","feb":"FEB","mar":"MAR","apr":"APR","may":"MAY","jun":"JUN",
               "jul":"JUL","aug":"AUG","sep":"SEP","oct":"OCT","nov":"NOV","dec":"DEC"}
    import re
    s = expiry_hint.strip()
    # Already in target format
    if re.match(r"^\d{2}[A-Z]{3}\d{2}$", s):
        return s
    # Try to extract day, month, year
    parts = re.findall(r"[A-Za-z]+|\d+", s)
    day = month_str = year_str = None
    for p in parts:
        if p.lower() in months:
            month_str = months[p.lower()]
        elif len(p) == 4 and p.isdigit():
            year_str = p[-2:]
        elif len(p) <= 2 and p.isdigit():
            day = p.zfill(2)
    if day and month_str:
        if not year_str:
            year_str = str(datetime.now(timezone.utc).year)[-2:]
        return f"{day}{month_str}{year_str}"
    return None


def find_option_symbol(strike: int, option_type: str, expiry_hint: str = None,
                       api_key: str = None, api_secret: str = None) -> str | None:
    """
    Resolve strike + option_type (+ optional expiry) to the correct BTC option symbol.
    Prefers the expiry from the signal; falls back to nearest Friday.
    Symbol format: BTC-21AUG26-58000-P-USDT
    """
    side = "P" if option_type.upper() in ("PE", "P") else "C"
    target_expiry = _parse_expiry(expiry_hint)  # e.g. "21AUG26"

    instruments = get_btc_option_instruments(api_key, api_secret)

    # Filter by strike and type
    candidates = [
        inst for inst in instruments
        if inst["symbol"].endswith(f"-{side}-USDT") and str(strike) in inst["symbol"]
    ]

    if candidates and target_expiry:
        # Prefer exact expiry match from signal
        exact = [c for c in candidates if target_expiry in c["symbol"]]
        if exact:
            log(f"Symbol (expiry-matched): {exact[0]['symbol']}")
            return exact[0]["symbol"]

    if candidates:
        # Nearest expiry
        candidates.sort(key=lambda x: int(x.get("deliveryTime", "9999999999999")))
        log(f"Symbol (nearest expiry): {candidates[0]['symbol']}")
        return candidates[0]["symbol"]

    # Fallback: build from expiry hint or nearest Friday
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

    # Scale lots by account multiplier, minimum 1
    lots = max(1, round(raw_lots * multiplier))
    if multiplier != 1.0:
        log(f"Lot scaling: mentor={raw_lots} × {multiplier}x = {lots} lots", account_name)

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

    symbol = find_option_symbol(strike, option_type, expiry_hint, api_key, api_secret)
    if not symbol:
        return False

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
        log(f"ERROR: Invalid price {price} for {symbol}", account_name)
        return False

    log(f"Mark={mark}  Bid={bid}  Ask={ask}  → Order price={price}", account_name)

    order_link_id = str(uuid.uuid4())
    body = {
        "category":    "option",
        "symbol":      symbol,
        "side":        side,
        "orderType":   "Limit",
        "qty":         str(lots),
        "price":       price,
        "timeInForce": "GTC",
        "orderLinkId": order_link_id,
    }

    # ── Dry-run / pre-live gate ───────────────────────────────────────────────
    if not _is_live_trading_allowed():
        reason = f"DRY_RUN=true" if DRY_RUN else f"live trading starts {LIVE_FROM}"
        log(f"[DRY RUN] Would place: {json.dumps(body, indent=2)}  ({reason})", account_name)
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
