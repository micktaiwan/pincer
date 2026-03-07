#!/usr/bin/env bash
# Hourly track.md reminder — spawns Claude to pick 3 tasks and send via Telegram
# Cron: 0 8-20 * * *

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PINCER_DIR="$(dirname "$SCRIPT_DIR")"
AGENT_HOME="$HOME/.pincer"
LAST_FILE="$AGENT_HOME/last-reminder.md"

mkdir -p "$AGENT_HOME"

# Copy agent CLAUDE.md to runtime dir
cp "$PINCER_DIR/agent/CLAUDE.md" "$AGENT_HOME/CLAUDE.md"

# Collect all track.md contents
TRACK_CONTENTS=""
for f in $(find /Users/mickaelfm/projects -name "track.md" -maxdepth 4 2>/dev/null); do
  TRACK_CONTENTS="$TRACK_CONTENTS
--- $f ---
$(cat "$f")
"
done

LAST_CONTENTS=""
if [ -f "$LAST_FILE" ]; then
  LAST_CONTENTS="
--- Dernier rappel envoyé ---
$(cat "$LAST_FILE")
"
fi

PROMPT="Tu es Pincer, assistant de Mickael. Voici les fichiers track.md de ses projets :

$TRACK_CONTENTS
$LAST_CONTENTS

Choisis 3 tâches EN COURS (pas terminées) qui semblent les plus importantes ou actionnables.
Si un dernier rappel est fourni, évite de renvoyer les mêmes 3 — varie si possible (sauf si rien d'autre n'a bougé).

Envoie un message Telegram avec exactement ce format (pas de préambule, pas de conclusion) :

📌 Rappel tâches en cours

• [projet] — description courte
• [projet] — description courte
• [projet] — description courte

Utilise $PINCER_DIR/scripts/telegram.sh pour envoyer.
Puis écris les 3 tâches choisies (une par ligne, même format) dans $AGENT_HOME/last-reminder.md pour la prochaine fois."

cd "$AGENT_HOME"
claude --dangerously-skip-permissions -p "$PROMPT"
