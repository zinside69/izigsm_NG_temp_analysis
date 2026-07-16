# iziGSM — État courant (MàJ : 2026-07-16, checkpoint 25 — feature Accord timeline + override + CACHE_VERSION v2.56)

## Checkpoint 25 — feature "Accord" (timeline suivi.html + override staff), 2026-07-16

Implémente la feature "Accord" spécifiée le 2026-07-10 (double validation boutique→client, réutilise le flow devis existant, pas de nouveau système de token) + une extension demandée dans la foulée : override manuel par le staff en cas de non-réponse client.

**Timeline `suivi.html`** : l'étape "Accord" (gris/orange/vert) dérive désormais de `devis_statut` (devis le plus récent lié au ticket), pas seulement du statut ticket. `getTicketPublicByToken()`/`getTicketById()` exposent ce champ via un `LEFT JOIN devis` corrélé. Bug annexe trouvé et corrigé : `routes/public.ts` filtrait explicitement les champs renvoyés, `devis_statut` était résolu côté service mais jamais exposé au client.

**Override staff** (`POST /api/devis/:id/accord-manuel`, admin/manager/technicien) : permet de forcer l'acceptation d'un devis "envoyé" sans réponse client, pour débloquer la prise en charge. Volontairement plus étroit que `PUT /devis/:id/statut` (réservé admin/manager) — seule la transition `envoye→accepte`, pas un accès général à la gestion des devis. Tracé (`ACCORD_MANUEL_STAFF`). Bouton correspondant dans la fiche détail ticket (`tickets.js`).

**Acompte structuré** : demandé en même temps, décisions de scope actées (encaissement manuel + en ligne, demandé au devis + à la prise en charge) mais **explicitement reporté à une session dédiée** (dépendances Stripe + NF525 à cadrer). Détail complet dans `todo.md`.

Validé en local live de bout en bout (devis→orange→override→vert, isolation rôle technicien confirmée, 409 sur re-override). Tests 803/805 (fixtures SQL mises à jour). `CACHE_VERSION` bumpée `v2.55`→`v2.56`. **Déployé (`271accb`)**, `sw.js` confirme `izigsm-v2.56` en prod.

## Checkpoint 24 — populateTechniciens() filtré + CACHE_VERSION bumpée, 2026-07-16

Suite du checkpoint 23. Bug slug boutiques libre-service revérifié : **déjà corrigé depuis le 2026-07-11** (`92f0db8`), seule la checkbox `todo.md` n'avait jamais été mise à jour — aucune action de code nécessaire, doc corrigée.

`populateTechniciens()` (`tickets.js`) listait tous les rôles (admin/manager/technicien) au lieu des seuls techniciens — filtre `.filter(u => u.role === 'technicien')` ajouté. **Découverte importante en validant** : le Service Worker servait encore l'ancien `tickets.js` malgré le rebuild/redéploiement — `CACHE_VERSION` n'avait pas été bumpée depuis `v2.54` (checkpoint 22 lot B) alors que les lots C (`clients.js`) et G (`settings.html`) de cette session avaient changé du frontend sans bump correspondant. Bumpé à `v2.55`, ce qui invalide rétroactivement le cache pour tous ces changements accumulés, pas seulement celui-ci. **Déployé (`d3a3592`)**, `sw.js` confirme `izigsm-v2.55` en prod. Détail complet dans `bugs.md`.

## Checkpoint 23 — reset password + créneaux RDV bookables + bug settings.html, 2026-07-16

Suite directe du checkpoint 22 (lots A-D déjà déployés). Traite les 2 derniers bugs connus (`bugs.md`) + 1 bug annexe découvert en validant :

**E. Reset password jamais envoyé (commité, pushé, déployé, `2dbb297`, validé en prod avec envoi réel)** : `sendResetPasswordEmail()` (nouveau, `emailService.ts`, modèle `sendOtpInscription()`) remplace l'appel `sendEmail()` mal paramétré dans `routes/auth.ts`. `tsc` : erreur historique disparue. **Testé en prod le 2026-07-16** avec `telnet@bbox.fr` (compte réel) : email de réinitialisation reçu, confirmé par l'utilisateur.

**F. Créneaux RDV bookables — `boutique_creneaux` était vide pour toutes les boutiques (commité, pushé, déployé, `2dbb297`)** : `creneauxService.ts` (nouveau) + `GET`/`PUT /api/boutiques/:id/creneaux` + onglet "Horaires RDV" dans `settings.html`. 12 tests nouveaux. Cycle complet validé en local live : API + `getDisponibilites()` publique génère bien des créneaux réels + round-trip navigateur (compte manager réel, ajout plage, sauvegarde confirmée).

**G. Bug annexe — `settings.html` entier cassé depuis la migration ApiService→apiGet (commité, pushé, déployé, `2dbb297`)** : 10 sites `r.success`/`r.data` au lieu de `r.data.success`/`r.data.data` — les 5 onglets existants ne préaffichaient jamais les vraies valeurs (risque d'écrasement par des champs vides) et le toast de sauvegarde affichait toujours "❌ échec" même en cas de succès, depuis le commit `a62c4fd`. Détecté en validant l'onglet Horaires RDV (qui reproduisait initialement le même bug).

Détail complet des 3 items dans `todo.md` § Checkpoint 23 et `bugs.md`. Tests 803/805 (12 nouveaux, mêmes 2 échecs pré-existants `computeFin()`). Déployé, `repairdesk.fr/api/health` → 200 après déploiement.

## Checkpoint 22 — reprise via conversation en cours (pas `/init recover`), 2026-07-15

Quatre lots de travail dans cette session, sur `izigsm/webapp/` :

**A. Bug + feature prise en charge (déployé, commits `c30984e`/`03e384d`)** : autocomplete Modèle réparé (bug d'extraction `res.data` vs `res.data.data`), champ Marque converti en autocomplete (126 marques réelles, remplace un `<select>` figé à 7 options), grille schéma de déverrouillage 9 points ajoutée (stockée dans la colonne texte existante, pas de migration). Faille XSS trouvée et corrigée dans les deux autocompletes (onclick interpolé → `data-*`/listener délégué).

**B. Fiche client type société (déployé, commit `f3938c5`, migration `0035` en prod)** : toggle particulier/professionnel, champs raison sociale/SIRET/TVA intracom, autocomplete adresse via l'API gouvernementale BAN. Bug corrigé au passage : `listClients()` ne renvoyait jamais adresse/code_postal/siret/tva_intracom (édition perdait ces champs). Sidebar : Clients remonté sous Tableau de bord.

**C. Recherche entreprise par SIRET (pushé et déployé le 2026-07-16)** : `recherche-entreprises.api.gouv.fr`, auto à 14 chiffres, pré-remplit raison sociale/adresse/TVA (calculée depuis le SIREN) sans jamais écraser une saisie manuelle. Commit `97f96b2` rebasé sans conflit sur `origin/main` (`a25c472`), buildé et déployé (`wrangler pages deploy`). **Validé en prod** (Claude in Chrome, SIRET réel DINUM `13002526500013`) : toast de confirmation, raison sociale/adresse/code postal/ville/TVA (`FR07130025265`) tous corrects.

**D. Fix sécurité — isolation photos tickets (commité, pushé, déployé le 2026-07-16, commit `506990f`)** : `GET`/`POST /api/tickets/:id/photos` appelaient `getBoutiqueId(c)` (contexte Hono seul, bug ouvert depuis le checkpoint 21) — remplacé par `getBoutiqueId(user, queryBoutiqueId)`, même pattern que `/photos/:photoId/url`. Test d'isolation dédié en local live : technicien d'une autre boutique → 403 sur un ticket qui n'est pas le sien (avant fix : 200, faille reproduite). Déployé, `repairdesk.fr/api/health` → 200 après déploiement.

Détail complet des 4 lots dans `todo.md` (§ Checkpoint 22). Tests 791/793 sur toute la session (2 échecs pré-existants `computeFin()`, sans rapport).

## Fix photos ticket — jeton signé courte durée — 2026-07-15

Suite au fix vignettes/lightbox (blob+fetch), remplacé par un système de jeton HMAC-SHA256 courte durée (5 min, `src/lib/photoToken.ts`) : `GET /api/tickets/:id/photos/:photoId/url` (authentifié) émet un jeton scopé `{photoId, boutiqueId, exp}`, consommé par `GET /api/photo-view/:token` (public, hors `authMiddleware`, `index.tsx`). Évite le passage par `fetch()`+blob côté client — `img.src` reçoit directement l'URL avec jeton. Validé en prod (cycle complet + rejets 401 sans/avec mauvais jeton). `sw.js` bumpé `v2.51`→`v2.52`.

**Bug de sécurité découvert en cours de route — CORRIGÉ le 2026-07-16** (voir § Checkpoint 22 lot D ci-dessus) : `GET`/`POST /api/tickets/:id/photos` appelaient `getBoutiqueId(c)` avec un seul argument au lieu de `(user, paramBoutiqueId)` — l'isolation multi-tenant sur ces 2 endpoints ne se déclenchait jamais. Détail complet dans `bugs.md`.

## 3 fixes frontend ticket post-déploiement — 2026-07-15

## Fix 3 bugs frontend ticket — 2026-07-15 (signalé par test utilisateur `telnet@bbox.fr`)

Détail complet `bugs.md`. Résumé : (1) impression fiche ticket cassée depuis Sprint 2.13 (`_triggerPrint` jamais chargé sur `tickets.html`, centralisé dans `app.js`) ; (2) changement de statut ticket jamais fonctionnel depuis le workflow granulaire 10-statuts (boutons legacy 4-statuts remplacés par génération dynamique depuis `TRANSITIONS_TICKET`) ; (3) création de ticket silencieusement écrite en localStorage seul (jamais en base) si le premier `GET /api/tickets` de la session avait raté — `saveTicket()` tente désormais toujours l'API réelle en premier. `sw.js` bumpé `v2.48`→`v2.49`. Déployé et vérifié en prod (fichiers statiques confirmés à jour), non testé en navigateur réel.

## Fix auth frontend — 2026-07-15 (signalé par test utilisateur `telnet@bbox.fr`)

3 bugs auth frontend corrigés et déployés (détail complet `bugs.md`) : `uploadPhoto()`/`archiverTicket()` (`tickets.js`) envoyaient un token toujours vide → 401 "Token manquant." systématique sur ajout photo/archivage ; `tryRefreshToken()` (`app.js`) envoyait un corps de requête et lisait une réponse au mauvais format (snake_case au lieu du camelCase réel de l'API) → le refresh JWT n'a jamais fonctionné, déconnexion silencieuse après 1h. `sw.js` `CACHE_VERSION` bumpée à `v2.48` pour forcer l'invalidation du cache App Shell chez les utilisateurs déjà connectés. Validé en prod (login + appels API directs), propagation confirmée sur `repairdesk.fr`.

## Déploiement production — 2026-07-15 (post checkpoint 20)

Les 15 checkpoints en attente depuis le checkpoint 5 (6→20, chantier Ports & Adapters complet) ont été **déployés en production** sur `repairdesk.fr` (`npm run build` → `wrangler pages deploy dist --project-name izigsm`). Suite de tests avant déploiement : 791/793 (2 échecs fuseau horaire connus, sans impact prod). Vérifié après déploiement : `GET https://repairdesk.fr/api/health` → 200, `version: 2.45.0`. Plus de décalage entre `origin/main` et la production.

## Chantier Ports & Adapters — TERMINÉ — 20/20 services migrés (session du 2026-07-15)

Dernier service migré : **statsService.ts** (2026-07-15) — 10/10 fonctions intégralement. `lib/timezone.ts` appliqué systématiquement (`todayParis`/`currentMonthParis` + helpers locaux `addDaysParis`/`addMonthsParis`). Tests étendus 15→33. **3 bugs préexistants corrigés** : `exportCsvCa()`/`getRapportComptable()` cassés depuis toujours (colonne `mode_paiement` inexistante sur `factures`, vit sur `paiements`) ; le test "1er du mois courant" documenté pré-existant non-bloquant depuis le 2026-07-09 est réparé. **Validé en local live** : 10/10 endpoints ✅.

**Chantier Ports & Adapters complet** : les 20 services métier passent par le port `Database` (au moins partiellement — chaque fonction dépendant d'`auditLog()`/`nextNumero()`/`enregistrerTransaction()`/`db.batch()` reste sur `D1Database` brut par choix architectural assumé, voir `docs/superpowers/specs/2026-07-12-architecture-ports-adapters-design.md`). Prochaine étape (hors scope immédiat) : adaptateur Postgres + bascule VPS, si engagée.

## Chantier Ports & Adapters — 19/20 services migrés (session du 2026-07-15)
- **agendaService.ts** (2026-07-15) — 12/12 fonctions migrées intégralement. `lib/timezone.ts` appliqué (`todayParis()` dans `getKpisAgenda`, `getWeekStart`/`getWeekEnd` refaits en arithmétique UTC pure). Câblage `routes/agenda.ts` + `index.tsx` (route iCal publique). Tests (73/75 ✅, 2 échecs confirmés pré-existants, bug `computeFin()` sans impact prod, documenté dans `bugs.md`). **Validé en local live** : CRUD RDV complet, KPIs, vue calendrier, token iCal — 9/9 ✅.

## Chantier Ports & Adapters — 18/20 services migrés (session du 2026-07-15)
- **garantiesService.ts** (2026-07-15) — 9/10 fonctions migrées (`createSav` reste D1, dépend de `nextNumero` ×2). Fuseau horaire vérifié sans correction nécessaire (UTC↔UTC). Tests (65/65 ✅). **Validé en local live** : cycle complet ticket terminé→garantie→SAV→consommation→clôture→expiration, 10/10 ✅.

## Chantier Ports & Adapters — 17/20 services migrés (session du 2026-07-15)
- **emailService.ts** (2026-07-15) — 13/13 fonctions migrées intégralement (`sendOtpInscription` exclue, aucun accès D1). Câblage `tickets.ts`/`sav.ts`/`notifications.ts`/`facturation.ts`. Tests convertis en bloc vers `mockDatabase` (24/24 ✅). **2 bugs préexistants découverts** : `sendEmail()` mal appelée dans `routes/auth.ts` (reset password jamais envoyé, non corrigé — décision de conception requise) ; `processRelancesDevis()` référençait une colonne inexistante `montant_ttc` (corrigé → `total_ttc`). **Validé en local live** : 8/8 endpoints/hooks ✅.

## Chantier Ports & Adapters — 16/20 services migrés (session du 2026-07-15)
- **phoneCatalogService.ts** (2026-07-15) — 5/5 fonctions migrées intégralement, aucune dépendance `auditLog`/`nextNumero`. **0 test existant avant** (seul service sans couverture) → `tests/phoneCatalogService.test.ts` créé (11 tests, `fetch` mocké). **Validé en local live** : sync-brands (126), sync-modeles fairphone (5/5), sync-selected cat (22/22), stats cohérentes.

## Chantier Ports & Adapters — 15/20 services migrés (session du 2026-07-15)
- **reconditionnementService.ts** (2026-07-15) — 12/13 fonctions migrées (tout sauf `createOrdre`, dépendant de `nextNumero()`). Aucun `auditLog()` dans ce fichier. `routes/reconditionnement.ts` : `Variables.db`/`dbPort` ajoutés de zéro (2 routers). Tests scindés (50/50 ✅). **Validé en local live** : cycle ordre complet (création→en_cours→terminer avec produit occasion créé) + cycle bon d'achat (créer→lister→vérifier→annuler), 10/11 ✅ (consommation bloquée par FK factures vide en local, attendu).

## Chantier Ports & Adapters — 14/20 services migrés (session du 2026-07-15)
- **ticketService.ts** (2026-07-15) — 6/11 fonctions migrées (`listTickets`, `getKanban`, `getTicketById`, `getTicketBoutiqueId`, `getTicketAvecClient` + `checkAndArchiveTickets`, cette dernière sans dépendance `auditLog`). Les 5 fonctions restantes (`createTicket`/`updateTicket`/`updateStatutTicket`/`deleteTicket`/`archiveTicket`) restent sur `D1Database`. Bonus sécurité : SQL interpolé (`boutique_id = ${boutiqueId}`) remplacé par un paramètre lié dans `checkAndArchiveTickets`. `lib/timezone.ts` appliqué au calcul `en_retard` de `getKanban()` (`parseUtcTimestamp` sur `date_promesse`). Tests scindés `mockDatabase`/`mockD1` (45/45 ✅, 3 nouveaux). **Validé en local live** : cycle complet création→statuts→hooks garantie/email→archivage, 6/6 ✅.

## Chantier Ports & Adapters — 13/20 services migrés (session du 2026-07-15)
- **servicesService.ts** (2026-07-15) — 8/22 fonctions migrées (toutes lecture pure : `listCategories`, `listServices`, `getService`, `getCatalogueArbre`, `listMarques`, `listModeles`, `getServicesByModele`, `getModeleWithServices`). Les 14 fonctions d'écriture (create/update/delete catégories/services/marques/modeles + link/unlink) restent sur `D1Database` — chacune appelle `auditLog()` directement. `routes/services.ts` : `Variables.db` ajouté. Tests scindés `mockDatabase`/`mockD1` (38/38 ✅, 7 nouveaux tests écrits pour des fonctions jusque-là non couvertes). **Bug préexistant corrigé** (Sprint 2.38, sans lien) : `GET /services/marques`/`GET /services/modeles` inaccessibles depuis toujours (collision de route avec `/services/:id`) — détail `bugs.md`. **Validé en local live** : 12/14 étapes du cycle catégorie→service→catalogue→marque→modèle→liaison ✅ (liaison INSERT bloquée par un artefact CLI wrangler local déjà connu, sans lien avec le code).


## Ce qui fonctionne en production (`https://repairdesk.fr`)
- Tout ce qui était opérationnel au checkpoint 4 (migration Cloudflare, auth, slug boutiques, chantier prise en charge, technicien_id, numérotation par boutique) — toujours en place, aucune régression.
- Checkpoint 5 (7 services Ports & Adapters + `lib/timezone.ts` + 2 bugs NF525) commité et déployé (commit `5bcea99`).
- Checkpoints 6/7/8/9 (`devisService.ts`, `authService.ts`, `stockService.ts`, `clientService.ts`, 11/20 services) commités et pushés (`485dd02`) — **pas encore déployés** au moment de cette mise à jour.
- **⚠ Le travail décrit ci-dessous (checkpoint 10, migration `fournisseursService.ts`) n'est PAS encore commité ni déployé** — développé, testé (unitaire + local live complet), pas encore buildé/déployé sur Cloudflare Pages ni poussé sur `origin/main`.

## Chantier Ports & Adapters — 12/20 services migrés (session du 2026-07-14)
- **fournisseursService.ts** (2026-07-14) — 6/12 fonctions migrées (`listFournisseurs`, `getFournisseur`, `listBonsCommande`, `getBonCommande`, `getKpisFournisseurs`, `getProduitsACommander`). `createFournisseur`/`updateFournisseur`/`deleteFournisseur`/`createBonCommande`/`updateStatutBonCommande`/`receptionnerBonCommande` restent sur `D1Database` (dépendent d'`auditLog`). `routes/fournisseurs.ts` n'avait aucun pattern `dbPort`/`db` avant cette migration — ajouté de zéro (`Variables.db`). Tests scindés `mockDatabase`/`mockD1` (65/65 ✅). Bonus : 5 erreurs TypeScript préexistantes corrigées en passant (casts non-sûrs remplacés par des génériques correctement typés). **Validé en local live** : CRUD fournisseur, CRUD bon de commande, cycle complet réception avec recalcul CUMP (stock 5→8, `prix_achat_cump` mis à jour, statut→`received`), KPIs, vue "à commander" — 12/12 fonctions couvertes, données de test nettoyées.

## Chantier Ports & Adapters — 11/20 services migrés (session du 2026-07-14)
- **clientService.ts** (2026-07-14) — 11/12 fonctions migrées (toutes sauf `purgeClient`, dépendante d'`auditLog`). Câblage `routes/clients.ts` (`dbPort`/`db` mixte), `routes/sav.ts` (nouveau `Variables.db`), `routes/tickets.ts` (`dbPort` ajouté à `POST /`). Tests scindés `mockDatabase`/`mockD1` (48/48 ✅). **2 bugs RGPD critiques découverts et corrigés en live** : `exportClientRgpd()`/`purgeClient()` cassés depuis toujours (table `appareils_client` inexistante + colonne `imei` inexistante sur `tickets`) — droit d'accès (Art. 15) et droit à l'effacement (Art. 17) RGPD n'avaient jamais fonctionné en production malgré 48 tests unitaires verts. Détail complet `bugs.md`. **Validé en local live** : CRUD client, appareils, historique CRM, import CSV, export RGPD, purge RGPD (+ idempotence), hooks email tickets/SAV — 11/12 fonctions couvertes, données de test nettoyées.

## Chantier Ports & Adapters — 10/20 services migrés (session du 2026-07-14)
- **stockService.ts** (2026-07-14) — 6/10 fonctions migrées (`listProduits`, `getProduitById`, `enregistrerMouvement`, `listCategories`, `createCategorie`, `getKpisStock`). `createProduit`/`updateProduit`/`deleteProduit`/`importCatalogueCsv` restent sur `D1Database` (dépendent d'`auditLog`). `routes/stocks.ts` : helper `ctx()` étendu avec `dbPort` en plus de `db`. Tests scindés `mockDatabase`/`mockD1` (56/56 ✅). **Validé en local live** : les 10 fonctions couvertes (create/list catégorie, create/get/list produit, KPIs, mouvement stock, update/delete produit, import CSV), données de test nettoyées.

## Chantier Ports & Adapters — 9/20 services migrés (session du 2026-07-14)
- **authService.ts** (2026-07-14) — 13/13 fonctions migrées **intégralement** (aucune dépendance `auditLog`/`nextNumero`/`batch`), 1er service sensible sécurité du chantier. `routes/auth.ts` câblé sur `c.get('db')` pour les 13 fonctions ; `auditLog`/`sendEmail` (non migrés) restent sur `c.env.DB`. Tests → `mockDatabase`, 25/25 ✅. **Validé en local live** : login, /me, refresh, register→verify-otp (avec/sans boutique), resend-otp, complete-onboarding (+ idempotence testée), reset-password-request→reset-password (mdp admin restauré après test), logout — 12/13 fonctions couvertes en conditions réelles (Google OAuth exclu, nécessite un vrai token externe). Détail complet dans `todo.md`.

## Chantier Ports & Adapters — 8/20 services migrés (session du 2026-07-13)
Pattern établi : `src/ports/database.ts` (interface `Database`) + `src/adapters/cloudflare/d1Database.ts` (adaptateur D1). Ordre de migration complet dans `todo.md`. Fonctions dépendant d'`auditLog()`/`nextNumero()`/`enregistrerTransaction()`/`db.batch()` (encore sur `D1Database` brut) restent non migrées au sein de chaque service — migration partielle assumée, pas un blocage.

Services migrés (dans l'ordre, cumulatif) :
1. `photosService.ts` — partiel (3/5 fns)
2. `publicService.ts` — intégral (8/8)
3. `boutiqueService.ts` — intégral (8/8)
4. `rachatService.ts` — partiel (3/5), 0 test existant → 17 écrits
5. `personnelService.ts` — partiel (8/9)
6. `caisseService.ts` — partiel (7/8), tests 14→31
7. `factureService.ts` — partiel (6/9), tests restructurés (41/41)
8. `devisService.ts` — partiel (6/10 fns : `listDevis`, `getDevis`, `getDevisByToken`, `getStatsDevis`, `expireDevisPerimes`, `saveSignatureDevis`). `createDevis`/`updateDevis`/`updateStatutDevis`/`convertirDevis` restent sur `D1Database` (dépendent de `nextNumero()`/`upsertLignes()`-batch/`auditLog()`). Tests scindés `mockDatabase`/`mockD1` (58/58). Câblage `routes/facturation.ts` + `routes/public.ts`. **Validé en local live** : cycle complet devis (créer→lister→consulter→stats→modifier→envoyer→consultation+réponse publique par token avec signature→expire→conversion facture), 10/10 ✅, données de test nettoyées.

Chaque service : migré, testé unitairement (`mockDatabase` pour les fonctions migrées, `mockD1` pour les restantes), vérifié sans nouvelle erreur `tsc`, **et validé en local live réelle** (`wrangler d1 migrations apply --local` + `npm run dev` + requêtes HTTP réelles, données de test nettoyées après coup) — exigence explicite de l'utilisateur.

## Fuseau horaire France — `src/lib/timezone.ts` (créé aujourd'hui)
`parseUtcTimestamp()` + `todayParis()` + `currentMonthParis()` (DST auto via Intl/ICU). Appliqué à `personnelService.ts` (bug réel corrigé : heures travaillées gonflées de l'écart local/UTC) et `caisseService.ts` (`DATE('now')`/`strftime` → jour/mois français, critique pour clôture NF525). Vérifié sur `factureService.ts` : rien à corriger (horodatages déjà UTC-Z explicites). Principe à appliquer lors de la migration de `ticketService.ts`, `garantiesService.ts`, `agendaService.ts`, `statsService.ts` (détail exact dans `todo.md`).

## 2 bugs de production découverts et corrigés aujourd'hui (sans lien avec la migration, confirmés pré-existants via `git show HEAD`)
- **`GET /api/rachats/export` → 404 depuis toujours** — collision de route avec `/rachats/:id` (déclarée avant). Fixé en réordonnant, même pattern que `/kanban` dans `tickets.ts`.
- **🔴 Vente POS d'un produit en stock cassée à 100% + facture orpheline NF525** — `mouvements_stock` INSERT référençait des colonnes inexistantes (`raison`/`reference_id` au lieu de `motif`, `stock_avant`/`stock_apres` NOT NULL jamais fournies). Conséquence grave : facture déjà `payee` créée avant le crash, sans entrée `journal_nf525` correspondante (violation de conformité). Corrigé, testé, revalidé en live (flux complet vente→KPIs→journal→clôture→intégrité chaîne).

## Bugs connus non corrigés (détail complet dans `bugs.md`)
- Prise de RDV en ligne : table `boutique_creneaux` vide, aucune UI pour la configurer
- `www.repairdesk.fr` → Error 521 (Gandi, indépendant de nous)
- `/factures/:id/emettre` n'envoie aucun email
- 3 tests unitaires sensibles au fuseau horaire (non-bloquant, stable, `agendaService`/`statsService`)
- `populateTechniciens()` liste tous les rôles (admin/manager/technicien), pas juste les techniciens
- Pas de test dédié pour `D1DatabaseAdapter`

## Chantiers identifiés pour plus tard (voir `todo.md` pour le détail complet)
- Continuer la migration des 12 services restants vers le port `Database` (prochain : `authService.ts`)
- Appliquer `lib/timezone.ts` à `ticketService.ts`/`garantiesService.ts`/`agendaService.ts`/`statsService.ts` lors de leur migration
- Ports `Storage`/`Cache`, adaptateur Postgres, bascule VPS — hors scope tant que non engagé
- Purge RGPD automatique, multi-sites géré, multi-appareils par ticket, acompte structuré, UI créneaux bookables, rebranding "Mon Atelier"→"MyDesk" — toujours en attente

## Repo et déploiement
- Repo : `izigsm/webapp/` (racine git), remote `zinside69/izigsm_NG_temp_analysis`, branche `main`
- **Rien déployé depuis le checkpoint 5** (`5bcea99`) — le travail du checkpoint 6 (`devisService.ts`) est local, testé, non buildé/non poussé au moment de cette mise à jour
- Suite de tests : 746/749 (mêmes 3 échecs fuseau horaire pré-existants, sans lien avec `devisService.ts`)
- Git : working tree avec modifications non commitées au moment de cette mise à jour (`src/services/devisService.ts`, `src/routes/facturation.ts`, `src/routes/public.ts`, `tests/devisService.test.ts`, `project-docs/todo.md`, `project-docs/current-state.md`) — commit à proposer à l'utilisateur
