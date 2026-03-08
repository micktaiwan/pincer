# Autonomous Dev — Pincer comme développeur autonome

## L'idée

Laisser Pincer tourner en autonomie (la nuit, le weekend) pour développer sur un projet. Il prend des tâches dans un backlog, code, ouvre des PRs. Mickael review au réveil.

## Mécanisme d'exécution

### /loop vs cron

- **`/loop`** : session vivante, le contexte s'accumule. Pincer sait ce qu'il a fait à l'itération précédente, peut enchaîner les tâches intelligemment. Mais : coût tokens élevé car le contexte grossit, et si le process meurt on perd l'état.
- **Cron** : cold start à chaque run. Chaque tâche est indépendante. Plus robuste (pas de perte d'état), moins cher (contexte minimal), mais pas de continuité entre les tâches.

Meilleur candidat pour commencer : probablement un **cron** qui traite une tâche par run. Plus simple, plus prévisible, plus facile à debugger.

## Source des tâches

Plusieurs options :
1. **Issues GitHub** taggées (ex: label `autopilot`) — standard, facile à filtrer via `gh`
2. **Tâches Panorama** — déjà intégré via MCP
3. **Fichier dédié** (ex: `autopilot-backlog.md`) — le plus simple pour prototyper
4. **Goals d'Eko** — voir `docs/agent-collaboration.md`

## Flow par tâche

1. Pincer lit le backlog, prend la première tâche non traitée
2. Lit le code existant, comprend le contexte
3. Crée une branche (`autopilot/task-xxx` ou `autopilot/description-courte`)
4. Implémente
5. Lance les tests
6. Si tests OK → commit, push, ouvre une PR, marque la tâche comme faite
7. Si tests KO → s'arrête, notifie Mickael sur Telegram avec le détail de l'erreur
8. Passe à la tâche suivante (ou s'arrête si limite atteinte)

## Questions ouvertes

### Quel projet ?
- **Pincer lui-même** : méta (l'agent s'améliore lui-même). Risque : il peut casser son propre bridge
- **Organizer** : gros codebase, beaucoup de surface, tests existants ?
- **Nouveau projet** : terrain vierge, moins de risque de casser l'existant, mais moins utile
- **Projet open source externe** : intéressant mais problèmes de contexte et permissions

### Garde-fous
- **Limite de PRs par session** : combien max ? 1 ? 3 ? 10 ?
- **Limite de coût** : budget tokens par nuit ?
- **Scope par tâche** : max de fichiers modifiés ? Max de lignes changées ?
- **Arrêt d'urgence** : comment stopper Pincer en pleine nuit ? (kill le process ? commande Telegram ?)
- **Tests obligatoires** : interdire de push si les tests ne passent pas ?
- **Branches protégées** : jamais de push sur main, uniquement des PRs

### Qualité sans review en temps réel
- Les tests deviennent le seul filet de sécurité
- Un projet sans bonne couverture de tests est un mauvais candidat
- Faut-il que Pincer écrive aussi les tests ? (risque : tests qui valident du code faux)
- Linter/formatter obligatoire avant commit

### Feedback et reporting
- Notification Telegram à chaque PR ouverte ?
- Résumé en fin de session ("cette nuit j'ai fait X, Y, Z") ?
- Log détaillé des décisions prises ?
- Que faire si Pincer est bloqué sur une tâche ? Timeout et skip ? Notifier ?

### Direction vs autonomie
- **Tâches précises** (ex: "ajoute un endpoint GET /health") : facile, prévisible
- **Tâches vagues** (ex: "améliore la performance") : risqué, peut partir dans tous les sens
- **Tâches créatives** (ex: "propose une nouvelle feature") : intéressant mais imprévisible
- Pour commencer, rester sur des tâches précises et bien définies

### Coût
- Opus 4.6 : ~$15/M input, ~$75/M output
- Une nuit de dev autonome = potentiellement des centaines de milliers de tokens
- Faut estimer le coût d'une tâche type avant de lancer
- Alternative : utiliser Sonnet pour les tâches simples, Opus pour les tâches complexes ?

### Concurrence avec le bridge Telegram
- Si Pincer tourne en /loop sur un projet, il ne répond plus sur Telegram (même session bloquée ?)
- Solution : deux instances séparées ? Le bridge Telegram reste indépendant, le dev autonome tourne dans sa propre session
- Risque de conflits si les deux modifient les mêmes fichiers

## Prérequis avant de lancer

1. Choisir un projet cible avec de bons tests
2. Définir un backlog clair avec des tâches atomiques
3. Mettre en place les garde-fous (limites, notifications, arrêt d'urgence)
4. Prototyper sur une seule tâche simple en mode surveillé
5. Itérer

## Relation avec la collab Pincer x Eko

Le dev autonome est plus général — Pincer travaille sur n'importe quel backlog. La collab Eko est un cas particulier où le backlog vient des goals d'un autre agent. Les deux idées sont complémentaires et partagent la même infra (branches, PRs, garde-fous).
