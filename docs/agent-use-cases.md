# Persistent Agents — Use Cases

A persistent agent is a long-running `claude -p` process spawned via `/agent <prompt>` on Telegram. Unlike regular messages (one question, one answer), agents work autonomously until the task is done, send progress updates via Telegram, and can ask questions mid-task.

This doc covers what they're good for, what they're not, and how to use them effectively.

## When to use `/agent` vs a regular message

Use `/agent` when the task is:

- **Multi-step** — search, read, analyze, produce (not a single question)
- **Uncertain** — might need to try different approaches or sources
- **Worth tracking** — you want progress updates, not just a final answer
- **Potentially blocking** — the agent might need to ask you something mid-task
- **Background-friendly** — you can do other things while it works

A regular message is fine for quick questions, simple lookups, or tight back-and-forth collaboration.

## Practical examples

### Research & information gathering

**Cross-source search**
```
/agent Find the investor deck we shared in Q4 2025. Check Notion, emails, and Google Drive.
```
Searches Notion first. If nothing, searches emails. If ambiguous, asks you. Sends candidates as it finds them.

**Web research**
```
/agent Research how Lemlist compares to Apollo.io on G2 reviews from the last 3 months. Summarize pros and cons for each.
```
Uses WebSearch to find reviews, reads pages via WebFetch, synthesizes. Sends intermediate findings ("found 12 reviews for Apollo, reading them now").

**Codebase exploration**
```
/agent Find in ~/projects/lemlist how email warm-up scheduling works. I need to understand the retry logic.
```
Reads files across the codebase, follows imports, checks tests. Note: you need to give the path since the agent's cwd is `~/.pincer/`, not your project directory.

### Code & development

**PR review**
```
/agent Review PR #342 on micktaiwan/lemlist. Focus on security issues and breaking changes.
```
Uses `gh` to fetch the PR, reads changed files, checks test coverage. Sends findings file by file as it progresses.

**Bug investigation**
```
/agent Users report wrong stats after duplicating a campaign. Trace the duplication flow in ~/projects/lemlist/src/campaigns/.
```
Reads code, traces data flow, checks for missing copies or stale references. May ask "which stats specifically?" if it needs to narrow down.

**Self-improvement**
```
/agent The bridge doesn't chunk long Telegram messages. Implement message chunking in bridge/utils.ts for messages over 4096 chars. Source code is in ~/projects/perso/pincer/.
```
Pincer can modify its own source code. The agent implements the change, then calls `scripts/restart-bridge.sh` to deploy. You review the diff afterward (or before restart, if you instruct it to wait).

### Email & communication

**Email triage**
```
/agent Check my emails from the last 24h via Panorama. Flag anything that needs a reply today.
```
Reads emails via Panorama MCP, classifies by urgency, ignores newsletters. Sends a prioritized summary.

**Draft preparation**
```
/agent Draft a reply to the email from [person] about the API migration. Tone: professional but firm on the Q2 deadline.
```
Reads the original thread, drafts a reply. May ask "do you want to mention the fallback plan?" if the original email raised it.

### Project management

**Meeting prep**
```
/agent Prepare notes for my 1:1 with [person] tomorrow. Check Panorama tasks, recent GitHub PRs, and any blockers.
```
Cross-references multiple sources, produces a structured brief.

**Status report**
```
/agent Compile the status of all Panorama tasks for "lemlist v3". Group by assignee, flag overdue items.
```
Reads tasks via Panorama, groups and formats. Tedious manually, trivial for an agent.

### System & ops

**Log analysis**
```
/agent Read the last 500 lines of ~/.pincer/bridge.log. Summarize errors and unusual patterns from the last 24h.
```
Filters noise, groups recurring errors, identifies anomalies.

**Disk/system check**
```
/agent Check disk space, running processes, and memory usage. Flag anything abnormal.
```
Runs system commands, reports a health summary.

### Multi-agent (parallel execution)

Up to 3 agents can run concurrently. Useful when tasks are independent:

```
/agent Search Notion for the Q4 OKR document
/agent Search my emails for messages from investors this month
/agent Check if any open PRs on lemlist are older than 2 weeks
```

Three agents, three different sources, working simultaneously. Each reports independently.

More interesting pattern — same target, different angles:
```
/agent Review PR #342 for security vulnerabilities
/agent Check if PR #342 changes break any existing API contracts
```

### Automated tasks (via cron)

Crons can run `claude -p` directly to perform agent-like tasks on a schedule (see `scripts/track-reminder.sh` for an example). These bypass the bridge and Telegram — the script itself handles output (e.g., calling `telegram.sh` to send results).

```bash
# Example: daily email triage at 8am
# 0 8 * * * cd ~/.pincer && claude --dangerously-skip-permissions -p "Check emails from the last 12h via Panorama. Flag urgent items. Send results via ~/projects/perso/pincer/scripts/telegram.sh."
```

Note: cron-triggered tasks don't use the `/agent` flow (no MCP tools, no `ask_user`, no label). They're fire-and-forget. For interactive agents, use `/agent` from Telegram.

## What `/agent` is NOT good for

**Quick questions** — "What time is it in Tokyo?" Just ask normally.

**Single file operations** — "Read memory.md" is one tool call. No need for an agent.

**Tight back-and-forth** — "Help me write this function, I'll give feedback after each line." Use regular conversation. Agents are for autonomous work with *occasional* check-ins (via `ask_user`), not rapid iteration.

**Tasks exceeding the timeout** — Default is 10 min of active work (waiting time is excluded). For longer tasks, either break them into sub-tasks or adjust `AGENT_TIMEOUT_MS` in `.env`.

**Context from the main chat** — Agents don't share the regular conversation history. If context is needed, include it in the prompt:
```
/agent We decided to use Redis with 5min TTL for caching. Implement it in the campaign stats endpoint at ~/projects/lemlist/src/stats/.
```

## Tips for good prompts

**Be specific about scope.** Bad: "Improve the codebase." Good: "Add input validation to POST /campaigns. Check what the other endpoints do for consistency."

**Give paths.** The agent runs from `~/.pincer/`. If you want it to work on a project, give the absolute path.

**Specify output format.** "Format: bullet list sorted by severity" saves you from getting a wall of text.

**Tell it when to ask.** "If you find multiple versions, ask me which one" — otherwise it'll pick one and move on.

**Use follow-ups.** When an agent finishes, reply to its message to spawn a follow-up with the previous context:
1. `/agent Analyze the search endpoint performance in ~/projects/lemlist/`
2. Agent sends findings
3. Reply to that message: "Implement the caching optimization you suggested"
4. New agent spawns with the analysis as context

Note: follow-up agents receive the previous agent's log as text, not the raw session. Tool results (files read, search results) are summarized, not reproduced in full.

## When things go wrong

**Agent seems stuck** — Check with `/agents` (shows status and elapsed time). If it's been "working" for too long, `/kill <label>`.

**Agent errors out** — You'll get a message like `[Label] Agent stopped with an error.` The agent's log is in `~/.pincer/agents/<id>/agent.log`. Check `bridge.log` for stderr output.

**Agent asks a question you can't answer yet** — You have 30 minutes to reply. If you miss it, the agent gets a timeout error and decides what to do (usually stops or continues without the answer).

**Agent timed out** — You'll get `[Label] Agent timed out.` The default is 10 min of active work. Increase `AGENT_TIMEOUT_MS` in `.env` for longer tasks.

**Multiple agents waiting for a reply** — The bridge tells you. Reply directly to the specific agent's message (Telegram reply-to).

## Costs

Each agent is a `claude -p` call billed at Anthropic API rates. Cost depends on task complexity and how many tools the agent calls. Check actual spending with `/cost` and per-agent cost with `/agents`.

## Current limitations

| Limitation | Details | Workaround |
|---|---|---|
| Max 3 concurrent agents | Configurable via `MAX_AGENTS` in `.env` | `/kill` an agent to free a slot |
| 10 min active timeout | Configurable via `AGENT_TIMEOUT_MS` | Break task into sub-tasks or increase timeout |
| 30 min ask_user timeout | Not configurable (hardcoded) | Reply faster, or the agent handles the timeout |
| No shared context | Agents don't see main chat or other agents | Include context in the prompt |
| Text only | No images/files via Telegram | — |
| No crash recovery | Process death = task stops | Logs preserved, reply to agent's last message to spawn follow-up with context |
| No queue | Excess agents are rejected, not queued | Wait or kill an existing agent |
