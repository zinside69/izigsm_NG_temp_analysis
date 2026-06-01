# TODO — iziGSM Progression & Roadmap
> **Dernière mise à jour** : 1er juin 2026  
> **Version app** : 1.1.0 — Sprint 1 complet — Backend D1 + Auth JWT + NF525 + Frontend connecté  
> **Stack** : Hono + Cloudflare Pages/Workers + D1 + KV + R2

---

## 🗺️ Vue d'ensemble des Sprints

| Sprint | Nom | Durée | Statut |
|--------|-----|-------|--------|
| **Sprint 1** | Fondations (D1 + Auth réelle + NF525 + Personnel) | 3 sem. | ✅ TERMINÉ |
| Sprint 2 | Fonctionnalités cœur (flux métier complets) | 3 sem. | ⏳ À venir |
| Sprint 3 | Intégrations externes (email, SMS, Qualirépar) | 2 sem. | ⏳ À venir |
| Sprint 4 | Multi-boutiques + avancé + hardening | 2 sem. | ⏳ À venir |

---

## ✅ CE QUI EST FAIT (état actuel)

### Pages HTML (UI complète)
- [x] `index.html` — Landing page / vitrine
- [x] `login.html` — Page de connexion
- [x] `register.html` — Inscription
- [x] `verify-email.html` — Vérification OTP
- [x] `dashboard.html` — Tableau de bord
- [x] `clients.html` — Gestion clients
- [x] `tickets.html` — Tickets de réparation
- [x] `stock.html` — Gestion des stocks
- [x] `devis.html` — Création de devis
- [x] `factures.html` — Facturation
- [x] `personnel.html` — Personnel & Pointage *(nouveau Sprint 1)*
- [x] `qualirepar.html` — Bonus Qualirépar
- [x] `settings.html` — Paramètres boutique
- [x] `modules.html` — Présentation modules
- [x] `legal.html` — Mentions légales / RGPD

### Fichiers JavaScript (connectés à l'API réelle)
- [x] `app.js` — Auth JWT réel + helpers API (getToken, storeSession, api(), apiGet/Post/Put/Delete, tryRefreshToken, requireAuth, hasRole, getBoutiqueId, logout) + sidebar avec Personnel
- [x] `register.js` — Formulaire inscription + OTP
- [x] `home.js` — Animations landing (scroll, counters, FAQ)
- [x] `dashboard.js` — KPIs réels depuis `/api/stats` + tickets récents + fallback localStorage
- [x] `clients.js` — CRUD complet `/api/clients` + mapApiClient() + fallback
- [x] `tickets.js` — CRUD `/api/tickets` + machine à états + mapStatutToLegacy() + fallback
- [x] `stock.js` — CRUD `/api/produits` + mouvements `/api/produits/:id/mouvement` + fallback
- [x] `devis.js` — CRUD `/api/devis` + mapApiDevis() + convertToFacture() + fallback
- [x] `factures.js` — CRUD `/api/factures` + mapApiFacture() + modal paiement → `/api/factures/:id/paiement` + KPIs NF525 + fallback
- [x] `personnel.js` — Machine à états pointage + auto-refresh 30s + modal rapport
- [x] `qualirepar.js` — UI déclarations Qualirépar (mockées)

### API Backend (Hono — D1 réel)
- [x] `POST /api/register` — Inscription PBKDF2 + KV OTP
- [x] `POST /api/verify-otp` — Vérification OTP depuis KV + activation D1
- [x] `POST /api/login` — Auth PBKDF2 + JWT HMAC-SHA256 + refresh KV
- [x] `POST /api/refresh` — Renouvellement access token via KV
- [x] `POST /api/logout` — Invalidation refresh token KV
- [x] `GET /api/me` — Profil utilisateur connecté
- [x] `GET /api/stats` — KPIs dashboard (nb_clients, tickets_en_cours, ca_mois, stock_bas, employes_en_poste)
- [x] `GET /api/health` — Health check
- [x] `GET|POST /api/clients` — Liste + création clients D1
- [x] `GET|PUT|DELETE /api/clients/:id` — Détail + modification + suppression
- [x] `GET /api/clients/:id/tickets` — Historique réparations
- [x] `POST /api/clients/:id/appareils` — Ajout appareil (IMEI)
- [x] `GET|POST /api/tickets` — Liste + création tickets D1
- [x] `GET|PUT|DELETE /api/tickets/:id` — Détail + modification + suppression
- [x] `PUT /api/tickets/:id/statut` — Machine à états + historique
- [x] `GET|POST /api/produits` — Liste + création produits D1
- [x] `GET|PUT|DELETE /api/produits/:id` — Détail + modification + suppression
- [x] `POST /api/produits/:id/mouvement` — Entrée/sortie stock
- [x] `GET|POST /api/categories` — Liste + création catégories
- [x] `GET|POST /api/devis` — Liste + création devis + lignes D1
- [x] `PUT /api/devis/:id/convertir` — Devis → Facture + NF525 chain
- [x] `GET /api/factures` — Liste factures D1
- [x] `GET /api/factures/:id` — Détail + lignes + paiements
- [x] `POST /api/factures/:id/paiement` — Enregistrement paiement + mise à jour statut
- [x] `GET|POST /api/employes` — Liste + création employés D1
- [x] `PUT|DELETE /api/employes/:id` — Modification + désactivation
- [x] `POST /api/pointage/:employeId/pointer` — Machine à états pointage (5 transitions)
- [x] `GET /api/pointage/:employeId/aujourd-hui` — Pointages du jour
- [x] `GET /api/pointage/statuts` — Statuts temps réel tous employés
- [x] `GET /api/pointage/rapport` — Rapport hebdo/mensuel
- [x] `GET|POST /api/boutiques` — Liste + création boutiques
- [x] `GET|PUT /api/boutiques/:id` — Détail + modification
- [x] `PUT /api/boutiques/:id/settings` — Paramètres boutique
- [x] `GET /api/nf525/verify` — Vérification chaîne NF525
- [x] `GET /api/nf525/export` — Export journal NF525

### Backend — Bibliothèques internes
- [x] `src/lib/auth.ts` — PBKDF2 (100k itérations SHA-256) + JWT HMAC-SHA256 (Web Crypto API)
- [x] `src/lib/nf525.ts` — Chaîne SHA-256 anti-fraude (NF525 / loi anti-fraude TVA 2018)
- [x] `src/lib/middleware.ts` — authMiddleware + requireRole() + getBoutiqueId()
- [x] `src/lib/db.ts` — nextNumero + parsePagination + calculTva/Lignes + auditLog

### Base de Données D1 (Migrations)
- [x] `migrations/0001_users_roles.sql` — Tables users, roles, user_roles
- [x] `migrations/0002_boutiques.sql` — Tables boutiques, boutique_settings
- [x] `migrations/0003_clients_appareils.sql` — Tables clients, appareils
- [x] `migrations/0004_tickets.sql` — Tables tickets, interventions, statuts_historique
- [x] `migrations/0005_stocks.sql` — Tables categories, produits, mouvements_stock
- [x] `migrations/0006_facturation.sql` — Tables devis, factures, lignes_document, paiements
- [x] `migrations/0007_personnel.sql` — Tables employes, pointages
- [x] `migrations/0008_nf525.sql` — Table journal_nf525 (chaîne de hachage)
- [x] `migrations/0009_indexes.sql` — Index de performance
- [x] Migrations appliquées en local (`wrangler d1 migrations apply --local`)
- [x] `seed.sql` — Données de test (admin, boutique, clients, produits, employés)

### Infrastructure
- [x] Git repository initialisé + `.gitignore` complet
- [x] Build Vite → `dist/` fonctionnel (76.82 kB worker)
- [x] PM2 + `ecosystem.config.cjs` pour développement sandbox
- [x] `wrangler.jsonc` configuré — D1 + KV bindings
- [x] `.dev.vars` — JWT_SECRET local
- [x] `.dev.vars.example` — Template secrets

### Documentation
- [x] `docs/ANALYSE_COMPARATIVE_CDC.md` — Comparaison CDC vs implémentation
- [x] `docs/GAP_ANALYSIS_ENRICHI.md` — Gap analysis complet priorisé
- [x] `docs/TODO.md` — Roadmap complète

---

## ✅ SPRINT 1 — Fondations — TERMINÉ

### 1.1 — Base de Données D1 (Migrations SQL) ✅
- [x] **9 migrations SQL** créées et appliquées localement
- [x] **`wrangler.jsonc`** — binding `DB` configuré
- [x] **`seed.sql`** — Données de test appliquées

### 1.2 — Authentification JWT Réelle ✅
- [x] **PBKDF2** (100k itérations SHA-256) pour hachage mots de passe
- [x] **JWT HMAC-SHA256** via Web Crypto API (sans bibliothèque)
- [x] **Access token 1h / Refresh token 7j** (stocké en KV)
- [x] **6 endpoints auth** : register, verify-otp, login, refresh, logout, me
- [x] **KV namespace** configuré dans `wrangler.jsonc`

### 1.3 — RBAC (Rôles et Permissions) ✅
- [x] **4 rôles** : admin, manager, technicien, client
- [x] **`requireRole(...roles)`** middleware Hono
- [x] **Routes protégées** selon les rôles
- [x] **Admin par défaut** dans `seed.sql` (admin@izigsm.fr)

### 1.4 — Persistance : Module Clients ✅
- [x] CRUD complet `/api/clients` connecté depuis `clients.js`
- [x] Mapping snake_case API → format legacy + fallback localStorage

### 1.5 — Persistance : Module Tickets ✅
- [x] CRUD `/api/tickets` + machine à états + historique statuts
- [x] `tickets.js` connecté + mapStatutToLegacy()

### 1.6 — Persistance : Module Stocks ✅
- [x] CRUD `/api/produits` + mouvements stock
- [x] `stock.js` connecté + confirmAdjustStock() async

### 1.7 — Persistance : Module Devis & Factures ✅
- [x] `devis.js` → `/api/devis` + convertToFacture()
- [x] `factures.js` → `/api/factures` + modal paiement → `/api/factures/:id/paiement`
- [x] Numérotation automatique côté serveur (nextNumero)
- [x] Calcul HT/TVA/TTC côté API (calculLignes)

### 1.8 — Conformité NF525 🔴✅
- [x] **`src/lib/nf525.ts`** — chaîne SHA-256 sur toutes les factures
- [x] **Table `journal_nf525`** en D1 (migration 0008)
- [x] **Hook automatique** sur conversion devis → facture
- [x] **`GET /api/nf525/verify`** — endpoint de vérification
- [x] **Badge NF525** 🔐 affiché dans la liste des factures
- [x] ⚠️ Factures non supprimables via UI (conformité légale)

### 1.9 — Module Personnel & Pointage ✅
- [x] **`public/personnel.html`** — page complète avec grille employés
- [x] **`public/static/js/personnel.js`** — JS complet (loadEmployes, pointer, modal, rapport, auto-refresh 30s)
- [x] **Machine à états** : absent → en_poste → pause → en_poste → termine
- [x] **API Personnel** complète (6 endpoints employes + 4 endpoints pointage)
- [x] **Lien Personnel** ajouté dans sidebar (app.js + dashboard.html)

### 1.10 — Module Boutiques ✅
- [x] CRUD `/api/boutiques` + settings
- [x] Routes protégées admin/manager

### 1.11 — Configuration wrangler.jsonc ✅
- [x] Binding `DB` (D1) configuré
- [x] Binding `KV` configuré
- [x] `.dev.vars` et `.dev.vars.example` créés

### 1.12 — Mise à jour Frontend (APIs réelles) ✅
- [x] **`app.js`** — helpers JWT réels (getToken, storeSession, api(), apiGet/Post/Put/Delete, tryRefreshToken, requireAuth, hasRole, getBoutiqueId, logout)
- [x] **`dashboard.js`** — KPIs réels `/api/stats` + tickets récents + fallback
- [x] **`clients.js`** — CRUD complet `/api/clients` + fallback
- [x] **`tickets.js`** — loadTickets(), changeStatus(), saveTicket() async + fallback
- [x] **`stock.js`** — loadStock(), confirmAdjustStock() → `/api/produits/:id/mouvement` + fallback
- [x] **`devis.js`** — loadDevis(), saveDevis(), convertToFacture() async + fallback
- [x] **`factures.js`** — loadFactures(), saveFacture(), markAsPaid() → `/api/factures/:id/paiement`, KPIs (CA/Encaissé/Attente/Retard) + fallback

### 1.13 — `docs/TODO.md` ✅
- [x] Toutes les tâches Sprint 1 cochées

---

## ⏳ SPRINT 2 — Fonctionnalités Cœur
> **Objectif** : Flux métier complets (devis → ticket → facture), upload photos, export PDF

### 2.1 — Flux Métier Complet
- [ ] Lier devis ↔ ticket ↔ facture (foreign keys + UI)
- [ ] Bouton "Convertir en ticket" depuis un devis
- [ ] Bouton "Générer facture" depuis un ticket terminé
- [ ] Vue chronologique sur la fiche client

### 2.2 — Upload Photos (Cloudflare R2)
- [ ] Configurer R2 bucket `izigsm-photos`
- [ ] `POST /api/tickets/:id/photos` — Upload photo vers R2
- [ ] Compression côté client avant upload (Canvas API)
- [ ] `GET /api/tickets/:id/photos` — Récupérer les URLs photos
- [ ] Affichage photos avant/après dans le ticket

### 2.3 — Export PDF Factures
- [ ] Générer un PDF côté client (html2canvas + jsPDF via CDN)
- [ ] Template HTML → PDF avec logo, données boutique, lignes, NF525 hash
- [ ] `GET /api/factures/:id/pdf` — Ou génération purement client

### 2.4 — Calcul Commissions Techniciens
- [ ] Champ `commission_%` sur profil employé
- [ ] Calcul automatique à la clôture d'une réparation
- [ ] Vue "Mes commissions" dans le module personnel

### 2.5 — Dashboard Réel
- [ ] Graphiques Chart.js branchés sur données réelles (actuellement KPIs texte)
- [ ] Sélecteur période (aujourd'hui / semaine / mois / année)

---

## ⏳ SPRINT 3 — Intégrations Externes

### 3.1 — Email (Resend API)
- [ ] `wrangler secret put RESEND_API_KEY`
- [ ] Service email dans `src/lib/email.ts`
- [ ] Email de confirmation inscription (OTP)
- [ ] Email de notification livraison ticket
- [ ] Email de devis (PDF en pièce jointe)

### 3.2 — SMS (Twilio)
- [ ] `wrangler secret put TWILIO_*`
- [ ] Service SMS dans `src/lib/sms.ts`
- [ ] SMS à la réception de l'appareil
- [ ] SMS quand réparation terminée

### 3.3 — Qualirépar API
- [ ] `GET /api/qualirepar/declarations` — Liste déclarations
- [ ] `POST /api/qualirepar/declarer` — Soumettre une déclaration bonus
- [ ] Intégration avec l'API officielle Qualirépar
- [ ] Relances automatiques de paiement

### 3.4 — OAuth2 Google
- [ ] `wrangler secret put GOOGLE_CLIENT_ID/SECRET`
- [ ] Flow OAuth dans Hono (redirect → callback → JWT)
- [ ] Bouton "Continuer avec Google" sur login/register

---

## ⏳ SPRINT 4 — Multi-boutiques + Hardening

### 4.1 — Multi-boutiques
- [ ] Filtre global par boutique sur toutes les requêtes D1
- [ ] Isolation des données par `boutique_id`
- [ ] Sélecteur boutique dans le header
- [ ] Rapports consolidés multi-boutiques (Admin only)

### 4.2 — Import Catalogues Fournisseurs
- [ ] Import CSV produits (colonnes : SKU, nom, prix achat, stock min)
- [ ] Mapping colonnes Mobilax / Utopya / Phone LCD
- [ ] `POST /api/produits/import` — Upload CSV + parsing + insert D1

### 4.3 — Hardening Sécurité
- [ ] CORS restreint au domaine de production (plus `*`)
- [ ] Rate limiting custom sur `/api/login` (5 tentatives / 15min via KV)
- [ ] Headers sécurité (CSP, X-Frame-Options) dans Hono middleware
- [ ] Logs d'audit en D1 (qui a fait quoi, quand)
- [ ] `wrangler secret put APP_ENV production`

### 4.4 — RGPD
- [ ] `GET /api/clients/:id/export` — Export complet données client (droit à la portabilité)
- [ ] `DELETE /api/clients/:id/purge` — Effacement complet (droit à l'oubli)
- [ ] Consentement cookies (bannière déjà présente, à relier)

---

## 📋 BACKLOG — Fonctionnalités Futures

- [ ] WhatsApp Business (API Meta)
- [ ] Chatbot IA prise de RDV (ChatGPT + Cloudflare AI)
- [ ] Réponses avis Google via IA
- [ ] Campagnes marketing Email/SMS
- [ ] Application mobile (React Native ou PWA)
- [ ] Mode hors-ligne (Service Worker + IndexedDB)
- [ ] Scanner codes-barres (API BarcodeDetector navigateur)
- [ ] Signature numérique tablette (Canvas + signature pad lib)
- [ ] Reporting avancé export Excel
- [ ] Planning techniciens (calendrier drag-and-drop)
- [ ] Système de tickets support client
- [ ] API publique pour intégrations tierces

---

## 🔐 Secrets à Configurer

### Dev local (`.dev.vars`)
```bash
JWT_SECRET=dev-secret-change-in-prod-min-64-chars-xxxxxxxxxxxxxxxxxxxxxxx
APP_ENV=development
FRONTEND_URL=http://localhost:3000
```

### Production (`wrangler secret put`)
```bash
wrangler secret put JWT_SECRET          # openssl rand -base64 64
wrangler secret put RESEND_API_KEY      # Sprint 3
wrangler secret put TWILIO_ACCOUNT_SID  # Sprint 3
wrangler secret put TWILIO_AUTH_TOKEN   # Sprint 3
wrangler secret put TWILIO_PHONE_NUMBER # Sprint 3
wrangler secret put GOOGLE_CLIENT_ID    # Sprint 3
wrangler secret put GOOGLE_CLIENT_SECRET # Sprint 3
wrangler secret put STRIPE_SECRET_KEY   # Sprint 4
```

---

## 📊 Indicateurs de Progression

| Module | Sprint 1 | Sprint 2 | Sprint 3 | Sprint 4 |
|--------|----------|----------|----------|----------|
| Auth JWT | ✅ | — | OAuth | — |
| RBAC | ✅ | — | — | — |
| Boutiques | ✅ | — | — | Multi |
| Clients | ✅ | Flux | — | RGPD |
| Tickets | ✅ | Photos | Notifs | — |
| Stock | ✅ | — | Fournisseurs | Import |
| Devis/Factures | ✅ | PDF | — | — |
| NF525 | ✅ | — | — | — |
| Personnel | ✅ | Commissions | — | Planning |
| Dashboard | ✅ (KPIs) | Graphiques | — | Multi |
| Email | — | — | 🔄 | — |
| SMS | — | — | 🔄 | — |
| Qualirépar | — | — | 🔄 | — |

**Légende** : ✅ Terminé | 🔄 En cours / dans ce sprint | — Non concerné

---

## 🏗️ Architecture Technique — Rappel

```
Cloudflare Pages (dist/)
├── HTML statiques servis par Cloudflare CDN (280 PoP mondiaux)
└── /functions/ → Hono Workers (src/index.tsx)
    ├── /api/auth/*       → JWT HMAC-SHA256, OTP KV, OAuth (Sprint 3)
    ├── /api/clients/*    → D1 : table clients, appareils
    ├── /api/tickets/*    → D1 : table tickets, interventions
    ├── /api/produits/    → D1 : table produits, mouvements_stock
    ├── /api/devis/       → D1 : table devis + lignes_document
    ├── /api/factures/    → D1 : table factures + NF525 journal
    ├── /api/personnel/   → D1 : table employes, pointages
    ├── /api/boutiques/   → D1 : table boutiques, boutique_settings
    └── /api/stats        → D1 : requêtes agrégées KPIs

Cloudflare D1 (SQLite edge)
├── 9 migrations SQL appliquées
└── Accès via env.DB.prepare()

Cloudflare KV
├── OTP temporaires (TTL 10min)
└── Refresh tokens JWT (TTL 7j)

Cloudflare R2
└── Photos réparations (Sprint 2)
```

---

*Sprint 1 terminé le 1er juin 2026 — prochain sprint : 2 (PDF, photos R2, flux métier complet)*
