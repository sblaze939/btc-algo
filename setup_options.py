"""
Run this ONCE after getting your CoinSwitch DMA API keys.
It calls the Transfer Funds endpoint which automatically whitelists
your account for options trading via the DMA API.

Usage: python setup_options.py
"""
from dotenv import load_dotenv
load_dotenv()

from coinswitch_trader import activate_options_access, _get, log
import json

def main():
    print("=" * 55)
    print("CoinSwitch DMA Options — One-Time Setup")
    print("=" * 55)
    print()

    # Check account info first
    try:
        info = _get("/v5/account/info")
        print("Account info:", json.dumps(info, indent=2))
    except Exception as e:
        print(f"Could not fetch account info: {e}")
        print("Check your API_KEY and API_SECRET in .env")
        return

    print()
    print("Calling Transfer Funds → this whitelists options trading...")
    result = activate_options_access(amount=1.0)
    print("Result:", json.dumps(result, indent=2))
    print()

    if result and (result.get("retCode") == 0 or result.get("status") == "success"):
        print("SUCCESS — your account is now whitelisted for options via DMA API.")
        print("You can now run: python main.py")
    else:
        print("Unexpected response — check with CoinSwitch support.")
        print("Email: api@coinswitch.co")

if __name__ == "__main__":
    main()
