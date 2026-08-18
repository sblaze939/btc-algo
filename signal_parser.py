import os
import json
import re
from pathlib import Path

import google.generativeai as genai
from PIL import Image
from dotenv import load_dotenv

load_dotenv()

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
model = genai.GenerativeModel("gemini-3.6-flash")

PROMPT = """You are a trading signal extractor for BTC/USDT options on CoinSwitch PRO.

This image may contain a screenshot of a WhatsApp/Telegram message with a trade signal, which may itself contain a screenshot of a trading position or order book.

Extract ALL trade signals and return ONLY valid JSON — either a single object or a JSON array if multiple signals exist (e.g. a strangle: sell both PE and CE).

Each signal object format:
{
  "action": "sell", "buy", or "exit",
  "strike": <number, e.g. 58000>,
  "option_type": "PE" or "CE",
  "lots": <number>,
  "expiry_date": "<DD Mon YY e.g. '21 Aug 26', or null>",
  "expiry_source": "explicit" or "screenshot" or "unknown",
  "stop_loss": <number or null>,
  "target": <number or null>,
  "confidence": "high" or "low",
  "raw_text": "<full readable text from image>"
}

EXPIRY RULES (in priority order):
1. If the message text explicitly states a date (e.g. "for Aug 21", "21 Aug expiry") → use it, set expiry_source="explicit"
2. If no date in text BUT the image contains a position screenshot, order panel, or options chain header showing a contract like "BTC-21AUG26-58000-P" or a date label → read the expiry from there, set expiry_source="screenshot"
3. Only if expiry is genuinely nowhere in the image → expiry_date=null, expiry_source="unknown" (caller will assume current expiry)

OTHER RULES:
- "Exit X lots of 68k CE" → action = "exit" (close/buy-back that position)
- "Sell X lots of 58k PE & 69k CE" → TWO objects, both action "sell"
- Strike: "58k" = 58000, "69K" = 69000
- CE = Call, PE = Put
- Year: assume 2026 if not stated
- If no clear signal: {"confidence": "low", "raw_text": "<what you see>"}

No explanation, no markdown fences, just raw JSON."""


def parse_signal(image_path: str) -> list[dict]:
    """
    Returns a list of signals found in the image.
    Each signal: { action, strike, option_type, lots, expiry_date, confidence, raw_text }
    """
    try:
        img = Image.open(image_path)
        if max(img.size) > 1200:
            img.thumbnail((1200, 1200))
        response = model.generate_content([PROMPT, img])
        raw = response.text.strip()
        raw = re.sub(r"^```(?:json)?\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            parsed = [parsed]
        return parsed
    except Exception as e:
        return [{"confidence": "low", "error": str(e)}]


def is_valid_signal(parsed: dict) -> bool:
    required = ["action", "strike", "option_type", "lots"]
    return (
        all(k in parsed for k in required)
        and parsed.get("confidence") == "high"
        and parsed.get("action") in ("sell", "buy", "exit")
        and isinstance(parsed.get("strike"), (int, float))
        and parsed.get("lots", 0) > 0
    )


def get_valid_signals(results: list[dict]) -> list[dict]:
    return [s for s in results if is_valid_signal(s)]
