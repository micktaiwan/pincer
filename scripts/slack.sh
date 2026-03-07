#!/usr/bin/env bash
# Send a message to Slack via webhook
# Usage: ./scripts/slack.sh "Hello world"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../.env"

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <message>" >&2
  exit 1
fi

curl -s -X POST "$SLACK_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg text "$1" '{text: $text}')"
