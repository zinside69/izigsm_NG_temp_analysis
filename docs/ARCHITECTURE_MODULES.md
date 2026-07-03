# iziGSM — Architecture des Modules & Liens Fonctionnels

> **Version** : 2.0  
> **Mise à jour** : 3 juillet 2026 — v2.28.0  
> **Stack** : Hono TypeScript + Cloudflare Workers + D1 SQLite + D1KV (remplacement KV) + R2 (planifié Sprint 2.36)

---

## 1. Vue d'ensemble — Architecture globale

```
┌─────────────────────────────────────────────────────────────────────┐
│  FRONTEND (HTML/JS statique — Cloudflare CDN mondial)               │
│                                                                     │
│  app.js ──────── apiGet / apiPost / apiPut / apiPatch / apiDelete   │
│                  Wrapper api() → { ok, status, data, error }        │
│                  Auth : localStorage izigsm_session → boutique_id   │
│                  0 axios — 0 ApiService — 0 JWT dans le code        │
│                                                                     │
│  Pages HTML (public/)                                               │
│  ├─ dashboard.html   ── dashboard.js        (KPIs + Chart.js)       │
│  ├─ tickets.html     ── tickets.js          (liste + CRUD)          │
│  ├─ kanban.html      ── kanban.js           (vue kanban drag&drop)  │
│  ├─ clients.html     ── clients.js          (CRM + import CSV)      │
│  ├─ stock.html       ── stock.js            (produits + mouvements) │
│  ├─ factures.html    ── factures.js         (facturation + avoirs)  │
│  ├─ devis.html       ── devis.js            (devis + conversion)    │
│  ├─ caisse.html      ── caisse.js           (POS tactile)           │
│  ├─ agenda.html      ── agenda.js           (calendrier + RDV)      │
│  ├─ sav.html         ── sav.js              (garanties + tickets SAV│
│  ├─ fournisseurs.html── fournisseurs.js     (BC + CUMP)             │
│  ├─ personnel.html   ── personnel.js        (pointage équipe)       │
│  ├─ services.html    ── services.js         (catalogue hiérarchique)│
│  ├─ rachats.html     ── rachats.js          (livre de police)       │
│  ├─ reconditionnement.html ── reconditionnement.js                  │
│  ├─ stats.html       ── (inline)            (graphiques Chart.js)   │
│  ├─ notifications.html ── (inline)          (journal emails)        │
│  ├─ settings.html    ── (inline)            (paramètres tenant)     │
│  ├─ suivi.html       ── (inline)            (tracking client PUBLIC)│
│  ├─ devis-public.html── (inline)            (réponse devis PUBLIC)  │
│  └─ login/register/verify-email.html                               │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTPS fetch() — session izigsm_session
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  BACKEND Hono TypeScript (src/) — Cloudflare Worker Edge            │
│                                                                     │
│  src/index.tsx — Point d'entrée, montage routes, health check       │
│  src/middleware.ts — authMiddleware, requireRole, requirePin,       │
│                       getBoutiqueId, hasPermission                  │
│  src/lib/db.ts — nextNumero(), auditLog(), parsePagination(),       │
│                   calculLignes(), sha256()                          │
│  src/lib/d1kv.ts — D1KVNamespace, createD1KV(), d1KvCleanup()      │
│                     (remplacement KV — stocke OTP + refresh tokens) │
│                                                                     │
│  Routes (src/routes/) — Controllers PURS — 0 SQL inline            │
│  ├─ auth.ts          → /api/auth/*           (8 endpoints)          │
│  ├─ public.ts        → /api/public/*         (6 endpoints, sans auth│
│  ├─ facturation.ts   → /api/devis/* + /api/factures/* + /api/avoirs/│
│  │                                           (28 endpoints)         │
│  ├─ rachats.ts       → /api/rachats/*        (9 endpoints)          │
│  ├─ fournisseurs.ts  → /api/fournisseurs/* + /api/bons-commande/*   │
│  │                                           (22 endpoints)         │
│  ├─ agenda.ts        → /api/agenda/* + /api/calendar/*.ics          │
│  │                                           (12 endpoints)         │
│  ├─ users.ts         → /api/users/*          (16 endpoints)         │
│  ├─ services.ts      → /api/services/* + /api/services/categories/* │
│  │                                           (19 endpoints)         │
│  ├─ tickets.ts       → /api/tickets/*        (8 endpoints)          │
│  ├─ stocks.ts        → /api/produits/* + /api/categories/*          │
│  │                                           (10 endpoints)         │
│  ├─ sav.ts           → /api/garanties/* + /api/sav/*               │
│  │                                           (11 endpoints)         │
│  ├─ notifications.ts → /api/notifications/*  (8 endpoints)          │
│  ├─ caisse.ts        → /api/caisse/*         (13 endpoints)         │
│  ├─ stats.ts         → /api/stats/*          (9 endpoints)          │
│  ├─ clients.ts       → /api/clients/*        (9 endpoints)          │
│  ├─ personnel.ts     → /api/employes/* + /api/pointage/*            │
│  │                                           (14 endpoints)         │
│  └─ boutiques.ts     → /api/boutiques/*      (15 endpoints)         │
│  + reconditionnement.ts → /api/reconditionnement/* + /api/bons-achat│
│                                                                     │
│  Services (src/services/) — Models — TOUT le SQL ici               │
│  ├─ authService.ts          — 8 fonctions auth + inscription        │
│  ├─ boutiqueService.ts      — 8 fonctions CRUD boutiques + settings │
│  ├─ clientService.ts        — 9 fonctions CRM + historique + import │
│  ├─ ticketService.ts        — 9 fonctions tickets + kanban + statuts│
│  ├─ stockService.ts         — 9 fonctions produits + mouvements     │
│  ├─ factureService.ts       — 7 fonctions factures + avoirs NF525   │
│  ├─ devisService.ts         — 9 fonctions devis + page publique     │
│  ├─ garantiesService.ts     — 10 fonctions SAV + garanties          │
│  ├─ agendaService.ts        — 10 fonctions RDV + iCal RFC 5545      │
│  ├─ fournisseursService.ts  — 12 fonctions BC + CUMP + réception    │
│  ├─ caisseService.ts        — caisse POS + journal NF525            │
│  ├─ statsService.ts         — 6 fonctions KPIs + graphiques         │
│  ├─ emailService.ts         — Resend API + logs + relances          │
│  ├─ personnelService.ts     — 8 fonctions employés + pointage       │
│  ├─ userService.ts          — 8 fonctions PIN + permissions         │
│  ├─ rachatService.ts        — 5 fonctions livre de police           │
│  ├─ reconditionnementService.ts — 14 fonctions ordres + bons achat  │
│  ├─ servicesService.ts      — catalogue services hiérarchique       │
│  └─ publicService.ts        — 7 fonctions vitrine publique sans auth│
└──────────────────────────┬──────────────────────────────────────────┘
                           │ D1 prepare().bind().run() — SQLite edge
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CLOUDFLARE D1 — SQLite distribué (même PoP que le Worker)          │
│  DB name : 8096d010-efde-413e-a481-72226566aa0b-db                  │
│  DB ID   : 85f74dc6-ff36-47ac-a673-a4d65a7f624f                    │
│  24 migrations appliquées                                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Schéma de base de données — Tables (24 migrations)

| Migration | Tables créées / modifiées | Sprint |
|-----------|--------------------------|--------|
| 0001 | `users`, `roles`, `user_roles` | 1.0 |
| 0002 | `boutiques`, `boutique_settings` | 1.0 |
| 0003 | `clients`, `appareils` | 1.0 |
| 0004 | `tickets`, `statuts_historique` | 1.0 |
| 0005 | `categories`, `produits`, `mouvements_stock` | 1.0 |
| 0006 | `devis`, `factures`, `lignes_facture`, `paiements` | 1.0 |
| 0007 | `employes`, `pointages` | 1.0 |
| 0008 | `journal_nf525`, `sessions_caisse`, `lignes_caisse` | 1.0/2.12 |
| 0009 | `otp_codes`, `audit_logs` | 2.3 |
| 0010 | `avoirs`, `lignes_avoir` + colonnes factures | 2.1 |
| 0011 | `rachats` (30 colonnes) | 2.2 |
| 0012 | `permissions` + colonnes PIN sur users | 2.3 |
| 0013 | `categories_services`, `services` | 2.4 |
| 0014 | `fournisseurs`, `bons_commande`, `lignes_bon_commande` + CUMP produits | 2.5 |
| 0015 | `rendez_vous`, `boutique_ical_tokens` | 2.6 |
| 0016 | colonnes vitrine sur `boutiques` | 2.7 |
| 0017 | `priorite`, `date_commande_pieces`, `date_reception_pieces` sur tickets | 2.8 |
| 0018 | colonnes numérotation + settings sur `boutique_settings` | 2.9 |
| 0019 | `garanties`, `tickets_sav` | 2.10 |
| 0020 | `email_logs` | 2.11 |
| 0021 | `ordres_reconditionnement`, `bons_achat` | 2.16 |
| 0022 | UPDATE slug boutiques existantes | 2.18 |
| 0023 | `public_token`, `envoye_le`, `repondu_le`, `signature_client` sur devis | 2.19 |
| 0024 | `kv_store` (remplacement KV natif CF) | 2.26 |

---

## 3. Conventions architecturales — Principes P1→P4

**P1 — MVC strict (ATTEINT v2.25)**
- Routes = Controllers PURS : 0 `.prepare()`, 0 SQL inline
- Services = Models : tout le SQL dans `src/services/*.ts`
- `src/lib/db.ts` : helpers partagés uniquement (`nextNumero`, `auditLog`, `parsePagination`)

**P2 — DRY frontend**
- `app.js` : helpers globaux uniques (`apiGet`, `apiPost`, `apiPut`, `apiPatch`, `apiDelete`, `_money`, `_fmtDate`, `_fmtDateTime`)
- 0 doublon dans les JS des pages

**P3 — Auth pattern uniforme**
- `localStorage.getItem('izigsm_session')` → JSON.parse → `{ boutique_id, role, user_id, ... }`
- `getBoutiqueId(user, queryParam)` → isolation multi-tenant automatique
- Jamais de JWT exposé dans le frontend

**P4 — Documentation JSDoc**
- Chaque fonction service = `@param`, `@returns`, description métier
- Chaque route = commentaire endpoint + rôles requis

---

## 4. Flux métier opérationnels (v2.28.0)

### Flux A — Réparation standard (le plus fréquent)
```
Client dépose appareil
  → POST /api/clients (si nouveau) → INSERT clients
  → POST /api/tickets {client_id, appareil, description}
      → tracking_token UUID généré
      → numero TKT-AAAA-NNNNN (nextNumero configurable)
  → PUT /api/tickets/:id/statut "en_diagnostic"
      → INSERT statuts_historique
  → POST /api/devis {ticket_id, lignes [catalogue services]}
      → public_token hex32 généré → email client sendDevisEmail()
  → Client approuve → POST /api/public/devis/:token/repondre
  → PUT /api/devis/:id/convertir
      → INSERT factures + journal_nf525 (SHA-256 chaîné)
  → PUT /api/tickets/:id/statut "en_reparation" → "termine"
      → POST /api/produits/:id/mouvement type "sortie" (pièces)
  → POST /api/factures/:id/emettre → locked=1
  → POST /api/factures/:id/paiement {montant, mode}
      → statut = "payee"
  → PUT /api/tickets/:id/statut "livre"
```

### Flux B — Commande fournisseur → Stock + CUMP
```
Stock bas détecté (produit.stock_actuel <= stock_minimum)
  → GET /api/fournisseurs/produits-a-commander → alerte dashboard
  → POST /api/bons-commande {fournisseur_id, lignes}
      → numero BC-AAAA-NNNNN (MAX séquentiel D1)
      → calcul montant_ht + montant_ttc
  → Réception marchandise
  → POST /api/bons-commande/:id/receptionner {lignes_recues}
      → CUMP = (stock×cump + qty×prix) / (stock+qty)
      → UPDATE produits.stock_actuel += qté
      → INSERT mouvements_stock type "reception_commande"
      → BC → statut "received"
```

### Flux C — SAV / Garantie
```
Client revient pour SAV
  → GET /api/garanties?client_id=X → recherche garantie active
  → POST /api/sav {garantie_id, description_probleme}
      → vérification garantie non expirée + non consommée
      → INSERT tickets_sav (ticket SAV)
      → UPDATE garanties.statut = "consommee"
      → (optionnel) email client ouverture SAV
  → PUT /api/sav/:id/statut "en_diagnostic" → "resolu" / "irresolu"
```

### Flux D — RDV → Ticket
```
Client prend RDV
  → POST /api/agenda {client_id, type, debut, duree}
      → fin auto-calculée (debut + duree)
      → ical_token hex32 généré
      → statut PENDING
  → Admin confirme → PUT /api/agenda/:id/statut "scheduled"
      → email confirmation client (futur 2.32)
  → Client arrive → PUT /api/agenda/:id/statut "converted"
      → (manuel) POST /api/tickets depuis RDV
```

### Flux E — Caisse POS NF525
```
Technicien ouvre caisse
  → POST /api/caisse/sessions/ouvrir {fonds_ouverture}
      → requirePin('acces_caisse')
  → Encaissement
  → POST /api/caisse/encaisser {facture_id, montant, mode}
      → INSERT paiements
      → UPDATE factures.statut = "payee"
      → INSERT journal_nf525 (SHA-256 chaîné)
  → Clôture journalière
  → POST /api/caisse/sessions/fermer {fonds_fermeture}
      → total_theorique vs total_reel → écart
```

---

## 5. Endpoints API — Inventaire complet (v2.28.0)

### Auth — `/api/auth/*`
```
POST /api/auth/register         → Inscription boutique + admin
POST /api/auth/verify-otp       → Validation email OTP
POST /api/auth/login            → Login JWT
POST /api/auth/logout           → Invalidation refresh token D1KV
POST /api/auth/refresh          → Nouveau JWT depuis refresh token
GET  /api/auth/me               → Profil utilisateur courant
POST /api/auth/pin/set          → Créer PIN technicien PBKDF2
POST /api/auth/pin/verify       → Vérifier PIN
```

### Public (sans auth) — `/api/public/*`
```
GET  /api/public/ticket/:token                → Tracking ticket client
GET  /api/public/boutique/:slug               → Page vitrine boutique
GET  /api/public/boutique/:slug/stats         → Stats publiques boutique
GET  /api/public/catalogue/:slug              → Catalogue services public
GET  /api/public/devis/:token                 → Consultation devis client
POST /api/public/devis/:token/repondre        → Accepter/refuser devis
GET  /api/calendar/:token.ics                 → Export iCal RFC 5545
```

### Tickets — `/api/tickets/*`
```
GET    /api/tickets                  → Liste paginée + filtres
GET    /api/tickets/kanban           → Vue kanban groupée par statut
GET    /api/tickets/:id              → Fiche complète + historique
POST   /api/tickets                  → Créer ticket
PUT    /api/tickets/:id              → Modifier champs éditables
PUT    /api/tickets/:id/statut       → Machine à états (10 statuts)
DELETE /api/tickets/:id              → Soft delete (actif=0)
POST   /api/tickets/:id/photos       → Upload photo (à implémenter R2)
```

### Clients — `/api/clients/*`
```
GET    /api/clients                  → Liste paginée + recherche
GET    /api/clients/:id              → Profil + KPIs
GET    /api/clients/:id/historique   → Tickets + factures + RDV + KPIs
POST   /api/clients                  → Créer client
PUT    /api/clients/:id              → Modifier client
DELETE /api/clients/:id              → Soft delete
POST   /api/clients/:id/appareils    → Ajouter appareil (IMEI/S/N)
POST   /api/clients/import-csv       → Import CSV (9 colonnes)
GET    /api/clients/kpis             → KPIs CRM globaux
```

### Stock — `/api/produits/*` + `/api/categories/*`
```
GET    /api/produits                 → Liste + filtres + pagination
GET    /api/produits/kpis            → KPIs stock (valeur, rupture)
GET    /api/produits/:id             → Détail produit
POST   /api/produits                 → Créer produit
PUT    /api/produits/:id             → Modifier produit
DELETE /api/produits/:id             → Soft delete
POST   /api/produits/:id/mouvement   → Entrée/sortie/ajustement stock
GET    /api/categories               → Liste catégories
POST   /api/categories               → Créer catégorie
```

### Facturation — `/api/factures/*` + `/api/devis/*` + `/api/avoirs/*`
```
GET    /api/devis                    → Liste devis + filtres
GET    /api/devis/stats              → KPIs devis (taux acceptation)
GET    /api/devis/:id                → Détail + lignes
POST   /api/devis                    → Créer devis
PUT    /api/devis/:id                → Modifier devis (draft uniquement)
PUT    /api/devis/:id/statut         → Machine à états
PUT    /api/devis/:id/convertir      → Convertir en facture NF525
POST   /api/devis/:id/envoyer        → Email devis au client

GET    /api/factures                 → Liste + filtres
GET    /api/factures/:id             → Détail + lignes + paiements
POST   /api/factures/:id/emettre     → Verrouillage NF525
POST   /api/factures/:id/paiement    → Enregistrer paiement
POST   /api/factures/:id/print       → Export PDF (window.print)

GET    /api/avoirs                   → Liste avoirs
GET    /api/avoirs/:id               → Détail avoir
POST   /api/avoirs                   → Créer avoir (facture locked obligatoire)
```

### SAV & Garanties — `/api/garanties/*` + `/api/sav/*`
```
GET    /api/garanties                → Liste + filtres (statut, expires_soon)
GET    /api/garanties/:id            → Détail garantie
POST   /api/garanties                → Créer garantie
POST   /api/garanties/expire         → Batch expiration
GET    /api/sav                      → Liste tickets SAV
GET    /api/sav/kpis                 → KPIs SAV (taux retour)
GET    /api/sav/:id                  → Détail ticket SAV
POST   /api/sav                      → Créer ticket SAV (depuis garantie)
PUT    /api/sav/:id/statut           → Machine à états SAV
```

### Fournisseurs — `/api/fournisseurs/*` + `/api/bons-commande/*`
```
GET    /api/fournisseurs             → Liste + recherche
GET    /api/fournisseurs/:id         → Détail fournisseur
POST   /api/fournisseurs             → Créer fournisseur
PUT    /api/fournisseurs/:id         → Modifier (COALESCE)
DELETE /api/fournisseurs/:id         → Soft delete
GET    /api/fournisseurs/kpis        → KPIs achats
GET    /api/fournisseurs/produits-a-commander → Vue stock bas

GET    /api/bons-commande            → Liste BC + filtres
GET    /api/bons-commande/:id        → Détail + lignes
POST   /api/bons-commande            → Créer BC (calcul HT/TTC)
PUT    /api/bons-commande/:id/statut → Statut (draft/awaiting/received/cancelled)
POST   /api/bons-commande/:id/receptionner → Réception + CUMP + mouvements stock
```

### Agenda — `/api/agenda/*`
```
GET    /api/agenda                   → Liste RDV + 7 filtres
GET    /api/agenda/view              → Vue calendrier (groupé par date)
GET    /api/agenda/kpis              → KPIs agenda (taux honoré)
GET    /api/agenda/:id               → Détail RDV
POST   /api/agenda                   → Créer RDV (fin auto-calculée)
PUT    /api/agenda/:id               → Modifier RDV
PUT    /api/agenda/:id/statut        → Machine à états (6 statuts)
DELETE /api/agenda/:id               → Soft delete (actif=0)
GET    /api/agenda/ical-token        → Obtenir/créer token iCal
```

### Personnel — `/api/employes/*` + `/api/pointage/*`
```
GET    /api/employes                 → Liste + statut pointage temps réel
GET    /api/employes/:id             → Détail + 50 derniers pointages
POST   /api/employes                 → Créer employé
PUT    /api/employes/:id             → Modifier employé
DELETE /api/employes/:id             → Désactiver (soft)
POST   /api/pointage/:id/pointer     → Machine à états pointage
GET    /api/pointage/aujourd-hui     → Pointages du jour + heures
GET    /api/pointage/rapport         → Rapport période
GET    /api/pointage/statuts         → Statuts temps réel équipe
```

### Autres modules
```
# Caisse POS
POST   /api/caisse/sessions/ouvrir    → Ouverture session (requirePin)
POST   /api/caisse/sessions/fermer    → Clôture journalière NF525
POST   /api/caisse/encaisser          → Encaissement + NF525
GET    /api/caisse/kpis               → KPIs caisse

# Stats & Rapports
GET    /api/stats                     → 12 KPIs dashboard temps réel
GET    /api/stats/graphiques/ca       → CA mensuel 12 mois
GET    /api/stats/graphiques/tickets  → Tickets par statut
GET    /api/stats/techniciens         → Rapport activité techniciens
GET    /api/stats/stock               → Rotation + valeur stock
GET    /api/stats/caisse              → Stats caisse période

# Boutiques & Settings
GET    /api/boutiques                 → Liste boutiques (admin: toutes)
GET    /api/boutiques/:id             → Détail boutique
POST   /api/boutiques                 → Créer boutique
PUT    /api/boutiques/:id             → Modifier boutique
GET    /api/boutiques/:id/settings    → Paramètres tenant
PUT    /api/boutiques/:id/settings    → Mettre à jour settings

# Notifications
GET    /api/notifications/stats       → Stats emails du mois
GET    /api/notifications/logs        → Journal emails (paginé)
POST   /api/notifications/test        → Email test
POST   /api/notifications/relances    → Batch relances devis

# Rachats
GET    /api/rachats                   → Liste livre de police
GET    /api/rachats/:id               → Détail rachat
POST   /api/rachats                   → Créer rachat (art. 321-7)
PATCH  /api/rachats/:id/statut        → Changer statut
GET    /api/rachats/export            → Export CSV réglementaire

# Reconditionnement
GET/POST/PUT /api/reconditionnement
PUT    /api/reconditionnement/:id/statut
POST   /api/reconditionnement/:id/terminer → crée produit occasion
GET/POST /api/bons-achat
POST   /api/bons-achat/:id/verifier
POST   /api/bons-achat/:id/consommer
POST   /api/bons-achat/:id/annuler
```

---

## 6. Tests — Couverture Vitest (v2.28.0)

| Fichier de test | Tests | Services couverts |
|---|---|---|
| `tests/authService.test.ts` | 23 | authService — login, register, OTP, JWT |
| `tests/boutiqueService.test.ts` | 24 | boutiqueService — CRUD, settings, stats |
| `tests/caisseService.test.ts` | 14 | caisseService — sessions, encaissement, NF525 |
| `tests/ticketService.test.ts` | 37 | ticketService — CRUD, kanban, machine états |
| `tests/emailService.test.ts` | 16 | emailService — Resend mock, logs, templates |
| `tests/garantiesService.test.ts` | 65 | garantiesService — SAV + garanties complet |
| `tests/agendaService.test.ts` | 75 | agendaService — RDV + iCal RFC 5545 |
| `tests/fournisseursService.test.ts` | 65 | fournisseursService — BC + CUMP |
| **Total** | **319** | **8 services** |

**Services sans tests (planifié Sprint 2.29→2.30) :**
- `stockService`, `devisService`, `factureService`, `clientService`
- `personnelService`, `reconditionnementService`, `publicService`

**Helper partagé :** `tests/helpers/mockD1.ts` — `createMockD1()`, `__setResponse`, `__setListFn`, `__getCalls`, normalisation SQL whitespace

---

## 7. Contraintes Cloudflare Workers (rappel)

| Contrainte | Impact | Solution |
|---|---|---|
| Pas de `fs`, `path`, `child_process` | Pas de Node.js APIs | Web APIs uniquement (fetch, crypto, TextEncoder) |
| Pas de KV natif (blocage gsk-hosted-deploy) | KV namespace non provisionnable | D1KV maison (`lib/d1kv.ts`) |
| Pas de R2 configuré | Pas de stockage fichiers actuellement | R2 planifié Sprint 2.36 (photos tickets) |
| CPU limit 10ms/req (free) | Pas de calculs lourds | SHA-256 Web Crypto API, CUMP JS pur |
| Taille Worker max 10MB | Bundle léger | Hono léger, CDN pour frontend libs (Tailwind, Chart.js, FontAwesome) |
| WebSocket persistant impossible | Pas de push temps réel | Polling 30s (Personnel) — Durable Objects post-MVP |

---

## 8. Déploiement — Procédure prod

```bash
# 1. Build local
cd /home/user/webapp && npm run build

# 2. Tests
npm test  # → doit être 319/319 (ou plus)

# 3. Git
git add . && git commit -m "feat(sprint-X.XX): description"

# 4. Déployer via gsk (nécessite approbation dans l'UI)
gsk --timeout 300000 --project-id 8096d010-efde-413e-a481-72226566aa0b hosted deploy
# → note le pending_action_id

# 5. Attendre approbation utilisateur dans l'onglet Deploy, puis :
gsk --timeout 300000 hosted action_wait --id <pending_action_id>

# 6. Vérifier
curl https://8096d010-efde-413e-a481-72226566aa0b.vip.gensparksite.com/api/health

# 7. Taguer
git tag vX.XX.X <commit_hash>
```

**Référence :** `docs/DEPLOIEMENT.md` pour mode opératoire complet (10 étapes).

---

*Architecture v2.0 — iziGSM v2.28.0 — 3 juillet 2026*
