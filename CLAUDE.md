# Pincer — Project

Personal assistant based on Claude Code, communicating via Telegram and Slack.

## Language

**All code, comments, docs, and commit messages must be in English.** The only exception is `~/.pincer/personality.md` which is personal config and can be in any language.

## The Three Spaces

This project has three distinct spaces that must be clearly differentiated to avoid logic errors:

### 1. Source repo (`/Users/mickaelfm/projects/perso/pincer/`)

Version-controlled source code in git. This is where we develop.

```
pincer/
  CLAUDE.md                  # This file — instructions for the dev working on the project
  agent/
    CLAUDE.md                # System/framework instructions for the agent (committed)
    meta.md                  # Agent capabilities and commands (committed)
    personality.md.example   # Personality template for new users
    tools.md.example         # Tools & local config template for new users
  bridge/
    index.ts                 # Long polling Telegram + spawn claude CLI
    package.json
  scripts/
    telegram.sh              # Send a Telegram message (curl)
    slack.sh                 # Send a Slack message (curl webhook)
    track-reminder.sh        # Hourly task reminder
  .env                       # Secrets (not committed)
  .env.example               # Template
```

### 2. Agent files (`agent/`)

Subfolder of the repo with a special role:

- **`CLAUDE.md`** — system/framework instructions (memory, architecture, restart, etc.). Committed. Describes **how** the agent works.
- **`meta.md`** — capabilities and commands. Committed. Describes **what** the code does.
- **`personality.md.example`** — template for personality (who the agent is). Committed.
- **`tools.md.example`** — template for tools & local config (what the user has installed). Committed.

The bridge copies system files and seeds personal config at startup (see below).

**Rule for devs**: when `agent/CLAUDE.md` references a file, the path must be relative to the **agent's cwd** (`~/.pincer/`), not the repo. Example: `meta.md` (not `agent/meta.md`, no absolute path).

### 3. Runtime space (`~/.pincer/`)

Agent's working directory. This is the cwd when `claude -p` is spawned. The agent only sees this directory.

```
~/.pincer/
  CLAUDE.md           # Copied from agent/CLAUDE.md at startup
  meta.md             # Copied from agent/meta.md at startup
  personality.md      # Who the agent is (name, tone, personality) — NOT in the repo
  tools.md            # What the user has (integrations, paths, platform) — NOT in the repo
  memory.md           # Agent's persistent memory (created/modified by the agent)
  .session            # Session ID for conversation continuity
  bridge.log          # Bridge logs
  conversations.jsonl # Conversation history
```

**Fundamental rule**: the agent must NEVER write to the source repo. All its data (memory, state, sessions) lives in `~/.pincer/`.

### Bootstrap mechanism

The bridge (`bridge/index.ts`) at startup:
1. Copies `agent/CLAUDE.md` and `agent/meta.md` → `~/.pincer/` (system files, overwritten each time)
2. Seeds `personality.md` and `tools.md` from `.example` templates if they don't exist yet (personal files, never overwritten)

The agent reads `personality.md` and `tools.md` via the Read tool at the start of each session (instructed in `agent/CLAUDE.md`). They are NOT assembled into CLAUDE.md.

On first run, the bridge handles setup:
- `tools.md` source path is auto-filled with the actual repo path at seeding time
- `personality.md` contains placeholders — the bridge injects a one-time setup prompt into the first message, asking the user for name/language/tone. The agent writes the config itself. This prompt is not in `agent/CLAUDE.md` — it lives in the bridge to avoid polluting every session with stale instructions.

**When adding a new file in `agent/`** that the agent needs to see, also add its copy logic in the bridge.

### Design: reference, don't assemble

Personal config files (`personality.md`, `tools.md`) are **referenced** from `agent/CLAUDE.md`, not concatenated into it. This is intentional:

- The user can ask the agent to modify its own personality or tools ("speak English from now on", "add Slack integration") — the agent writes the file directly
- The user can also edit the files manually in `~/.pincer/`
- No assembly step, no build script, no hidden transformation between what the user writes and what the agent sees
- Adding a new config file means adding a reference in `agent/CLAUDE.md` — no bridge changes needed

**Do NOT** build an assembly/concatenation mechanism for these files. Keep them as separate files that the agent reads.

## Architecture

- **bridge/**: Node.js process that listens to Telegram (grammy, long polling) and spawns `claude -p` for each message
- **scripts/**: curl wrappers for sending messages (used by crons/loops)

## Dev notes

- **No `tsc`**: the bridge uses `tsx` for direct TS execution, there is no TypeScript compiler installed. Don't try `npx tsc` — it will fail with "This is not the tsc command you are looking for". To check syntax, run `node --import tsx/esm -e "import('./index.ts')"` from `bridge/`.

## Docs

- `docs/roadmap.md` — project phases and next steps
- `docs/agent-collaboration.md` — brainstorm on Pincer x Eko collaboration (Organizer's agent)
- `docs/autonomous-dev.md` — brainstorm on Pincer as autonomous developer (overnight, /loop, crons)

## Config

Secrets in `.env`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SLACK_WEBHOOK_URL`.
