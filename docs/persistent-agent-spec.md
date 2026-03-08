# Persistent agent — continuous work assistant

## The problem

Today Pincer works in request/response mode: one message in, one answer out. If a search fails or context is missing, it stops and waits.

What's missing: an agent that **doesn't give up** until the task is done.

## The vision

An assistant that:

- **Persists on the task**: if a search fails, it tries other approaches, broadens, reformulates, searches other sources
- **Asks questions** when blocked or when it needs clarification — and waits for the answer
- **Keeps working** between user responses (no passive blocking)
- **Only stops when the task is done** or explicitly cancelled

## Use cases

- "Find the architecture doc for investors" → searches Notion, Google Drive, Slack, emails, asks for clarification, doesn't stop at the first empty result
- "Analyze the performance of module X" → reads code, runs benchmarks, asks questions, delivers a report
- "Prepare the review for this PR" → reads all files, checks tests, identifies risks, asks for context if needed

## Relationship with the current architecture

The current bridge (`bridge/index.ts`) handles conversational messages: one message in, one `claude -p` call, one response out, with `--resume` for session continuity. This flow stays as-is for casual chat.

The persistent agent is a **new mode** triggered by `/agent <prompt>`. It spawns a long-running `claude -p` process with access to MCP tools for user communication. Both modes coexist in the same bridge:

- **Regular message** → current flow (simple `claude -p --resume`, single response)
- **`/agent <prompt>`** → persistent agent (long-running `claude -p` with MCP tools, own session, own log)

Persistent agents run in parallel with each other and with the regular conversation.

## Architecture

### MCP server integrated in the bridge

The bridge exposes a local MCP SSE server on `localhost:<PORT>`. Persistent agents connect to it at spawn time. The MCP server is configured in `~/.pincer/.claude/settings.json` so that `claude -p` discovers it automatically.

Communication with the user goes through structured MCP tools — not text conventions.

**Why MCP over text conventions (like `<!-- STATUS:CONTINUE -->`):**

- **Reliability**: `tool_use` is Claude's native mechanism for actions. Text markers depend on the LLM following formatting instructions perfectly — which it doesn't always do.
- **Single process**: the agent keeps its full context for the entire task. No restarts, no re-orientation, no wasted tokens.
- **Agent-driven**: the agent decides when to communicate, ask, or stop. The intelligence stays in the agent, not in bridge orchestration logic.
- **Mid-execution updates**: the agent can send messages at any point during execution, not just between steps.
- **Extensible**: adding capabilities (send files, polls, typing indicators) = adding MCP tools.
- **Multi-agent**: N agents = N SSE connections. Routing is natural via connection ID. With text conventions and multiple agents, the bridge would need N parallel parsers and N state machines — unmanageable.

### Components

```
Bridge (single Node.js process)
├── Telegram bot (grammy, long polling)
├── MCP SSE server (localhost:PORT)
│   ├── set_label(label)        → agent names itself (e.g. "Notion")
│   ├── send_message(text)      → sends a Telegram message
│   └── ask_user(question)      → sends message, blocks until user replies
├── Agent Manager
│   ├── agents: Map<id, AgentState>
│   ├── spawn(task) → agentId
│   ├── kill(agentId)
│   └── listActive()
└── Message Router
    ├── Reply-to-message → route to the agent that asked
    ├── One agent waiting → route to that agent
    ├── /agent <prompt> → spawn new persistent agent
    └── Regular message → current conversational flow
```

### Agent state

Each persistent agent has its own session (not shared with the regular conversation or other agents).

```typescript
interface AgentState {
  id: string;
  label: string;              // short name: "Notion", "Search", "PR-142"
  process: ChildProcess;
  sessionId: string;          // own session, independent from regular chat
  status: "working" | "waiting" | "done" | "error";
  startedAt: number;
  pendingAsk: {
    messageId: number;        // Telegram message_id for reply routing
    resolve: (reply: string) => void;
  } | null;
}
```

### MCP tools

**`set_label(label)`** — the agent names itself with a short word describing its task (e.g. "Notion", "PR-142", "Finances"). Called early in execution. Before `set_label` is called, the agent's messages use a default label (`#1`, `#2`, etc.). The agent chooses the label — it's the LLM that extracts the right word from the task, not the bridge. Instructions in CLAUDE.md tell the agent to call `set_label` at the start of each task.

**`send_message(text)`** — sends a Telegram message prefixed with the agent's label. Non-blocking, returns immediately.

**`ask_user(question)`** — sends the question on Telegram, then blocks. The bridge stores the Telegram `message_id` and a Promise. When the user replies (via Telegram reply-to-message), the bridge resolves the Promise and returns the answer as a tool result. The claude process stays alive but idle (no API cost while waiting). Timeout: 30 minutes — if the user doesn't reply, the tool returns an error and the agent decides whether to continue without the answer or give up.

### Message routing

When a Telegram message arrives:

1. **Has `reply_to_message_id`** → look up which agent sent that message → route to that agent's `pendingAsk`
2. **No reply-to, one agent in `waiting` status** → route to that agent (no ambiguity)
3. **No reply-to, multiple agents waiting** → ask the user to reply to the specific message
4. **`/agent <prompt>`** → spawn a new persistent agent
5. **Regular message, no agent waiting** → current conversational flow (simple `claude -p --resume`)

### Agent labels

The agent names itself via `set_label` at the start of execution. Before that, a default ID is used. Messages are prefixed with the label:

```
[#3] Starting…                              ← default label (set_label not called yet)
[Notion] Searching for architecture docs…   ← agent called set_label("Notion")
[Notion] Found 3 candidates. Which one?
  1) Q3 Architecture Overview
  2) Investor Deck v2
  3) Tech Due Diligence
[PR-142] Analysis complete. 2 issues found, see details below.
```

### User commands

Existing commands (`/status`, `/cost`, `/new`) remain unchanged. New commands:

```
/agent <prompt>  → spawn a persistent agent for this task
/agents          → list active agents with status and label
/kill <label>    → stop a specific agent
/kill all        → stop all agents
```

`/new` also kills all running agents before resetting.

### Safeguards

- **Max concurrent agents**: configurable (e.g. 3)
- **Timeout per agent**: configurable (e.g. 10min of active work)
- **Cost tracking**: per-agent via stream-json `result` events
- If the limit is reached, the bridge replies "X agents already running, wait or /kill one"

### Agent logs

Each agent writes to its own log file (`~/.pincer/agents/<id>.log`). Format: messages sent and received, plus tool calls, as structured JSONL:

```jsonl
{"ts":"...","type":"sent","text":"Searching for architecture docs…"}
{"ts":"...","type":"tool","name":"mcp__notion__search","input":{...}}
{"ts":"...","type":"received","text":"the 2nd one"}
{"ts":"...","type":"sent","text":"Here's the link: ..."}
```

This serves two purposes:

1. **Follow-up**: if the user replies to a message from a finished agent, the bridge spawns a new agent and feeds it the old agent's log as context. The user can resume any past task.
2. **Memory consolidation**: agents never write to `memory.md` directly (see below).

### Memory

Agents **do not write to `memory.md`** during execution. This avoids concurrent write conflicts entirely.

Instead, when all running agents have finished, the Agent Manager consolidates:
1. Reads each agent's log file
2. Spawns a short claude call to summarize what's worth remembering
3. Updates `memory.md` with the consolidated summary

Agents can **read** `memory.md` at the start of their execution for context — that's safe since it's read-only during agent lifetime.

### Communication channels

Persistent agents have two ways to communicate:

- **During execution**: `send_message` and `ask_user` MCP tools — for progress updates and questions
- **At the end**: stdout — the final `claude -p` response, sent as a last message prefixed with the label (same as a regular message)

The MCP tools are for mid-work communication. The stdout response is the conclusion. Like someone texting updates while working, then giving a summary at the end.

### Agent instructions

Persistent agent behavior is defined in a dedicated section of `agent/CLAUDE.md` (the same file used for regular conversations). When spawned via `/agent`, the agent reads the same CLAUDE.md and follows the persistent agent section: call `set_label` early, use `send_message` for progress, use `ask_user` when blocked.

### Crash recovery

If a claude process dies mid-task:
- Intermediate messages were already sent (user has visibility)
- The agent's log file is preserved — context is not lost
- Session ID is saved — `--resume` can recover the conversation
- The agent manager marks the agent as `error` and notifies the user

## Implementation status

Implemented:
- MCP SSE server in the bridge (mcp-server.ts)
- 3 MCP tools: set_label, send_message, ask_user
- Agent manager: spawn, kill, killAll, listActive
- Message router with reply-to and single-waiting auto-route
- Telegram commands: /agent, /agents, /kill
- Per-agent logs (~/.pincer/agents/<id>/agent.log, JSONL)
- Active work timeout (paused while waiting)
- Per-agent cost tracking
- Memory consolidation after all agents finish
- Done/error notification to user
- Follow-up on finished agents (reply to a finished agent's message → spawns new agent with old logs as context)
- Finished agents kept in memory for 1 hour to allow follow-ups

Not yet implemented:
- **Crash recovery via --resume**: session ID is captured but not used to resume crashed agents. The MCP SSE connection would be lost on crash, making a simple `--resume` insufficient — it would need a new MCP connection with the same Claude session. Current mitigation: user is notified, logs preserved, follow-up available via reply.
- **Typing indicator**: persistent agents don't send typing indicators during long work periods.
- **Message chunking**: Telegram's 4096-char limit is not handled — long `send_message` calls may be truncated.
