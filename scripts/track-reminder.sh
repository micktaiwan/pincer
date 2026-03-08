#!/usr/bin/env bash
# Hourly track.md reminder — spawns Claude to pick 3 tasks and send via Telegram
# Cron: 0 8-20 * * *

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PINCER_DIR="$(dirname "$SCRIPT_DIR")"
AGENT_HOME="$HOME/.pincer"
LAST_FILE="$AGENT_HOME/last-reminder.md"

mkdir -p "$AGENT_HOME"

# Copy system files to runtime dir (personality.md and tools.md are personal
# config read by the agent at runtime — no assembly needed)
cp "$PINCER_DIR/agent/CLAUDE.md" "$AGENT_HOME/CLAUDE.md"
cp "$PINCER_DIR/agent/meta.md" "$AGENT_HOME/meta.md"

# Collect all track.md contents
TRACK_CONTENTS=""
while IFS= read -r -d '' f; do
  TRACK_CONTENTS="$TRACK_CONTENTS
--- $f ---
$(cat "$f")
"
done < <(find "$HOME/projects" -name "track.md" -maxdepth 4 -print0 2>/dev/null)

LAST_CONTENTS=""
if [ -f "$LAST_FILE" ]; then
  LAST_CONTENTS="
--- Last reminder sent ---
$(cat "$LAST_FILE")
"
fi

PROMPT="You are Pincer. Here are the track.md files from the user's projects:

$TRACK_CONTENTS
$LAST_CONTENTS

Pick 3 IN PROGRESS tasks (not completed) that seem most important or actionable.
If a previous reminder is provided, avoid sending the same 3 — vary if possible (unless nothing else has changed).

Send a Telegram message with exactly this format (no preamble, no conclusion):

📌 Task reminder

• [project] — short description
• [project] — short description
• [project] — short description

Use $PINCER_DIR/scripts/telegram.sh to send.
Then write the 3 chosen tasks (one per line, same format) to $AGENT_HOME/last-reminder.md for next time."

cd "$AGENT_HOME"
claude --dangerously-skip-permissions -p "$PROMPT"
