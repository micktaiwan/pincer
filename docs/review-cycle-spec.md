# Review Cycle — Self-Improvement Loop

## Concept

Pincer periodically reviews its own backlog (track.md), reprioritizes, picks one task, implements it, and asks the user for permission to deploy. When the backlog is empty, the cycle idles.

The backlog is dynamic: every cycle starts by reading the full context (code, docs, track) and deciding what matters most RIGHT NOW. Priorities are never fixed — the agent re-evaluates each time.

## Runtime Context

- **Source repo**: the pincer git repository (path provided in the review prompt as `Source repo: <path>`)
- **Agent CWD**: `~/.pincer/` (NOT the source repo)
- **track.md**: lives at `<source_repo>/track.md` (locally ignored via `.git/info/exclude`, never committed)
- **All file paths** in this spec (track.md, docs/*, bridge/*) are relative to the source repo unless stated otherwise
- **Timeout**: the review agent has a **10-minute active work timeout** (configurable via `REVIEW_TIMEOUT_MS`). Plan accordingly — be efficient, don't over-explore.

## Trigger

The heartbeat scheduler spawns a review agent when:
1. No other agent is active
2. Enough time has passed since the last cycle (configurable, default: 24h)
3. track.md contains actionable tasks (pre-scan for 💡 or 🔧 markers)

Can also be triggered manually via `/review` Telegram command (bypasses cooldown).

## Cycle

```
READ → HOUSEKEEPING → PRIORITIZE → PLAN → IMPLEMENT → VERIFY → REPORT → DEPLOY
```

### 1. READ

Read these files for context:
- `track.md` — the backlog
- `docs/roadmap.md` — the big picture
- `docs/review-cycle-spec.md` — this spec (the agent's own instructions)
- The source files relevant to the backlog tasks (read on demand, not upfront)

Do NOT read logs or costs. The backlog is the input.

### 2. HOUSEKEEPING

Before prioritizing, check if any task marked `💡` or `🔧` is already implemented in the code. A previous review cycle may have been killed before updating track.md, or a task may have been implemented manually. For each candidate task, skim the relevant source files. If the code is already there, update track.md to `✅ Terminé` and move on. This is not a task — it's cleanup.

### 3. PRIORITIZE

**Priority order (strict):**
1. **Meta tasks first** — anything that improves the review cycle itself (specs, prompts, guard rails, the heartbeat mechanism). The agent must be reliable before it builds features. These tasks are always #1 until the backlog has no more meta tasks.
2. **Bugs and regressions** — things that are broken right now
3. **Features** — new capabilities, only when meta and bugs are clear

Within each tier, consider:
- **Impact**: does this fix a bug, unblock a feature, or improve reliability?
- **Feasibility**: can I implement this alone in one cycle without new dependencies?
- **Risk**: what breaks if I get it wrong?
- **Dependencies**: does task A need to be done before task B?

Output a ranked list (in your reasoning, not sent to user). Pick the #1.

The agent can also ADD new tasks it discovers while reading the code (bugs, inconsistencies, dead code). These go into track.md as `💡 Idée` for future cycles.

Skip tasks that:
- Require new npm packages or API keys
- Need user decisions ("brainstormer", "discuter", open questions)
- Touch .env or security-sensitive config
- Are too vague to implement without clarification

If no task is actionable → exit silently.

### 4. PLAN

Write a short plan (3-5 lines max):
- What file(s) will be modified
- What the change does
- What could go wrong

Send the plan to the user via `send_message` (informational only — no confirmation needed).

### 5. IMPLEMENT

Write the code. Rules:
- One task per cycle. No scope creep.
- Follow existing codebase patterns.
- No new dependencies without explicit permission.
- No .env, launchd, or crontab modifications.
- Smallest diff that solves the task.

### 6. VERIFY

Run syntax check (**do NOT boot the bridge — it hangs forever**):
```bash
cd <source_repo>/bridge && node --import tsx/esm -e "import('./index.ts')" &
PID=$!; sleep 3; kill $PID 2>/dev/null; wait $PID 2>/dev/null
```

This imports the module to check for TypeScript/import errors, then kills the process after 3s (before it starts listening). If the import fails, errors appear immediately.

If errors → fix or revert. Do not proceed with broken code.

### 7. REPORT

Send a summary to the user via `send_message`:
- What was changed (file list + one-line per file)
- Key parts of the diff (highlights, not full diff)

### 8. FINALIZE

Update track.md:
- Mark task as `✅ Terminé` or remove it
- Add any follow-up tasks discovered during implementation

**Do NOT restart the bridge.** Changes will take effect at the next manual restart. Calling `restart-bridge.sh` from the review agent causes restart loops and is strictly forbidden.

## Guard Rails

### NEVER
- Call `restart-bridge.sh` or restart the bridge (causes restart loops)
- Modify `.env`
- Push to git without permission
- Modify launchd/systemd config
- Install npm packages
- Work on multiple tasks in one cycle
- Continue after verification failure
- Modify this spec file without asking first

### Can do autonomously
- Read any file in the repo or runtime dir
- Write/modify source files (bridge, scripts, agent, docs)
- Run syntax checks
- Update track.md (add tasks, update status)
- Send messages to the user

## State

track.md IS the state. No separate database.
- `💡 Idée` = pending
- `🔧 En test` = in progress (agent is working on it or testing it)
- `⏸️ En attente` = blocked (needs user input, noted why)
- `✅ Terminé` = done

`~/.pincer/.last-review` = timestamp written when the review agent is **spawned** (not when it finishes). This means the 24h cooldown starts even if the agent fails immediately. This is intentional — it prevents rapid re-spawning on persistent failures.

## Implementation Notes

The review agent is a regular persistent agent spawned via `agentManager.spawn()` with a specialized prompt. It has the same MCP tools (set_label, send_message, ask_user) and the same timeout mechanism as any other agent.

The review agent is spawned with `silent: true`. This means:
- No `[Review] Done.` message when nothing was done
- Memory consolidation still runs after it finishes
- The agent reports via `send_message` during REPORT step when it has actual work to show

## Convergence

The cycle idles when track.md has no `💡` or `🔧` entries. The pre-scan catches this before spawning an agent.

New tasks appear when:
- The user adds them manually
- The agent discovers issues during a cycle
- External events (new feature ideas, bugs reported via Telegram)
