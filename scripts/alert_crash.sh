#!/bin/bash
# Called by systemd OnFailure — sends Telegram alert when a service crashes.
# Usage: alert_crash.sh <service-label>
set -euo pipefail

LABEL="${1:-BTC Options Algo}"
ENV_FILE="/home/ubuntu/btc-options-bot/.env"

if [ ! -f "$ENV_FILE" ]; then
    exit 0
fi

BOT_TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
CHAT_ID=$(grep '^TELEGRAM_ALERT_CHAT_ID=' "$ENV_FILE" | cut -d= -f2-)

if [ -z "$BOT_TOKEN" ] || [ -z "$CHAT_ID" ]; then
    exit 0
fi

MSG="🚨 *${LABEL} — Crashed*%0AProcess stopped unexpectedly on the VM.%0ASystemd will auto-restart in 30 seconds."

curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d "chat_id=${CHAT_ID}&text=${MSG}&parse_mode=Markdown" \
    --max-time 10 > /dev/null || true
