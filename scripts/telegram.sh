#!/usr/bin/env bash
# Send a message to Telegram
# Usage: ./scripts/telegram.sh "Hello world"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../.env"

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <message>" >&2
  exit 1
fi

curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg chat_id "$TELEGRAM_CHAT_ID" --arg text "$1" \
    '{chat_id: $chat_id, text: $text, parse_mode: "Markdown"}')"
