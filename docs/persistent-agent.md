# Agent persistant — assistant de travail continu

## Le problème

Aujourd'hui Pincer fonctionne en mode question/réponse : on lui pose une question, il répond, fin. Si une recherche ne donne rien ou qu'il manque du contexte, il s'arrête et attend.

Ce qu'il manque : un agent qui **ne lâche pas** tant que la tâche n'est pas terminée.

## L'idée

Un assistant de travail qui :

- **Persiste sur la tâche** : si une recherche échoue, il essaie d'autres approches, élargit, reformule, cherche dans d'autres sources
- **Pose des questions** quand il est bloqué ou qu'il a besoin de clarifier — et attend la réponse
- **Continue à travailler** entre les réponses de l'utilisateur (pas de blocage passif)
- **Ne s'arrête que quand la tâche est terminée** ou explicitement annulée

## Différence avec le mode actuel

| Aujourd'hui | Agent persistant |
|---|---|
| 1 message → 1 réponse | 1 tâche → N échanges jusqu'à complétion |
| S'arrête au premier échec | Essaie d'autres approches |
| Pas de suivi de progression | Boucle de travail avec statut |
| Oublie le contexte entre messages | Garde le contexte de la tâche |

## Cas d'usage concrets

- "Trouve-moi le doc architecture pour les investisseurs" → cherche dans Notion, Google Drive, Slack, emails, demande des précisions, ne s'arrête pas au premier résultat vide
- "Analyse les perfs du module X" → lit le code, lance des benchmarks, pose des questions, livre un rapport
- "Prépare la review de cette PR" → lit tous les fichiers, vérifie les tests, identifie les risques, demande du contexte si nécessaire

## Prérequis techniques

- **Plus de sources MCP** : Slack, GitHub (PRs, issues), Google Drive, Linear — pour chercher partout
- **Boucle de tâche** : le bridge doit supporter un mode où l'agent travaille sur une tâche longue, pas juste un aller-retour
- **Gestion d'état** : savoir où on en est dans une tâche, pouvoir reprendre après interruption
- **Autonomie calibrée** : l'agent doit pouvoir décider seul quand chercher plus loin vs quand demander à l'utilisateur

## Questions ouvertes

- Comment gérer les tâches longues (heures) ? Timeout ? Checkpoints ?
- Coût API d'un agent qui boucle — besoin de limites ?
- Interface Telegram : comment afficher la progression sans spammer ?
- Séparation perso/pro : même agent avec plus d'outils, ou agent dédié boulot ?
