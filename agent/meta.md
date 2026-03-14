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
| `/review` | Trigger a self-improvement review cycle — the agent reads its backlog, picks a task, implements it, and asks permission to deploy. |

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

### Scheduled / Recurring Tasks
- The bridge exposes `POST http://127.0.0.1:3100/trigger` with body `{"prompt":"..."}` — this spawns a persistent agent
- To schedule a recurring task:
  1. Write the prompt to a JSON file in `~/.pincer/triggers/` (create dir if needed):
     ```
     echo '{"prompt":"Your prompt here with accents and apostrophes"}' > ~/.pincer/triggers/email-summary.json
     ```
  2. Create a cron via `crontab` that reads from the file (`-d @file`):
     ```
     7 */3 * * * curl -s -X POST http://127.0.0.1:3100/trigger -H 'Content-Type: application/json' -d @/Users/mickaelfm/.pincer/triggers/email-summary.json
     ```
- **NEVER put the prompt inline in the cron command** — shell quoting breaks accents and apostrophes. Always use a file.
- **NEVER use Claude Code's `CronCreate`/`CronDelete` tools** — they are session-only (in-memory, auto-expire after 3 days). Use `crontab` via Bash for persistent crons.
- To modify a scheduled task: update the JSON file (no cron change needed). To stop: remove the cron line.
- To list/modify/delete crons: `crontab -l` and `crontab` via Bash

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
- Telegram messages limited to 4096 characters (auto-split into multiple messages)
- No image/document handling from Telegram (text only)
- Memory limited to memory.md file (no database)
- Single authorized user (TELEGRAM_CHAT_ID in .env)
