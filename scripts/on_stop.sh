#!/bin/bash
# Fire crash alert only on failure, not on clean stop/restart
if [ "$SERVICE_RESULT" != "success" ]; then
    /home/ubuntu/btc-options-bot/venv/bin/python /home/ubuntu/btc-options-bot/send_crash_alert.py crash
fi
