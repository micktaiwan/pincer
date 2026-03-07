# Pincer — Projet

Assistant personnel basé sur Claude Code, communiquant via Telegram et Slack.

## Structure

```
pincer/
  CLAUDE.md              # Ce fichier — instructions projet pour le dev
  agent/
    prompt.md            # Personnalité de Pincer (chargé par le bridge)
  bridge/
    index.ts             # Long polling Telegram + spawn claude CLI
    package.json
  scripts/
    telegram.sh          # Envoyer un message Telegram (curl)
    slack.sh             # Envoyer un message Slack (curl webhook)
  docs/
    roadmap.md           # Roadmap et décisions d'architecture
  .env                   # Secrets (non commité)
  .env.example           # Template
```

## Architecture

- **bridge/** : process Node.js qui écoute Telegram (grammy, long polling) et spawn `claude -p` pour chaque message
- **scripts/** : wrappers curl pour envoyer des messages (utilisés par les crons/loops)
- **agent/prompt.md** : personnalité de Pincer, passé au bridge via `--append-system-prompt`

## Config

Secrets dans `.env` : `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SLACK_WEBHOOK_URL`.
