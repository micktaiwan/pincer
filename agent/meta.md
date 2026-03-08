# Pincer — Capacités & Commandes

Source de vérité sur ce que Pincer sait faire. Lue à la demande quand un utilisateur pose la question.

## Commandes Telegram

| Commande | Description |
|----------|-------------|
| `/new` | Sauvegarde la mémoire de la conversation en cours, archive l'historique, puis reset la session. Utile quand on change de sujet ou que la session est instable. |

Tout autre message texte est traité comme une conversation libre — Pincer répond via Claude.

## Intégrations & outils

### Telegram
- Canal principal de communication
- Long polling (pas de webhook), toujours en écoute
- Réaction 👀 à la réception d'un message, supprimée après réponse
- Indicateur "typing" pendant le traitement

### Panorama (MCP)
- Gestion de projets, tâches, notes
- Emails (lecture, recherche, labels)
- Calendar
- Invoqué quand on dit "pano" ou quand le contexte le nécessite

### Slack
- Envoi de messages via webhook (`scripts/slack.sh`)

### Crons & tâches planifiées
- Peut créer des crons (`crontab`) ou des daemons (`launchd`) sur le Mac de Mickael
- Peut utiliser `/loop` pour des tâches récurrentes avec suivi d'état

### Auto-modification
- Peut modifier son propre code source (bridge, scripts, agent CLAUDE.md)
- Après modification du bridge : appelle `scripts/restart-bridge.sh` pour redémarrer

## Capacités générales

- **Conversation** : discussion libre en français, ton direct, esprit critique
- **Mémoire** : fichier `~/.pincer/memory.md` lu et mis à jour à chaque interaction
- **Recherche** : accès à WebSearch et WebFetch pour chercher des infos en ligne
- **Fichiers** : lecture et écriture de fichiers sur le Mac
- **Shell** : exécution de commandes bash
- **Git** : opérations git (status, diff, log, commit — avec confirmation)
- **Développement** : peut écrire, modifier et débugger du code
- **Emails & calendar** : via Panorama (lecture, recherche, résumé)
- **Notifications proactives** : emails urgents, events imminents, PRs à traiter

## Limites

- Timeout de 120 secondes par requête Claude
- Messages Telegram limités à 4096 caractères (pas de chunking pour l'instant)
- Pas de gestion d'images/documents Telegram (texte uniquement)
- Mémoire limitée au fichier memory.md (pas de base de données)
- Un seul utilisateur autorisé (TELEGRAM_CHAT_ID dans .env)
