# iziGSM — État courant (MàJ : 2026-07-12, checkpoint 4)

## Ce qui fonctionne en production (`https://repairdesk.fr`)
- Tout ce qui était opérationnel au 2026-07-11 (migration Cloudflare, auth, slug boutiques, chantier prise en charge, création de ticket) — toujours en place, aucune régression.
- **Pattern Ports & Adapters introduit** : `src/ports/database.ts` (interface `Database`) + `src/adapters/cloudflare/d1Database.ts` (adaptateur D1, seule implémentation active) — préparation portabilité VPS/Postgres. Un service migré (`userService.listUsers()`), les 17 autres restent sur `D1Database` direct, migration incrémentale prévue.
- **`populateTechniciens()` livré et déployé** — le select "Technicien" à la création de ticket affiche les vrais utilisateurs (`GET /api/users`) au lieu de 3 noms en dur, `technicien_id` numérique envoyé et persisté correctement.
- **Isolation multi-tenant renforcée** : `technicien_id` désormais validé contre le `boutique_id` du ticket (`createTicket`/`updateTicket`) — un admin/manager ne peut plus assigner un technicien d'une autre boutique. Validé en live (422 rejeté cross-boutique, 201 réussi same-boutique).
- **`editTicket()` corrigé** — présélectionne à nouveau le technicien assigné (régression du jour introduite puis corrigée avant impact utilisateur réel signalé).
- **Numérotation documents corrigée** (migration `0034_numero_unique_par_boutique.sql`) — `UNIQUE(boutique_id, numero)` au lieu de `UNIQUE(numero)` global sur `tickets`/`devis`/`factures`/`avoirs`/`rachats`. Desk1 peut de nouveau créer des tickets (validé en live : 201, `TKT-2026-00007`).

## Bugs connus non corrigés (détail complet dans `bugs.md`)
- Prise de RDV en ligne : table `boutique_creneaux` vide, aucune UI pour la configurer
- `www.repairdesk.fr` → Error 521 (Gandi, indépendant de nous)
- `/factures/:id/emettre` n'envoie aucun email
- 3 tests unitaires sensibles au fuseau horaire (non-bloquant, stable)
- `populateTechniciens()` liste tous les rôles (admin/manager/technicien), pas juste les techniciens
- Pas de test dédié pour `D1DatabaseAdapter`
- `GET /api/users` réservé admin/manager — un technicien ne voit pas la liste se remplir dans "Nouvelle prise en charge" (échec silencieux, comportement volontairement identique à `populateClients()`)

## Chantiers identifiés pour plus tard (voir `todo.md` pour le détail complet)
- Continuer la migration des 17 services restants vers le port `Database`
- Ports `Storage`/`Cache` (R2/D1KV → disque local/Redis) — pas nécessaires avant d'engager la bascule VPS
- Adaptateur Postgres, migration des données, déploiement Node.js sur VPS — hors scope tant que non engagé
- Purge RGPD automatique, multi-sites géré, multi-appareils par ticket, acompte structuré, UI créneaux bookables, rebranding "Mon Atelier"→"MyDesk" — chantiers déjà identifiés avant aujourd'hui, toujours en attente

## Repo et déploiement
- Repo : `izigsm/webapp/` (racine git), remote `zinside69/izigsm_NG_temp_analysis`, branche `main`
- Déploiement : `npm run build && npx wrangler pages deploy dist --project-name izigsm --branch main` — redéployé 2 fois le 2026-07-12 (injection port Database + routes/users.ts ; technicien_id + editTicket), `https://repairdesk.fr/api/health` confirmé 200 après chaque déploiement
- Migration D1 `0034_numero_unique_par_boutique.sql` appliquée en prod le 2026-07-12 (`wrangler d1 migrations apply izigsm-production --remote`, 52 commandes, testée en local d'abord)
- Suite de tests : 712/715 (3 échecs fuseau horaire pré-existants, sans lien), +8 tests ajoutés aujourd'hui (3 `userService.test.ts` migration port + 5 `ticketService.test.ts` validation technicien_id)
- Git : 18 commits aujourd'hui (`3ceaff7` → `114dd16`), tous sur `main` directement (pas de branche dédiée, choix explicite de l'utilisateur), working tree propre, poussé sur `origin/main`
