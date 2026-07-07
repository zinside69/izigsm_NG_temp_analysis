# iziGSM — TODO & Suivi des Sprints

> Mis à jour : Sprint 2.41-A terminé — 7 juillet 2026  
> Version production : **v2.41.0** (en cours de déploiement) — `https://8096d010-efde-413e-a481-72226566aa0b.vip.gensparksite.com`  
> Tests : **651/651** (16 suites Vitest) — ✅ publicService +10 tests Sprint 2.41-A  
> Build : 73 modules / 298.92 kB (dernier build stable v2.41.0)  
> Git : branche `main`, tag `v2.41.0` — working tree propre

---

## État technique global

| Composant | État | Détail |
|---|---|---|
| **Backend Hono** | ✅ Complet | 18 fichiers routes, ~240 endpoints, 0 SQL dans les controllers |
| **Services Model** | ✅ Complet | 18 services (+ phoneCatalogService.ts Sprint 2.39), P1 MVC strict respecté partout |
| **Migrations D1** | ✅ 31 migrations | 0031_marques_modeles_global.sql = dernière (✅ appliquée localement Sprint 2.39) |
| **Auth JWT + D1KV** | ✅ Prod | PBKDF2, sessions D1 (remplacement KV), refresh tokens |
| **NF525 conformité** | ✅ Prod | SHA-256 chaîné factures + avoirs + caisse |
| **Tests Vitest** | ✅ 641/641 | authService 23, boutiqueService 24, caisseService 14, ticketService 37, emailService 16, garantiesService 65, agendaService 75, fournisseursService 65, stockService 45, devisService 58, factureService 41, clientService 38, personnelService 36, reconditionnementService 50, publicService 20, **servicesService 26** — ✅ adapté Sprint 2.39 (schéma global sans boutique_id) |
| **PWA** | ✅ Prod | manifest.json, sw.js, install prompt |
| **Déploiement** | ✅ Prod | gsk hosted deploy, Cloudflare Workers for Platform |

---

## Sprints terminés ✅

### Sprint 2.1 ✅ — Facturation NF525 + Avoirs
- [x] Migration 0010 : `locked`, `issued_at`, `tracking_token` sur factures + tables `avoirs` + `lignes_avoir`
- [x] `nextNumero()` : `avoir → AV`, `rachat → LP`
- [x] `POST /api/factures/:id/emettre` : locked=1, hash NF525, UUID tracking
- [x] `GET/POST /api/avoirs`, `GET /api/avoirs/:id`
- [x] Frontend `factures.js` : badges 🔒, bouton Émettre, modal Avoir

### Sprint 2.2 ✅ — Livre de police (Rachats)
- [x] Migration 0011 : table `rachats` (30 colonnes) + 6 index
- [x] `routes/rachats.ts` : GET list, GET :id, POST (validations art. 321-7 + doublon IMEI), PATCH /statut, GET /export CSV
- [x] `public/rachats.html` + `public/static/js/rachats.js`
- [x] `app.js` : `apiPatch` + sidebar "Livre de police"

### Sprint 2.3 ✅ — PIN PBKDF2 + Sessions KV + Permissions granulaires
- [x] Migration 0012 : `pin_hash`, `pin_actif` sur users + table `permissions`
- [x] `routes/users.ts` : PIN set/verify/delete/status/reset + permissions GET/PUT
- [x] `middleware.ts` : `requirePin` + `hasPermission()`
- [x] `app.js` : `requirePinAction()` + `confirmPin()` modal global

### Sprint 2.4 ✅ — Catalogue services hiérarchique
- [x] Migration 0013 : `categories_services` + `services` (10 index)
- [x] `src/services/servicesService.ts` : premier Model layer
- [x] `src/routes/services.ts` : Controller pur — 0 SQL inline, 19 endpoints
- [x] `public/services.html` : layout split sidebar/grille, modals catégorie + service, color picker

### Sprint 2.5 ✅ — Fournisseurs + Bons de commande + CUMP
- [x] Migration 0014 : `fournisseurs` + `bons_commande` + `lignes_bon_commande` + CUMP sur `produits`
- [x] `src/services/fournisseursService.ts` : CRUD fournisseurs, CRUD BC, réception+CUMP, KPIs, À commander
- [x] CUMP : `(stock×cump + qty×prix) / (stock+qty)` — calculé à la réception
- [x] Numérotation BC : `BC-AAAA-XXXXX` via MAX séquentiel D1
- [x] `public/fournisseurs.html` + `public/static/js/fournisseurs.js`
- [x] Sidebar : entrée Fournisseurs + badge nb produits à commander

### Sprint 2.6 ✅ — Agenda / RDV + iCal RFC 5545
- [x] Migration 0015 : `rendez_vous` + `boutique_ical_tokens`
- [x] `src/services/agendaService.ts` : CRUD, vue calendrier, KPIs, iCal
- [x] Machine à états RDV : PENDING→SCHEDULED→DONE/NO_SHOW/CANCELLED/CONVERTED
- [x] Export iCal RFC 5545 `GET /api/calendar/:token.ics` — public, sans auth
- [x] `public/agenda.html` + `public/static/js/agenda.js`

### Sprint 2.7 ✅ — Vitrine publique + Tracking token
- [x] Migration 0016 : colonnes vitrine sur `boutiques`
- [x] `public/suivi.html` : page tracking public client (sans auth), timeline statuts
- [x] `src/routes/public.ts` : `GET /api/public/ticket/:token`, `GET /api/public/boutique/:slug`, catalogue public
- [x] QR code tracking_token sur fiche ticket
- [x] `public/static/js/suivi.js` — affichage statut + timeline

### Sprint 2.8 ✅ — Statuts tickets complets + Kanban
- [x] Migration 0017 : `priorite` + `date_commande_pieces` + `date_reception_pieces` sur tickets
- [x] Statuts complets : `recu → en_diagnostic → attente_accord → a_commander → commande → pieces_recues → en_reparation → termine → livre / annule`
- [x] `src/services/ticketService.ts` : `getKanban()`, `TRANSITIONS_TICKET`, `STATUT_CONFIG`
- [x] `GET /api/tickets/kanban` : données groupées par statut + ancienneté couleur
- [x] `public/kanban.html` + `public/static/js/kanban.js` : 9 colonnes, drag & drop JS natif, filtres technicien
- [x] Indicateurs ancienneté : vert (<2j), orange (3–7j), rouge (>7j), alerte (>14j)

### Sprint 2.9 ✅ — Numérotation configurable + Settings tenant
- [x] Migration 0018 : `prefix_ticket/facture/devis/avoir/rachat`, `format_numero`, `padding_numero`, `garantie_defaut_jours`, `delai_relance_jours`, `mention_facture`, `pied_de_page` sur `boutique_settings`
- [x] `src/lib/db.ts` : `nextNumero()` lit `boutique_settings` pour préfixes + format
- [x] `src/services/boutiqueService.ts` : `updateBoutiqueSettings()` avec COALESCE
- [x] `public/settings.html` : 5 onglets (Général / Numérotation / Facturation / Paiements / Email)
- [x] Aperçu temps réel numérotation dans le formulaire

### Sprint 2.10 ✅ — SAV & Garanties
- [x] Migration 0019 : `garanties` + `tickets_sav`
- [x] `src/services/garantiesService.ts` : createGarantieFromTicket (idempotent), createGarantie, getGarantie, listGaranties, checkAndExpireGaranties, createSav, listSav, getSav, updateSavStatut, getKpisSav
- [x] `TRANSITIONS_SAV` : machine à états SAV complète
- [x] `src/routes/sav.ts` : 11 endpoints controller pur
- [x] `public/sav.html` + `public/static/js/sav.js`

### Sprint 2.11 ✅ — Notifications email
- [x] Migration 0020 : `email_logs`
- [x] `src/services/emailService.ts` : sendEmail (Resend API), sendTicketStatus, sendDevisEmail, sendFactureEmail, sendRelance, listEmailLogs, getBoutiqueNomById
- [x] `src/routes/notifications.ts` : stats, logs, test email, batch relances
- [x] `public/notifications.html` : journal emails + stats + bouton test
- [x] Hook statut ticket → email client (non-bloquant, fire & forget)

### Sprint 2.12 ✅ — Caisse POS + Journal NF525
- [x] Migration intégrée dans 0008 + extensions
- [x] `src/services/caisseService.ts` : ouverture/fermeture session, encaissement, journal NF525, KPIs
- [x] `src/routes/caisse.ts` : 13 endpoints
- [x] `public/caisse.html` : interface POS tactile, multi-modes paiement
- [x] `requirePin` sur accès caisse (`acces_caisse`)

### Sprint 2.13 ✅ — Export PDF + Dashboard graphiques réels
- [x] Export PDF factures/tickets (HTML → `window.print()`)
- [x] `src/services/statsService.ts` : 6 fonctions — KPIs CA, tickets par statut, top produits, rapport techniciens
- [x] `src/routes/stats.ts` : 9 endpoints (KPIs, graphiques, techniciens, stock, factures, caisse)
- [x] Dashboard : Chart.js — CA mensuel réel, tickets par statut, top produits
- [x] 12 KPIs temps réel

### Sprint 2.14 ✅ — PWA manifest + Service Worker
- [x] `public/manifest.json` — app iziGSM, icônes 192×192 + 512×512
- [x] `public/sw.js` : cache offline assets statiques (cache-first)
- [x] Install prompt (banner Android/iOS)

### Sprint 2.15 ✅ — CRM étendu
- [x] `src/services/clientService.ts` : 9 fonctions — listClients, getClient, updateClient, deleteClient, addAppareil, getHistoriqueClient, importClients, getKpis, createClient
- [x] `GET /api/clients/:id/historique` : tickets + factures + RDV + KPIs
- [x] `POST /api/clients/import-csv` : parsing côté client, mapping 9 colonnes, dédup email silencieux
- [x] `public/clients.html` : 4 KPIs, modal historique 4 onglets, import CSV 3 étapes

### Sprint 2.16 ✅ — Reconditionnement + Bons d'achat
- [x] Migration 0021 : `ordres_reconditionnement` + `bons_achat`
- [x] `src/services/reconditionnementService.ts` : 14 fonctions — ordres + bons d'achat
- [x] `terminerOrdre()` : crée produit occasion en stock
- [x] `consommerBonAchat()` : déduction partielle/totale + audit
- [x] `public/reconditionnement.html` + `public/static/js/reconditionnement.js`

### Sprint 2.17 ✅ — Conformité P1 MVC : ticketService + stockService + fix dashboard KPIs
- [x] `src/services/ticketService.ts` : 9 fonctions exportées, JSDoc P4
- [x] `src/services/stockService.ts` : 9 fonctions exportées
- [x] `src/routes/tickets.ts` + `stocks.ts` refactorisés : 0 SQL inline
- [x] Fix login → auto-sélection boutique_id si admin null
- [x] Fix redirections `/login.html` → `/login` (5 occurrences)
- [x] `seed.sql` : vrais hashes PBKDF2-SHA256

### Sprint 2.18 ✅ — Corrections bugs bloquants
- [x] Alias SQL `to` (mot réservé SQLite) → `t_orig` dans `listSav()` + `getSav()`
- [x] `routes/public.ts` : mapping STATUT_CLIENT en clés minuscules
- [x] `routes/boutiques.ts` : auto-génération slug à la création
- [x] Migration 0022 : UPDATE slug boutiques existantes

### Sprint 2.19 ✅ — MOD-03 Devis : complétion complète
- [x] Migration 0023 : `public_token`, `envoye_le`, `repondu_le`, `signature_client` sur devis
- [x] `src/services/devisService.ts` : machine à états draft→envoye→accepte/refuse/expire/annule
- [x] `GET/POST /api/public/devis/:token/repondre` — sans auth, CORS *
- [x] `public/devis-public.html` : page autonome client — Accepter/Refuser

### Sprint 2.20 ✅ — MOD-02 Facturation : Model layer complet
- [x] `src/services/factureService.ts` : 7 fonctions — listFactures, getFacture, ajouterPaiement, emettreFacture, listAvoirs, getAvoir, createAvoir
- [x] `routes/facturation.ts` : 36 SQL inline → 6 routes controller pures (0 SQL)

### Sprint 2.21 ✅ — Conformité P1 MVC : rachatService + personnelService + userService
- [x] `src/services/rachatService.ts` : 5 fonctions + constantes PIECES_VALIDES/ETATS_VALIDES
- [x] `src/services/personnelService.ts` : 8 fonctions + TRANSITIONS_POINTAGE
- [x] `src/services/userService.ts` : 8 fonctions (PIN cycle de vie + permissions)
- [x] Routes rachats/personnel/users refactorisées : 35 SQL inline → 0

### Sprint 2.23 ✅ — Conformité P1 MVC : authService + boutiqueService
- [x] `src/services/authService.ts` : 8 fonctions + 3 interfaces TypeScript
- [x] `src/services/boutiqueService.ts` : 8 fonctions + 6 interfaces TypeScript
- [x] Routes auth/boutiques refactorisées : 21 SQL inline → 0
- [x] Validation route iCal `GET /api/calendar/:token.ics` — RFC 5545 ✅

### Sprint 2.24 ✅ — Stats avancées + page analytics
- [x] `public/stats.html` : 4 onglets (CA / Tickets / Techniciens / Produits) — Chart.js
- [x] `src/routes/stats.ts` : 6 endpoints `/api/stats/*`

### Sprint 2.25 ✅ — Conformité P1 MVC : purge SQL résiduel (16 → 0 `.prepare` dans routes/)
- [x] `src/services/publicService.ts` : 7 fonctions — ticket public, boutique slug, stats boutique, catalogue public
- [x] `clientService.ts` : + `getClientEmailPrenom()`
- [x] `ticketService.ts` : + `getTicketBoutiqueId()` + `getTicketAvecClient()`
- [x] `factureService.ts` : + `getDevisPourNf525()` + `updateFactureHash()`
- [x] `emailService.ts` : + `listEmailLogs()` + `getBoutiqueNomById()`
- [x] **P1 MVC : 0 SQL dans aucun controller** — objectif global atteint

### Sprint 2.26 ✅ — Déploiement Cloudflare : D1AsKV (remplacement KV → D1)
- [x] Migration 0024 : `kv_store (key PK, value, expires_at)` + index TTL partiel
- [x] `src/lib/d1kv.ts` : `D1KVNamespace`, `createD1KV()`, TTL passif + `d1KvCleanup()`
- [x] Suppression `kv_namespaces` de wrangler.jsonc (blocage gsk-hosted-deploy KV non supporté)
- [x] Migration `KVNamespace` → `D1KVNamespace` dans auth.ts, middleware.ts, userService.ts + 18 routes
- [x] **Premier déploiement prod réussi** — action `6f3ef9d7`, 24 migrations appliquées
- [x] `gsk hosted secret_put JWT_SECRET` ✅
- [x] Auth end-to-end validé (register + verify-otp + login)
- [x] `GET /api/calendar/:token.ics` → RFC 5545 validé

### Sprint 2.27 ✅ — Audit global frontend : ApiService → apiGet/apiPost (zéro dette auth)
- [x] `public/stats.html` : page analytics complète 4 onglets
- [x] `kanban.js` : 6× ApiService → apiGet/apiPut
- [x] `caisse.js` : 9× axios → apiGet/apiPost
- [x] `personnel.js` : 4× axios → apiGet/apiPost
- [x] `sav.js` : fonctions locales apiGet/apiPost supprimées → globales app.js
- [x] `dashboard.js` : access_token JWT → izigsm_session
- [x] `tickets.js` : statuts FR 10 valeurs, STATUT_LABELS complets
- [x] Audit routes backend × frontend : 18 fichiers routes, cross-check exhaustif
- [x] `docs/DEPLOIEMENT.md` : mode opératoire 10 étapes
- [x] **Zéro dette** : 0 axios, 0 ApiService, 0 access_token/authHeaders dans tout le frontend
- [x] 319 tests (5 suites nouvelles + 3 héritées)

### Sprint 2.28 ✅ — Tests Vitest : garantiesService + agendaService + fournisseursService
- [x] `tests/garantiesService.test.ts` : **65 tests** — TRANSITIONS_SAV, createGarantieFromTicket (idempotence, dateFin JS, settings 90j/180j), createGarantie, getGarantie, listGaranties (filtres SQL dynamiques via __getCalls), checkAndExpireGaranties, createSav (3 erreurs + ticket SAV + marque consommée), listSav (alias t_orig/ts), getSav (4 JOIN), updateSavStatut (transitions complètes), getKpisSav (5 requêtes parallèles, taux_retour_pct)
- [x] `tests/agendaService.test.ts` : **75 tests** — STATUTS_RDV/TYPES_RDV, listRendezVous (7 filtres), getRendezVous, createRendezVous (fin auto, ical_token hex 32, user_id fallback), updateRendezVous, updateStatutRdv (machine à états 6 statuts), deleteRendezVous (soft delete), getAgendaView (groupement date, CANCELLED exclus), getKpisAgenda (5 req, taux_honore), getOrCreateIcalToken, generateIcal (RFC 5545 CRLF, VCALENDAR, VEVENT, UID stable, DTSTART UTC)
- [x] `tests/fournisseursService.test.ts` : **65 tests** — listFournisseurs, getFournisseur, createFournisseur (trim, auditLog), updateFournisseur (COALESCE), deleteFournisseur (soft), listBonsCommande (4 filtres), getBonCommande, createBonCommande (numérotation BC-AAAA-NNNNN, calcul HT/TTC, TVA custom, auditLog), updateStatutBonCommande (4 statuts valides), receptionnerBonCommande (CUMP standard + stock=0, mouvement stock, BC→received), getKpisFournisseurs, getProduitsACommander
- [x] Audit `qualirepar.html` + `modules.html` : 0 dette (0 axios, 0 ApiService)
- [x] Build ✅ 71 modules / 248.08 kB + tests ✅ **319/319**
- [x] **Déploiement prod** — action `cc3077d7`, version `4649d6c2`, health ✅ v2.28.0
- [x] Tag git `v2.28.0`

---

### Sprint 2.41-A ✅ — J08/J09/N05 : Prise de RDV en ligne (vitrine publique)
**Modules CDC : J08 (HAUTE) + J09 (HAUTE) + N05 (HAUTE) — RDV public** — *terminé — 7 juillet 2026*

- [x] Découverte : `getDisponibilites()` + `createRdvPublic()` déjà implémentées dans `publicService.ts` (lignes 286/388)
- [x] Correction import manquant dans `src/routes/public.ts` : +`getDisponibilites`, +`createRdvPublic`
- [x] Routes déjà présentes : `GET /api/public/boutique/:slug/disponibilites` + `POST /api/public/rdv`
- [x] `public/rdv-public.html` créé : formulaire 3 étapes (service → créneau calendrier → coordonnées)
- [x] **+10 tests** `publicService.test.ts` : `getDisponibilites` (5) + `createRdvPublic` (5) — 20→30 tests
- [x] **651/651 tests** globaux ✅
- [x] `npm run build` ✅ — 73 modules / 298.92 kB
- [x] Version bump `src/index.tsx` → v2.41.0
- [x] Commit `40a2ce4` + tag `v2.41.0`
- [x] GAP_ANALYSIS v4.2 : J08/J09/N05 → ✅ — couverture 147/159 = ~93%

---

### Sprint 2.40 ✅ — G07 : Relances automatiques devis non répondus
**Module CDC : G07 (HAUTE) — Relances devis** — *terminé — 7 juillet 2026*

- [x] `EmailType` étendu : ajout `'relance_devis'`
- [x] `notifMap` dans `sendEmail()` : entrée `relance_devis: config.notif_relance` ajoutée
- [x] `sendRelanceDevis()` : email relance avec lien public `/devis-public.html?token=...`
- [x] `processRelancesDevis()` : batch SELECT devis éligibles (statut=envoye, délai dépassé, non expiré, pas de relance récente), LIMIT 30
- [x] `POST /api/notifications/relances-devis` : route déclenchement manuel (admin)
- [x] UI `notifications.html` : bouton "Relances devis" violet + `lancerRelancesDevis()`
- [x] R09 (modal sync services.html), A07 (reset-password.html), B06/L08/L09 (toggles notifs) : **découverts déjà implémentés** — validés Sprint 2.40
- [x] **8 tests** `emailService.test.ts` : `sendRelanceDevis` (4) + `processRelancesDevis` (4) — 24/24 ✅
- [x] **641/641 tests** globaux ✅
- [x] `npm run build` ✅ — 73 modules / 296.37 kB
- [x] Version bump `src/index.tsx` → v2.40.0
- [x] Commit + tag v2.40.0
- [x] GAP_ANALYSIS v4.1 : R09/A07/B06/L08/L09/G07 → ✅ — couverture 144/159 = ~90%

---

### Sprint 2.39 ✅ — MOD-15 Phase 2 : Synchronisation référentiel global phone-specs-api
**Module CDC : MOD-15 (HAUTE) — Catalogue services complet** — *terminé — 6 juillet 2026*

#### Contexte et décision d'architecture
L'API gratuite `phone-specs-api.vercel.app` (source GSMArena) expose 126 marques et leurs modèles paginés. Décision : **référentiel global** (sans `boutique_id`) — les marques/modèles sont partagés entre toutes les boutiques.

Rupture de schéma avec Sprint 2.38 (tables avaient `boutique_id`) → migration 0031 refonte totale via stratégie SQLite RENAME→CREATE→INSERT OR IGNORE→DROP.

#### Backend (✅ Complet)

- [x] Migration `0031_marques_modeles_global.sql` : refonte tables sans `boutique_id` — `brand_slug UNIQUE`, `phone_slug UNIQUE`, colonne `source ('manual'|'api')`, `synced_at`, table `phone_catalog_sync_log`
- [x] `src/services/phoneCatalogService.ts` : 5 fonctions de sync
  - `syncBrands(db)` — `GET /brands` → INSERT OR IGNORE sur `brand_slug`, UPDATE `device_count` si `source='api'`
  - `syncModelesByBrand(db, brandSlug)` — page 1 → `last_page` → `Promise.all` chunks 10 pages → INSERT OR IGNORE sur `phone_slug` + `guessType()` heuristique
  - `syncSelectedBrands(db, slugs[])` — itère `syncModelesByBrand()` pour liste sélectionnée
  - `getLastSyncStatus(db)` — JOIN marques + sync_log (ROW_NUMBER dernière sync)
  - `getCatalogStats(db)` — `{total_marques, total_modeles, marques_api, modeles_api, last_sync}`
- [x] `src/services/servicesService.ts` adapté : interfaces `MarqueAppareil` / `ModeleAppareil` sans `boutique_id`, `listMarques(db)` + `listModeles(db, opts)` sans paramètre `boutiqueId`
- [x] `src/routes/services.ts` adapté : 5 nouvelles routes sync
  - `GET  /api/services/catalog/stats`
  - `GET  /api/services/catalog/sync-status` (admin)
  - `POST /api/services/catalog/sync-brands` (admin)
  - `POST /api/services/catalog/sync-modeles/:slug` (admin)
  - `POST /api/services/catalog/sync-selected` (admin, body: `{ slugs: string[] }`)

#### Frontend (⚠️ Partiel)

- [x] `public/services.html` : bouton `🔄 Synchroniser API` ajouté dans `#btns-modeles`
- [ ] `public/services.html` : **modal sync manquante** (sélection marques + barre de progression)
- [ ] `public/static/js/services.js` : `openModalSync()`, `startSync()`, boucle progression par marque, mise à jour stats

#### Tests (❌ Non mis à jour)

- [ ] `tests/servicesService.test.ts` : SQL constants + signatures à adapter (boutique_id supprimé)

#### Checklist de clôture Sprint 2.39

- [ ] Modal sync UI (`services.html` + `services.js`)
- [ ] `tests/servicesService.test.ts` mis à jour
- [ ] `npm run build` ✅
- [ ] `npm test` → N/N ✅
- [ ] Migration 0031 locale : `npx wrangler d1 migrations apply izigsm-production --local`
- [ ] Version bump : `src/index.tsx` 2.38.0 → 2.39.0
- [ ] `git commit -m "feat(MOD-15): sync phone-specs-api référentiel global — Sprint 2.39"`
- [ ] `git tag v2.39.0`

#### Notes techniques

> **Pattern fetch Cloudflare Workers** : `fetch(url, { cf: { cacheTtl: 3600 } })` — cache edge natif, pas de Node.js fetch.  
> **Idempotence** : INSERT OR IGNORE sur slug unique → jamais d'écrasement des entrées manuelles (`source='manual'`).  
> **Chunks** : max 10 pages en `Promise.all` pour respecter la limite de connexions simultanées Cloudflare Workers.  
> **Migration SQLite** : pas d'`ALTER TABLE DROP COLUMN` en SQLite — stratégie RENAME → CREATE → INSERT OR IGNORE → DROP.

---

## Sprints à venir — Plan priorisé

> Priorités : 🔴 P0 Bloquant / 🟠 P1 Haute / 🟡 P2 Moyenne / 🔵 P3 Basse

---

### Sprint 2.29 ✅ — Tests Vitest : couverture services critiques
**463/463 tests (11 suites) — +144 tests ce sprint**

- [x] `tests/stockService.test.ts` : **45 tests** — listProduits (5 filtres, pagination), getProduitById (mouvements), createProduit (+mouvement initial si stock>0), updateProduit (COALESCE, guard), deleteProduit (soft), enregistrerMouvement (4 types, delta effectif ajustement, stock insuffisant), listCategories, createCategorie, getKpisStock (5 champs, fallback 0)
- [x] `tests/devisService.test.ts` : **58 tests** — listDevis (5 filtres, exclut annule), getDevis, createDevis (public_token hex32, totaux calculés, guard lignes vides), updateDevis (guard draft+introuvable, upsertLignes conditionnel), updateStatutDevis (machine états 6 statuts, extras envoye_le/repondu_le, fromPublic), convertirDevis (3 guards, INSERT facture, copie lignes, auditLog), getDevisByToken, getStatsDevis (taux_conversion), expireDevisPerimes, saveSignatureDevis (tronqué 1000 chars)
- [x] `tests/factureService.test.ts` : **41 tests** — listFactures (3 filtres, Promise.all), getFacture (3 requêtes parallèles), ajouterPaiement (guard locked, statut payee/partiellement_payee, INSERT paiement), emettreFacture (guard locked, NF525 SHA-256, UUID tracking_token), listAvoirs (3 filtres), getAvoir, createAvoir (4 guards, NF525, batch lignes_avoir, UPDATE hash), getDevisPourNf525, updateFactureHash
- [x] Build ✅ + **463/463 tests** (11 suites, 4.5s)
- [x] Version bump v2.29.0
- [x] **Déploiement prod v2.29.0** — action `925f6b76`, Worker `8e6e5fb0`, health ✅ v2.29.0

---

### Sprint 2.30 ✅ — Tests services secondaires + reconditionnementService
**607/607 tests (15 suites) — +144 tests ce sprint**

- [x] `tests/clientService.test.ts` : **38 tests** — CRUD, historique (tickets+factures+rdv, rachats=vide), importClients (dédup email, UNIQUE constraint), getKpis, addAppareil
- [x] `tests/personnelService.test.ts` : **36 tests** — CRUD employés, pointer (machine états TRANSITIONS_POINTAGE, JOURNEE_TERMINEE, TRANSITION_INVALIDE), pointagesAujourdhui (calcul heures JS), rapportPointage, statutsTempsReel
- [x] `tests/reconditionnementService.test.ts` : **50 tests** — CRUD ordres, updateStatutOrdre (SQL dynamique date_debut/date_fin), terminerOrdre (produit existant ou nouveau OCC-), CRUD bons d’achat, verifierBonAchat (5 guards), consommerBonAchat (partiel+total), annulerBonAchat
- [x] `tests/publicService.test.ts` : **20 tests** — getTicketPublicByToken, getBoutiquePublicBySlug, getStatsBoutiquePublic (fallback 0), getCategoriesPubliques, getServicesPublics
- [x] **607/607 tests** (15 suites, 7.2s)
- [x] Version bump v2.30.0
- [x] **Déploiement prod v2.30.0** — Worker `b4a426bb`, health ✅ v2.30.0

---

### Sprint 2.31 ✅ — MOD-14 Vitrine publique : prise de RDV en ligne
**Module CDC : MOD-14 (MOYENNE) — Différenciateur concurrentiel**

- [x] Migration `0025_rdv_public.sql` : table `boutique_creneaux` + index `idx_rdv_boutique_debut`
- [x] `publicService.ts` : `getDisponibilites(db, boutiqueId, date)` — génère slots depuis plages horaires, filtre occupés + passés
- [x] `publicService.ts` : `createRdvPublic(db, boutiqueId, body)` — statut PENDING, ical_token, validations
- [x] `routes/public.ts` : `GET /api/public/boutique/:slug/disponibilites?date=YYYY-MM-DD`
- [x] `routes/public.ts` : `POST /api/public/rdv` (sans auth, CORS *)
- [x] `public/rdv-public.html` : formulaire 3 étapes (service → calendrier+créneaux → coordonnées) + page confirmation
- [x] `public/suivi.html` : bouton « Prendre un nouveau rendez-vous » (slug injecté dynamiquement depuis la réponse ticket)
- [x] `publicService.ts` : `getTicketPublicByToken` — ajout `b.slug AS boutique_slug` dans le SELECT
- [x] Fix `tests/publicService.test.ts` : SQL_TICKET_TOKEN mis à jour (+boutique_slug)
- [x] **607/607 tests** (15 suites)
- [x] Version bump v2.31.0
- [x] **Déploiement prod v2.31.0** — Worker `f2ad1b1d`, health ✅ v2.31.0
---

### Sprint 2.32 ✅ — MOD-12 Automatisations email : triggers statut → client
**Module CDC : MOD-12 (HAUTE) — Rétention client**

- [x] Lecture `routes/tickets.ts` — `sendTicketTermine` déjà géré pour `termine` ; `livre` absent → pas de doublon
- [x] `emailService.ts` : ajout `EmailType 'ticket_livre'` dans le type union
- [x] `emailService.ts` : ajout entrée `ticket_livre` dans `notifMap` (réutilise flag `notif_ticket_termine`)
- [x] `emailService.ts` : `sendTicketLivre()` — template HTML responsive, sujet, badge-green, lien suivi conditionnel
- [x] `routes/tickets.ts` : import `sendTicketLivre` ; bloc hook étendu à `statut_apres === 'livre'`
- [x] Architecture conservée : hook dans la route (accès `c.env.FRONTEND_URL`), fire-and-forget `.catch(() => {})`
- [x] Garantie automatique (`createGarantieFromTicket`) conservée uniquement sur `termine` (pas sur `livre`)
- [x] **607/607 tests** (15 suites — aucune régression)
- [x] Version bump v2.32.0 (`src/index.tsx`)
- [x] **Déploiement prod v2.32.0**

---

### Sprint 2.33 ✅ — MOD-17 Rapports avancés : exports CSV + rapport comptable
**Module CDC : MOD-17 (HAUTE)**

- [x] `statsService.ts` : `toCSV()` helper (BOM UTF-8, RFC 4180, échappement guillemets)
- [x] `statsService.ts` : `exportCsvTickets(db, boutiqueId, from?, to?)` — tickets + client + technicien
- [x] `statsService.ts` : `exportCsvCa(db, boutiqueId, from?, to?)` — factures payées HT/TVA/TTC
- [x] `statsService.ts` : `exportCsvTechniciens(db, boutiqueId, from?, to?)` — rapport activité équipe
- [x] `statsService.ts` : `getRapportComptable(db, boutiqueId, from?, to?)` — TVA par taux + modes paiement
- [x] `routes/stats.ts` : `GET /api/stats/export/csv?type=tickets|ca|techniciens&from=&to=` → text/csv
- [x] `routes/stats.ts` : `GET /api/stats/rapport-comptable?from=&to=` → JSON (admin/gérant)
- [x] `public/stats.html` : filtres date `from`/`to` dans le header (mois courant par défaut)
- [x] `public/stats.html` : bouton "Exporter CA (CSV)" dans onglet CA + widget rapport comptable
- [x] `public/stats.html` : bouton "Exporter tickets (CSV)" dans onglet Tickets
- [x] `public/stats.html` : bouton "Exporter techniciens (CSV)" dans onglet Techniciens
- [x] `public/stats.html` : `loadRapportComptable()` + `exportCsv(type)` — fetch avec JWT, download blob
- [x] **607/607 tests** (15 suites — aucune régression)
- [x] Version bump v2.33.0
- [x] **Déploiement prod v2.33.0**

---

### Sprint 2.34 ✅ — MOD-04 Stock : familles produits + import catalogue fournisseur CSV
**Module CDC : MOD-04 (CRITIQUE)** — v2.34.0 — *6 juillet 2026*

- [x] Migration `0026_produits_famille.sql` : `famille TEXT DEFAULT 'piece'` CHECK + index
- [x] `stockService.ts` : `FamilleProduit` type + `FAMILLES[]` constant
- [x] `stockService.ts` : `listProduits()` → filtre par famille
- [x] `stockService.ts` : `createProduit()` + `updateProduit()` → colonne famille
- [x] `stockService.ts` : `importCatalogueCsv()` — CSV RFC 4180, sep auto `,`/`;`, UPSERT sur SKU, 500 lignes max
- [x] `routes/stocks.ts` : param `famille` dans `GET /api/produits` + `POST /api/produits/import-csv`
- [x] `public/stock.html` : filtres famille (boutons pill), badge couleur par famille, modal import CSV
- [x] `public/static/js/stock.js` : refonte complète — filtre famille API, FAMILLE_CONFIG palette, `importCatalogueCsv()`, `loadCategories()` dynamique
- [x] Tests : 607/607 — `SQL_INSERT_PRODUIT` + `SQL_UPDATE_PRODUIT` mis à jour (ajout colonne `famille`)

---

### Sprint 2.35 ✅ — OAuth Google + réinitialisation mot de passe
**Module CDC : MOD-18 (HAUTE)** — v2.35.0 — *6 juillet 2026*

- [x] Migration `0027_users_google_id.sql` : `ALTER TABLE users ADD COLUMN google_id TEXT` + index unique partiel
- [x] `authService.ts` : `updatePasswordHash()`, `findUserByGoogleId()`, `linkGoogleId()`, `createGoogleUser()`
- [x] `routes/auth.ts` : `GET /api/auth/config` (expose `GOOGLE_CLIENT_ID` public), `POST /api/auth/reset-password-request` (KV TTL 1h + email fire-and-forget), `POST /api/auth/reset-password` (vérif token + PBKDF2 + révocation), `POST /api/auth/google` (tokeninfo Google + find/link/create)
- [x] `public/reset-password.html` : 4 états (demande / envoyé / nouveau mdp / confirmé + lien invalide), jauge force mdp
- [x] `public/login.html` : lien "Mot de passe oublié" → `/reset-password.html` ; bouton Google One Tap via CDN GSI + fallback gracieux si `GOOGLE_CLIENT_ID` absent
- [x] Tests : 607/607 — zéro régression

**Configuration requise en production :**
- Secret `GOOGLE_CLIENT_ID` : `wrangler pages secret put GOOGLE_CLIENT_ID`
- Origines autorisées dans Google Cloud Console : domaine Pages.dev + domaine custom

---

### Sprint 2.36 ✅ — Photos tickets R2 + upload AJAX
**Module CDC : MOD-01 (CRITIQUE) — Upload photos avant/après** — v2.36.0 — *6 juillet 2026*

- [x] Migration `0028_ticket_photos.sql` : table `ticket_photos (id, ticket_id, r2_key, nom_fichier, type_photo [avant/apres/autre], mime_type, taille, created_at, created_by)` + 2 index
- [x] `src/services/photosService.ts` : `uploadPhoto()` (R2 put + D1 insert + audit), `listPhotos()` (ORDER BY type puis date), `getPhotoById()`, `deletePhoto()` (R2 delete + D1 delete), `getTicketForPhoto()`, types `TypePhoto` + constantes `MIME_AUTORISES` / `TAILLE_MAX`
- [x] `wrangler.jsonc` : binding `PHOTOS: R2Bucket` → bucket `izigsm-photos` (optionnel en dev local → 503 gracieux)
- [x] `src/routes/tickets.ts` : `GET /api/tickets/:id/photos`, `POST /api/tickets/:id/photos` (multipart + body brut), `GET /api/tickets/:id/photos/:photoId/view` (proxy R2), `DELETE /api/tickets/:id/photos/:photoId` (admin/manager/technicien)
- [x] `src/index.tsx` : `PHOTOS?: R2Bucket` dans Bindings, version 2.36.0
- [x] `public/tickets.html` : onglet Photos dans modal détail (drag & drop, select avant/apres/autre, galerie 3 sections, progress bar, lightbox, avertissement R2 absent)
- [x] `public/static/js/tickets.js` : `switchDetailTab()`, `loadPhotos()`, `renderGallery()`, `buildPhotoThumb()`, `processPhotoFile()`, `compressImage()` (canvas max 1400px q:0.82), `uploadPhoto()` (FormData JWT), `deletePhotoConfirm()`, `openLightbox()`/`closeLightbox()`, `showToast()`
- [x] 607/607 tests — zéro régression

**Notes déploiement production :**
```bash
# Créer le bucket R2 avant le déploiement
gsk hosted r2_create izigsm-photos   # ou via dashboard CF
# Puis déployer normalement
npm run build && gsk hosted deploy
```

---

### Sprint 2.37 ✅ — RGPD + Archivage tickets
**Module CDC : MOD-01 + conformité légale** — *6 juillet 2026*

- [x] `GET /api/clients/:id/export-rgpd` : export JSON complet données client (RGPD Art. 15 droit d'accès)
- [x] `DELETE /api/clients/:id/purge` : anonymisation RGPD (pseudonymiser nom/email/tel, conserver factures)
- [x] Migration `0029_tickets_archivage_rgpd.sql` : `archived_at DATETIME` + 2 index sur `tickets`
- [x] `POST /api/tickets/:id/archiver` : archivage manuel ticket terminal (livre/annule)
- [x] `GET /api/tickets?archived=true` : liste tickets archivés
- [x] `checkAndArchiveTickets()` — batch auto-archivage tickets livre/annule > 90j (hook 1% GET /tickets)
- [x] UI `clients.html` : footer RGPD dans modal historique (Export + Purge)
- [x] UI `tickets.html` : bouton "📦 Archivés" + bouton "Archiver" conditionnel dans modal
- [x] Tests 607/607 ✅ — ticketService.test.ts mis à jour (SQL constants + archived_at IS NULL)
- [x] Version bump v2.37.0

---

### Sprint 2.38 ✅ — MOD-15 : Référentiel marques/modèles + liaison catalogue services
**Module CDC : MOD-15 (HAUTE) — Catalogue services complet** — *6 juillet 2026*

- [x] Migration `0030_marques_modeles_appareils.sql` : `marques_appareils`, `modeles_appareils`, `service_modeles` (pivot M2M avec prix override)
- [x] `servicesService.ts` : `listMarques()`, `createMarque()`, `updateMarque()`, `deleteMarque()` (cascade modèles)
- [x] `servicesService.ts` : `listModeles()` (filtres marque_id/search/type), `createModele()`, `updateModele()`, `deleteModele()`
- [x] `servicesService.ts` : `getServicesByModele()` (prix COALESCE override), `linkServiceModele()` (ON CONFLICT idempotent), `unlinkServiceModele()`, `getModeleWithServices()`
- [x] `routes/services.ts` : CRUD marques (`GET/POST/PUT/DELETE /api/services/marques/*`)
- [x] `routes/services.ts` : CRUD modèles (`GET/POST/PUT/DELETE /api/services/modeles/*`)
- [x] `routes/services.ts` : liaison (`GET/POST /api/services/modeles/:id/services`, `DELETE /api/services/modeles/:id/services/:sid`)
- [x] `services.html` : onglet "📱 Marques & Modèles" — liste marques + grille modèles + modal liaison services
- [x] `tickets.html` : autocomplete champ Modèle avec suggestions services pré-configurés (debounce 300ms)
- [x] `tests/servicesService.test.ts` : **26 tests** — listMarques, createMarque, updateMarque, deleteMarque, listModeles (3 variantes), createModele, updateModele, deleteModele, getServicesByModele, linkServiceModele, unlinkServiceModele, getModeleWithServices (3 variantes)
- [x] **633/633 tests** ✅ (16 suites)
- [x] Version bump v2.38.0

---

## RGPD — Conformité phase 2 (post-MVP, à planifier)

> Couverture actuelle : droits **sur demande** couverts (Art. 15 export ✅, Art. 17 purge ✅).
> Point de non-conformité principal : **limitation automatique de conservation** (Art. 5.1.e) non implémentée.

### Durées légales applicables

| Catégorie | Durée base active | Base légale | Durée archivage intermédiaire | Fondement |
|---|---|---|---|---|
| Clients (nom, email, tél) | 3 ans après dernier contact | Art. 6.1.b RGPD (contrat) | 5 ans | Prescription civile art. 2224 C.civ. |
| Tickets / réparations | 3 ans après clôture | Art. 6.1.b RGPD | 10 ans | Garantie légale + prescription commerciale |
| Factures | 10 ans | Art. 6.1.c (obligation légale) | Indéfini | Art. L123-22 Code de commerce |
| Devis | 3 ans | Art. 6.1.b RGPD | 5 ans | Prescription civile |
| RDV | 1 an | Art. 6.1.b RGPD | 3 ans | Prescription civile |
| IMEI / numéro de série | Durée ticket associé | Art. 6.1.b RGPD | 5 ans | Art. 321-7 C.pén. (anti-recel) |
| Logs / audit trail | 1 an | Art. 6.1.c (obligation légale) | 1 an | LCEN art. 6-II |

### Fonctionnalités manquantes

- [ ] `checkAndPurgeExpiredClients()` — batch auto-anonymisation clients inactifs > 3 ans (Art. 5.1.e)
- [ ] `checkAndPurgeExpiredTickets()` — batch suppression tickets anonymisés > 10 ans
- [ ] 3 états distincts : **base active** → **archive légale** (accès restreint) → **destruction** (actuellement : 1 seul état actif/inactif)
- [ ] Mention légale dans l'export RGPD : durées de conservation applicables par catégorie
- [ ] Registre des traitements Art. 30 (document externe à tenir manuellement)
- [ ] Tableau de bord admin : suivi des expirations et volumes à purger

### Risque IMEI / anti-recel

L'art. 321-7 C.pén. impose un registre des appareils reçus avec IMEI pendant **5 ans minimum**.
La purge RGPD met l'IMEI à `NULL` → tension légale si contrôle DGCCRF.
Solution : tenir un registre réglementaire séparé (hors CRM) avant d'implémenter la purge automatique IMEI.

---

## Fonctionnalités hors périmètre MVP (post-v3)

| Fonctionnalité | Priorité | Raison |
|---|---|---|
| SMS Twilio | P3 | Coût + complexité, email suffisant MVP |
| WhatsApp Business API | P3 | API payante, non prioritaire |
| Signature eIDAS certifiée | P3 | Tiers de confiance (Yousign), Sprint 4 |
| Paiement Stripe en ligne | P3 | Intégration complexe, hors atelier traditionnel |
| Multi-boutiques réseau (cockpit) | P3 | Infrastructure supplémentaire |
| Import Mobilax / Utopya API | P3 | Partenariats à négocier |
| Scanner codes-barres | P3 | QZ Tray ou WebUSB, Sprint 4 |
| Chatbot RDV IA | P3 | Post-MVP, Cloudflare AI Workers |
| Tableaux de bord personnalisables | P3 | Nice-to-have |
| WebSockets temps réel | P3 | Durable Objects CF, post-MVP |

---

## Résumé coverage CDC (état v2.39.0 en cours)

| Module CDC | Priorité | Couverture | Statut |
|---|---|---|---|
| MOD-01 Tickets + Kanban | CRITIQUE | ~95% | ✅ Complet (photos R2 ✅ Sprint 2.36, archivage RGPD ✅ Sprint 2.37) |
| MOD-02 Facturation NF525 | CRITIQUE | ~95% | ✅ Complet (rapport comptable CSV ✅ Sprint 2.33) |
| MOD-03 Devis + page publique | HAUTE | ~88% | ✅ Complet (manque eIDAS, relance auto) |
| MOD-04 Stock + CUMP | CRITIQUE | ✅ 100% | Familles + import CSV + CUMP |
| MOD-05 Reconditionnement | MOYENNE | ~90% | ✅ Complet |
| MOD-06 Rachats (livre de police) | HAUTE | ~92% | ✅ Complet |
| MOD-07 CRM Clients | HAUTE | ~90% | ✅ Complet (export RGPD Art.15 ✅, purge Art.17 ✅ Sprint 2.37, manque parrainage) |
| MOD-08 Agenda/RDV + iCal | MOYENNE | ~88% | ✅ Complet (manque RDV en ligne public) |
| MOD-09 SAV + Garanties | MOYENNE | ~85% | ✅ Complet |
| MOD-10 Fournisseurs + BC + CUMP | HAUTE | ~90% | ✅ Complet |
| MOD-12 Notifications email | HAUTE | ~75% | ✅ Triggers termine + livre, relances actives |
| MOD-13 Caisse POS NF525 | MOYENNE | ~85% | ✅ Complet |
| MOD-14 Vitrine publique | MOYENNE | ~75% | ✅ Tracking + RDV en ligne public |
| MOD-15 Catalogue services | HAUTE | ~98% | ✅ Sprint 2.38: référentiel marques/modèles + liaison services. 🔜 Sprint 2.39: sync API phone-specs-api (backend ✅, UI ⚠️ partielle) |
| MOD-17 Rapports/Exports | HAUTE | ~90% | ✅ Exports CSV tickets/CA/techniciens + rapport comptable |
| MOD-18 Auth avancée | MOYENNE | ~90% | ✅ Reset password + OAuth Google One Tap |

**Couverture globale estimée CDC : ~90%** (v2.39 en cours — +2% vs v2.38 grâce aux Sprints 2.36/2.37)

---

## Secrets Cloudflare configurés en production

| Secret | Statut | Usage |
|---|---|---|
| `JWT_SECRET` | ✅ Configuré | Auth JWT HMAC-SHA256 |
| `RESEND_API_KEY` | ✅ Configuré | Emails transactionnels |

Secrets à configurer :
```bash
gsk hosted secret_put GOOGLE_CLIENT_ID       # OAuth Google One Tap (Sprint 2.35)
gsk hosted secret_put FRONTEND_URL           # Liens emails reset-password (Sprint 2.35)
gsk hosted secret_put TWILIO_ACCOUNT_SID     # Post-MVP SMS
gsk hosted secret_put TWILIO_AUTH_TOKEN      # Post-MVP SMS
```

---

*Dernière mise à jour : 7 juillet 2026 — Sprint 2.41-A terminé (v2.41.0) — J08/J09/N05 : prise de RDV en ligne — couverture CDC 147/159 = ~93%*
