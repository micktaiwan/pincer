# Pincer — Projet

Assistant personnel basé sur Claude Code, communiquant via Telegram et Slack.

## Les trois espaces

Ce projet a trois espaces distincts qu'il faut bien différencier pour éviter les erreurs de logique :

### 1. Le repo source (`/Users/mickaelfm/projects/perso/pincer/`)

Code source versionné dans git. C'est ici qu'on développe.

```
pincer/
  CLAUDE.md              # Ce fichier — instructions pour le dev qui travaille sur le projet
  agent/
    CLAUDE.md            # Personnalité et instructions de l'agent (source de vérité)
    meta.md              # Capacités et commandes de l'agent (source de vérité)
    CLAUDE.md.example    # Template pour d'autres agents
  bridge/
    index.ts             # Long polling Telegram + spawn claude CLI
    package.json
  scripts/
    telegram.sh          # Envoyer un message Telegram (curl)
    slack.sh             # Envoyer un message Slack (curl webhook)
    track-reminder.sh    # Rappel horaire des tâches en cours
  .env                   # Secrets (non commité)
  .env.example           # Template
```

### 2. Les fichiers agent (`agent/`)

Sous-dossier du repo, mais rôle spécial : ces fichiers sont la **source de vérité** pour le contexte de l'agent. Ils sont copiés dans l'espace runtime au démarrage du bridge (voir ci-dessous). L'agent ne les lit jamais directement depuis le repo.

**Règle pour le dev** : quand `agent/CLAUDE.md` référence un fichier, le chemin doit être relatif au **cwd de l'agent** (`~/.pincer/`), pas au repo. Exemple : `meta.md` (pas `agent/meta.md`, pas de path absolu).

### 3. L'espace runtime (`~/.pincer/`)

Répertoire de travail de l'agent. C'est le cwd quand `claude -p` est spawné. L'agent ne voit que ce répertoire.

```
~/.pincer/
  CLAUDE.md           # Copié depuis agent/CLAUDE.md au démarrage
  meta.md             # Copié depuis agent/meta.md au démarrage
  memory.md           # Mémoire persistante de l'agent (créé/modifié par l'agent)
  .session            # Session ID pour la continuité de conversation
  bridge.log          # Logs du bridge
  conversations.jsonl # Historique des conversations
```

**Règle fondamentale** : l'agent ne doit JAMAIS écrire dans le repo source. Toutes ses données (mémoire, état, sessions) vivent dans `~/.pincer/`.

### Mécanisme de synchronisation

Le bridge (`bridge/index.ts`) copie les fichiers agent au démarrage :
- `agent/CLAUDE.md` → `~/.pincer/CLAUDE.md`
- `agent/meta.md` → `~/.pincer/meta.md`

**Quand on ajoute un nouveau fichier dans `agent/`** qui doit être visible par l'agent, il faut aussi ajouter sa copie dans le bridge.

## Architecture

- **bridge/** : process Node.js qui écoute Telegram (grammy, long polling) et spawn `claude -p` pour chaque message
- **scripts/** : wrappers curl pour envoyer des messages (utilisés par les crons/loops)

## Docs

- `docs/roadmap.md` — phases du projet et prochaines étapes
- `docs/agent-collaboration.md` — brainstorm sur la collaboration Pincer x Eko (agent d'Organizer)
- `docs/autonomous-dev.md` — brainstorm sur Pincer comme développeur autonome (nuit, /loop, crons)

## Config

Secrets dans `.env` : `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SLACK_WEBHOOK_URL`.
