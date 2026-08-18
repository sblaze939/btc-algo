"""
BTC Options Bot — Entry Point
Monitors Telegram channel for options signals and auto-executes on CoinSwitch PRO.

Run:  python main.py
"""
from dotenv import load_dotenv
load_dotenv()

import asyncio
from telegram_listener import main

if __name__ == "__main__":
    asyncio.run(main())
