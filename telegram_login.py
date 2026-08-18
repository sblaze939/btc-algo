"""
One-time Telegram login. Run this to save your session.
After this, main.py runs silently without prompting again.
"""
import asyncio
from telethon import TelegramClient
from dotenv import load_dotenv
import os

load_dotenv()

API_ID   = int(os.getenv("TELEGRAM_API_ID"))
API_HASH = os.getenv("TELEGRAM_API_HASH")

async def main():
    client = TelegramClient("session/telegram_session", API_ID, API_HASH)
    await client.start()
    me = await client.get_me()
    print(f"\nLogged in as: {me.first_name} (@{me.username})")
    print("Session saved to session/telegram_session.session")
    print("You can now run: python main.py")
    await client.disconnect()

asyncio.run(main())
