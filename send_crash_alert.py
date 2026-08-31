#!/usr/bin/env python3
import os, sys, requests
from datetime import datetime, timezone, timedelta

IST = timezone(timedelta(hours=5, minutes=30))

env = {}
try:
    with open('/home/ubuntu/btc-options-bot/.env') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, _, v = line.partition('=')
                env[k.strip()] = v.strip()
except Exception:
    pass

token   = env.get('TELEGRAM_BOT_TOKEN', '')
chat_id = env.get('TELEGRAM_ALERT_CHAT_ID', '')
mode    = sys.argv[1] if len(sys.argv) > 1 else 'crash'  # 'crash' or 'restart'

if not token or not chat_id:
    sys.exit(0)

now_ist = datetime.now(IST).strftime('%d %b %Y, %I:%M %p IST')

if mode == 'restart':
    msg = (
        "⚡ <b>Kirasha BTC Algo Restarted</b>\n"
        "Analysing signals begin.\n"
        f"Time: {now_ist}"
    )
else:
    msg = (
        "🔴 <b>Kirasha BTC Algo crashed.</b>\n"
        f"Time: {now_ist}\n"
        "Service set to restart in 30 sec."
    )

requests.post(
    f'https://api.telegram.org/bot{token}/sendMessage',
    json={'chat_id': chat_id, 'text': msg, 'parse_mode': 'HTML'},
    timeout=8
)
