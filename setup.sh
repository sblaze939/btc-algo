#!/bin/bash
echo "Setting up BTC Options Bot..."

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Install Playwright browsers
playwright install chromium

echo ""
echo "Setup complete. Next steps:"
echo "1. Add your keys to .env:"
echo "   GEMINI_API_KEY     → aistudio.google.com (free)"
echo "   COINSWITCH_API_KEY → CoinSwitch PRO → API Trading → DMA"
echo "   COINSWITCH_API_SECRET"
echo ""
echo "2. Run: source .venv/bin/activate"
echo "3. Run: python setup_options.py   ← ONE TIME — whitelists options trading"
echo "4. Run: python main.py            ← starts the 24/7 bot"
