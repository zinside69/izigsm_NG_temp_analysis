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

