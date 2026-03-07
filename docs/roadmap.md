# Pincer — Roadmap

## Contexte

Assistant personnel basé sur Claude Code qui communique via Telegram (bidirectionnel) et Slack (notifications).

Approche légère vs OpenClaw : pas de serveur Docker, pas de gateway. Un bridge Node.js qui spawn `claude` CLI pour chaque message.

## Architecture

```
pincer/
  CLAUDE.md              # Instructions projet (pour le dev)
  agent/
    CLAUDE.md            # Personnalité de l'agent (gitignored, perso)
    CLAUDE.md.example    # Template personnalité (commité)
    memory.md            # Mémoire persistante de l'agent (gitignored)
  bridge/
    index.ts             # Long polling Telegram (grammy) + spawn claude CLI
    package.json         # grammy + tsx
  scripts/
    telegram.sh          # Envoyer un message Telegram (curl)
    slack.sh             # Envoyer un message Slack (curl webhook)
  docs/
    roadmap.md           # Ce fichier
  .env                   # TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SLACK_WEBHOOK_URL
  .env.example           # Template sans secrets
  .gitignore
```

## Séparation des contextes

- `CLAUDE.md` (racine) = instructions projet pour le développeur
- `agent/CLAUDE.md` = personnalité et instructions de l'agent (gitignored)
- `agent/memory.md` = mémoire persistante de l'agent, gérée par l'agent lui-même (gitignored)

## Bridge — fonctionnement

1. Le bridge tourne en permanence (long polling Telegram via grammy)
2. Message Telegram arrive -> spawn `claude -p <message> --resume <sessionId>` dans le répertoire `agent/`
3. Claude lit `agent/CLAUDE.md`, répond via stream-json, le bridge parse et renvoie sur Telegram
4. Claude peut écrire dans `agent/memory.md` pour persister des souvenirs (via `--permission-mode bypassPermissions`)
5. Le `sessionId` est conservé sur disque (`.session`) pour survivre aux redémarrages

Points techniques :
- Le binaire `claude` est résolu au démarrage via `which claude` (le PATH de Node peut différer)
- `--output-format stream-json --verbose` pour parser la sortie structurée
- Reset automatique de session en cas d'erreur (retry avec session neuve)

## Scripts

- `telegram.sh <message>` — curl vers `api.telegram.org/bot$TOKEN/sendMessage`
- `slack.sh <message>` — curl vers le webhook Slack

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

### Phase 1 — Fondations
1. [x] Brainstorm architecture
2. [x] Init git + fichiers de base
3. [x] Setup bot Telegram via BotFather (@PincerAssistantBot)
4. [x] scripts/telegram.sh fonctionnel
5. [x] Bridge bidirectionnel Telegram (grammy + claude CLI)
6. [x] Historique de conversation (--resume sessionId)
7. [x] Séparation CLAUDE.md (projet) / agent/CLAUDE.md (personnalité)
8. [x] Mémoire persistante (agent/memory.md géré par l'agent)
9. [x] Permissions agent (bypassPermissions — Bash, Read, Write)
10. [x] Session persistée sur disque (.session)
11. [x] Repo GitHub privé
12. [x] README.md

### Phase 2 — Intégrations
13. [ ] Lancement auto du bridge (launchd)
14. [ ] Webhook Slack (scripts/slack.sh)
15. [ ] Premier cron utile (résumé emails/calendar le matin)
16. [ ] Backup agent/memory.md

### Phase 3 — Évolutions
17. [ ] Gestion des messages longs (chunking Telegram 4096 chars)
18. [ ] Typing indicator continu pendant que Claude réfléchit
19. [ ] Notifications intelligentes (filtrage, priorité, heures calmes)
20. [ ] Commandes Telegram (/reset, /status, etc.)
