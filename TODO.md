# iziGSM — TODO & Suivi des Sprints

> Mis à jour automatiquement à chaque avancement de sprint.
> Dernière mise à jour : Sprint 2.4 ✅

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

### Sprint 2.5 🔜 — Fournisseurs + Bons de commande + CUMP
- [ ] Migration 0014 : table `fournisseurs` + `bons_commande` + `lignes_bon_commande`
- [ ] `src/services/fournisseursService.ts` (Model)
- [ ] `src/lib/validators.ts` : `validateFournisseur()`, `validateBonCommande()`
- [ ] `src/routes/fournisseurs.ts` (Controller pur)
- [ ] CUMP : calcul Coût Unitaire Moyen Pondéré à la réception
- [ ] `public/fournisseurs.html` + `public/static/js/fournisseurs.js`
- [ ] Liaison bons de commande → mouvements stock à la réception

### Sprint 2.6 🔜 — Agenda / RDV + iCal
- [ ] Migration 0015 : table `rendez_vous`
- [ ] `src/services/agendaService.ts` (Model)
- [ ] `src/routes/agenda.ts` (Controller pur)
- [ ] Liaison RDV → ticket (durée depuis catalogue services Sprint 2.4)
- [ ] Export iCal `.ics`
- [ ] `public/agenda.html` : vue semaine/mois
- [ ] `public/static/js/agenda.js`

### Sprint 2.7 🔜 — Vitrine publique + Tracking token
- [ ] Page publique `/suivi/:token` (sans auth)
- [ ] `src/routes/public.ts` : endpoint public `GET /api/public/ticket/:token`
- [ ] QR code sur fiche ticket (tracking_token)
- [ ] `public/suivi.html` : page status ticket client

### Sprint 2.8 🔜 — Caisse POS + Journal NF525
- [ ] Migration 0016 : table `sessions_caisse` + `journal_caisse`
- [ ] `src/services/caisseService.ts` (Model)
- [ ] `src/routes/caisse.ts` (Controller pur)
- [ ] Journal NF525 : chaîne SHA-256 continue
- [ ] `requirePin` sur accès caisse (`acces_caisse`)
- [ ] `public/caisse.html` : interface POS tactile

### Sprint 2.9 🔜 — Flux métier complets + Photos R2
- [ ] Liaison ticket → service catalogue (Sprint 2.4)
- [ ] Upload photos R2 sur tickets
- [ ] `src/services/photosService.ts` (Model)
- [ ] Signature client sur ticket (canvas)

### Sprint 2.10 🔜 — Export PDF + Dashboard graphiques
- [ ] Export PDF factures/tickets (HTML → PDF côté client)
- [ ] `src/routes/stats.ts` : déplacer `/api/stats` hors `index.tsx` (**violation backlog**)
- [ ] `src/services/statsService.ts` (Model)
- [ ] Dashboard : Chart.js — CA mensuel, tickets par statut, stock bas

### Sprint 2.11 🔜 — PWA manifest + Service Worker
- [ ] `public/manifest.json`
- [ ] `public/sw.js` : cache offline assets
- [ ] `<link rel="manifest">` dans tous les HTML
- [ ] Install prompt

### Sprint 2.12 🔜 — CRM étendu
- [ ] Historique complet client (tickets + factures + rachats)
- [ ] Fix `JOIN tickets` cross-module dans `routes/clients.ts` (**violation backlog**)
- [ ] `src/services/clientService.ts` (Model)
- [ ] Campagnes SMS/email (via API tierce)
- [ ] Score fidélité client

---

## Backlog violations architecturales (à corriger au fil des sprints)

| Priorité | Fichier | Violation | Sprint cible |
|---|---|---|---|
| 🟡 | `src/index.tsx` | `/api/stats` SQL inline multi-module | Sprint 2.10 |
| 🟡 | `routes/clients.ts` l.41 | `JOIN tickets` cross-module | Sprint 2.12 |
| 🟢 | `routes/*.ts` (anciens) | Documentation fonctions insuffisante | Au fil des sprints |
| 🟢 | `routes/tickets.ts` | Pas de couche `ticketService.ts` | Sprint 2.9 |
| 🟢 | `routes/clients.ts` | Pas de couche `clientService.ts` | Sprint 2.12 |
| 🟢 | `routes/stocks.ts` | Pas de couche `stockService.ts` | Sprint 2.9 |

---

## État technique courant

| Élément | Valeur |
|---|---|
| Version | 2.4.0 |
| Build | `dist/_worker.js` 104.73 kB — 44 modules |
| Dernière migration | `0013_services.sql` ✅ |
| Dernier commit | `eaee586` — Sprint 2.4 |
| Branche | `main` |
| PM2 | `izigsm` online — port 3000 |
