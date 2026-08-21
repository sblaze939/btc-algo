"""
BTC Options Bot — Entry Point
Monitors Telegram channel for options signals and auto-executes on CoinSwitch PRO.

Run:  python main.py
"""
import fcntl, os, sys

LOCK_FILE = "/home/ubuntu/btc-options-bot/.bot.lock"

def _acquire_lock():
    fd = open(LOCK_FILE, "w")
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fd.write(str(os.getpid()))
        fd.flush()
        return fd
    except OSError:
        print("[STARTUP] Another instance is already running — exiting.")
        sys.exit(0)

_lock_fd = _acquire_lock()

from dotenv import load_dotenv
load_dotenv()

import asyncio
from telegram_listener import main

if __name__ == "__main__":
    asyncio.run(main())
