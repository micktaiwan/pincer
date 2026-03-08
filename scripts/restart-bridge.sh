#!/usr/bin/env bash
# Restart the bridge gracefully: notify via Telegram, then restart via launchctl.
# Using launchctl stop/start instead of pkill avoids Telegram 409 conflicts
# (the old long poll needs time to expire before a new one can connect).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Notify user before restarting
"$SCRIPT_DIR/telegram.sh" "Restarting... 🔄"

# Stop the bridge, wait for Telegram's long poll to expire, then restart
launchctl stop com.pincer.bridge
sleep 3
launchctl start com.pincer.bridge

echo "Bridge restarted."
