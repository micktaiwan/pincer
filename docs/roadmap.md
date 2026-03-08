# Pincer — Roadmap

## Architecture Decisions

### Native CLAUDE.md vs OpenClaw files (SOUL.md, AGENTS.md, etc.)

We use Claude Code's native mechanisms rather than reproducing OpenClaw's file system.

**What we gain:**
- Zero boilerplate (no boot sequence "read SOUL.md then USER.md...")
- Global → project inheritance (~/.claude/CLAUDE.md + agent/CLAUDE.md)
- Native crons (no custom heartbeat needed). Note: `/loop` is not usable — the agent runs via `claude -p` (one-shot), not interactive sessions

**What we lose (acceptable):**
- Structured daily journal (memory is thematic, not chronological)
- Multi-LLM portability (not a goal)

### Root CLAUDE.md / agent/CLAUDE.md separation

CLAUDE.md originally served both purposes (dev + agent personality). Separated because:
- Context conflict: the dev needs project instructions, the bridge needs agent personality
- The bridge launches claude from `agent/`, it naturally loads `agent/CLAUDE.md`

### Three-layer config (inspired by OpenClaw)

The agent's context is split into three layers:
1. **`personality.md`** (personal, not committed) — who the agent is (name, tone, traits)
2. **`tools.md`** (personal, not committed) — what the user has (integrations, paths, platform)
3. **`agent/CLAUDE.md`** (committed) — how the framework works (memory, architecture, restart)

Personal files are referenced from `agent/CLAUDE.md` and read by the agent at runtime — not concatenated. The bridge seeds `.example` templates on first launch. On first message, the bridge injects a one-time setup prompt so the agent configures itself by asking the user for name/language/tone.

### Memory: memory.md vs Claude Code auto-memory

Claude Code's auto-memory (`~/.claude/projects/*/memory/`) doesn't work in `-p` mode (one-shot). The agent manages its own memory in `~/.pincer/memory.md` via Read/Write.

## Phases

### Phase 1 — Foundations (done)
1. [x] Architecture brainstorm
2. [x] Init git + base files
3. [x] Setup Telegram bot via BotFather
4. [x] scripts/telegram.sh working
5. [x] Bidirectional Telegram bridge
6. [x] Conversation history (--resume)
7. [x] Separate project / agent CLAUDE.md
8. [x] Persistent memory (agent/memory.md)
9. [x] Agent permissions (bypassPermissions)
10. [x] Session persisted to disk
11. [x] GitHub repo + README

### Phase 2 — Robustness & ops (done)
12. [x] Separate runtime (~/.pincer/) from sources (repo)
13. [x] Auto-start bridge (launchd + KeepAlive)
14. [x] Self-restart (scripts/restart-bridge.sh + launchd)
15. [x] Telegram reactions (👀 received, 👍 response sent)
16. [x] Persistent logs (~/.pincer/bridge.log)
17. [x] Structured conversation history (~/.pincer/conversations.jsonl)
18. [x] Resilient retry (same session → fresh session with context recovery)
19. [x] Architecture documentation in agent/CLAUDE.md

### Phase 3 — Integrations
20. [ ] Slack webhook
21. [ ] First useful cron (email/calendar summary)
22. [ ] Backup memory.md

### Phase 4 — Open source readiness
23. [x] Three-layer config: personality (who) + tools (what) + system (how)
24. [x] Translate all docs and code to English
25. [x] First-run setup via conversation (agent asks for name/language/tone)
26. [x] Startup notification on Telegram ("Back online")

### Phase 5 — Evolutions
27. [ ] Long message handling (Telegram 4096 char chunking)
28. [ ] Continuous typing indicator
29. [ ] Smart notifications (filtering, priority, quiet hours)
30. [ ] Persistent agent mode — task loop until completion instead of single Q&A ([details](persistent-agent.md))
