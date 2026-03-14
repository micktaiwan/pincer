#!/bin/bash
# remind.sh — Create a one-shot reminder via Pincer trigger + crontab
#
# Usage:
#   remind.sh "30m" "Appeler David"
#   remind.sh "1h" "Check les logs"
#   remind.sh "2h30m" "Réunion"
#   remind.sh "0 9 11 3 *" "Ordi pour Benjamin"

set -euo pipefail

TRIGGERS_DIR="$HOME/.pincer/triggers"

usage() {
  echo "Usage: $0 <time> <message>"
  echo ""
  echo "  time: relative (30m, 1h, 2h30m) or cron expression (\"0 9 11 3 *\")"
  echo "  message: reminder text"
  exit 1
}

[[ $# -lt 2 ]] && usage

TIME_ARG="$1"
MESSAGE="$2"

# Generate slug from message
slug=$(echo "$MESSAGE" | iconv -t ASCII//TRANSLIT 2>/dev/null || echo "$MESSAGE")
slug=$(echo "$slug" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')
slug="${slug:0:40}"
TRIGGER_NAME="reminder-${slug}"
TRIGGER_FILE="${TRIGGERS_DIR}/${TRIGGER_NAME}.json"

# Ensure triggers directory exists
mkdir -p "$TRIGGERS_DIR"

# Check if trigger already exists
if [[ -f "$TRIGGER_FILE" ]]; then
  echo "Error: trigger file already exists: $TRIGGER_FILE"
  echo "A reminder with a similar name is already scheduled."
  exit 1
fi

# Determine if time arg is relative or cron expression
# Relative: matches patterns like 30m, 1h, 2h30m, 45m, etc.
# Cron: contains spaces or starts with digit+space
is_relative() {
  [[ "$1" =~ ^([0-9]+h)?([0-9]+m)?$ ]] && [[ "$1" != "" ]] && [[ "$1" =~ [0-9] ]]
}

if is_relative "$TIME_ARG"; then
  # Parse relative time
  hours=0
  minutes=0
  if [[ "$TIME_ARG" =~ ([0-9]+)h ]]; then
    hours="${BASH_REMATCH[1]}"
  fi
  if [[ "$TIME_ARG" =~ ([0-9]+)m ]]; then
    minutes="${BASH_REMATCH[1]}"
  fi

  total_minutes=$((hours * 60 + minutes))
  if [[ $total_minutes -eq 0 ]]; then
    echo "Error: invalid relative time '$TIME_ARG'"
    exit 1
  fi

  # Compute target time
  target_epoch=$(( $(date +%s) + total_minutes * 60 ))
  target_min=$(date -r "$target_epoch" +%M)
  target_hour=$(date -r "$target_epoch" +%H)
  target_day=$(date -r "$target_epoch" +%d)
  target_month=$(date -r "$target_epoch" +%m)

  # Strip leading zeros for cron
  target_min=$((10#$target_min))
  target_hour=$((10#$target_hour))
  target_day=$((10#$target_day))
  target_month=$((10#$target_month))

  CRON_EXPR="${target_min} ${target_hour} ${target_day} ${target_month} *"
  DISPLAY_TIME=$(date -r "$target_epoch" "+%Y-%m-%d %H:%M")
else
  # Assume cron expression
  CRON_EXPR="$TIME_ARG"
  DISPLAY_TIME="cron: $CRON_EXPR"
fi

# Create trigger JSON (use jq to safely escape the message)
jq -n --arg msg "Rappelle à Mickael : ${MESSAGE}. Envoie juste le rappel, pas besoin de détails." \
  '{prompt: $msg}' > "$TRIGGER_FILE"

# Build the crontab line with a unique marker for safe self-removal
CRON_MARKER="# PINCER_REMINDER:${TRIGGER_NAME}"
CRON_LINE="${CRON_EXPR} curl -s -X POST http://127.0.0.1:3100/trigger -H 'Content-Type: application/json' -d @\"${TRIGGER_FILE}\" && (crontab -l | grep -v 'PINCER_REMINDER:${TRIGGER_NAME}' | crontab -) && rm \"${TRIGGER_FILE}\" ${CRON_MARKER}"

# Add to crontab (append to existing)
(crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -

echo "Reminder scheduled: ${DISPLAY_TIME}"
echo "  Message: ${MESSAGE}"
echo "  Trigger: ${TRIGGER_FILE}"
echo "  Cron: ${CRON_EXPR}"
