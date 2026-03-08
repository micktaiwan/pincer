# Autonomous Dev — Pincer as Autonomous Developer

## The Idea

Let Pincer run autonomously (overnight, on weekends) to develop on a project. It picks tasks from a backlog, codes, opens PRs. Mickael reviews in the morning.

## Execution Mechanism

### /loop vs cron

- **`/loop`**: live session, context accumulates. Pincer knows what it did in the previous iteration, can chain tasks intelligently. But: high token cost as context grows, and if the process dies the state is lost.
- **Cron**: cold start each run. Each task is independent. More robust (no state loss), cheaper (minimal context), but no continuity between tasks.

Best candidate to start: probably a **cron** that processes one task per run. Simpler, more predictable, easier to debug.

## Task Source

Several options:
1. **GitHub issues** with tags (e.g., label `autopilot`) — standard, easy to filter via `gh`
2. **Panorama tasks** — already integrated via MCP
3. **Dedicated file** (e.g., `autopilot-backlog.md`) — simplest for prototyping
4. **Eko's goals** — see `docs/agent-collaboration.md`

## Flow Per Task

1. Pincer reads the backlog, picks the first unprocessed task
2. Reads existing code, understands context
3. Creates a branch (`autopilot/task-xxx` or `autopilot/short-description`)
4. Implements
5. Runs tests
6. If tests pass → commit, push, open a PR, mark task as done
7. If tests fail → stops, notifies Mickael on Telegram with error details
8. Moves to next task (or stops if limit reached)

## Open Questions

### Which project?
- **Pincer itself**: meta (the agent improves itself). Risk: it can break its own bridge
- **Organizer**: large codebase, lots of surface area, existing tests?
- **New project**: clean slate, less risk of breaking things, but less useful
- **External open source project**: interesting but context and permissions challenges

### Guardrails
- **PR limit per session**: how many max? 1? 3? 10?
- **Cost limit**: token budget per night?
- **Scope per task**: max files modified? Max lines changed?
- **Emergency stop**: how to stop Pincer mid-night? (kill process? Telegram command?)
- **Mandatory tests**: forbid pushing if tests don't pass?
- **Protected branches**: never push to main, only PRs

### Quality Without Real-time Review
- Tests become the only safety net
- A project without good test coverage is a bad candidate
- Should Pincer also write tests? (risk: tests that validate incorrect code)
- Mandatory linter/formatter before commit

### Feedback and Reporting
- Telegram notification for each opened PR?
- End-of-session summary ("tonight I did X, Y, Z")?
- Detailed log of decisions made?
- What if Pincer is stuck on a task? Timeout and skip? Notify?

### Direction vs Autonomy
- **Precise tasks** (e.g., "add a GET /health endpoint"): easy, predictable
- **Vague tasks** (e.g., "improve performance"): risky, can go in every direction
- **Creative tasks** (e.g., "propose a new feature"): interesting but unpredictable
- To start, stick with precise, well-defined tasks

### Cost
- Opus 4.6: ~$15/M input, ~$75/M output
- A night of autonomous dev = potentially hundreds of thousands of tokens
- Need to estimate the cost of a typical task before launching
- Alternative: use Sonnet for simple tasks, Opus for complex ones?

### Concurrency with the Telegram Bridge
- If Pincer runs in /loop on a project, it no longer responds on Telegram (same session blocked?)
- Solution: two separate instances? Telegram bridge stays independent, autonomous dev runs in its own session
- Risk of conflicts if both modify the same files

## Prerequisites Before Launching

1. Choose a target project with good tests
2. Define a clear backlog with atomic tasks
3. Set up guardrails (limits, notifications, emergency stop)
4. Prototype on a single simple task in supervised mode
5. Iterate

## Relationship with Pincer x Eko Collaboration

Autonomous dev is more general — Pincer works on any backlog. The Eko collaboration is a special case where the backlog comes from another agent's goals. Both ideas are complementary and share the same infrastructure (branches, PRs, guardrails).
