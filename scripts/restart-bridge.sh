#!/usr/bin/env bash
# Restart the bridge gracefully: notify via Telegram, then kill the process.
# Launchd will auto-restart it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Notify user before restarting
"$SCRIPT_DIR/telegram.sh" "Je redémarre... 🔄"

# Kill the bridge — launchd will restart it
pkill -f "pincer/bridge/index.ts" || true

echo "Bridge killed — launchd will restart it."
