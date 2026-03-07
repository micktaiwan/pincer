# Pincer — Roadmap

## Décisions d'architecture

### CLAUDE.md natif vs fichiers OpenClaw (SOUL.md, AGENTS.md, etc.)

On utilise les mécanismes natifs de Claude Code plutôt que de reproduire le système de fichiers OpenClaw.

**Ce qu'on gagne :**
- Zéro boilerplate (pas de boot sequence "lis SOUL.md puis USER.md...")
- Héritage global -> projet (~/.claude/CLAUDE.md + agent/CLAUDE.md)
- Crons + /loop natifs (pas besoin de heartbeat custom)

**Ce qu'on perd (acceptable) :**
- Journal quotidien structuré (la mémoire est thématique, pas chronologique)
- Portabilité multi-LLM (pas un objectif)

### Séparation CLAUDE.md racine / agent/CLAUDE.md

CLAUDE.md servait initialement aux deux usages (dev + personnalité agent). Séparé car :
- Conflit de contexte : le dev a besoin d'instructions projet, le bridge a besoin de personnalité agent
- Le bridge lance claude depuis `agent/`, il charge naturellement `agent/CLAUDE.md`

### Mémoire : memory.md vs auto-memory Claude Code

L'auto-memory de Claude Code (`~/.claude/projects/*/memory/`) ne fonctionne pas en mode `-p` (one-shot). L'agent gère sa propre mémoire dans `agent/memory.md` via Read/Write.

## Étapes

### Phase 1 — Fondations (done)
1. [x] Brainstorm architecture
2. [x] Init git + fichiers de base
3. [x] Setup bot Telegram via BotFather
4. [x] scripts/telegram.sh fonctionnel
5. [x] Bridge bidirectionnel Telegram
6. [x] Historique de conversation (--resume)
7. [x] Séparation CLAUDE.md projet / agent
8. [x] Mémoire persistante (agent/memory.md)
9. [x] Permissions agent (bypassPermissions)
10. [x] Session persistée sur disque
11. [x] Repo GitHub + README

### Phase 2 — Intégrations
12. [ ] Lancement auto du bridge (launchd)
13. [ ] Webhook Slack
14. [ ] Premier cron utile (résumé emails/calendar)
15. [ ] Backup agent/memory.md

### Phase 3 — Évolutions
16. [ ] Gestion des messages longs (chunking Telegram 4096 chars)
17. [ ] Typing indicator continu
18. [ ] Notifications intelligentes (filtrage, priorité, heures calmes)
19. [ ] Commandes Telegram (/reset, /status, etc.)
