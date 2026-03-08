# Agent Collaboration — Pincer x Eko

## The Idea

Eko (Organizer's agent) has a "goals" system — aspirations and improvement wishes stored in Qdrant. Today these goals are passive: Eko expresses them, reflects on them, but can't act on them technically.

Pincer, on the other hand, has filesystem access, git, and can modify code.

The idea: connect the two so Eko can express a need and Pincer implements it autonomously.

## Proposed Flow

1. **Eko** expresses a technical goal (e.g., "I'd like to be able to search the web")
2. **Pincer** retrieves Eko's goals (via Organizer API or directly from Qdrant)
3. **Pincer** analyzes feasibility, brainstorms a solution
4. **Pincer** implements on a dedicated branch (e.g., `eko/goal-xxx`)
5. **Pincer** opens a PR with the goal's context
6. **Mickael** reviews and merges (human in the loop)
7. **Pincer** notifies Eko that the goal is achieved → Eko removes the goal

## Open Questions

### Inter-agent Communication
- Via Organizer API (POST /messages to the lobby)?
- Via a dedicated channel (room "agent-collab")?
- Via a shared file (simpler but less elegant)?
- Via Qdrant directly (Pincer reads goals, writes results)?

### Scope and Guardrails
- What types of goals can Pincer handle? (new tool, config, refactor...)
- Is a human filter needed BEFORE Pincer starts coding, or is the PR enough?
- Complexity limit? (e.g., max N modified files per PR)
- Should Pincer be able to reject a goal it deems unrealistic?

### Autonomy vs Control
- Fully autonomous (cron that polls goals, implements, opens PRs)?
- Semi-autonomous (Mickael manually triggers "process Eko's goals")?
- Risk of full autonomy: PR spam, dead branches, noise

### Technical Context
- Eko runs on a server (Node.js, MongoDB, Qdrant)
- Pincer runs locally on Mickael's Mac (Claude Code, launchd)
- Organizer has a REST API with auth (JWT)
- Eko stores goals in Qdrant via `store_goal(content, category)`
- Eko has a reflection service (reflection.service.ts) that runs every 3h

## Identified Risks

- **Infinite loop**: Eko requests something, Pincer does it poorly, Eko re-requests...
- **Scope creep**: a vague goal ("improve me") can go in every direction
- **Git conflicts**: if Pincer makes N PRs in parallel on the same code
- **Security**: Pincer has bypassPermissions, need to limit what it can do on the Organizer repo
- **Cost**: each implementation = Claude tokens, can add up

## Next Steps

1. Brainstorm the communication protocol (as simple as possible)
2. Prototype with a simple, concrete goal
3. Iterate
