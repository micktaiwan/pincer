# Pincer

Personal AI assistant powered by [Claude Code](https://docs.anthropic.com/en/docs/claude-code), communicating via Telegram.

Lightweight alternative to full-stack AI assistants like OpenClaw — no server, no Docker, no gateway. Just a Node.js bridge that spawns `claude` CLI for each message.

## How it works

```
Telegram <-> Bridge (grammy long polling) <-> claude CLI <-> Anthropic API
```

The bridge listens for Telegram messages, spawns `claude -p` with your message, and sends the response back. Conversations are persistent via `--resume`. The agent manages its own memory in `agent/memory.md`.

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`claude` in your PATH)
- Node.js >= 20
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))

## Setup

### 1. Clone and install

```bash
git clone https://github.com/micktaiwan/pincer.git
cd pincer/bridge
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:
- `TELEGRAM_BOT_TOKEN` — from BotFather
- `TELEGRAM_CHAT_ID` — your Telegram user ID (send a message to your bot, then check `https://api.telegram.org/bot<TOKEN>/getUpdates`)
- `SLACK_WEBHOOK_URL` — (optional) Slack incoming webhook URL

### 3. Configure agent personality

```bash
cp agent/CLAUDE.md.example agent/CLAUDE.md
```

Edit `agent/CLAUDE.md` to customize your agent's name, language, tone, and behavior.

### 4. Start the bridge

```bash
cd bridge
npm start
```

Send a message to your bot on Telegram — it should respond.

### 5. (Optional) Interactive mode

You can also talk to your agent directly in the terminal:

```bash
cd agent
claude
```

Same CLAUDE.md, same memory.md — consistent behavior across both interfaces.

## Architecture

```
pincer/
  CLAUDE.md              # Project instructions (for development)
  agent/
    CLAUDE.md            # Agent personality and instructions (gitignored)
    CLAUDE.md.example    # Template (committed)
    memory.md            # Agent's persistent memory (gitignored)
  bridge/
    index.ts             # Telegram long polling + claude CLI spawn
    package.json
  scripts/
    telegram.sh          # Send a Telegram message (curl)
    slack.sh             # Send a Slack message (curl webhook)
  docs/
    roadmap.md           # Roadmap and architecture decisions
```

### Key design decisions

- **Claude Code is the brain** — the bridge is just a transport layer
- **`agent/CLAUDE.md` is the personality** — separated from project CLAUDE.md to avoid context pollution
- **`agent/memory.md` is the memory** — managed by the agent itself via Read/Write tools, not by the bridge
- **`--resume` for conversation continuity** — session ID persisted to `.session` file
- **`--permission-mode bypassPermissions`** — agent has full tool access (Bash, Read, Write, etc.)

## Scripts

Send messages directly (useful for crons and automation):

```bash
# Telegram
./scripts/telegram.sh "Hello from Pincer"

# Slack
./scripts/slack.sh "Hello from Pincer"
```

## License

MIT
