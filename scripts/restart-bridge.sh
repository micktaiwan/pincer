#!/usr/bin/env bash
# Restart the bridge gracefully: notify via Telegram, then restart via launchctl.
# Using launchctl stop/start instead of pkill avoids Telegram 409 conflicts
# (the old long poll needs time to expire before a new one can connect).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Notify user before restarting
"$SCRIPT_DIR/telegram.sh" "Restarting... 🔄"

# Stop the bridge — KeepAlive=true in the plist means launchd will
# automatically restart it after ThrottleInterval (5s).
# No need for `launchctl start` (that caused double restarts).
launchctl stop com.pincer.bridge

echo "Bridge restarting (launchd will respawn automatically)."
