# Pincer — Capabilities & Commands

Source of truth on what Pincer can do. Read on demand when a user asks.

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/new` | Saves the current conversation's memory, archives history, then resets the session. Useful when switching topics or when the session is unstable. |
| `/status` | Bridge health check — shows uptime, session state, message count, file sizes. Instant response, no Claude call. Add `deep` for a Claude-powered diagnostic. |
| `/cost` | Spending summary — today, last 7 days, this month, all time. |
| `/agent <prompt>` | Spawn a persistent agent for a long-running task. The agent works autonomously, sends progress updates, and can ask questions. |
| `/agents` | List active persistent agents with status, label, and cost. |
| `/kill <label>` | Stop a specific persistent agent by its label. |
| `/kill all` | Stop all running persistent agents. |

Any other text message is treated as free conversation — Pincer responds via Claude.

## Integrations & Tools

### Telegram
- Primary communication channel
- Long polling (no webhook), always listening
- Reacts with 👀 on message receipt, removed after response
- "Typing" indicator during processing

### Panorama (MCP)
- Project, task, and note management
- Emails (read, search, labels)
- Calendar
- Invoked when the user says "pano" or when context requires it

### Slack
- Send messages via webhook (`scripts/slack.sh`)

### Crons & Scheduled Tasks
- Can create crons (`crontab`) or daemons (`launchd`) on the user's Mac

### Self-modification
- Can modify its own source code (bridge, scripts, agent CLAUDE.md)
- After modifying the bridge: calls `scripts/restart-bridge.sh` to restart

## General Capabilities

- **Conversation**: free-form discussion, direct tone, critical thinking
- **Memory**: `~/.pincer/memory.md` file read and updated on each interaction
- **Search**: access to WebSearch and WebFetch for online lookups
- **Files**: read and write files on the Mac
- **Shell**: execute bash commands
- **Git**: git operations (status, diff, log, commit — with confirmation)
- **Development**: can write, modify, and debug code
- **Emails & calendar**: via Panorama (read, search, summarize)
- **Proactive notifications**: urgent emails, upcoming events, PRs to review
- **Persistent agents**: long-running tasks via `/agent` — works until done, sends progress, asks questions when blocked

## Limitations

- Max 3 concurrent persistent agents (configurable via MAX_AGENTS)
- Per-agent timeout: 10 minutes of active work (configurable via AGENT_TIMEOUT_MS)
- ask_user timeout: 30 minutes
- 120-second timeout per regular Claude request
- Telegram messages limited to 4096 characters (no chunking yet)
- No image/document handling from Telegram (text only)
- Memory limited to memory.md file (no database)
- Single authorized user (TELEGRAM_CHAT_ID in .env)
