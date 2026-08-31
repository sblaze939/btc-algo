#!/bin/bash
# Kill any stale main.py before starting a fresh instance
pgrep -f "python.*main.py" | xargs -r kill -9
sleep 1
rm -f /home/ubuntu/btc-options-bot/session/telegram_session.session-journal
