# iziGSM — Journal des modifications

> **But de ce document** : traçabilité exhaustive de chaque fichier créé ou modifié,
> classé par sprint. Permet à tout développeur (ou IA) de reprendre le projet sans
> avoir à lire l'intégralité du code ou de l'historique git.
>
> **Format** : pour chaque sprint → liste fichiers + rôle + décisions architecturales.
> **Convention** : 🆕 créé | ✏️ modifié | 🗑️ supprimé | 🔧 corrigé bug

---

## Navigation rapide

| Sprint | Thème | Commit |
|---|---|---|
| [2.1](#sprint-21) | Facturation NF525 + Avoirs | — |
| [2.2](#sprint-22) | Livre de police (Rachats) | — |
| [2.3](#sprint-23) | PIN PBKDF2 + Sessions KV | — |
| [Fix DP](#fix-design-patterns) | Design Patterns — audit conformité | `785a0ed` |
| [2.4](#sprint-24) | Catalogue services hiérarchique | `eaee586` |
| [2.5](#sprint-25) | Fournisseurs + Bons de commande + CUMP | — |
| [2.6](#sprint-26) | Agenda / RDV + iCal | — |
| [2.7](#sprint-27) | Vitrine publique + Tracking token | — |
| [2.8](#sprint-28) | Kanban + Statuts pièces + Priorités | `17758d8` |
| [2.9](#sprint-29) | Numérotation configurable + Settings | `4ff076e` |
| [2.10](#sprint-210) | SAV & Garanties | `a0e6480` |
| [2.11](#sprint-211) | Notifications email | `2266d9b` |
| [2.12](#sprint-212) | Caisse POS + Journal NF525 | `d687f8c` |
| [Fix T3](#fix-t3) | Bug garanties FK constraint | `b2f0d78` |
| [Récap 2.12](#recapitulatif-2.12) | Document récapitulatif CDC | `e24d305` |
| [2.13](#sprint-213) | Export PDF + Dashboard Chart.js | `ab88537` |
| [2.14](#sprint-214) | PWA manifest + Service Worker | `0d7cdf6` |
| [Correctif DP](#sprint-correctif-design-pattern) | Conformité design pattern P1/P2/P4 | `f915398` |
| [2.15](#sprint-215) | CRM étendu — clientService + historique + import-csv | `f621703` |
| [2.16](#sprint-216) | Reconditionnement + Bons d'achat | `81b00fa` |
| [2.17](#sprint-217) | Violations P1 soldées : ticketService + stockService | `3b1405d` |
| [2.17-fix](#sprint-217-fix) | Fix login + dashboard KPIs + auto-sélection boutique admin | `869d5ae` |
| [2.18](#sprint-218) | Bugs bloquants SAV + vitrine publique + slug boutique | `0ba5d22` |
| [2.19](#sprint-219) | MOD-03 Devis : endpoints publics + UI complète | Sprint 2.19 |
| [2.20](#sprint-220) | MOD-02 factureService + page publique devis client | Sprint 2.20 |
| [2.21](#sprint-221) | P1 MVC : rachatService + personnelService + userService | Sprint 2.21 |

---

## Sprint 2.1

**Thème** : Facturation NF525 + Avoirs  
**Objectif** : Conformité CGI art. 289, verrouillage post-émission, chaîne SHA-256

| Fichier | Action | Description |
|---|---|---|
| `migrations/0010_facturation_nf525.sql` | 🆕 | `locked`, `issued_at`, `tracking_token` sur factures + tables `avoirs` + `lignes_avoir` |
| `src/lib/db.ts` | ✏️ | `nextNumero()` étendu : `avoir → AV-AAAA-XXXXX`, `rachat → LP-AAAA-XXXXX` |
| `src/lib/nf525.ts` | 🆕 | Chaîne SHA-256 séquentielle pour NF525 — Web Crypto API |
| `src/routes/factures.ts` | ✏️ | `POST /api/factures/:id/emettre` : locked=1, hash NF525, UUID tracking |
| `src/routes/avoirs.ts` | 🆕 | `GET /api/avoirs`, `POST /api/avoirs`, `GET /api/avoirs/:id` |
| `public/static/js/factures.js` | ✏️ | Badges 🔒, bouton Émettre, modal création Avoir |

**Décisions** :
- Hash NF525 = `SHA-256(previous_hash + montant + numero + date)` — chaîne rompt si modification
- Avoirs référencent `facture_id` obligatoire — pas d'avoir sans facture source

---

## Sprint 2.2

**Thème** : Livre de police (Rachats)  
**Objectif** : Conformité art. 321-7 Code pénal, 30 champs obligatoires

| Fichier | Action | Description |
|---|---|---|
| `migrations/0011_rachats.sql` | 🆕 | Table `rachats` (30 colonnes) + 6 index |
| `src/routes/rachats.ts` | 🆕 | GET list, GET :id, POST (validations art. 321-7 + doublon IMEI), PATCH /statut, GET /export CSV |
| `public/rachats.html` | 🆕 | Interface livre de police avec filtres et statuts |
| `public/static/js/rachats.js` | 🆕 | 650 lignes — ApiService, validation IMEI, export CSV |
| `public/static/js/app.js` | ✏️ | Ajout `apiPatch()` + entrée sidebar "Livre de police" |

**Décisions** :
- Doublon IMEI détecté à 30 jours — alerte non bloquante (revendeur peut racheter même appareil)
- Export CSV : `GET /api/rachats/export` retourne `Content-Type: text/csv` avec BOM UTF-8

---

## Sprint 2.3

**Thème** : PIN PBKDF2 + Sessions KV + Permissions granulaires  
**Objectif** : Sécuriser les actions critiques (caisse, avoirs, remises) avec PIN

| Fichier | Action | Description |
|---|---|---|
| `migrations/0012_pin_permissions.sql` | 🆕 | `pin_hash`, `pin_actif` sur `users` + table `permissions` |
| `src/routes/users.ts` | ✏️ | PIN set/verify/delete/status/reset + permissions GET/PUT |
| `src/lib/middleware.ts` | ✏️ | `requirePin()` middleware + `hasPermission()` |
| `src/index.tsx` | ✏️ | `usersRoutes` monté, ordre routes corrigé (health avant routes dynamiques) |
| `public/static/js/app.js` | ✏️ | `requirePinAction()` + `confirmPin()` modal PIN global |

**Décisions** :
- PIN stocké PBKDF2-SHA256, format `100000:salt_hex:hash_hex` — compatible Web Crypto Workers
- Session PIN TTL 15 min en KV — évite ressaisie à chaque action
- `requirePin` = middleware optionnel (pas dans la chaîne globale, appelé explicitement)

---

## Fix Design Patterns

**Commit** : `785a0ed`  
**Contexte** : Audit conformité suite à la définition des 5 principes architecturaux

| Fichier | Action | Violation corrigée |
|---|---|---|
| `src/routes/users.ts` | 🔧 | Suppression query SQL morte dans `GET /users` |
| `public/static/js/rachats.js` | 🔧 | `getBoutiqueId()` direct sans ternaire défensif (P4) |
| `public/static/js/factures.js` | 🔧 | `getBoutiqueId()` direct sans ternaire défensif (P4) |
| `src/index.tsx` | 🔧 | Health check `/api/health` remonté AVANT les routes dynamiques |
| `public/static/js/app.js` | 🔧 | Doublon `apiPut` (l.427 + l.442) → gardé l.427 uniquement (P5) |
| `public/static/js/app.js` | ✏️ | Ajout `apiPostPublic()` (sans Bearer) + `apiBlobGet()` (download blob) |
| `public/static/js/register.js` | 🔧 | `fetch('/api/register')` → `apiPostPublic('/api/register')` (P5) |
| `public/static/js/rachats.js` | 🔧 | `fetch(url)` export CSV → `apiBlobGet('/api/rachats/export')` (P5) |
| `docs/PRINCIPES.md` | 🆕 | Formalisation des 5 principes architecturaux iziGSM |

---

## Sprint 2.4

**Commit** : `eaee586`  
**Thème** : Catalogue services hiérarchique  
**Premier module avec couche Model (Service) complète — référence d'implémentation**

| Fichier | Action | Description |
|---|---|---|
| `migrations/0013_services.sql` | 🆕 | Tables `categories_services` (arbre parent/enfant) + `services` (10 index) |
| `src/services/servicesService.ts` | 🆕 | **Premier Model layer** du projet — toute logique SQL externalisée ici |
| `src/lib/validators.ts` | 🆕 | Validation centralisée : `validateService()`, `validateCategorie()`, `validateTicket()`, `validateClient()` |
| `src/routes/services.ts` | 🆕 | Controller pur — 0 SQL inline, délègue tout à servicesService |
| `src/index.tsx` | ✏️ | Mount `servicesRoutes` |
| `public/services.html` | 🆕 | Layout split sidebar/grille, modals catégorie + service, color picker HSL |
| `public/static/js/services.js` | 🆕 | Rendu arbre hiérarchique, filtres, drag-and-drop catégorie, ApiService |

**Décisions** :
- `servicesService.ts` = référence d'implémentation du pattern MVC pour tous les sprints suivants
- `validators.ts` centralisé dans `src/lib/` — les routes importent uniquement `validateXxx()`
- Arbre catégories : `parent_id = NULL` pour racine, récursivité via requête SQL `LEFT JOIN`

---

## Sprint 2.5

**Thème** : Fournisseurs + Bons de commande + CUMP  
**Objectif** : MOD-10 + calcul CUMP (Coût Unitaire Moyen Pondéré) sur réception

| Fichier | Action | Description |
|---|---|---|
| `migrations/0014_fournisseurs.sql` | 🆕 | Tables `fournisseurs` + `bons_commande` + `lignes_bon_commande` + colonne `prix_achat_cump` sur `produits` |
| `src/services/fournisseursService.ts` | 🆕 | Model — CRUD fournisseurs, CRUD BC, réception + calcul CUMP, KPIs, vue "À commander" |
| `src/lib/validators.ts` | ✏️ | Ajout `validateFournisseur()`, `validateBonCommande()` avec validation par ligne |
| `src/routes/fournisseurs.ts` | 🆕 | Controller pur — 12 endpoints, 0 SQL inline |
| `src/index.tsx` | ✏️ | Mount `fournisseursRoutes` |
| `public/fournisseurs.html` | 🆕 | 3 onglets (BC / Fournisseurs / À commander), KPIs, 3 modales |
| `public/static/js/fournisseurs.js` | 🆕 | 650+ lignes — pré-remplissage BC depuis "À commander", ApiService |

**Décisions** :
- CUMP = `(stock_actuel × prix_achat_cump + quantite_recue × prix_achat_ligne) / (stock_actuel + quantite_recue)`
- Numérotation BC : `BC-AAAA-XXXXX` via `MAX(numero) + 1` en D1
- Vue "À commander" : `WHERE stock_actuel <= stock_minimum AND actif=1`

---

## Sprint 2.6

**Thème** : Agenda / RDV + iCal  
**Objectif** : MOD-08 — planning interventions, export calendrier

| Fichier | Action | Description |
|---|---|---|
| `migrations/0015_agenda.sql` | 🆕 | Tables `rendez_vous` + `boutique_ical_tokens` |
| `src/services/agendaService.ts` | 🆕 | Model — CRUD, vue calendrier, KPIs, génération iCal RFC 5545 |
| `src/routes/agenda.ts` | 🆕 | Controller pur — 9 endpoints + 1 route iCal publique |
| `src/index.tsx` | ✏️ | Fix critical : route iCal montée AVANT `authMiddleware` global |
| `public/agenda.html` | 🆕 | Vues semaine (grille horaire 08h-20h) + liste + 3 modales |
| `public/static/js/agenda.js` | 🆕 | Navigation semaine, KPIs, détail + actions statut |

**Décisions** :
- Route iCal `GET /api/calendar/:token.ics` = publique (sans JWT) → déclarée AVANT `app.use('*', authMiddleware)`
- Token iCal stable par boutique : `boutique_ical_tokens` — changement invalidation volontaire uniquement
- Fin RDV auto-calculée : `debut + duree_minutes` si `fin` non fourni

---

## Sprint 2.7

**Thème** : Vitrine publique + Tracking token  
**Objectif** : MOD-14 — page publique suivi réparation + vitrine services

| Fichier | Action | Description |
|---|---|---|
| `src/routes/public.ts` | 🆕 | Routes sans auth : `GET /api/public/ticket/:token`, `GET /api/public/catalogue/:slug` |
| `src/index.tsx` | ✏️ | Mount routes publiques AVANT authMiddleware |
| `public/suivi.html` | 🆕 | Page tracking `/suivi/:token` — statut avancement, sans authentification |
| `public/pro.html` | 🆕 | Vitrine `/pro/:slug` — catalogue services public (placeholder) |

---

## Sprint 2.8

**Commit** : `17758d8`  
**Thème** : Kanban tickets + Statuts pièces + Priorités  
**Objectif** : MOD-01 — 8 statuts complets, Kanban drag & drop, indicateurs ancienneté

| Fichier | Action | Description |
|---|---|---|
| `migrations/0016_tickets_statuts.sql` | 🆕 | 3 statuts manquants : `TO_ORDER`, `ORDERED`, `PARTS_RECEIVED` + contrainte CHECK |
| `src/routes/tickets.ts` | ✏️ | `GET /api/tickets/kanban` — données groupées par statut |
| `public/tickets.html` | ✏️ | Vue Kanban 8 colonnes + vue liste existante |
| `public/static/js/tickets.js` | ✏️ | Drag & drop vanilla JS entre colonnes Kanban, indicateurs ancienneté (vert/orange/rouge/alerte) |

**Décisions** :
- 8 statuts : `recu → diagnostic → en_reparation → to_order → ordered → parts_received → termine → livre`
- Indicateurs ancienneté : vert <2j, orange 3–7j, rouge >7j, alerte >14j (CSS classes)
- Drag & drop : `dragstart/dragover/drop` natifs — pas de lib externe

---

## Sprint 2.9

**Commit** : `4ff076e`  
**Thème** : Numérotation configurable + Settings tenant  
**Objectif** : MOD-02 + MOD-18 — préfixe et format configurables par boutique

| Fichier | Action | Description |
|---|---|---|
| `migrations/0017_config_tenant.sql` | 🆕 | Table `config_tenant` : préfixe, séparateur, format_date, nb_chiffres, types appareils (JSON) |
| `src/services/configService.ts` | 🆕 | Model — CRUD config, `nextNumeroDynamique()` depuis config tenant |
| `src/routes/config.ts` | 🆕 | Controller pur — GET/PUT config tenant |
| `src/lib/db.ts` | ✏️ | `nextNumero()` → délègue à `configService.nextNumeroDynamique()` |
| `public/settings.html` | ✏️ | Onboarding numérotation, types appareils configurables, aperçu temps réel |
| `public/static/js/settings.js` | ✏️ | Formulaire config + aperçu live format numéro |

---

## Sprint 2.10

**Commit** : `a0e6480`  
**Thème** : SAV & Garanties  
**Objectif** : MOD-09 — dossiers SAV, garanties depuis factures, alertes expiry

| Fichier | Action | Description |
|---|---|---|
| `migrations/0018_sav_garanties.sql` | 🆕 | Tables `garanties` + `tickets_sav` + `retours_client` + `rma_fournisseurs` |
| `src/services/savService.ts` | 🆕 | Model — CRUD garanties, dossiers SAV, alertes expiry <30j/<7j, retours, RMA |
| `src/routes/sav.ts` | 🆕 | Controller pur — endpoints SAV + garanties |
| `src/index.tsx` | ✏️ | Mount `savRoutes` + version `2.10.0` |
| `public/sav.html` | 🆕 | Onglets Garanties / SAV / Retours / RMA |
| `public/static/js/sav.js` | 🆕 | Gestion dossiers + alertes |

---

## Sprint 2.11

**Commit** : `2266d9b`  
**Thème** : Notifications email  
**Objectif** : MOD-12 — Resend API, 4 templates, hooks automatiques sur changement statut

| Fichier | Action | Description |
|---|---|---|
| `migrations/0019_notifications.sql` | 🆕 | Table `email_logs` — historique envois |
| `src/services/notifService.ts` | 🆕 | Model — envoi Resend, 4 templates, logs, hooks automatiques |
| `src/routes/notifications.ts` | 🆕 | Controller — GET logs, POST test |
| `src/routes/tickets.ts` | ✏️ | Hook `notifService.onStatutChange()` à chaque PATCH /statut |
| `src/routes/factures.ts` | ✏️ | Hook `notifService.onFactureEmise()` à chaque POST /emettre |
| `public/communications.html` | 🆕 | Gestion templates email, historique logs |

**Décisions** :
- `RESEND_API_KEY` stocké via `wrangler secret put RESEND_API_KEY` (jamais dans le code)
- En l'absence de clé Resend, `notifService` simule l'envoi (log + retour `{ simulated: true }`)

---

## Sprint 2.12

**Commit** : `d687f8c`  
**Thème** : Caisse POS + Journal NF525  
**Objectif** : MOD-13 — interface POS, journal chaîné SHA-256, clôture irréversible

| Fichier | Action | Description |
|---|---|---|
| `migrations/0019_caisse.sql` | 🆕 | Tables `sessions_caisse` + `journal_caisse` (note : migration renommée si conflit avec 0019_notif) |
| `src/services/caisseService.ts` | 🆕 | Model — ouverture/clôture session, ventes multi-lignes, journal NF525 chaîné |
| `src/routes/caisse.ts` | 🆕 | Controller pur — ouverture, vente, clôture, vérification intégrité |
| `src/index.tsx` | ✏️ | Mount `caisseRoutes` + version `2.12.0` |
| `public/caisse.html` | 🆕 | Interface POS 3 onglets : vente / clôture / historique |
| `public/static/js/caisse.js` | 🆕 | Gestion session, ligne articles, 4 modes paiement, rendu ticket reçu |

**Décisions** :
- Journal NF525 caisse = même pattern que factures : `SHA-256(prev_hash + montant + timestamp + session_id)`
- Clôture = `locked=1` + hash final — irrévocable (même mécanisme CGI factures)
- `requirePin('acces_caisse')` obligatoire à l'ouverture de session caisse

---

## Fix T3

**Commit** : `b2f0d78`  
**Contexte** : Bug FK constraint sur `createGarantie()` — `ticket_id` obligatoire alors que les garanties peuvent exister sans ticket (vente directe)

| Fichier | Action | Description |
|---|---|---|
| `src/services/savService.ts` | 🔧 | `ticket_id = NULL` accepté — contrainte FK retirée de l'INSERT |
| `src/services/savService.ts` | 🔧 | `date_fin` calculé côté JS (`date_debut + garantie_mois × 30j`) si non fourni |

---

## Récapitulatif 2.12

**Commit** : `e24d305`  
**Contexte** : Document de suivi demandé pour reprendre la session au Sprint 2.13

| Fichier | Action | Description |
|---|---|---|
| `docs/RECAPITULATIF_SPRINT_2.12.md` | 🆕 | Tableau 18 modules CDC : fait/validé, à corriger, reste à faire |

---

## Sprint 2.13

**Commit** : `ab88537`  
**Thème** : Export PDF + Dashboard Chart.js  
**Objectif** : MOD-17 — PDF factures/tickets, dashboard graphiques réels

| Fichier | Action | Description |
|---|---|---|
| `src/services/statsService.ts` | 🆕 | Model stats — 6 fonctions : `getKpisDashboard`, `getCaMensuel`, `getTicketsParStatut`, `getTopProduits`, `getActiviteRecente`, `getRapportTechnicien` |
| `src/routes/stats.ts` | 🆕 | Controller pur — 6 endpoints `/api/stats/*`, 0 SQL inline |
| `src/index.tsx` | ✏️ | Mount `statsRoutes` après `caisseRoutes` + suppression du bloc `/api/stats` SQL inline (violation résolue) + version `2.13.0` |
| `public/static/css/print.css` | 🆕 | CSS impression A4 (210×297 mm) + ticket thermique 80 mm. Classes : `.print-header`, `.print-table`, `.print-totaux`, `.print-ticket`, `.print-footer`, `.print-badge` |
| `public/dashboard.html` | ✏️ | Refonte complète : Chart.js CDN, grille 4 KPI cards avec badges évolution, barchart CA, doughnut statuts, section techniciens + top produits + activité |
| `public/static/js/dashboard.js` | ✏️ | Refonte complète : module `window.DashApp` avec `init()` + `refresh()`, 6 loaders asynchrones, auto-refresh 5 min |
| `public/static/js/factures.js` | ✏️ | `printFacture(id)` implémenté — PDF via `window.print()` |
| `public/static/js/tickets.js` | ✏️ | `printTicket(id)` + `window._currentTicketId` + bouton 🖨 dans modal |
| `public/tickets.html` | ✏️ | Bouton `<button onclick="printTicket(window._currentTicketId)">🖨 Imprimer</button>` dans modal footer |

**Corrections bugs appliquées lors des tests** :

| Erreur D1 | Cause | Correction |
|---|---|---|
| `no such column: p.reference` | Colonne s'appelle `sku` | `p.sku as reference` |
| `no such column: p.cump` | S'appelle `prix_achat_cump` | Corrigé dans alias + calcul marge |
| `no such column: t.assigned_to` | S'appelle `technicien_id` | `t.technicien_id` |
| `no such column: u.role` | `role_id` + table `roles` séparée | `LEFT JOIN roles r ON r.id=u.role_id` |
| `no such column: t.actif` | Colonne absente dans `tickets` | Suppression `AND t.actif=1` |

---

## Sprint 2.14

**Commit** : `0d7cdf6`  
**Thème** : PWA manifest + Service Worker offline  
**Objectif** : Application installable A2HS, cache offline

| Fichier | Action | Description |
|---|---|---|
| `public/manifest.json` | 🆕 | Manifest W3C — 10 icônes SVG, `start_url: /dashboard.html`, 3 shortcuts (Ticket/Caisse/Agenda), `theme_color: #6366f1`, `display: standalone` |
| `public/sw.js` | 🆕 | Service Worker 3 stratégies : Network First (API), Cache First (App Shell 24 fichiers), Stale-While-Revalidate (CDN). Messages : `SKIP_WAITING`, `CLEAR_CACHE` |
| `public/static/js/pwa.js` | 🆕 | IIFE auto-exécutée — SW registration, `beforeinstallprompt`, install banner A2HS, update banner, indicateur hors-ligne |
| `public/favicon.svg` | 🆕 | SVG 32×32 — lettre "i" fond violet `#6366f1` |
| `public/_routes.json` | 🆕 | **Fix critique** : `include: ["/api/*"]`, exclut `/static/*`, `/*.html`, `/manifest.json`, `/sw.js`, `/favicon.svg` — résout HTTP 500 sur assets statiques (Worker Hono interceptait toutes les routes `/*`) |
| `public/static/img/icon-72.svg` | 🆕 | Icône PWA 72px |
| `public/static/img/icon-96.svg` | 🆕 | Icône PWA 96px |
| `public/static/img/icon-128.svg` | 🆕 | Icône PWA 128px |
| `public/static/img/icon-144.svg` | 🆕 | Icône PWA 144px |
| `public/static/img/icon-152.svg` | 🆕 | Icône PWA 152px |
| `public/static/img/icon-192.svg` | 🆕 | Icône PWA 192px (any) |
| `public/static/img/icon-maskable-192.svg` | 🆕 | Icône PWA 192px maskable (safe zone) |
| `public/static/img/icon-384.svg` | 🆕 | Icône PWA 384px |
| `public/static/img/icon-512.svg` | 🆕 | Icône PWA 512px (any) |
| `public/static/img/icon-maskable-512.svg` | 🆕 | Icône PWA 512px maskable |
| `public/static/img/apple-touch-icon.svg` | 🆕 | Apple Touch Icon 180px (iOS) |
| `public/*.html` (23 fichiers) | ✏️ | Injection dans `<head>` : `<link rel="manifest">`, `<meta name="theme-color">`, `<link rel="icon">`, `<link rel="apple-touch-icon">`. Et avant `</body>` : `<script src="/static/js/pwa.js">` |

**Décisions** :
- `_routes.json` = solution officielle Cloudflare Pages pour exclure des routes du Worker
- Service Worker version : `'izigsm-v2.14'` — à incrémenter à chaque déploiement avec changements assets
- Cache App Shell précache 24 fichiers à l'install — les routes API restent toujours Network First

---

## Sprint correctif Design Pattern

**Commit** : `f915398`  
**Contexte** : Audit design pattern post-Sprints 2.13-2.14 — violations P1/P2/P4 identifiées et corrigées  
**Voir aussi** : `docs/PRINCIPES.md` pour la définition des 5 principes

### Principe 1 — Modularité (exception documentée)

| Fichier | Action | Description |
|---|---|---|
| `src/services/statsService.ts` | ✏️ | Ajout bloc d'en-tête `⚠️ EXCEPTION ARCHITECTURE` — justifie l'agrégation multi-modules (reporting lecture seule). Référence `docs/PRINCIPES.md §Exception-Reporting` |

### Principe 2 — Centralisation des helpers (`app.js`)

**Problème** : `_money()` dupliqué dans `factures.js` + `dashboard.js`, `_fmtDate()` dans `factures.js`, `_fmtDateTk()` dans `tickets.js` — 3 implémentations divergentes pour la même logique.

**Solution** : source unique dans `app.js`, suppression des copies locales.

| Fichier | Action | Description |
|---|---|---|
| `public/static/js/app.js` | ✏️ | **Ajout de 3 helpers centralisés** :<br>`_money(n, symbol?)` — format euros fr-FR, paramètre `symbol=false` pour axes Chart.js<br>`_fmtDate(iso)` — date jj/mm/aaaa fr-FR<br>`_fmtDateTime(iso)` — date + heure fr-FR (ex-`_fmtDateTk`) |
| `public/static/js/factures.js` | 🔧 | Suppression `_money()` local + `_fmtDate()` local → remplacés par les versions `app.js` |
| `public/static/js/dashboard.js` | 🔧 | Suppression `_money()` local → version `app.js` utilisée (accessible via scope global depuis IIFE) |
| `public/static/js/tickets.js` | 🔧 | Suppression `_fmtDateTk()` local → `_fmtDateTime()` de `app.js`. Mise à jour usage dans template print |

### Principe 4 — JSDoc obligatoire sur les fonctions publiques

**Problème** : chaque fichier avait exactement 1 bloc `/**` (en-tête de fichier), 0 sur les fonctions individuelles.

| Fichier | Action | Fonctions documentées |
|---|---|---|
| `src/services/statsService.ts` | ✏️ | `getKpisDashboard`, `getCaMensuel`, `getTicketsParStatut`, `getTopProduits`, `getActiviteRecente`, `getRapportTechnicien` — chacune avec `@param` + `@returns` |
| `src/routes/stats.ts` | ✏️ | `ctx()` + 6 handlers — chacun avec `@query` + `@returns` |
| `public/static/js/dashboard.js` | ✏️ | `init()`, `refresh()`, `_setDate()`, `_setUser()`, `_loadKpis()`, `_buildAlerts()`, `_loadCaMensuel()`, `_loadTicketsStatut()`, `_loadTopProduits()`, `_loadActivite()`, `_loadTechniciens()`, `_setText()`, `_esc()`, `_ago()` |

### Principe 4 — Refactoring fonctions trop longues (> 3 niveaux imbrication)

**Problème** : `printFacture()` (~180 lignes) et `printTicket()` (~155 lignes) — logique imbriquée 4 niveaux (try → fetch → template → ternaire).

**Solution** : découpage en 3 fonctions spécialisées par responsabilité.

| Avant | Après | Responsabilité |
|---|---|---|
| `printFacture(id)` 180L | `printFacture(id)` ~8L | Orchestration — appelle les 3 sous-fonctions |
| *(inline)* | `_fetchFacturePrintData(id)` ~55L | Appels API + normalisation données |
| *(inline)* | `_buildFactureHTML(data)` ~80L | Construction template HTML (sans logique conditionnelle > 2 niveaux) |
| *(inline)* | `_triggerPrint(html)` ~20L | Injection DOM + `window.print()` + cleanup |
| `printTicket(id)` 155L | `printTicket(id)` ~8L | Orchestration |
| *(inline)* | `_fetchTicketPrintData(id)` ~50L | Appels API + normalisation |
| *(inline)* | `_buildTicketHTML(data)` ~70L | Construction template fiche |
| *(partagé)* | `_triggerPrint(html)` | Réutilisé depuis `factures.js` |

> **Note** : `_triggerPrint()` est défini dans `factures.js` et appelé depuis `tickets.js`.
> Les deux fichiers sont chargés dans les pages concernées — pas de dépendance circulaire.

---

## Colonnes DB importantes — Pièges connus

> Section de référence pour éviter les erreurs SQL récurrentes.

| Table | Colonne correcte | Colonne ERRONÉE (ne pas utiliser) |
|---|---|---|
| `produits` | `sku` | ~~`reference`~~ |
| `produits` | `prix_achat_cump` | ~~`cump`~~ |
| `tickets` | `technicien_id` | ~~`assigned_to`~~ |
| `users` | `role_id` (FK → `roles.id`) | ~~`role`~~ (string direct absent) |
| `tickets` | *(pas de colonne `actif`)* | ~~`actif`~~ |

**Pour le rôle d'un user** : `LEFT JOIN roles r ON r.id = u.role_id` puis utiliser `r.nom`.

---

## Constantes et formats critiques

| Élément | Valeur | Notes |
|---|---|---|
| Login response | `{ accessToken, refreshToken, expiresIn, user }` à la **racine** | Pas dans `data:{}` — différent du format P5 standard |
| JWT payload | `sub` pour l'id user | Pas `id` — `user.sub` dans les routes |
| `requireRole` signature | `requireRole('admin', 'gerant')` | Variadique — **pas** `requireRole(['admin', 'gerant'])` |
| `getBoutiqueId` signature | `getBoutiqueId(user, searchParams.get('boutique_id') ?? undefined)` | Dans les routes Hono |
| Hash mot de passe | `100000:salt_hex(32):hash_hex(64)` | PBKDF2-SHA256, `deriveBits(256)` = 32 octets = 64 hex |
| Service Worker cache | `'izigsm-v2.14'` | Incrémenter à chaque déploiement avec changements assets |
| `_routes.json` | `include: ["/api/*"]` | Cloudflare Pages — évite Worker sur fichiers statiques |

---

*Document créé le 8 juin 2026 — Post-Sprint correctif Design Pattern (commit `f915398`)*
*Maintenu manuellement — mettre à jour à chaque sprint terminé*

## Sprint 2.15

**Thème** : CRM étendu — Model layer + historique consolidé + import CSV  
**Commit** : `f621703`  
**Date** : 15 juin 2026  

| Fichier | Action | Description |
|---|---|---|
| `src/services/clientService.ts` | 🆕 créé | Model layer CRM complet : `listClients` (sous-requête COUNT tickets P1), `getClient`, `createClient`, `updateClient`, `deleteClient`, `addAppareil`, `getHistoriqueClient` (Promise.all tickets+factures+rdv+kpis), `importClients` (dédup email), `getKpis`. Fix colonnes DB : `factures` (statut != ANNULE), `rachats` (pas client_id → []), `rendez_vous` (type_rdv as type) |
| `src/routes/clients.ts` | ✏️ réécriture | Controller pur 0 SQL (8 endpoints). ctx() refactorisé : `queryBoutiqueId` séparé, chaque handler POST combine `body.boutique_id ?? queryBoutiqueId`. Route `/import-csv` déclarée avant `/:id`. |
| `src/index.tsx` | 🔧 corrigé | Montage `app.route('/api/clients', clientsRoutes)` — était `/api`, causait `/:id` à capturer la liste |
| `public/clients.html` | ✏️ réécriture | Refonte complète : 4 KPIs, table 8 colonnes, modal client (prénom/nom séparés), modal historique (4 onglets : Tickets / Factures / Rachats / RDV + KPIs synthèse), modal import CSV (3 étapes : drop zone → mapping → résultat) |
| `public/static/js/clients.js` | ✏️ réécriture | 30 316 chars JSDoc complet (P4). `viewHistorique()` → `GET /api/clients/:id/historique`. `doImportCsv()` → `POST /api/clients/import-csv`. CSV_FIELD_MAP 9 colonnes avec aliases (prénom/prenom/firstname…). State module. Helpers privés documentés (`_fullName`, `_initials`, `_avatarColor`). Usage `_money()` / `_fmtDate()` de app.js (P2). |

### Décisions architecturales

- **Violation P1 résolue** : le `LEFT JOIN tickets` inline dans `routes/clients.ts` est remplacé par une sous-requête `(SELECT COUNT(*) FROM tickets WHERE client_id=c.id)` dans `clientService.ts`. Aucun cross-module avec retour de données.
- **Violation P1 résolue** : création de `clientService.ts` — `routes/clients.ts` ne contient plus de SQL.
- **Routing fix** : pattern `app.route('/api/clients', clientsRoutes)` identique à `ticketsRoutes`. Avant : `app.route('/api')` avec handlers `/` et `/:id` causait confusion avec les autres routers.
- **rachats** : pas de colonne `client_id` (table livre de police vendeur, non liée au CRM client) → `Promise.resolve({ results: [] })` dans `getHistoriqueClient`.

### Tests Sprint 2.15

| Test | Endpoint | Résultat |
|---|---|---|
| T1 | `GET /api/clients?boutique_id=1` | ✅ 8 clients, nb_tickets OK |
| T2 | `POST /api/clients` | ✅ id: 7 |
| T3 | `GET /api/clients/:id/historique` | ✅ kpis + tickets + factures + rdv |
| T4 | `POST /api/clients/import-csv` | ✅ inserted: 2, skipped: 0 |
| T5 | `PUT /api/clients/:id` | ✅ |
| T6 | `POST /api/clients/:id/appareils` | ✅ id: 7 |
| T7 | `DELETE /api/clients/:id` | ✅ |

---

## Sprint 2.16

**Thème** : Reconditionnement + Bons d'achat  
**Commit** : `81b00fa`  
**Date** : 15 juin 2026  

| Fichier | Action | Description |
|---|---|---|
| `migrations/0021_reconditionnement_bons_achat.sql` | 🆕 créé | Tables `ordres_reconditionnement` (colonne `cout_revient GENERATED ALWAYS AS (prix_rachat + cout_main_oeuvre + cout_pieces) STORED`, machine états `brouillon→en_cours→termine|abandonne`, grade A–D) + `bons_achat` (code `BA-XXXXXXXX` unique sans I/O/1/0, statuts `actif→utilise|expire|annule`, expiration) |
| `src/services/reconditionnementService.ts` | 🆕 créé | Model layer 14 fonctions exportées avec JSDoc P4 complet : ordres (`listOrdres`, `getOrdre`, `createOrdre`, `updateOrdre`, `updateStatutOrdre`, `terminerOrdre` → crée produit occasion en stock, `getKpisReconditionnement`) + bons (`listBonsAchat`, `getBonAchat`, `createBonAchat`, `verifierBonAchat` lecture seule caisse, `consommerBonAchat` partiel/total, `annulerBonAchat`). Helpers privés : `genererCodeBon()` + `genererCodeUnique()` 5 tentatives. |
| `src/routes/reconditionnement.ts` | 🆕 créé | **2 routers distincts** (P1) : `reconditionnementRoutes` (7 endpoints `/api/reconditionnement`) + `bonsAchatRoutes` (6 endpoints `/api/bons-achat`). Séparation évite collision `/:id` vs `/bons-achat/*`. Pattern `ctx()` helper identique aux autres controllers. 0 SQL inline (P3). |
| `src/index.tsx` | ✏️ modifié | Import 2 routers + montages explicites `app.route('/api/reconditionnement', reconditionnementRoutes)` + `app.route('/api/bons-achat', bonsAchatRoutes)`. Version `2.16.0`. |
| `public/reconditionnement.html` | 🆕 créé | 2 onglets (Ordres de reconditionnement / Bons d'achat), 4 KPIs (ordres actifs, terminés ce mois, bons actifs, CA généré), modal CRUD ordre, modal terminer (prix vente + grade → création produit), modal création bon, modal vérification code caisse. Pattern HTML identique aux autres pages (manifest, topbar, sidebar-placeholder, data-table, modal-dialog). |
| `public/static/js/reconditionnement.js` | 🆕 créé | View JSDoc P4 : `switchTab`, `loadKpis`, `loadOrdres`, `loadBons`, `openNewOrdre`, `openEditOrdre`, `updateCoutRevient` (calcul temps réel), `submitOrdre`, `changerStatutOrdre`, `openTerminerOrdre`, `submitTerminer`, `openNewBon`, `submitBon`, `doVerifierBon`, `annulerBon`. 0 `fetch` direct (P2) — 100% via `apiGet`/`apiPost`/`apiPut`/`apiPatch` de `app.js`. |
| `public/static/js/app.js` | ✏️ modifié | Entrée sidebar `{ id:'reconditionnement', icon:'🔄', label:'Reconditionnement', href:'reconditionnement.html', section:'gestion' }` ajoutée entre rachats et clients. |

### Décisions architecturales

- **2 routers séparés** : un router unique avec routes `/bons-achat/*` montées via `app.route('/api')` causait que `GET /api/bons-achat` était capturé par le handler `GET /:id` (interprétait `"bons-achat"` comme valeur de paramètre). Solution définitive : `reconditionnementRoutes` monté sur `/api/reconditionnement` + `bonsAchatRoutes` monté sur `/api/bons-achat`.
- **Colonne générée** : `cout_revient REAL GENERATED ALWAYS AS (prix_rachat + cout_main_oeuvre + cout_pieces) STORED` — calcul garanti en DB, jamais recalculé côté JS, cohérence absolue.
- **`terminerOrdre`** crée automatiquement un produit occasion dans le catalogue avec `SKU = OCC-{numero}`, `prix_achat_ht = cout_revient`, `stock_actuel = 1`. Si `produit_id_existant` fourni, incrémente le stock existant sans créer de doublon.
- **`verifierBonAchat`** = lecture seule (ne consomme pas) — utilisé en caisse avant encaissement pour afficher le solde disponible sans l'engager.
- **`genererCodeBon()`** exclut les caractères I, O, 1, 0 pour éviter toute ambiguïté visuelle lors de la saisie manuelle en caisse.

### Tests Sprint 2.16

| Test | Endpoint | Résultat |
|---|---|---|
| T1 | `GET /api/reconditionnement?boutique_id=1` | ✅ liste OK |
| T2 | `GET /api/reconditionnement/kpis?boutique_id=1` | ✅ 4 KPIs |
| T3 | `POST /api/reconditionnement` | ✅ RC-2026-00003, `cout_revient=90` |
| T4 | `PATCH /api/reconditionnement/:id/statut` | ✅ `brouillon→en_cours` |
| T5 | `POST /api/reconditionnement/:id/terminer` | ✅ `statut=termine`, `produit_id=10` créé |
| T5b | `GET /api/bons-achat?boutique_id=1` | ✅ après correction routing (2 routers) |
| T6 | `POST /api/bons-achat` | ✅ code `BA-N9MWGRT6`, `montant=30` |
| T7 | `POST /api/bons-achat/verifier` | ✅ `valide=true`, `solde=30` |
| T8 | `GET /api/bons-achat/:id` | ✅ détail complet |

---

## Sprint 2.17

**Thème** : Violations P1 soldées — couches Model pour Tickets et Stock  
**Commit** : `3b1405d`  
**Date** : 15 juin 2026  

| Fichier | Action | Description |
|---|---|---|
| `src/services/ticketService.ts` | 🆕 créé | Model layer tickets (7 fonctions exportées) : `listTickets` (filtres statut/technicien/client/search + pagination), `getKanban` (10 colonnes + indicateurs ancienneté + stats), `getTicketById` (+ historique + photos via `Promise.all`), `createTicket` (génère numéro + tracking_token + historique initial), `updateTicket` (COALESCE, valide priorité), `updateStatutTicket` (machine à états TRANSITIONS_TICKET, champs date associés, historique), `deleteTicket` (soft delete). Helpers privés : `genererTrackingToken()` Web Crypto, `couleurAnciennete()`. JSDoc P4 complet. |
| `src/services/stockService.ts` | 🆕 créé | Model layer stock (9 fonctions exportées) : `listProduits` (filtres + marge % + `alerte_stock`), `getProduitById` (+ 20 derniers mouvements), `createProduit` (mouvement entree automatique si stock > 0), `updateProduit` (COALESCE), `deleteProduit` (soft delete), `enregistrerMouvement` (4 types : entree/sortie/ajustement/inventaire, garde délta effectif en DB), `listCategories` (avec `nb_produits`), `createCategorie`, `getKpisStock` (valeur stock HT + CUMP + ruptures + alertes). JSDoc P4 complet. |
| `src/routes/tickets.ts` | ✏️ refactorisé | Controller pur 0 SQL. Import `ticketService`. Pattern `ctx()` helper. Hooks cross-service conservés non bloquants : `createGarantieFromTicket` (SAV) + `sendTicketTermine` (email) au passage en `termine`. 346 lignes → 246 lignes (- 100L de SQL). |
| `src/routes/stocks.ts` | ✏️ refactorisé | Controller pur 0 SQL. Import `stockService`. Pattern `ctx()` helper. Nouveau endpoint `GET /api/produits/kpis` (segment fixe avant `/:id`). 194 lignes → 196 lignes (logique métier déplacée dans service). |

### Décisions architecturales

- **Complétude du backlog P1** : `ticketService.ts` + `stockService.ts` soldent les 2 dernières violations P1 référencées dans le backlog. **Tous les modules ont désormais leur couche Model** : tickets, stocks, clients, fournisseurs, agenda, garanties, caisse, stats, reconditionnement, config.
- **TRANSITIONS_TICKET exporté** : la map des transitions est exportée depuis le service (pas dupliquée dans la route) — la route consulte le service pour connaître l'état précédent et les transitions via `updateStatutTicket`.
- **Hooks cross-service non déplacés** : `createGarantieFromTicket` et `sendTicketTermine` restent dans la route (pas dans le service) car ils créent des dépendances inter-modules — la route est le bon niveau d'orchestration pour les effets secondaires.
- **`GET /api/produits/kpis`** : nouvel endpoint ajouté à l'occasion du refactoring — valeur stock HT et CUMP en un seul appel.

### Tests Sprint 2.17

| Test | Endpoint | Résultat |
|---|---|---|
| T1 | `GET /api/tickets?boutique_id=1` | ✅ 6 tickets, pagination OK |
| T2 | `GET /api/tickets/kanban?boutique_id=1` | ✅ 10 colonnes, stats actifs/urgents |
| T3 | `GET /api/tickets/1` | ✅ fiche + historique + photos |
| T4 | `PUT /api/tickets/1/statut` `en_reparation→termine` | ✅ + garantie créée |
| T4c | Transition invalide `termine→en_reparation` | ✅ 422 Transition invalide |
| T5 | `GET /api/produits?boutique_id=1` | ✅ 10 produits, alerte_stock OK |
| T6 | `GET /api/produits/kpis?boutique_id=1` | ✅ ruptures/alertes/valeur_ht |
| T7 | `POST /api/produits/1/mouvement` `sortie` | ✅ stock_avant:12 → stock_apres:11 |
| T8 | `GET /api/categories?boutique_id=1` | ✅ 8 catégories |


---

## Sprint 2.17-fix

**Titre** : Fix login + dashboard KPIs — auto-sélection boutique pour admin  
**Commits** : `a6c075a` (fix login) + `953bf02` (fix redirections html) + `869d5ae` (fix KPIs)  
**Date** : 15 juin 2026  

### Problèmes corrigés

#### Bug 1 — Fausse authentification login.html
**Symptôme** : login sans erreur mais état d'authentification incorrect / ERR_CONNECTION_FAILED  
**Cause** : `login.html` utilisait un tableau `DEMO_USERS` hardcodé avec `Admin1234` (majuscule) — n'appelait jamais `POST /api/auth/login`  
**Fix** : Remplacement complet du handler par `fetch('/api/auth/login', ...)` + stockage session format `izigsm_session` attendu par `app.js`

#### Bug 2 — ERR_FAILED sur dashboard.html après login
**Symptôme** : Page "Ce site est inaccessible / ERR_FAILED" après redirection post-login  
**Cause** : `window.location.href = '/dashboard.html'` → wrangler émet 308 Redirect vers `/dashboard` → sur sandbox, le 2ème hop réseau échoue  
**Fix** : Suppression de toutes les extensions `.html` dans les redirections JS (7 occurrences dans 3 fichiers)

#### Bug 3 — Dashboard KPIs tous à 0
**Symptôme** : Dashboard accessible, tickets: 0, CA: 0€, clients: 0, stock_bas: 0  
**Cause** :
1. Admin `boutique_id: null` en base (rôle multi-boutiques sans boutique assignée)
2. `dashboard.js` appelle `apiGet('/api/stats')` sans paramètre `boutique_id`
3. `getBoutiqueId()` retourne `null` pour l'admin → `apiGet` n'injecte pas `boutique_id`
4. `statsService` reçoit `boutique_id` null → retourne données vides

**Fix en 2 couches** :
- `login.html` : après login réussi, si `user.boutique_id === null`, appel `GET /api/boutiques` (avec le token obtenu) pour récupérer la première boutique disponible et renseigner `boutique_id`/`boutique_name` dans la session `localStorage` avant la redirection
- `app.js apiGet()` : auto-injection de `boutique_id` via `getBoutiqueId()` si absent des paramètres et de l'URL — protège tous les futurs appels sans toucher aux views

**Résultat** : KPIs dashboard affichent les vraies données — `tickets_en_cours: 5`, `ca_mois: 70.03€`, `nb_clients: 8`, `stock_bas: 1`

#### Bonus — Hashes PBKDF2 seed.sql
**Cause** : `seed.sql` contenait des placeholders `$2b$12$SEED_*_HASH_PLACEHOLDER` (format bcrypt fictif) — incompatible avec `verifyPassword()` qui attend le format PBKDF2 `100000:salt:hash`  
**Fix** : Remplacement par de vrais hashes PBKDF2-SHA256 (100 000 itérations) pour `Admin@2026!` — tous les utilisateurs de test (admin, manager, tech1, tech2)

### Fichiers modifiés

| Fichier | Action | Description |
|---|---|---|
| `public/login.html` | ✏️ modifié | Fix auth réelle `POST /api/auth/login` + redirect `/dashboard` sans `.html` + auto-sélection boutique si `user.boutique_id === null` |
| `public/static/js/app.js` | ✏️ modifié | `apiGet()` auto-injecte `boutique_id` depuis `getBoutiqueId()` + 5× `/login.html` → `/login` |
| `public/static/js/personnel.js` | ✏️ modifié | 2× `/login.html` → `/login` |
| `public/static/js/sav.js` | ✏️ modifié | 1× `/login.html` → `/login` |
| `public/sw.js` | ✏️ modifié | Cache `izigsm-v2.14` → `izigsm-v2.17` |
| `seed.sql` | ✏️ modifié | Hashes PBKDF2 réels pour `Admin@2026!` — remplace placeholders bcrypt fictifs |

### Tests de non-régression

| Test | Résultat |
|---|---|
| `POST /api/auth/login admin@izigsm.fr / Admin@2026!` | ✅ `success: true`, token JWT retourné |
| `GET /api/boutiques` avec token admin | ✅ `[{id:1, nom:"iziGSM Paris 11"}]` |
| `GET /api/stats?boutique_id=1` | ✅ `tickets_en_cours:5, ca_mois:70.03, nb_clients:8, stock_bas:1` |
| Build production | ✅ 225.24 kB, 62 modules |
| Redirect `/dashboard` (sans .html) | ✅ Pas de 308, page accessible |

---

## Sprint 2.18

**Titre** : Corrections bugs bloquants post-audit — SAV + vitrine publique + slug boutique  
**Commit** : `0ba5d22`  
**Date** : 17 juin 2026  

### Contexte

Audit complet des modules post-Sprint 2.17 ayant révélé 3 bugs bloquants :
1. `GET /api/sav` → `D1_ERROR: near "to": syntax error` (alias SQL réservé)
2. `GET /api/public/ticket/:token` → `statut_label` retournait la valeur brute (ex: `recu`) au lieu du libellé FR
3. `GET /api/public/boutique/:slug` → `404 Boutique introuvable` car colonne `slug` NULL en base

Audit également révélé que `GET /api/notifications/stats|logs` fonctionnait correctement — le faux positif était dû à un test sur `/api/notifications` (root sans sous-chemin).

### Fichiers modifiés

| Fichier | Action | Description |
|---|---|---|
| `src/services/garantiesService.ts` | ✏️ modifié | Alias `to` (mot réservé SQLite) → `t_orig` dans `listSav()` (L433) et `getSav()` (L479) — 2 LEFT JOIN concernés |
| `src/routes/public.ts` | ✏️ modifié | `STATUT_CLIENT` map redesignée : clés MAJUSCULES (RECEIVED…) → minuscules (recu, en_diagnostic, attente_accord, a_commander, commande, pieces_recues, en_reparation, termine, livre, annule) alignées sur machine à états `ticketService` |
| `src/routes/boutiques.ts` | ✏️ modifié | `POST /api/boutiques` : auto-génération slug depuis `nom` (minuscules, espaces→tirets, accents normalisés) |
| `migrations/0022_slug_boutiques.sql` | 🆕 créé | `UPDATE boutiques SET slug = ...` pour les boutiques existantes sans slug |
| `seed.sql` | ✏️ modifié | INSERT boutique avec `slug = 'izigsm-paris-11'` |

### Tests Sprint 2.18

| Test | Endpoint | Résultat |
|---|---|---|
| T1 | `GET /api/sav?boutique_id=1` | ✅ success (était D1_ERROR SQLITE_ERROR) |
| T2 | `GET /api/sav/kpis?boutique_id=1` | ✅ success |
| T3 | `GET /api/public/ticket/:token` | ✅ `statut_label=Reçu` (était `recu` brut) |
| T4 | `GET /api/public/boutique/izigsm-paris-11` | ✅ `boutique=iziGSM Paris 11` (était 404) |
| T5 | `GET /api/public/catalogue/izigsm-paris-11` | ✅ catalogue 0 catégories (boutique sans services) |
| T6 | `GET /api/notifications/stats?boutique_id=1` | ✅ `provider=resend` |
| T7 | `GET /api/garanties?boutique_id=1` | ✅ `total=3` |


---

## Sprint 2.19

**Titre** : MOD-03 Devis — complétion complète (endpoints publics + UI)  
**Commit** : Sprint 2.19  
**Date** : 17 juin 2026  

### Contexte

Sprint de complétion du module Devis (MOD-03). Le service `devisService.ts` et les 9 routes de `facturation.ts` avaient été créés en fin de Sprint 2.19 précédent. Il restait à ajouter :
1. Les 2 endpoints publics (sans auth) dans `public.ts` — consultation et réponse client
2. L'UI complète `devis.html` + `devis.js` — KPIs, modal détail, badges statuts, boutons selon état

### Fichiers modifiés

| Fichier | Action | Description |
|---|---|---|
| `src/routes/public.ts` | ✏️ modifié | Import `devisService` ; CORS étendu aux méthodes POST ; 2 nouveaux endpoints sans auth : `GET /api/public/devis/:token` (consultation + statut FR + `peut_repondre`) et `POST /api/public/devis/:token/repondre` (machine à états côté client, enregistrement `signature_client`) |
| `public/devis.html` | ✏️ modifié | Ajout section KPIs `#devis-stats` ; filtres statuts en valeurs minuscules alignées API ; modal détail `#modal-devis-detail` avec body/footer dynamiques ; champ TVA dans le formulaire |
| `public/static/js/devis.js` | ✏️ modifié | Réécriture complète 31 kB — `STATUT_DEVIS` badges map ; `loadDevisStats()` + `kpiCard()` ; `openDevisDetail()` avec lignes + boutons selon statut ; `openEditDevis()` pour modification brouillon ; `envoyerDevis()` ; `changerStatutDevis()` ; `annulerDevis()` ; `buildRowActions()` selon statut ; `addLine(prefill?)` avec champ TVA caché ; `updateDevisTotals()` multiTVA |

### Décisions architecturales

- **Endpoint `GET /api/public/devis/:token`** : retourne uniquement `client_prenom` (pas le nom complet) pour préserver la confidentialité — le client connaît son prénom
- **Vérification expiration inline** : même si le statut DB est encore `envoye`, on vérifie `date_validite < now()` → `peut_repondre: false` + `est_expire: true` retournés au frontend sans modifier le statut DB (la mise à jour est assurée par le cron `POST /api/devis/expire`)
- **userId = 0** pour les actions publiques : `updateStatutDevis(db, id, 0, action, true)` — l'audit log enregistre `user_id=0` et `action='PUBLIC_STATUT_DEVIS'` pour traçabilité
- **`signature_client`** : stockée brute (max 1 000 chars) — permettra d'afficher dans le PDF "Accepté le JJ/MM/AAAA par [prénom]"
- **CORS POST activé** : `allowMethods: ['GET', 'POST', 'OPTIONS']` sur `pub.use('/*', cors(...))` — nécessaire pour `POST /api/public/devis/:token/repondre` depuis la page d'acceptation

### Tests Sprint 2.19

| Test | Endpoint | Résultat |
|---|---|---|
| T1 | `GET /api/devis/stats?boutique_id=1` | ✅ KPIs 7 champs (total, draft, envoyes, acceptes, refuses, montants, taux) |
| T2 | `POST /api/devis` | ✅ `DEV-2026-00004`, `public_token` 32 chars, 2 lignes |
| T3 | `GET /api/devis/1` | ✅ statut=draft, 2 lignes, `total_ttc=208.8` |
| T4 | `PUT /api/devis/1/statut {statut:envoye}` | ✅ `draft → envoye` |
| T5 | `POST /api/devis/1/envoyer` (depuis envoye) | ✅ rejet correct `Transition invalide : envoye → envoye` |
| T6 | `GET /api/public/devis/:token` (sans auth) | ✅ `peut_repondre=true`, `statut_label=En attente`, 2 lignes |
| T7 | `POST /api/public/devis/:token/repondre {action:accepte}` | ✅ `envoye → accepte`, message FR |
| T8 | `PUT /api/devis/2/convertir` (devis accepté) | ✅ `FAC-2026-00012`, `facture_id=6` |

---

## Sprint 2.20

**Titre** : MOD-02 Facturation — Model layer `factureService` + page publique devis client  
**Commit** : Sprint 2.20  
**Date** : 29 juin 2026  

### Contexte

Sprint en deux axes :
1. **Page publique `/devis-public`** : page HTML autonome sans auth pour qu'un client accepte ou refuse son devis via son `public_token` — complète la machine à états devis côté client
2. **`factureService.ts` P1** : extraction de toutes les requêtes SQL inline de la section Factures/Avoirs de `facturation.ts` (36 appels SQL → 0) vers une couche service dédiée — conformité stricte P1 MVC

### Fichiers modifiés

| Fichier | Action | Description |
|---|---|---|
| `public/devis-public.html` | 🆕 créé | Page HTML autonome sans auth (TailwindCSS CDN + FontAwesome). 4 sections : `#loading-section` (spinner), `#error-section` (token invalide), `#devis-section` (affichage complet + boutons), `#repondu-section` (terminal). Lecture token depuis URL path ou querystring. Appels `GET /api/public/devis/:token` + `POST .../repondre`. |
| `src/services/factureService.ts` | 🆕 créé | Model layer P1 — 7 fonctions exportées : `listFactures`, `getFacture`, `ajouterPaiement`, `emettreFacture`, `listAvoirs`, `getAvoir`, `createAvoir`. Toute la logique SQL + NF525 centralisée ici. JSDoc complet. |
| `src/routes/facturation.ts` | ✏️ modifié | Section Factures/Avoirs refactorisée : 36 SQL inline → 6 routes controller pures (0 SQL), imports `listFactures` / `getFacture` / `ajouterPaiement` / `emettreFacture` / `listAvoirs` / `getAvoir` / `createAvoir`. Import `enregistrerTransaction` restauré pour la route `PUT /devis/:id/convertir`. |
| `src/index.tsx` | ✏️ modifié | Version `2.16.0` → `2.20.0` dans le health check `/api/health`. |

### Décisions architecturales

- **`factureService.ts` couche Model P1** : les routes `facturation.ts` section factures/avoirs étaient les dernières à contenir du SQL inline — ce sprint les nettoie complètement. Toute modification SQL passe désormais par le service.
- **`ajouterPaiement`** : calcule le nouveau statut (`payee` / `partiellement_payee`) à partir de `montant_paye + input.montant` vs `total_ttc`. La mise à jour `date_paiement` est conditionnelle (CASE WHEN) pour n'enregistrer la date que si entièrement payée.
- **`emettreFacture`** : génère le `tracking_token` via `crypto.randomUUID()` (Web Crypto, compatible Cloudflare Workers). Enchaîne `enregistrerTransaction()` puis verrouille la facture en une seule UPDATE.
- **`createAvoir`** : vérifie que la facture source est `locked=1` avant de créer l'avoir — les avoirs ne peuvent être émis que sur factures émises (conformité NF525).
- **Page `/devis-public`** : servie automatiquement par wrangler Pages depuis `public/` sans route Hono explicite. Accès via `/devis-public` (308 redirect depuis `/devis-public.html`).

### Tests Sprint 2.20

| Test | Endpoint | Résultat |
|---|---|---|
| T1 | `GET /api/factures?boutique_id=1` | ✅ 6 factures |
| T2 | `GET /api/factures/1` | ✅ détail complet, lignes=0 |
| T3 | `GET /api/avoirs?boutique_id=1` | ✅ 0 avoirs (base vide) |
| T4 | `POST /api/factures/1/paiement {montant:50,mode:carte}` | ✅ `montant_paye=50`, `statut=payee` |
| T5 | `POST /api/factures/5/emettre` | ✅ `FAC-2026-00011` émise, `hash_nf525` 64 chars, `tracking_token` UUID |
| T6 | `POST /api/avoirs {facture_id:5,type:remboursement,...}` | ✅ `AV-2026-00001` créé, `hash_nf525` chaîné NF525 |
| T7 | `GET /devis-public?token=62a2fcb...` | ✅ HTTP 200, HTML page publique servie |
| T7b | `GET /api/public/devis/:token` | ✅ `num=DEV-2026-00007`, `statut=envoye`, `peut_repondre=True`, 1 ligne |
| T8 | `POST /api/public/devis/:token/repondre {action:accepte}` | ✅ `statut=accepte`, `peut_repondre=False`, `repondu_le` enregistré |

---

## Sprint 2.21

**Titre** : Conformité P1 MVC — rachatService + personnelService + userService  
**Commit** : Sprint 2.21  
**Date** : 29 juin 2026  

### Contexte

Audit SQL inline sur toutes les routes : `rachats.ts` (12 `.prepare`), `personnel.ts` (12), `users.ts` (11) n'avaient pas encore de couche service dédiée. Ce sprint crée les 3 services manquants et refactorise les routes correspondantes en controllers purs (0 SQL).

Résultat après Sprint 2.21 : **12 routes à 0 SQL** — seules `auth.ts` (9), `boutiques.ts` (12), `public.ts` (7), `facturation.ts` (2 résidus `convertirDevis`), `tickets.ts` (3), `notifications.ts` (3) et `sav.ts` (1) contiennent encore du SQL inline.

### Fichiers créés

| Fichier | Action | Description |
|---|---|---|
| `src/services/rachatService.ts` | 🆕 créé | Model P1 — 5 fonctions : `listRachats`, `getRachat`, `createRachat`, `updateStatutRachat`, `exportLivrePolice`. Constantes exportées : `PIECES_VALIDES`, `ETATS_VALIDES`, `MODES_PAIEMENT_VALIDES`, `STATUTS_VALIDES`. Doublon IMEI via erreur typée `{ code: 'DOUBLON_IMEI', doublon_id }`. |
| `src/services/personnelService.ts` | 🆕 créé | Model P1 — 8 fonctions : CRUD employés + machine à états pointage + `pointagesAujourdhui` (calcul heures JS pur) + `rapportPointage` + `statutsTempsReel` (groupé par statut). Constantes `TRANSITIONS_POINTAGE` + `STATUT_LABELS`. |
| `src/services/userService.ts` | 🆕 créé | Model P1 — 8 fonctions : cycle de vie PIN PBKDF2 (`setPIN`/`verifyPIN`/`deletePIN`/`getPINStatus`/`resetPINAdmin`), permissions granulaires (`getPermissions`/`setPermissions` avec batch upsert), `listUsers` admin/manager. `ACTIONS_VALIDES` (8 actions) exporté. |

### Fichiers refactorisés

| Fichier | Action | Avant → Après |
|---|---|---|
| `src/routes/rachats.ts` | ✏️ refactorisé | 12 `.prepare` → 0 — 5 routes controller pures |
| `src/routes/personnel.ts` | ✏️ refactorisé | 12 `.prepare` → 0 — 9 routes controller pures |
| `src/routes/users.ts` | ✏️ refactorisé | 11 `.prepare` → 0 — 7 routes controller pures |
| `src/index.tsx` | ✏️ modifié | Version `2.20.0` → `2.21.0`, sprint label mis à jour |

### Décisions architecturales

- **Erreurs typées avec `code`** : les services lancent des erreurs enrichies d'un `code` (`DOUBLON_IMEI`, `JOURNEE_TERMINEE`, `TRANSITION_INVALIDE`, `PIN_INCORRECT`, `NO_PIN`, `NOT_FOUND`, `FORBIDDEN`) — les routes mappent ces codes sur les statuts HTTP appropriés sans logique métier
- **`pointer()` en service** : la machine à états pointage (transitions validées, insertion en `pointages`, mise à jour `employes.statut_pointage`) est entièrement dans le service — la route `POST /pointage/:id/pointer` est une simple passe avant
- **`setPermissions()` batch** : upsert de toutes les permissions en une seule `db.batch()` — évite N requêtes séquentielles
- **`getPINStatus` parallel** : `Promise.all([db.prepare..., kv.get...])` — DB et KV interrogés simultanément
- **Constantes exportées depuis le service** : `PIECES_VALIDES`, `STATUTS_VALIDES`, `ACTIONS_VALIDES` etc. définis dans les services et importés dans les routes — source unique de vérité, pas de duplication entre route et service

### Tests Sprint 2.21

| Test | Endpoint | Résultat |
|---|---|---|
| T1 | `GET /api/rachats?boutique_id=1` | ✅ 0 rachats (base vide) |
| T2 | `POST /api/rachats` | ✅ `LP-2026-00001` créé (art. 321-7) |
| T3 | `GET /api/employes?boutique_id=1` | ✅ 3 employés avec statut_pointage |
| T4 | `POST /api/pointage/1/pointer` | ✅ `absent → en_poste` — Lucas Dubois |
| T5 | `GET /api/pointage/statuts?boutique_id=1` | ✅ résumé `{en_poste:1, absent:2}` |
| T6 | `POST /api/users/pin/set {pin:"1234"}` | ✅ PIN PBKDF2 défini |
| T7 | `POST /api/users/pin/verify {pin:"1234"}` | ✅ session KV 15min ouverte |
| T7b | `GET /api/users/pin/status` | ✅ `pin_actif=True, session_active=True` |
| T8 | `PUT /api/users/1/permissions` | ✅ 3 permissions upsertées |
