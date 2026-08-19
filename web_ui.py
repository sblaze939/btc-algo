"""
KiraFX Algos — Web Management UI Backend
FastAPI server: REST API + serves React build from ui/dist/
Start: python web_ui.py   (port 8080)
"""
import asyncio
import json
import os
import sys
import subprocess
import uuid
from datetime import datetime, date
from pathlib import Path
from typing import Optional

from fastapi import Cookie, Depends, FastAPI, File, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

# Import CoinSwitch API helpers (Ed25519 auth + HTTP wrappers)
sys.path.insert(0, str(Path(__file__).parent))
try:
    from coinswitch_trader import _get as _cs_get, _post as _cs_post
    _CS_OK = True
except Exception:
    _CS_OK = False


# ── Daily auto-sync task ───────────────────────────────────────────────────────

def _send_telegram_alert(message: str):
    """Send a message via the Telegram bot to the alert chat."""
    token = _env_get("TELEGRAM_BOT_TOKEN")
    chat  = _env_get("TELEGRAM_ALERT_CHAT_ID")
    if not token or not chat:
        return
    import urllib.request
    url  = f"https://api.telegram.org/bot{token}/sendMessage"
    data = json.dumps({"chat_id": chat, "text": message, "parse_mode": "Markdown"}).encode()
    try:
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10)
    except Exception:
        pass


def _check_api_expiry():
    """Alert via Telegram if master API key expires within 1 day."""
    expiry_str = _env_get("COINSWITCH_API_EXPIRY")
    if not expiry_str:
        return
    try:
        expiry = date.fromisoformat(expiry_str)
        days_left = (expiry - date.today()).days
        if days_left <= 1:
            msg = (
                f"⚠️ *CoinSwitch API Key Expiry Alert*\n\n"
                f"Your master API key expires on *{expiry_str}* "
                f"({'today' if days_left <= 0 else 'tomorrow'}).\n\n"
                f"Generate new keys at CoinSwitch DMA and update `.env` on the VM, "
                f"then click *Reset Expiry* in Settings."
            )
            _send_telegram_alert(msg)
    except ValueError:
        pass


async def _daily_sync():
    """Runs once on startup (after 30s), then every 24h. Caches portfolio snapshot."""
    await asyncio.sleep(30)
    while True:
        try:
            if _CS_OK:
                k = _env_get("COINSWITCH_API_KEY")
                s = _env_get("COINSWITCH_API_SECRET")
                if k and s:
                    wallet = _fetch_wallet(k, s)
                    positions = _fetch_positions(k, s, "master")
                    snap = {
                        "synced_at":  datetime.now().isoformat(),
                        "wallet":     wallet,
                        "positions":  positions,
                    }
                    (BOT_DIR / "logs" / "portfolio_snapshot.json").write_text(
                        json.dumps(snap, indent=2)
                    )
        except Exception:
            pass
        try:
            _check_api_expiry()
        except Exception:
            pass
        await asyncio.sleep(86400)  # 24 hours


from contextlib import asynccontextmanager

@asynccontextmanager
async def _lifespan(app):
    task = asyncio.create_task(_daily_sync())
    yield
    task.cancel()

app = FastAPI(title="KiraFX Algos UI", lifespan=_lifespan)
BOT_DIR           = Path(__file__).parent
UI_PASSWORD = os.getenv("UI_PASSWORD", "havenark2026")
_SESSION = "kirafx_ok"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Auth ──────────────────────────────────────────────────────────────────────

def auth(token: Optional[str] = Cookie(None, alias="token")):
    if token != _SESSION:
        raise HTTPException(401, "Unauthorized")


class LoginReq(BaseModel):
    password: str


@app.post("/api/login")
async def login(req: LoginReq, response: Response):
    if req.password != UI_PASSWORD:
        raise HTTPException(401, "Wrong password")
    response.set_cookie("token", _SESSION, httponly=True, max_age=86400 * 30, samesite="lax")
    return {"ok": True}


@app.post("/api/logout")
async def logout(response: Response):
    response.delete_cookie("token")
    return {"ok": True}


# ── Env helpers ───────────────────────────────────────────────────────────────

def _env_get(key: str) -> str:
    for line in (BOT_DIR / ".env").read_text().splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip()
    return ""


def _env_set(key: str, value: str):
    path = BOT_DIR / ".env"
    lines = path.read_text().splitlines()
    replaced = False
    for i, l in enumerate(lines):
        if l.startswith(f"{key}="):
            lines[i] = f"{key}={value}"
            replaced = True
            break
    if not replaced:
        lines.append(f"{key}={value}")
    path.write_text("\n".join(lines) + "\n")


# ── Bot status ────────────────────────────────────────────────────────────────

def _pid() -> Optional[int]:
    r = subprocess.run(["pgrep", "-f", "python main.py"], capture_output=True, text=True)
    pids = r.stdout.strip().split()
    return int(pids[0]) if pids else None


def _uptime() -> Optional[int]:
    log = BOT_DIR / "logs" / "trades.log"
    if not log.exists():
        return None
    for line in reversed(log.read_text().splitlines()):
        if "Starting BTC Options Bot" in line:
            try:
                ts = datetime.strptime(line[1:20], "%Y-%m-%d %H:%M:%S")
                return int((datetime.now() - ts).total_seconds())
            except Exception:
                pass
    return None


@app.get("/api/status")
async def status(_=Depends(auth)):
    return {
        "running": _pid() is not None,
        "pid": _pid(),
        "dry_run": _env_get("DRY_RUN").lower() == "true",
        "live_from": _env_get("LIVE_FROM"),
        "signal_mode": _env_get("SIGNAL_MODE") or "image",
        "uptime_seconds": _uptime(),
    }


# ── Bot control ───────────────────────────────────────────────────────────────

class ActionReq(BaseModel):
    action: str  # start | stop | restart


def _systemctl(action: str):
    """Run systemctl command for kirafx-bot, falling back to pkill/nohup if systemd unavailable."""
    r = subprocess.run(["sudo", "systemctl", action, "kirafx-bot"],
                       capture_output=True, text=True)
    return r.returncode == 0


def _systemd_available() -> bool:
    r = subprocess.run(["systemctl", "is-enabled", "kirafx-bot"],
                       capture_output=True, text=True)
    return r.returncode == 0


@app.post("/api/bot/action")
async def bot_action(req: ActionReq, _=Depends(auth)):
    use_systemd = _systemd_available()
    venv = f"source {BOT_DIR}/venv/bin/activate"
    log_out = f"{BOT_DIR}/logs/trades.log"
    start_cmd = f"cd {BOT_DIR} && {venv} && nohup python main.py >> {log_out} 2>&1 &"

    mode = "DRY RUN" if _env_get("DRY_RUN").lower() == "true" else "LIVE TRADING"

    if req.action == "stop":
        if use_systemd:
            _systemctl("stop")
        else:
            subprocess.run("pkill -f 'python main.py'", shell=True)
        _send_telegram_alert(f"🔴 *BTC Options Algo — Stopped*\nAlgo stopped via dashboard.\nMode was: {mode}")
        return {"ok": True}

    if req.action == "start":
        if _pid():
            return {"ok": False, "error": "Already running"}
        if use_systemd:
            _systemctl("start")
        else:
            subprocess.Popen(start_cmd, shell=True, executable="/bin/bash")
        _send_telegram_alert(f"🟢 *BTC Options Algo — Started*\nAlgo is now running.\nMode: *{mode}*")
        return {"ok": True}

    if req.action == "restart":
        if use_systemd:
            _systemctl("restart")
        else:
            subprocess.run("pkill -f 'python main.py'", shell=True)
            await asyncio.sleep(2)
            subprocess.Popen(start_cmd, shell=True, executable="/bin/bash")
        _send_telegram_alert(f"🔄 *BTC Options Algo — Restarted*\nAlgo restarted via dashboard.\nMode: *{mode}*")
        return {"ok": True}

    raise HTTPException(400, "Invalid action: use start | stop | restart")


# ── Logs ──────────────────────────────────────────────────────────────────────

@app.get("/api/logs")
async def logs(lines: int = 300, _=Depends(auth)):
    log = BOT_DIR / "logs" / "trades.log"
    if not log.exists():
        return {"lines": []}
    return {"lines": log.read_text().splitlines()[-lines:]}


async def _sse_generator():
    log = BOT_DIR / "logs" / "trades.log"
    log.touch()
    with open(log) as f:
        f.seek(0, 2)          # seek to end
        while True:
            line = f.readline()
            if line:
                payload = json.dumps({"line": line.rstrip()})
                yield f"data: {payload}\n\n"
            else:
                await asyncio.sleep(0.8)


@app.get("/api/logs/stream")
async def log_stream(_=Depends(auth)):
    return StreamingResponse(_sse_generator(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/logs/clear")
async def clear_logs(_=Depends(auth)):
    log = BOT_DIR / "logs" / "trades.log"
    if log.exists():
        log.write_text("")
    return {"ok": True}


# ── Logo ──────────────────────────────────────────────────────────────────────

_LOGO_DIR = BOT_DIR / "static"
_LOGO_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]


def _logo_path() -> Optional[Path]:
    for ext in _LOGO_EXTS:
        p = _LOGO_DIR / f"logo{ext}"
        if p.exists():
            return p
    return None


@app.get("/api/logo")
async def get_logo():
    p = _logo_path()
    if not p:
        raise HTTPException(404, "No logo uploaded")
    return FileResponse(p, headers={"Cache-Control": "no-cache"})


@app.post("/api/logo")
async def upload_logo(file: UploadFile = File(...), _=Depends(auth)):
    _LOGO_DIR.mkdir(exist_ok=True)
    ext = Path(file.filename or "logo.png").suffix.lower() or ".png"
    if ext not in _LOGO_EXTS:
        raise HTTPException(400, "Unsupported image type")
    # Remove old logo files first
    for old_ext in _LOGO_EXTS:
        old = _LOGO_DIR / f"logo{old_ext}"
        if old.exists():
            old.unlink()
    dest = _LOGO_DIR / f"logo{ext}"
    dest.write_bytes(await file.read())
    return {"ok": True}


# ── Accounts ──────────────────────────────────────────────────────────────────

ACCS = BOT_DIR / "accounts.json"


def _read_accs():
    return json.loads(ACCS.read_text()) if ACCS.exists() else []


def _write_accs(data):
    ACCS.write_text(json.dumps(data, indent=2))


class AccInput(BaseModel):
    name: str
    account_size: int
    active: bool = True
    api_key: str = ""
    api_secret: str = ""
    lot_multiplier: Optional[float] = None  # explicit override; None = size/50000


@app.get("/api/accounts")
async def list_accounts(_=Depends(auth)):
    result = []
    for a in _read_accs():
        a = dict(a)
        masked = (a.get("api_key") or "")[:8] + "…" if a.get("api_key") else ""
        a["api_key_masked"] = masked
        a.pop("api_key", None)
        a.pop("api_secret", None)
        result.append(a)
    return result


@app.post("/api/accounts")
async def add_account(a: AccInput, _=Depends(auth)):
    accs = _read_accs()
    accs.append(a.model_dump())
    _write_accs(accs)
    return {"ok": True}


@app.put("/api/accounts/{idx}")
async def update_account(idx: int, a: AccInput, _=Depends(auth)):
    accs = _read_accs()
    if not (0 <= idx < len(accs)):
        raise HTTPException(404, "Not found")
    updated = a.model_dump()
    if not updated["api_key"]:
        updated["api_key"] = accs[idx].get("api_key", "")
    if not updated["api_secret"]:
        updated["api_secret"] = accs[idx].get("api_secret", "")
    accs[idx] = updated
    _write_accs(accs)
    return {"ok": True}


@app.patch("/api/accounts/{idx}/toggle")
async def toggle_account(idx: int, _=Depends(auth)):
    accs = _read_accs()
    if not (0 <= idx < len(accs)):
        raise HTTPException(404, "Not found")
    accs[idx]["active"] = not accs[idx].get("active", True)
    _write_accs(accs)
    return {"ok": True, "active": accs[idx]["active"]}


@app.delete("/api/accounts/{idx}")
async def delete_account(idx: int, _=Depends(auth)):
    accs = _read_accs()
    if not (0 <= idx < len(accs)):
        raise HTTPException(404, "Not found")
    accs.pop(idx)
    _write_accs(accs)
    return {"ok": True}


# ── Settings ──────────────────────────────────────────────────────────────────

@app.get("/api/settings")
async def get_settings(_=Depends(auth)):
    return {
        "dry_run": _env_get("DRY_RUN").lower() == "true",
        "live_from": _env_get("LIVE_FROM"),
        "signal_mode": _env_get("SIGNAL_MODE") or "image",
        "alert_chat_id": _env_get("TELEGRAM_ALERT_CHAT_ID"),
        "source_channel_id": _env_get("TELEGRAM_CHANNEL_ID"),
        "current_expiry": _env_get("CURRENT_EXPIRY") or _env_get("LIVE_FROM"),
        "api_key_set": bool(_env_get("COINSWITCH_API_KEY")),
        "api_key_expires": _env_get("COINSWITCH_API_EXPIRY") or None,
    }


class SettingsInput(BaseModel):
    dry_run: bool
    live_from: str
    signal_mode: str
    alert_chat_id: str
    source_channel_id: str = ""
    current_expiry: str = ""
    bot_token: str = ""
    cs_api_key: str = ""
    cs_api_secret: str = ""


@app.post("/api/settings")
async def save_settings(s: SettingsInput, _=Depends(auth)):
    from datetime import timedelta
    _env_set("DRY_RUN", "true" if s.dry_run else "false")
    _env_set("LIVE_FROM", s.live_from)
    _env_set("SIGNAL_MODE", s.signal_mode)
    _env_set("TELEGRAM_ALERT_CHAT_ID", s.alert_chat_id)
    if s.source_channel_id:
        _env_set("TELEGRAM_CHANNEL_ID", s.source_channel_id)
    if s.current_expiry:
        _env_set("CURRENT_EXPIRY", s.current_expiry)
    if s.bot_token:
        _env_set("TELEGRAM_BOT_TOKEN", s.bot_token)
    if s.cs_api_key:
        _env_set("COINSWITCH_API_KEY", s.cs_api_key)
    if s.cs_api_secret:
        _env_set("COINSWITCH_API_SECRET", s.cs_api_secret)
    if s.cs_api_key or s.cs_api_secret:
        # New keys saved — auto-reset expiry to today + 90 days
        _env_set("COINSWITCH_API_EXPIRY", (date.today() + timedelta(days=90)).isoformat())
    return {"ok": True, "note": "Restart bot for changes to take effect"}



@app.post("/api/settings/reset-expiry")
async def reset_api_expiry(_=Depends(auth)):
    """Call this after saving new CoinSwitch API keys — sets expiry to today + 90 days."""
    from datetime import timedelta
    expiry = (date.today() + timedelta(days=90)).isoformat()
    _env_set("COINSWITCH_API_EXPIRY", expiry)
    return {"ok": True, "expiry": expiry}


# ── Portfolio / positions / journal ───────────────────────────────────────────

def _live_allowed() -> bool:
    if _env_get("DRY_RUN").lower() == "true":
        return False
    lf = _env_get("LIVE_FROM")
    if lf:
        try:
            if date.today() < date.fromisoformat(lf):
                return False
        except ValueError:
            pass
    return True


def _keys_for(acct: dict) -> tuple[str, str]:
    """Return (api_key, api_secret) for an account, falling back to master .env."""
    k = acct.get("api_key") or _env_get("COINSWITCH_API_KEY")
    s = acct.get("api_secret") or _env_get("COINSWITCH_API_SECRET")
    return k, s


def _fetch_wallet(api_key: str, api_secret: str) -> dict:
    r = _cs_get("/v5/account/wallet-balance", {"accountType": "UNIFIED"}, api_key, api_secret)
    coins = r.get("result", {}).get("list", [{}])[0].get("coin", [])
    # CoinSwitch DMA uses INR-denominated accounts; fall back to USDT if not found
    coin = (
        next((c for c in coins if c.get("coin") == "INR"), None)
        or next((c for c in coins if c.get("coin") == "USDT"), None)
        or (max(coins, key=lambda c: float(c.get("equity", 0))) if coins else {})
    )
    return {
        "currency":        coin.get("coin", "INR"),
        "equity":          float(coin.get("equity", 0)),
        "wallet_balance":  float(coin.get("walletBalance", 0)),
        "unrealised_pnl":  float(coin.get("unrealisedPnl", 0)),
    }


def _fetch_positions(api_key: str, api_secret: str, account_name: str) -> list:
    r = _cs_get("/v5/position/list", {"category": "option", "settleCoin": "USDT"}, api_key, api_secret)
    out = []
    for p in r.get("result", {}).get("list", []):
        if float(p.get("size", 0)) == 0:
            continue
        out.append({
            "account":       account_name,
            "symbol":        p["symbol"],
            "side":          p["side"],
            "size":          p["size"],
            "avgPrice":      p.get("avgPrice", "0"),
            "markPrice":     p.get("markPrice", "0"),
            "unrealisedPnl": p.get("unrealisedPnl", "0"),
            "leverage":      p.get("leverage", "1"),
        })
    return out


@app.get("/api/portfolio/balance")
async def portfolio_balance(_=Depends(auth)):
    if not _CS_OK:
        raise HTTPException(503, "CoinSwitch module unavailable — run: pip install pynacl")
    try:
        k, s = _env_get("COINSWITCH_API_KEY"), _env_get("COINSWITCH_API_SECRET")
        return _fetch_wallet(k, s)
    except Exception as e:
        raise HTTPException(502, f"API error: {e}")


@app.get("/api/portfolio/positions")
async def portfolio_positions(_=Depends(auth)):
    if not _CS_OK:
        raise HTTPException(503, "CoinSwitch module unavailable")
    positions: list = []
    errors: list = []

    # Master account
    try:
        k, s = _env_get("COINSWITCH_API_KEY"), _env_get("COINSWITCH_API_SECRET")
        positions += _fetch_positions(k, s, "master")
    except Exception as e:
        errors.append(f"master: {e}")

    # Sub-accounts with own keys
    for acct in _read_accs():
        if acct.get("api_key") and acct.get("api_secret"):
            try:
                positions += _fetch_positions(acct["api_key"], acct["api_secret"], acct["name"])
            except Exception as e:
                errors.append(f"{acct['name']}: {e}")

    return {"positions": positions, "errors": errors}


@app.get("/api/portfolio/account/{idx}")
async def account_balance(idx: int, _=Depends(auth)):
    if not _CS_OK:
        raise HTTPException(503, "CoinSwitch module unavailable")
    accs = _read_accs()
    if not (0 <= idx < len(accs)):
        raise HTTPException(404, "Account not found")
    try:
        k, s = _keys_for(accs[idx])
        wallet = _fetch_wallet(k, s)
        positions = _fetch_positions(k, s, accs[idx]["name"])
        return {"wallet": wallet, "positions": positions}
    except Exception as e:
        raise HTTPException(502, f"API error: {e}")


class ClosePositionReq(BaseModel):
    symbol: str
    side:   str   # current side: "Buy" or "Sell"
    size:   str
    account: str  # "master" or account name from accounts.json


@app.post("/api/portfolio/close")
async def close_position(req: ClosePositionReq, _=Depends(auth)):
    if not _CS_OK:
        raise HTTPException(503, "CoinSwitch module unavailable")
    if not _live_allowed():
        raise HTTPException(400, "Cannot close: DRY_RUN=true or before LIVE_FROM date")

    if req.account == "master":
        k, s = _env_get("COINSWITCH_API_KEY"), _env_get("COINSWITCH_API_SECRET")
    else:
        accs = _read_accs()
        acct = next((a for a in accs if a["name"] == req.account), None)
        if not acct:
            raise HTTPException(404, "Account not found")
        k, s = _keys_for(acct)

    close_side = "Buy" if req.side == "Sell" else "Sell"
    try:
        ticker_r = _cs_get("/v5/market/tickers", {"category": "option", "symbol": req.symbol}, k, s)
        tickers = ticker_r.get("result", {}).get("list", [])
        if not tickers:
            raise HTTPException(400, "Ticker fetch failed")
        t = tickers[0]
        mark = t.get("markPrice", "0")
        price = t.get("ask1Price", mark) if close_side == "Buy" else t.get("bid1Price", mark)

        body = {
            "category": "option", "symbol": req.symbol,
            "side": close_side, "orderType": "Limit",
            "qty": req.size, "price": price,
            "timeInForce": "GTC", "reduceOnly": True,
            "orderLinkId": str(uuid.uuid4()),
        }
        result = _cs_post("/v5/order/create", body, k, s)
        if result.get("retCode") == 0:
            return {"ok": True, "orderId": result["result"]["orderId"]}
        raise HTTPException(400, result.get("retMsg", "Order failed"))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, str(e))


@app.get("/api/journal")
async def get_journal(_=Depends(auth)):
    history_path = BOT_DIR / "logs" / "trade_history.json"
    trades = []
    if history_path.exists():
        for line in history_path.read_text().splitlines():
            line = line.strip()
            if line:
                try:
                    trades.append(json.loads(line))
                except Exception:
                    pass
    trades.reverse()  # newest first

    total = len(trades)
    sells  = sum(1 for t in trades if t.get("side") == "Sell")
    buys   = sum(1 for t in trades if t.get("side") == "Buy")
    exits  = sum(1 for t in trades if t.get("action") == "exit")
    return {
        "trades":       trades,
        "total_trades": total,
        "sells":        sells,
        "buys":         buys,
        "exits":        exits,
    }


@app.get("/api/journal/executions")
async def get_executions(_=Depends(auth)):
    if not _CS_OK:
        raise HTTPException(503, "CoinSwitch module unavailable")
    try:
        k, s = _env_get("COINSWITCH_API_KEY"), _env_get("COINSWITCH_API_SECRET")
        r = _cs_get("/v5/execution/list", {"category": "option", "limit": "50"}, k, s)
        execs = r.get("result", {}).get("list", [])
        # Compute realized PnL sum
        total_pnl = sum(float(e.get("closedPnl", 0)) for e in execs)
        return {"executions": execs, "total_realised_pnl": total_pnl}
    except Exception as e:
        raise HTTPException(502, f"API error: {e}")


# ── Serve React build ─────────────────────────────────────────────────────────

_dist = BOT_DIR / "ui" / "dist"
if (_dist / "assets").exists():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")


@app.get("/{full_path:path}", include_in_schema=False)
async def spa(full_path: str):
    # Skip if this looks like an API path (shouldn't reach here but safety net)
    if full_path.startswith("api/"):
        raise HTTPException(404)
    index = _dist / "index.html"
    if index.exists():
        return FileResponse(index)
    return {"error": "UI not built. Run: cd ui && npm install && npm run build"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080, reload=False)
