# iziGSM — TODO & Suivi des Sprints

> Mis à jour automatiquement à chaque avancement de sprint.
> Dernière mise à jour : Sprint 2.5 terminé — 4 juin 2026

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

### Sprint 2.6 🔜 — Agenda / RDV + iCal *(inchangé)*
**Modules CDC : MOD-08 (MOYENNE)**
- [ ] Migration 0015 : table `rendez_vous`
- [ ] `src/services/agendaService.ts` (Model)
- [ ] `src/routes/agenda.ts` (Controller pur)
- [ ] Statuts : PENDING/SCHEDULED/DONE/NO_SHOW/CANCELLED/CONVERTED
- [ ] Liaison RDV → ticket (durée depuis catalogue services Sprint 2.4)
- [ ] Export iCal `.ics` (`webcal://izigsm.fr/api/calendar/:tenant/:token.ics`)
- [ ] `public/agenda.html` : vues jour/semaine/mois
- [ ] `public/static/js/agenda.js`

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

### Sprint 2.13 🔜 — Export PDF + Dashboard graphiques réels
**Module CDC : MOD-17 (HAUTE)**
- [ ] Export PDF factures/tickets (HTML → PDF côté client via `window.print()`)
- [ ] `src/routes/stats.ts` : déplacer `/api/stats` hors `index.tsx` (**violation backlog 🟡**)
- [ ] `src/services/statsService.ts` (Model)
- [ ] Dashboard : Chart.js — CA mensuel réel, tickets par statut, stock bas, marge
- [ ] Rapport activité par technicien
- [ ] Export Excel/CSV rapports avancés

### Sprint 2.14 🔜 — PWA manifest + Service Worker
- [ ] `public/manifest.json`
- [ ] `public/sw.js` : cache offline assets statiques
- [ ] `<link rel="manifest">` dans tous les HTML
- [ ] Install prompt (banner Android/iOS)
- [ ] Icônes PWA (192x192, 512x512)

### Sprint 2.15 🔜 — CRM étendu
**Module CDC : MOD-07 (HAUTE)**
- [ ] Historique consolidé client (tickets + factures + rachats + RDV + SAV)
- [ ] Fix `JOIN tickets` cross-module dans `routes/clients.ts` (**violation backlog 🟡**)
- [ ] `src/services/clientService.ts` (Model)
- [ ] Import CSV clients avec mapping colonnes
- [ ] Parrainage client (`referral_code`, `referred_by`)
- [ ] Score fidélité client

### Sprint 2.16 🔜 — Reconditionnement + Bons d'achat
**Modules CDC : MOD-05 (MOYENNE) + MOD-11 bons d'achat**
- [ ] Migration : table `ordres_reconditionnement`
- [ ] Lien rachat → ordre reconditionnement → stock occasion
- [ ] Calcul coût de revient (pièces + MO)
- [ ] Bons d'achat (geste commercial, expiration configurable)

---

## Backlog violations architecturales (à corriger au fil des sprints)

| Priorité | Fichier | Violation | Sprint cible |
|---|---|---|---|
| 🟡 | `src/index.tsx` | `/api/stats` SQL inline multi-module | Sprint 2.13 |
| 🟡 | `routes/clients.ts` l.41 | `JOIN tickets` cross-module | Sprint 2.15 |
| 🟢 | `routes/*.ts` (anciens) | Documentation fonctions insuffisante | Au fil des sprints |
| 🟢 | `routes/tickets.ts` | Pas de couche `ticketService.ts` | Sprint 2.8 |
| 🟢 | `routes/clients.ts` | Pas de couche `clientService.ts` | Sprint 2.15 |
| 🟢 | `routes/stocks.ts` | Pas de couche `stockService.ts` | Sprint 2.9 |

---

## État technique courant

| Élément | Valeur |
|---|---|
| Version | 2.5.0 |
| Build | `dist/_worker.js` 118.87 kB — 46 modules |
| Dernière migration | `0014_fournisseurs_bons_commande.sql` ✅ |
| Dernier commit | Sprint 2.5 (pending) |
| Branche | `main` |
| PM2 | `izigsm` online — port 3000 |

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
