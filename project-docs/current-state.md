# iziGSM — État courant (MàJ : 2026-07-12, checkpoint 3)

## Ce qui fonctionne en production (`https://repairdesk.fr`)
- Tout ce qui était opérationnel au 2026-07-11 (migration Cloudflare, auth, slug boutiques, chantier prise en charge, création de ticket) — toujours en place, aucune régression.
- **Pattern Ports & Adapters introduit** : `src/ports/database.ts` (interface `Database`) + `src/adapters/cloudflare/d1Database.ts` (adaptateur D1, seule implémentation active) — préparation portabilité VPS/Postgres. Un service migré (`userService.listUsers()`), les 17 autres restent sur `D1Database` direct, migration incrémentale prévue.
- **`populateTechniciens()` livré et déployé** — le select "Technicien" à la création de ticket affiche les vrais utilisateurs (`GET /api/users`) au lieu de 3 noms en dur, `technicien_id` numérique envoyé et persisté correctement.
- **Isolation multi-tenant renforcée** : `technicien_id` désormais validé contre le `boutique_id` du ticket (`createTicket`/`updateTicket`) — un admin/manager ne peut plus assigner un technicien d'une autre boutique. Validé en live (422 rejeté cross-boutique, 201 réussi same-boutique).
- **`editTicket()` corrigé** — présélectionne à nouveau le technicien assigné (régression du jour introduite puis corrigée avant impact utilisateur réel signalé).

## Bugs connus non corrigés (détail complet dans `bugs.md`)
- **NOUVEAU, priorité haute** : numérotation documents (`numero`) non isolée par boutique — contrainte `UNIQUE` globale sur 5 tables (tickets/factures/devis/avoirs/rachats) vs compteurs `sequences` indépendants par boutique. Desk1 bloquée pour toute création de ticket. SOTELI latente (heurtera le même mur à sa première création). Root cause confirmée par requêtes DB en lecture seule, fix décidé (`UNIQUE(boutique_id, numero)`, migration schéma 5 tables), exécution différée à une session dédiée (risque NF525 sur factures/avoirs).
- Prise de RDV en ligne : table `boutique_creneaux` vide, aucune UI pour la configurer
- `www.repairdesk.fr` → Error 521 (Gandi, indépendant de nous)
- `/factures/:id/emettre` n'envoie aucun email
- 3 tests unitaires sensibles au fuseau horaire (non-bloquant, stable)
- `populateTechniciens()` liste tous les rôles (admin/manager/technicien), pas juste les techniciens
- Pas de test dédié pour `D1DatabaseAdapter`
- `GET /api/users` réservé admin/manager — un technicien ne voit pas la liste se remplir dans "Nouvelle prise en charge" (échec silencieux, comportement volontairement identique à `populateClients()`)

## Chantiers identifiés pour plus tard (voir `todo.md` pour le détail complet)
- Migration `UNIQUE(boutique_id, numero)` sur 5 tables — priorité haute, session dédiée
- Continuer la migration des 17 services restants vers le port `Database`
- Ports `Storage`/`Cache` (R2/D1KV → disque local/Redis) — pas nécessaires avant d'engager la bascule VPS
- Adaptateur Postgres, migration des données, déploiement Node.js sur VPS — hors scope tant que non engagé
- Purge RGPD automatique, multi-sites géré, multi-appareils par ticket, acompte structuré, UI créneaux bookables, rebranding "Mon Atelier"→"MyDesk" — chantiers déjà identifiés avant aujourd'hui, toujours en attente

## Repo et déploiement
- Repo : `izigsm/webapp/` (racine git), remote `zinside69/izigsm_NG_temp_analysis`, branche `main`
- Déploiement : `npm run build && npx wrangler pages deploy dist --project-name izigsm --branch main` — redéployé 2 fois le 2026-07-12 (injection port Database + routes/users.ts ; technicien_id + editTicket), `https://repairdesk.fr/api/health` confirmé 200 après chaque déploiement
- Suite de tests : 712/715 (3 échecs fuseau horaire pré-existants, sans lien), +8 tests ajoutés aujourd'hui (3 `userService.test.ts` migration port + 5 `ticketService.test.ts` validation technicien_id)
- Git : 15 commits aujourd'hui (`3ceaff7` → `f51f220`), tous sur `main` directement (pas de branche dédiée, choix explicite de l'utilisateur), working tree propre
