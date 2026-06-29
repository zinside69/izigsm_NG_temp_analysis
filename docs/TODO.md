# iziGSM — TODO & Suivi des Sprints

> Mis à jour automatiquement à chaque avancement de sprint.
> Dernière mise à jour : Sprint 2.17 terminé — 15 juin 2026

---

## Sprints terminés

### Sprint 2.1 ✅ — Facturation NF525 + Avoirs
- [x] Migration 0010 : `locked`, `issued_at`, `tracking_token` sur factures + table `avoirs` + `lignes_avoir`
- [x] `nextNumero()` étendu : `avoir → AV`, `rachat → LP`
- [x] `POST /api/factures/:id/emettre` : locked=1, hash NF525, UUID tracking
- [x] `GET/POST /api/avoirs`, `GET /api/avoirs/:id`
- [x] Frontend `factures.js` : badges 🔒, bouton Émettre, modal Avoir
- [x] Migration appliquée + build + tests + commit `2abcde7`

### Sprint 2.2 ✅ — Livre de police (Rachats)
- [x] Migration 0011 : table `rachats` (30 colonnes) + 6 index
- [x] `routes/rachats.ts` : GET list, GET :id, POST (validations art. 321-7 + doublon IMEI), PATCH /statut, GET /export CSV
- [x] `public/rachats.html` + `public/static/js/rachats.js` (650 lignes)
- [x] `app.js` : `apiPatch` + sidebar "Livre de police"
- [x] Migration appliquée + build + tests + commit

### Sprint 2.3 ✅ — PIN PBKDF2 + Sessions KV + Permissions granulaires
- [x] Migration 0012 : `pin_hash`, `pin_actif` sur users + table `permissions`
- [x] `routes/users.ts` : PIN set/verify/delete/status/reset + permissions GET/PUT
- [x] `middleware.ts` : `requirePin` + `hasPermission()`
- [x] `index.tsx` : `usersRoutes` monté, ordre routes corrigé
- [x] `app.js` : `requirePinAction()` + `confirmPin()` modal global
- [x] Migration appliquée + build + tests curl + commit `fde9a13`

### Fix Design Patterns ✅ — Audit conformité Principes Core
- [x] `users.ts` : suppression query SQL morte dans `GET /users`
- [x] `rachats.js` + `factures.js` : `getBoutiqueId()` direct (sans ternaire défensif)
- [x] `index.tsx` : health check remonté avant routes dynamiques
- [x] `index.tsx` : version `2.3.0` + sprint à jour
- [x] `app.js` : doublon `apiPut` supprimé
- [x] `app.js` : `apiPostPublic()` + `apiBlobGet()` + flag `skipAuth`
- [x] `register.js` : `fetch()` → `apiPostPublic()` (Principe 5)
- [x] `rachats.js` : `fetch()` export → `apiBlobGet()` (Principe 5)
- [x] Principes architecturaux enregistrés dans `.architecture/PRINCIPES.md`
- [x] Commit `785a0ed`

### Sprint 2.4 ✅ — Catalogue services hiérarchique
- [x] Migration 0013 : `categories_services` (arbre parent/enfant) + `services` (10 index)
- [x] `src/services/servicesService.ts` : **premier Model layer** — toute logique SQL
- [x] `src/lib/validators.ts` : validation centralisée (`validateService`, `validateCategorie`, `validateTicket`, `validateClient`)
- [x] `src/routes/services.ts` : Controller pur — 0 SQL inline, délègue tout
- [x] Endpoints : GET/POST/PUT/DELETE `/api/services` + `/api/services/categories` + GET `/api/services/catalogue` (arbre)
- [x] `public/services.html` : layout split sidebar/grille, modals catégorie + service, color picker
- [x] `public/static/js/services.js` : rendu arbre, filtres, ApiService (Principe 5)
- [x] Sidebar : entrée "Catalogue services"
- [x] Migration appliquée + build (104KB, 44 modules) + tests + commit `eaee586`

---

## Sprints à venir

> ⚠️ **Plan révisé le 4 juin 2026** suite à l'analyse comparative CDC Manus vs monatelier.net.  
> L'ordre a été ajusté selon : Priorités CDC (CRITIQUE > HAUTE > MOYENNE) + dépendances techniques + différenciateurs concurrentiels.  
> Voir `docs/ANALYSE_COMPARATIVE_CDC.md` pour le détail.

---

### Sprint 2.5 ✅ — Fournisseurs + Bons de commande + CUMP
**Modules CDC : MOD-10 (HAUTE) + MOD-04 CUMP (CRITIQUE)**
- [x] Migration 0014 : tables `fournisseurs` + `bons_commande` + `lignes_bon_commande` + CUMP sur `produits`
- [x] `src/services/fournisseursService.ts` (Model) — CRUD fournisseurs, CRUD BC, réception+CUMP, KPIs, À commander
- [x] `src/lib/validators.ts` : `validateFournisseur()`, `validateBonCommande()` (avec validation par ligne)
- [x] `src/routes/fournisseurs.ts` (Controller pur — 12 endpoints, 0 SQL)
- [x] CUMP : `(stock×cump + qty×prix) / (stock+qty)` — calculé à la réception, mouvement `reception_commande`
- [x] Vue "À commander" : produits dont `stock_actuel ≤ stock_minimum`
- [x] Numérotation BC : `BC-AAAA-XXXXX` via MAX séquentiel D1
- [x] `public/fournisseurs.html` : 3 onglets (BC / Fournisseurs / À commander), KPIs, 3 modales
- [x] `public/static/js/fournisseurs.js` : 650+ lignes, ApiService, pré-remplissage BC depuis À commander
- [x] Sidebar : entrée Fournisseurs + badge nb produits à commander
- [x] Build ✅ (118.87 kB, 46 modules) + tests 10/10 ✅

### Sprint 2.6 ✅ — Agenda / RDV + iCal
**Modules CDC : MOD-08 (MOYENNE)**
- [x] Migration 0015 : tables `rendez_vous` + `boutique_ical_tokens`
- [x] `src/services/agendaService.ts` (Model) — CRUD, vue calendrier, KPIs, iCal
- [x] `src/routes/agenda.ts` (Controller pur — 9 endpoints + iCal)
- [x] Statuts : PENDING/SCHEDULED/DONE/NO_SHOW/CANCELLED/CONVERTED + machine à états
- [x] Types : réparation/restitution/devis/diagnostic/autre
- [x] Vue calendrier groupée par date (`GET /api/agenda/view`)
- [x] Export iCal RFC 5545 `GET /api/calendar/:token.ics` — public, sans auth
- [x] Token iCal stable par boutique (`boutique_ical_tokens`)
- [x] Fin auto-calculée depuis début + durée si non fournie
- [x] `public/agenda.html` : vues semaine (grille horaire) + liste + 3 modales
- [x] `public/static/js/agenda.js` : navigation semaine, KPIs, détail+actions
- [x] Sidebar : entrée Agenda
- [x] Fix route iCal : montée dans `index.tsx` avant routers avec `use('*', authMiddleware)`
- [x] Build ✅ (133.00 kB, 48 modules) + tests 11/11 ✅

### Sprint 2.7 🔜 — Vitrine publique + Tracking token *(inchangé)*
**Modules CDC : MOD-14 (MOYENNE) + MOD-01 tracking**
- [ ] Page publique `/suivi/:token` (sans auth) — `public/suivi.html`
- [ ] `src/routes/public.ts` : `GET /api/public/ticket/:token`
- [ ] QR code sur fiche ticket (tracking_token)
- [ ] Page vitrine `/pro/:slug` (placeholder)
- [ ] `GET /api/public/catalogue/:slug` : catalogue services public

### Sprint 2.8 🔜 — Statuts tickets complets + Kanban 🔄 **(RÉVISÉ — était Caisse POS)**
**Module CDC : MOD-01 (CRITIQUE) — Différenciateur monatelier.net**
- [ ] 3 statuts manquants : `TO_ORDER`, `ORDERED`, `PARTS_RECEIVED`
- [ ] Migration 0016 : `ALTER TABLE tickets` + contrainte statuts
- [ ] Liaison `TO_ORDER` → vue "À commander" (Sprint 2.5)
- [ ] `GET /api/tickets/kanban` : données groupées par statut
- [ ] `public/tickets.html` : vue Kanban (8 colonnes, drag & drop JS)
- [ ] Indicateurs ancienneté : vert (<2j), orange (3–7j), rouge (>7j), alerte (>14j)
- [ ] Noms de statuts configurables (table `config_tenant`)

### Sprint 2.9 🔜 — Numérotation configurable + Settings tenant 🔄 **(RÉVISÉ — était Flux métier)**
**Modules CDC : MOD-02 numérotation + MOD-18 settings — Différenciateur monatelier.net**
- [ ] Migration 0017 : table `config_tenant` (préfixe, séparateur, format_date, nb_chiffres)
- [ ] `src/services/configService.ts` (Model)
- [ ] `src/routes/config.ts` (Controller pur)
- [ ] `nextNumero()` dynamique : utilise `config_tenant` + aperçu temps réel
- [ ] Types d'appareils configurables (JSONB dans config)
- [ ] `public/settings.html` : onboarding numérotation + types appareils
- [ ] Photos R2 sur tickets (upload + stockage)
- [ ] `src/services/photosService.ts` (Model)

### Sprint 2.10 🔜 — SAV & Garanties 🔄 **(RÉVISÉ — était Export PDF)**
**Module CDC : MOD-09 (MOYENNE) — Très visible chez monatelier.net**
- [ ] Migration 0018 : tables `garanties` + `tickets_sav` + `retours_client` + `rma_fournisseurs`
- [ ] `src/services/savService.ts` (Model)
- [ ] `src/routes/sav.ts` (Controller pur)
- [ ] Garanties depuis factures (`garantie_jours` sprint 2.4 est sur services, à lier)
- [ ] Alertes garanties expirant < 30j / < 7j
- [ ] Tickets SAV = workflow identique MOD-01
- [ ] Retours client : échange / avoir / refus
- [ ] RMA fournisseurs : suivi colis
- [ ] `public/sav.html` + `public/static/js/sav.js`

### Sprint 2.11 🔜 — Notifications email + Automatisations 🔄 **(RÉVISÉ — était PWA)**
**Module CDC : MOD-12 (HAUTE) — Différenciateur monatelier.net**
- [ ] Intégration Resend API (`wrangler secret put RESEND_API_KEY`)
- [ ] `src/services/notifService.ts` (Model)
- [ ] Templates email : réception, pièces attendues, prêt à restituer, suivi lien
- [ ] Automatisations : changement statut ticket → email client
- [ ] Automatisation : facture émise → email client
- [ ] Automatisation : anniversaire client (via cron externe ou ticket hebdo)
- [ ] `public/communications.html` + gestion templates

### Sprint 2.12 🔜 — Caisse POS + Journal NF525 🔄 **(DÉPLACÉ depuis 2.8)**
**Module CDC : MOD-13 (MOYENNE)**
- [ ] Migration 0019 : table `sessions_caisse` + `journal_caisse`
- [ ] `src/services/caisseService.ts` (Model)
- [ ] `src/routes/caisse.ts` (Controller pur)
- [ ] Journal NF525 : chaîne SHA-256 continue (même pattern que factures)
- [ ] `requirePin` sur accès caisse (`acces_caisse`)
- [ ] Multi-modes paiement (CB, espèces, chèque, virement)
- [ ] `public/caisse.html` : interface POS tactile
- [ ] QZ Tray (impression thermique) : optionnel, post-MVP

### Sprint 2.13 ✅ — Export PDF + Dashboard graphiques réels
**Module CDC : MOD-17 (HAUTE)**
- [x] Export PDF factures/tickets (HTML → `window.print()`) — `printFacture()` + `printTicket()`
- [x] `src/routes/stats.ts` : `/api/stats` extrait hors `index.tsx` ✅ — violation P1 résolue
- [x] `src/services/statsService.ts` (Model) — 6 exports, injection DB
- [x] Dashboard : Chart.js — CA mensuel réel, tickets par statut, top produits
- [x] Rapport activité par technicien (`/api/stats/techniciens`)
- [x] 12 KPIs temps réel (`GET /api/stats`) — nb_clients, ca_mois, evolution_ca_pct
- [x] Build ✅ + tests 6/6 ✅

### Sprint 2.14 ✅ — PWA manifest + Service Worker
- [x] `public/manifest.json` — app iziGSM, icônes 192×192 + 512×512
- [x] `public/sw.js` : cache offline assets statiques (cache-first strategy)
- [x] `<link rel="manifest">` injecté dans tous les HTML
- [x] Install prompt (banner Android/iOS)
- [x] Icônes PWA SVG générées
- [x] Build ✅ + commit

### Sprint correctif Design Pattern ✅ — Conformité P1/P2/P4
**Audit post-Sprint 2.14 — violations identifiées et corrigées**
- [x] P1 — Exception reporting documentée dans `statsService.ts` (bloc `⚠️ EXCEPTION ARCHITECTURE`)
- [x] P4 — JSDoc `@param`/`@returns` sur les 6 exports de `statsService.ts`
- [x] P4 — JSDoc sur `ctx()` + 6 handlers de `routes/stats.ts`
- [x] P2 — `_money()`, `_fmtDate()`, `_fmtDateTime()` centralisés dans `app.js`
- [x] P2 — Suppression `_money()` local dans `factures.js` + `dashboard.js`
- [x] P2 — Suppression `_fmtDateTk()` local dans `tickets.js` → `_fmtDateTime()` de `app.js`
- [x] P4 — `printFacture()` 180L → 3 fonctions : `_fetchFacturePrintData` + `_buildFactureHTML` + `_triggerPrint`
- [x] P4 — `printTicket()` 155L → 3 fonctions : `_fetchTicketPrintData` + `_buildTicketHTML`
- [x] P4 — JSDoc sur 14 fonctions de `dashboard.js`
- [x] Build ✅ (197.52 kB) + tests T1–T6 ✅ 6/6 + commit `f915398`

### Sprint 2.15 ✅ — CRM étendu
**Module CDC : MOD-07 (HAUTE)**
- [x] `src/services/clientService.ts` (Model) — 9 fonctions : listClients, getClient, updateClient, deleteClient, addAppareil, getHistoriqueClient, importClients, getKpis, createClient
- [x] Fix violation P1 : `JOIN tickets` cross-module → sous-requête `COUNT(*)` dans clientService
- [x] `src/routes/clients.ts` : Controller pur 0 SQL — 8 endpoints, ctx() refactorisé
- [x] `GET /api/clients/:id/historique` : historique consolidé (tickets + factures + rdv + KPIs)
- [x] `POST /api/clients/import-csv` : parsing côté client, mapping 9 colonnes, dédup email silencieux
- [x] Fix montage Hono : `app.route('/api/clients')` (était `/api` → routing /:id cassé)
- [x] Fix colonnes DB : `factures` (statut != ANNULE), `rachats` (pas de client_id → []), `rendez_vous` (type_rdv)
- [x] `public/clients.html` : refonte complète — 4 KPIs, modal historique 4 onglets, modal import CSV 3 étapes
- [x] `public/static/js/clients.js` : viewHistorique, doImportCsv, JSDoc P4 complet, CSV_FIELD_MAP 9 colonnes
- [x] Build ✅ (201.22 kB, 58 modules) + tests 7/7 ✅ + commit `f621703`

### Sprint 2.16 ✅ — Reconditionnement + Bons d'achat

### Sprint 2.17 ✅ — Correction violations P1 : ticketService + stockService + fix dashboard KPIs
**Backlog architectural P1**
- [x] `src/services/ticketService.ts` créé (14 fonctions exportées, JSDoc P4) : `listTickets`, `getKanban`, `getTicketById`, `createTicket`, `updateTicket`, `updateStatutTicket` (machine à états), `deleteTicket` + helpers privés `genererTrackingToken`, `couleurAnciennete`
- [x] `src/services/stockService.ts` créé (9 fonctions exportées, JSDoc P4) : `listProduits`, `getProduitById`, `createProduit`, `updateProduit`, `deleteProduit`, `enregistrerMouvement`, `listCategories`, `createCategorie`, `getKpisStock`
- [x] `src/routes/tickets.ts` refactorisé : 0 SQL inline, 100% délégué à `ticketService`. Hooks cross-service conservés (garantie + email) — non bloquants
- [x] `src/routes/stocks.ts` refactorisé : 0 SQL inline, 100% délégué à `stockService`. Nouveau endpoint `GET /api/produits/kpis`
- [x] Build ✅ (225.24 kB, 62 modules) + tests 8/8 ✅ + commit `3b1405d`
**Corrections bugs login / navigation (hors P1)**
- [x] `public/login.html` : fausse auth hardcodée → `POST /api/auth/login` réel + redirect `/dashboard` sans `.html` — commit `a6c075a`
- [x] `public/static/js/app.js` : 5× `/login.html` → `/login` (redirections logout/session expirée) — commit `953bf02`
- [x] `public/static/js/personnel.js` + `sav.js` : `/login.html` → `/login` — commit `953bf02`
- [x] `public/sw.js` : cache `v2.14` → `v2.17` — commit `953bf02`
**Fix dashboard KPIs à 0 — commit `869d5ae`**
- [x] Diagnostic : admin `boutique_id: null` → `getBoutiqueId()` retourne `null` → stats vides
- [x] `public/login.html` : après login réussi, si `user.boutique_id === null`, appel `GET /api/boutiques` pour auto-sélectionner la première boutique et renseigner la session
- [x] `public/static/js/app.js` : `apiGet()` auto-injecte `boutique_id` depuis `getBoutiqueId()` → tous les appels dashboard bénéficient du boutique_id sans modifier dashboard.js
- [x] `seed.sql` : placeholders bcrypt → vrais hashes PBKDF2-SHA256 `Admin@2026!` pour tous les users de test
**Modules CDC : MOD-05 (MOYENNE) + MOD-11 bons d'achat**
- [x] Migration `0021` : table `ordres_reconditionnement` (colonne `cout_revient` générée) + table `bons_achat` (code BA-XXXXXXXX, expiration, machine statuts)
- [x] `src/services/reconditionnementService.ts` (Model) — 14 fonctions : ordres (listOrdres, getOrdre, createOrdre, updateOrdre, updateStatutOrdre, terminerOrdre → crée produit occasion, getKpisReconditionnement) + bons (listBonsAchat, getBonAchat, createBonAchat, verifierBonAchat, consommerBonAchat partiel/total, annulerBonAchat)
- [x] `src/routes/reconditionnement.ts` : **2 routers séparés** — `reconditionnementRoutes` (/api/reconditionnement, 7 endpoints) + `bonsAchatRoutes` (/api/bons-achat, 6 endpoints). Séparation évite collision `/:id` vs `/bons-achat/*`.
- [x] `src/index.tsx` : montages explicites `app.route('/api/reconditionnement')` + `app.route('/api/bons-achat')` — version 2.16.0
- [x] `public/reconditionnement.html` : 2 onglets (ordres + bons), 4 KPIs, modal CRUD ordre, modal terminer (prix + grade → produit créé), modal bon, modal vérification code caisse
- [x] `public/static/js/reconditionnement.js` : View JSDoc P4 complet — switchTab, CRUD ordres, terminerOrdre, émission bon, verifierBon, annulerBon
- [x] `public/static/js/app.js` sidebar : entrée « Reconditionnement » ajoutée
- [x] Build ✅ (220.29 kB, 60 modules) + tests 8/8 ✅ + commit `81b00fa`

### Sprint 2.18 ✅ — Correction bugs bloquants post-audit
- [x] `src/services/garantiesService.ts` : alias SQL `to` (mot réservé SQLite) → `t_orig` dans `listSav()` + `getSav()` → fix `D1_ERROR SQLITE_ERROR` sur `GET /api/sav`
- [x] `src/routes/public.ts` : mapping `STATUT_CLIENT` redesigné en clés minuscules alignées sur la machine à états (`recu`, `en_diagnostic`, `attente_accord`…) → `statut_label` en français dans la page suivi client
- [x] `src/routes/boutiques.ts` : auto-génération slug à la création `POST /api/boutiques`
- [x] `migrations/0022_slug_boutiques.sql` : `UPDATE boutiques SET slug` pour les boutiques existantes sans slug
- [x] `seed.sql` : INSERT boutique avec slug `'izigsm-paris-11'` — cohérence après `db:reset`
- [x] Build ✅ (225.68 kB, 62 modules) + tests 7/7 ✅ + commit `0ba5d22`

### Sprint 2.19 ✅ — MOD-03 Devis : complétion complète
**Modules CDC : MOD-03 Devis (HAUTE)**
- [x] `migrations/0023_devis_public_token.sql` : `ALTER TABLE devis` → colonnes `public_token`, `envoye_le`, `repondu_le`, `signature_client` + index unique `idx_devis_public_token`
- [x] `src/services/devisService.ts` (Model — 8 fonctions) :
  - Machine à états `draft → envoye → accepte|refuse|expire|annule` (transitions validées)
  - `listDevis()` : liste paginée avec filtres statut/client/search
  - `getDevis()` : détail + lignes JOIN
  - `createDevis()` : numéro séquentiel + `public_token` hex 32 via Web Crypto
  - `updateDevis()` : modification (draft uniquement)
  - `updateStatutDevis()` : machine à états avec flag `fromPublic`
  - `convertirDevis()` : copie lignes → facture (liaison `devis_id`)
  - `getDevisByToken()` : accès public sans auth
  - `getStatsDevis()` : agrégats KPIs (total/envoyes/acceptes/montants/taux)
  - `expireDevisPerimes()` : batch expiration date_validite dépassée
- [x] `src/routes/facturation.ts` : section devis réécrite — 3 routes SQL inline → 9 routes (0 SQL, délègue à devisService) + import emailService pour `/envoyer`
- [x] `src/routes/public.ts` : 2 nouveaux endpoints (sans auth, CORS `*`) :
  - `GET /api/public/devis/:token` : consultation client avec statut_label FR + `peut_repondre` + vérification expiration
  - `POST /api/public/devis/:token/repondre` : accepter/refuser + enregistrement `signature_client`
- [x] `public/devis.html` : KPIs stats, filtres statuts (valeurs minuscules alignées API), modal détail complet, modal création/édition refactorisé (champ TVA)
- [x] `public/static/js/devis.js` : réécriture complète 31 kB — `loadDevisStats()`, `openDevisDetail()`, `openEditDevis()`, `envoyerDevis()`, `changerStatutDevis()`, `annulerDevis()`, badges `devisBadge()`, boutons d'action selon statut
- [x] Build ✅ (239.49 kB, 63 modules) + tests 8/8 ✅ + commit (Sprint 2.19)

### Sprint 2.20 ✅ — MOD-02 Factures/Avoirs : Model layer + page publique devis
**Modules CDC : MOD-02 Facturation (CRITIQUE) + MOD-03 Devis page client**
- [x] `public/devis-public.html` : page autonome sans auth (TailwindCSS CDN) — sections loading/error/devis/repondu
  - Lecture `public_token` depuis URL (`/devis-public/TOKEN` ou `?token=TOKEN`)
  - Boutons Accepter/Refuser → `POST /api/public/devis/:token/repondre`
  - Confirmation inline sans rechargement, badge statut coloré, lignes tableau + totaux
- [x] `src/services/factureService.ts` (Model P1 — 7 fonctions, 0 SQL dans routes) :
  - `listFactures()` : liste paginée avec filtres statut/client
  - `getFacture()` : détail + lignes + paiements (Promise.all parallèle)
  - `ajouterPaiement()` : paiement + calcul statut (payee/partiellement_payee) + audit
  - `emettreFacture()` : verrouillage NF525 + SHA-256 + tracking_token (CGI art. 289)
  - `listAvoirs()` : liste paginée avec filtres
  - `getAvoir()` : détail + lignes
  - `createAvoir()` : création avec chaîne NF525 obligatoire (facture doit être locked)
- [x] `src/routes/facturation.ts` : section Factures/Avoirs refactorisée — 36 SQL inline → 6 routes controller pures (0 SQL)
  - Import `enregistrerTransaction` restauré pour la route `PUT /devis/:id/convertir`
- [x] `src/index.tsx` : version → `2.20.0`
- [x] Build ✅ (241.41 kB, 64 modules) + tests 8/8 ✅ + commit (Sprint 2.20)

### Sprint 2.21 ✅ — Conformité P1 MVC : rachatService + personnelService + userService
**Principe P1 Modularité : routes = Controller pur (0 SQL), services = Model**
- [x] `src/services/rachatService.ts` (Model P1 — 5 fonctions) :
  - `listRachats()` : liste paginée + filtres (statut, search 6 champs, dates)
  - `getRachat()` : détail + opérateur + boutique (JOIN triple)
  - `createRachat()` : vérification doublon IMEI + `nextNumero(LP)` + audit
  - `updateStatutRachat()` : machine à états statut + audit
  - `exportLivrePolice()` : données brutes pour CSV réglementaire art. 321-7
  - Constantes exportées : `PIECES_VALIDES`, `ETATS_VALIDES`, `MODES_PAIEMENT_VALIDES`, `STATUTS_VALIDES`
- [x] `src/services/personnelService.ts` (Model P1 — 8 fonctions) :
  - `listEmployes()` : liste + statut pointage temps réel + heures aujourd'hui
  - `getEmploye()` : détail + 50 derniers pointages (Promise.all)
  - `createEmploye()` / `updateEmploye()` / `desactiverEmploye()` : CRUD employés
  - `pointer()` : machine à états pointage (absent→en_poste↔pause→termine)
  - `pointagesAujourdhui()` : pointages du jour + calcul heures JS (sans SQL complexe)
  - `rapportPointage()` : présences sur période
  - `statutsTempsReel()` : statuts groupés + résumé chiffré
  - Constantes exportées : `TRANSITIONS_POINTAGE`, `STATUT_LABELS`
- [x] `src/services/userService.ts` (Model P1 — 8 fonctions) :
  - `setPIN()` / `verifyPIN()` / `deletePIN()` / `getPINStatus()` : cycle de vie PIN PBKDF2
  - `resetPINAdmin()` : réinitialisation admin avec contrôle accès boutique
  - `getPermissions()` : map action → bool avec défaut tout-autorisé
  - `setPermissions()` : upsert batch avec whitelist `ACTIONS_VALIDES` (8 actions)
  - `listUsers()` : tous ou filtré boutique selon rôle admin/manager
- [x] `src/routes/rachats.ts` refactorisé : 12 SQL inline → 0 (5 routes controller pures)
- [x] `src/routes/personnel.ts` refactorisé : 12 SQL inline → 0 (9 routes controller pures)
- [x] `src/routes/users.ts` refactorisé : 11 SQL inline → 0 (7 routes controller pures)
- [x] `src/index.tsx` : version `2.20.0` → `2.21.0`, sprint mis à jour
- [x] Build ✅ (244.23 kB, 67 modules) + tests 8/8 ✅ + commit (Sprint 2.21)

### Sprint 2.22 ✅ — Documentation P4 : JSDoc exhaustif (services + lib + routes)
**Principe P4 Lisibilité : JSDoc obligatoire sur toutes les fonctions exportées**
- [x] `src/services/agendaService.ts` : `@module` + JSDoc 10 fonctions + 5 helpers privés (machine états RDV, iCal RFC 5545)
- [x] `src/services/caisseService.ts` : `@module` NF525 + JSDoc 8 fonctions + interfaces + `buildDonneesHash` FORMAT FIGÉ
- [x] `src/services/emailService.ts` : `@module` stratégie non-bloquante + JSDoc 8 fonctions + logique décision `sendEmail`
- [x] `src/services/garantiesService.ts` : `@module` machine états SAV + alias SQL + JSDoc 10 fonctions
- [x] `src/services/fournisseursService.ts` : `@module` CUMP + JSDoc 12 fonctions + formule CUMP documentée
- [x] `src/services/servicesService.ts` : `@module` arbre hiérarchique + JSDoc 10 fonctions
- [x] `src/lib/db.ts` : `@module` + JSDoc 7 fonctions (nextNumero atomicité, parsePagination, auditLog)
- [x] `src/lib/nf525.ts` : `@module` légal LFR2015 + `sha256` Web Crypto + `buildCanonicalData` FORMAT FIGÉ + `clotureJournaliere`
- [x] `src/lib/middleware.ts` : `@module` RBAC + JSDoc complet sur 5 fonctions/middlewares
- [x] `src/lib/auth.ts` : `@module` PBKDF2/JWT/KV + JSDoc 12 fonctions dont `timingSafeEqual`, `signJwt`, `storeOtp`, `generateOtp`
- [x] `src/routes/caisse.ts` : `@module` + JSDoc 7 handlers + `validateVente` + `ctx()`
- [x] `src/routes/boutiques.ts` : `@module` + JSDoc 8 handlers (CRUD, settings, stats, NF525)
- [x] `src/routes/agenda.ts` : `@module` machine états + JSDoc 9 handlers
- [x] `src/routes/auth.ts` : `@module` flux auth + JSDoc 6 handlers (séquences détaillées + notes sécurité)
- [x] `src/routes/services.ts` : `@module` arbre + JSDoc 10 handlers (catalogue, categories, services)
- [x] `src/index.tsx` : `@version 2.22.0`
- [x] Build ✅ (244.26 kB, 67 modules, 0 erreur TypeScript) + commit `ac116be` (Sprint 2.22)

---

## Backlog violations architecturales (à corriger au fil des sprints)

| Priorité | Fichier | Violation | Sprint cible |
|---|---|---|---|
| ✅ Résolu | ~~`src/index.tsx`~~ | ~~`/api/stats` SQL inline multi-module~~ | ✅ Résolu Sprint 2.13 |
| ✅ Résolu | ~~`app.js` doublon~~ | ~~`apiPut` déclaré deux fois~~ | ✅ Résolu Fix DP |
| ✅ Résolu | ~~`routes/clients.ts` l.41~~ | ~~`JOIN tickets` cross-module~~ | ✅ Résolu Sprint 2.15 |
| ✅ Résolu | ~~`routes/clients.ts`~~ | ~~Pas de couche `clientService.ts`~~ | ✅ Résolu Sprint 2.15 |
| ✅ Résolu | ~~`routes/*.ts` (anciens)~~ | ~~Documentation fonctions insuffisante~~ | ✅ Résolu Sprint 2.22 |
| ✅ Résolu | ~~`routes/tickets.ts`~~ | ~~Pas de couche `ticketService.ts`~~ | ✅ Résolu Sprint 2.17 |
| ✅ Résolu | ~~`routes/stocks.ts`~~ | ~~Pas de couche `stockService.ts`~~ | ✅ Résolu Sprint 2.17 |

---

## État technique courant

| Élément | Valeur |
|---|---|
| Version | 2.22.0 |
| Build | `dist/_worker.js` 244.26 kB — 67 modules |
| Dernière migration | `0023_devis_public_token.sql` ✅ Sprint 2.19 |
| Dernier commit | `ac116be` Sprint 2.22 — JSDoc P4 complet (services + lib + routes) |
| Branche | `main` |
| PM2 | `izigsm` online — port 3000 |
| Conformité DP | ✅ P1 P2 P3 P4 P5 — **backlog violations complètement soldé** — tous les modules ont leur couche Service |}

---

## Couverture CDC par priorité (état Sprint 2.4)

| Priorité CDC | Modules | Couverture moyenne |
|---|---|---|
| CRITIQUE (MOD-01, 02, 04) | Tickets ⚠️, Facturation ✅, Stock ⚠️ + CUMP ✅ | ~58% |
| HAUTE (MOD-03, 06, 07, 10, 12, 17) | Devis ⚠️, Rachats ✅, CRM ⚠️, Achats ✅, Notifs ❌, Rapports ⚠️ | ~45% |
| HAUTE (MOD-15, 18) | Catalogue ✅, Équipe ✅ | ~68% |
| MOYENNE (MOD-05, 08, 09, 13, 14, 16) | Tous ❌ | ~0% |
| **Global** | **18 modules** | **~38%** |

*Référence : `docs/ANALYSE_COMPARATIVE_CDC.md` pour le détail module par module.*
