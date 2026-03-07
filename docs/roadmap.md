# Pincer — Roadmap

## Contexte

Assistant personnel basé sur Claude Code qui communique via Telegram (bidirectionnel) et Slack (notifications).

Approche légère vs OpenClaw : pas de serveur Docker, pas de gateway. Un bridge Node.js qui spawn `claude` CLI pour chaque message.

## Architecture

```
pincer/
  CLAUDE.md              # Instructions projet (pour le dev)
  agent/
    prompt.md            # Personnalité de Pincer (chargé par le bridge via --append-system-prompt)
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
  .gitignore             # .env, node_modules/
```

## Séparation des contextes

- `CLAUDE.md` = instructions projet pour le développeur (cette session Claude Code)
- `agent/prompt.md` = personnalité de Pincer (chargé par le bridge pour les conversations Telegram)
- Auto-memory de Claude Code = mémoire persistante entre sessions

## Bridge — fonctionnement

1. Le bridge tourne en permanence (long polling Telegram via grammy)
2. Message Telegram arrive -> spawn `claude -p <message> --resume <sessionId> --append-system-prompt <agent/prompt.md>`
3. Claude répond via stream-json, le bridge parse et renvoie sur Telegram
4. Le `sessionId` est conservé entre les messages pour garder l'historique de conversation

Points techniques :
- Le binaire `claude` est résolu au démarrage via `which claude` (le PATH de Node peut différer)
- `--output-format stream-json --verbose` pour parser la sortie structurée
- Reset automatique de session en cas d'erreur

## Scripts

- `telegram.sh <message>` — curl vers `api.telegram.org/bot$TOKEN/sendMessage`
- `slack.sh <message>` — curl vers le webhook Slack

## Crons / loops typiques (a venir)

- **Cron quotidien 9h** : résumé emails + calendar -> Telegram
- **Cron** : backup auto-memory vers repo privé GitHub
- **/loop ad hoc** : surveiller des PRs, babysit un deploy, etc.

## Décisions d'architecture

### CLAUDE.md natif vs fichiers OpenClaw (SOUL.md, AGENTS.md, etc.)

On utilise les mécanismes natifs de Claude Code plutôt que de reproduire le système de fichiers OpenClaw.

**Ce qu'on gagne :**
- Zéro boilerplate (pas de boot sequence "lis SOUL.md puis USER.md...")
- Héritage global -> projet (~/.claude/CLAUDE.md + pincer/CLAUDE.md)
- Auto-memory sans friction (natif Claude Code)
- Crons + /loop natifs (pas besoin de heartbeat custom)

**Ce qu'on perd (acceptable) :**
- Journal quotidien structuré (l'auto-memory est thématique, pas chronologique)
- Portabilité multi-LLM (pas un objectif)

### Séparation CLAUDE.md / agent/prompt.md

CLAUDE.md servait initialement aux deux usages (dev + personnalité agent). Séparé car :
- Conflit de contexte : le dev a besoin d'instructions projet, le bridge a besoin de personnalité agent
- `--append-system-prompt` permet de charger la personnalité sans polluer le CLAUDE.md projet

**Point d'attention :** backup de l'auto-memory (~/.claude/projects/*/memory/) qui n'est pas dans le repo projet.

## Étapes

### Phase 1 — Fondations
1. [x] Brainstorm architecture
2. [x] Init git + fichiers de base
3. [x] Setup bot Telegram via BotFather (@PincerAssistantBot)
4. [x] scripts/telegram.sh fonctionnel
5. [x] Bridge bidirectionnel Telegram (grammy + claude CLI)
6. [x] Historique de conversation (--resume sessionId)
7. [x] Séparation CLAUDE.md (projet) / agent/prompt.md (personnalité)
8. [ ] Lancement auto du bridge (launchd)
9. [ ] README.md

### Phase 2 — Intégrations
10. [ ] Webhook Slack (scripts/slack.sh)
11. [ ] Cron quotidien résumé emails/calendar
12. [ ] Backup auto-memory vers repo privé GitHub

### Phase 3 — Évolutions
13. [ ] Gestion des messages longs (chunking Telegram 4096 chars)
14. [ ] Typing indicator continu pendant que Claude réfléchit
15. [ ] Notifications intelligentes (filtrage, priorité, heures calmes)
16. [ ] Commandes Telegram (/reset, /status, etc.)
