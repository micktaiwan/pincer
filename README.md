# Pincer

Personal AI assistant powered by [Claude Code](https://docs.anthropic.com/en/docs/claude-code), communicating via Telegram.

Lightweight alternative to full-stack AI assistants like OpenClaw — no server, no Docker, no gateway. Just a Node.js bridge that spawns `claude` CLI for each message.

## How it works

```
Telegram <-> Bridge (grammy long polling) <-> claude CLI <-> Anthropic API
```

The bridge listens for Telegram messages, spawns `claude -p` with your message, and sends the response back. Conversations are persistent via `--resume`. The agent manages its own memory in `~/.pincer/memory.md`.

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

### 3. Start the bridge

```bash
cd bridge
npm start
```

Send a message to your bot on Telegram. On first launch, the agent will ask for a name, language, and tone — then configure itself automatically.

### 4. (Optional) Manual configuration

Personal config files live in `~/.pincer/` and are created automatically on first launch:

- **`personality.md`** — agent name, language, tone, personality traits
- **`tools.md`** — integrations, local paths, platform-specific config

You can edit these files directly, or ask the agent to change them via Telegram ("speak English from now on", "add Slack integration").

## Architecture

```
pincer/
  CLAUDE.md                  # Project instructions (for development)
  agent/
    CLAUDE.md                # System instructions for the agent (committed)
    meta.md                  # Agent capabilities and commands (committed)
    personality.md.example   # Personality template
    tools.md.example         # Tools & local config template
  bridge/
    index.ts                 # Telegram long polling + claude CLI spawn
    package.json
  scripts/
    telegram.sh              # Send a Telegram message (curl)
    slack.sh                 # Send a Slack message (curl webhook)
    track-reminder.sh        # Hourly task reminder
  docs/
    roadmap.md               # Roadmap and architecture decisions

~/.pincer/                   # Runtime directory (created by the bridge)
  CLAUDE.md                  # Copied from agent/CLAUDE.md at startup
  meta.md                    # Copied from agent/meta.md at startup
  personality.md             # Personal config — who the agent is
  tools.md                   # Personal config — integrations and local setup
  memory.md                  # Agent's persistent memory
  .session                   # Session ID for conversation continuity
```

### Key design decisions

- **Claude Code is the brain** — the bridge is just a transport layer
- **Three-layer config** — system instructions (committed), personality (personal), tools (personal). Inspired by [OpenClaw](https://github.com/nichochar/openclaw)
- **Reference, don't assemble** — personal config files are read by the agent at runtime, not concatenated into CLAUDE.md. This lets the user (or the agent) edit them directly
- **First-run setup via conversation** — no manual config step. The agent asks for name/language/tone on first message, then writes its own personality file
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
