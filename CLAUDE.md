# Pincer — Projet

Assistant personnel basé sur Claude Code, communiquant via Telegram et Slack.

## Séparation projet / agent

**Règle fondamentale** : ce repo est le code source du projet. L'agent ne doit JAMAIS écrire de fichiers dans ce repo.

Toutes les données runtime de l'agent (mémoire, état, sessions) vont dans `~/.pincer/` :

```
~/.pincer/
  CLAUDE.md           # Copié depuis agent/CLAUDE.md au démarrage du bridge/cron
  memory.md           # Mémoire persistante de l'agent
  last-reminder.md    # État du dernier rappel envoyé
  .session            # Session ID pour la continuité de conversation
```

Le bridge et les scripts copient `agent/CLAUDE.md` → `~/.pincer/CLAUDE.md` à chaque démarrage.

## Structure

```
pincer/
  CLAUDE.md              # Ce fichier — instructions projet pour le dev
  agent/
    CLAUDE.md            # Personnalité et instructions de l'agent (source de vérité)
    CLAUDE.md.example    # Template pour d'autres agents
  bridge/
    index.ts             # Long polling Telegram + spawn claude CLI
    package.json
  scripts/
    telegram.sh          # Envoyer un message Telegram (curl)
    slack.sh             # Envoyer un message Slack (curl webhook)
    track-reminder.sh    # Rappel horaire des tâches en cours
  .env                   # Secrets (non commité)
  .env.example           # Template
```

## Architecture

- **bridge/** : process Node.js qui écoute Telegram (grammy, long polling) et spawn `claude -p` pour chaque message
- **scripts/** : wrappers curl pour envoyer des messages (utilisés par les crons/loops)
- **agent/CLAUDE.md** : personnalité de Pincer, copié dans `~/.pincer/` au démarrage

## Config

Secrets dans `.env` : `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SLACK_WEBHOOK_URL`.
