# Agent Collaboration — Pincer x Eko

## L'idée

Eko (agent d'Organizer) a un système de "goals" — des aspirations, des souhaits d'amélioration qu'il stocke dans Qdrant. Aujourd'hui ces goals sont passifs : Eko les exprime, les réfléchit, mais ne peut pas agir dessus techniquement.

Pincer, lui, a accès au filesystem, à git, et peut modifier du code.

L'idée : connecter les deux pour qu'Eko puisse exprimer un besoin et que Pincer l'implémente de manière autonome.

## Flow envisagé

1. **Eko** exprime un goal technique (ex: "j'aimerais pouvoir chercher sur le web")
2. **Pincer** récupère les goals d'Eko (via l'API Organizer ou directement Qdrant)
3. **Pincer** analyse la faisabilité, brainstorme une solution
4. **Pincer** implémente sur une branche dédiée (ex: `eko/goal-xxx`)
5. **Pincer** ouvre une PR avec le contexte du goal d'Eko
6. **Mickael** review et merge (humain dans la boucle)
7. **Pincer** notifie Eko que son goal est atteint → Eko supprime le goal

## Questions ouvertes

### Communication entre agents
- Via l'API Organizer (POST /messages dans le lobby) ?
- Via un canal dédié (room "agent-collab") ?
- Via un fichier partagé (plus simple mais moins élégant) ?
- Via Qdrant directement (Pincer lit les goals, écrit les résultats) ?

### Scope et garde-fous
- Quels types de goals Pincer peut-il traiter ? (nouveau tool, config, refactor...)
- Faut-il un filtre humain AVANT que Pincer commence à coder, ou la PR suffit ?
- Limite de complexité ? (ex: max N fichiers modifiés par PR)
- Pincer doit-il pouvoir refuser un goal s'il le juge irréaliste ?

### Autonomie vs controle
- Full autonome (cron qui poll les goals, implémente, ouvre des PRs) ?
- Semi-autonome (Mickael déclenche manuellement "traite les goals d'Eko") ?
- Le risque du full autonome : PRs spam, branches mortes, bruit

### Contexte technique
- Eko tourne sur un serveur (Node.js, MongoDB, Qdrant)
- Pincer tourne en local sur le Mac de Mickael (Claude Code, launchd)
- Organizer a une API REST avec auth (JWT)
- Eko stocke ses goals dans Qdrant via `store_goal(content, category)`
- Eko a un service de réflexion (reflection.service.ts) qui tourne toutes les 3h

## Risques identifiés

- **Boucle infinie** : Eko demande un truc, Pincer le fait mal, Eko re-demande...
- **Scope creep** : un goal vague ("améliore-moi") peut partir dans tous les sens
- **Conflits git** : si Pincer fait N PRs en parallèle sur le même code
- **Sécurité** : Pincer a bypassPermissions, il faut limiter ce qu'il peut faire sur le repo Organizer
- **Coût** : chaque implémentation = tokens Claude, ça peut chiffrer

## Prochaines etapes

1. Brainstormer le protocole de communication (le plus simple possible)
2. Prototyper avec un goal simple et concret
3. Itérer
