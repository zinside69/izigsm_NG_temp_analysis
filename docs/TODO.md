# TODO — iziGSM Progression & Roadmap
> **Dernière mise à jour** : 1er juin 2026  
> **Version app** : 1.0.0 — Prototype UI complet, persistance à implémenter  
> **Stack** : Hono + Cloudflare Pages/Workers + D1 + KV + R2

---

## 🗺️ Vue d'ensemble des Sprints

| Sprint | Nom | Durée | Statut |
|--------|-----|-------|--------|
| **Sprint 1** | Fondations (D1 + Auth réelle + NF525 + Personnel) | 3 sem. | 🔄 EN COURS |
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
- [x] `qualirepar.html` — Bonus Qualirépar
- [x] `settings.html` — Paramètres boutique
- [x] `modules.html` — Présentation modules
- [x] `legal.html` — Mentions légales / RGPD

### Fichiers JavaScript (UI interactive, données mockées)
- [x] `app.js` — Auth flow (login, logout, navigation)
- [x] `register.js` — Formulaire inscription + OTP
- [x] `home.js` — Animations landing (scroll, counters, FAQ)
- [x] `dashboard.js` — KPIs + graphiques Chart.js (mockés)
- [x] `clients.js` — CRUD clients + recherche + export CSV (mockés)
- [x] `tickets.js` — CRUD tickets + filtres + statuts (mockés)
- [x] `stock.js` — CRUD stock + KPIs + alertes + export CSV (mockés)
- [x] `devis.js` — Création devis + lignes + calculs (mockés)
- [x] `factures.js` — Liste factures + filtres (mockés)
- [x] `qualirepar.js` — UI déclarations Qualirépar (mockées)

### API Backend (Hono — démo)
- [x] `POST /api/register` — Inscription (sans persistance)
- [x] `POST /api/verify-otp` — Vérification OTP (sans persistance)
- [x] `POST /api/login` — Connexion (sans persistance)
- [x] `GET /api/health` — Health check

### Documentation
- [x] `docs/ANALYSE_COMPARATIVE_CDC.md` — Comparaison CDC vs implémentation
- [x] `docs/GAP_ANALYSIS_ENRICHI.md` — Gap analysis complet priorisé

### Infrastructure
- [x] Git repository initialisé
- [x] Build Vite → `dist/` fonctionnel
- [x] PM2 + `server.mjs` pour développement sandbox
- [x] `wrangler.jsonc` configuré (base)
- [x] `ecosystem.config.cjs` — PM2 config

---

## 🔄 SPRINT 1 — Fondations (EN COURS)
> **Objectif** : Rendre l'application utilisable en production — données réelles, auth sécurisée, conformité légale, module personnel  
> **Durée estimée** : 3 semaines  
> **Priorité absolue** — rien d'autre ne peut fonctionner sans ces bases

---

### 1.1 — Base de Données D1 (Migrations SQL)
> Créer le schéma complet de la base de données Cloudflare D1

- [ ] **Créer la base D1 production** — `wrangler d1 create izigsm-production`
- [ ] **Mettre à jour `wrangler.jsonc`** — ajouter le binding `DB` avec l'ID D1
- [ ] **`migrations/0001_users_roles.sql`** — Tables `users`, `roles`, `user_roles`
- [ ] **`migrations/0002_boutiques.sql`** — Tables `boutiques`, `boutique_settings`
- [ ] **`migrations/0003_clients_appareils.sql`** — Tables `clients`, `appareils`
- [ ] **`migrations/0004_tickets.sql`** — Tables `tickets`, `interventions`, `statuts_historique`
- [ ] **`migrations/0005_stocks.sql`** — Tables `categories`, `produits`, `mouvements_stock`
- [ ] **`migrations/0006_facturation.sql`** — Tables `devis`, `factures`, `lignes_facture`, `paiements`
- [ ] **`migrations/0007_personnel.sql`** — Tables `employes`, `pointages`
- [ ] **`migrations/0008_nf525.sql`** — Table `journal_nf525` (chaîne de hachage)
- [ ] **`migrations/0009_indexes.sql`** — Index de performance sur toutes les tables
- [ ] **Appliquer les migrations en local** — `wrangler d1 migrations apply izigsm-production --local`
- [ ] **Créer `seed.sql`** — Données de test (admin, boutique, clients, produits)
- [ ] **Appliquer le seed local** — `wrangler d1 execute izigsm-production --local --file=seed.sql`

---

### 1.2 — Authentification JWT Réelle
> Remplacer `demo_${Date.now()}` par une vraie auth sécurisée

- [ ] **Installer `hono/jwt`** — déjà inclus dans Hono (import à ajouter)
- [ ] **Configurer `JWT_SECRET`** — via `.dev.vars` en local, `wrangler secret put` en prod
- [ ] **`POST /api/register`** — Hash bcrypt du mot de passe + insert en D1
  - Champs : email, password (hashé), firstName, lastName, workshopName, phone
  - Générer OTP 6 chiffres + stocker en KV avec TTL 10min
- [ ] **`POST /api/verify-otp`** — Vérifier OTP depuis KV + activer le compte en D1
- [ ] **`POST /api/login`** — Vérifier email/password vs D1 + retourner JWT signé
  - Payload JWT : `{ sub: userId, email, role, boutique_id, exp }`
  - Access token : 1h | Refresh token : 7 jours (stocké en KV)
- [ ] **`POST /api/refresh`** — Renouveler l'access token via refresh token KV
- [ ] **`POST /api/logout`** — Invalider le refresh token dans KV
- [ ] **`GET /api/me`** — Retourner le profil de l'utilisateur connecté
- [ ] **Middleware `authMiddleware`** — Vérifier JWT sur toutes les routes `/api/*` (sauf auth)
- [ ] **Configurer KV namespace** — `wrangler kv:namespace create izigsm_KV`
- [ ] **Mettre à jour `wrangler.jsonc`** — ajouter le binding `KV`

---

### 1.3 — RBAC (Rôles et Permissions)
> Contrôle d'accès basé sur les rôles

- [ ] **Définir les 4 rôles** : `admin`, `manager`, `technicien`, `client`
- [ ] **Middleware `requireRole(...roles)`** — Hono middleware qui vérifie le rôle depuis le JWT
- [ ] **Table `permissions`** en D1 — Liste des permissions par rôle
- [ ] **Protéger les routes sensibles** :
  - Admin only : CRUD boutiques, CRUD utilisateurs, accès comptabilité
  - Manager + Admin : CRUD clients, devis, factures
  - Tous rôles internes : CRUD tickets, stocks
- [ ] **Initialiser les rôles dans `seed.sql`**
- [ ] **Créer l'admin par défaut** dans `seed.sql` (email : admin@izigsm.fr)

---

### 1.4 — Persistance : Module Clients
> Connecter `clients.js` à la vraie API D1

- [ ] **`GET /api/clients`** — Liste paginée avec filtres (search, statut) depuis D1
- [ ] **`POST /api/clients`** — Créer un client + validation serveur
- [ ] **`GET /api/clients/:id`** — Détail client + ses appareils
- [ ] **`PUT /api/clients/:id`** — Modifier un client
- [ ] **`DELETE /api/clients/:id`** — Supprimer (soft delete)
- [ ] **`GET /api/clients/:id/tickets`** — Historique réparations du client
- [ ] **`POST /api/clients/:id/appareils`** — Ajouter un appareil (IMEI, S/N, modèle)
- [ ] **Mettre à jour `clients.js`** — Remplacer les données mockées par des appels API réels
- [ ] **Gestion des appareils** — IMEI validation (15 chiffres), numéro de série

---

### 1.5 — Persistance : Module Tickets / Réparations
> Connecter `tickets.js` à la vraie API D1

- [ ] **`GET /api/tickets`** — Liste paginée avec filtres (statut, technicien, date)
- [ ] **`POST /api/tickets`** — Créer un ticket (client, appareil, description, technicien assigné)
- [ ] **`GET /api/tickets/:id`** — Détail ticket + historique statuts
- [ ] **`PUT /api/tickets/:id`** — Modifier un ticket
- [ ] **`PUT /api/tickets/:id/statut`** — Changer le statut + enregistrer dans `statuts_historique`
- [ ] **`DELETE /api/tickets/:id`** — Supprimer (soft delete)
- [ ] **Machine à états** : `reçu` → `diagnostic` → `en_réparation` → `terminé` → `livré`
- [ ] **Mettre à jour `tickets.js`** — Remplacer les données mockées par des appels API

---

### 1.6 — Persistance : Module Stocks
> Connecter `stock.js` à la vraie API D1

- [ ] **`GET /api/produits`** — Liste avec filtres (catégorie, stock bas, recherche)
- [ ] **`POST /api/produits`** — Créer un produit (SKU, nom, prix achat, prix vente, stock min)
- [ ] **`PUT /api/produits/:id`** — Modifier
- [ ] **`DELETE /api/produits/:id`** — Supprimer
- [ ] **`POST /api/produits/:id/mouvement`** — Entrée/sortie de stock + enregistrer mouvement
- [ ] **`GET /api/categories`** — Liste des catégories
- [ ] **`POST /api/categories`** — Créer une catégorie
- [ ] **Calcul marge en temps réel** : `((prix_vente - prix_achat) / prix_vente) * 100`
- [ ] **Mettre à jour `stock.js`** — Remplacer les données mockées

---

### 1.7 — Persistance : Module Devis & Factures
> Connecter `devis.js` et `factures.js` à la vraie API D1

- [ ] **`GET /api/devis`** — Liste devis
- [ ] **`POST /api/devis`** — Créer un devis + lignes + calcul HT/TVA/TTC
- [ ] **`PUT /api/devis/:id`** — Modifier
- [ ] **`PUT /api/devis/:id/convertir`** — Convertir devis → facture
- [ ] **`GET /api/factures`** — Liste factures
- [ ] **`POST /api/factures`** — Créer une facture
- [ ] **`GET /api/factures/:id`** — Détail facture
- [ ] **Numérotation automatique** : format `FAC-2026-XXXX` (séquentiel en D1)
- [ ] **Calcul automatique côté API** : HT, TVA (20% défaut), TTC
- [ ] **Mettre à jour `devis.js` et `factures.js`**

---

### 1.8 — Conformité NF525 🔴 CRITIQUE LÉGAL
> Obligatoire pour tout logiciel de caisse en France (Loi anti-fraude TVA 2018)

**Contexte** : La loi française oblige tout logiciel de caisse à implémenter un système d'inaltérabilité des données de vente via une chaîne de hachage SHA-256. Sans ça, l'entreprise risque une amende de **7 500 € par logiciel**.

- [ ] **Créer `src/lib/nf525.ts`** — Module de conformité
  - Fonction `hashTransaction(data, previousHash)` → SHA-256
  - Fonction `buildChainEntry(facture)` → entrée dans le journal
  - Fonction `verifyChain(entries[])` → vérification intégrité
- [ ] **Table `journal_nf525`** en D1 :
  ```sql
  id, facture_id, montant_ttc, date_transaction,
  hash_courant, hash_precedent, created_at
  ```
- [ ] **Hook automatique sur `POST /api/factures`** — Enregistrer chaque facture dans le journal NF525 avec son hash
- [ ] **`GET /api/nf525/verify`** — Endpoint de vérification de la chaîne (pour audit)
- [ ] **`GET /api/nf525/export`** — Export du journal (format requis par l'administration)
- [ ] **Clôture périodique** — Fonction de clôture journalière (total du jour + hash)
- [ ] **Tests** — Vérifier que la chaîne est bien inaltérable (modification d'une entrée → rupture)

---

### 1.9 — Module Personnel & Pointage 🔴 PRIORITAIRE
> Module entièrement à créer (page HTML + API + D1)

- [ ] **Créer `public/personnel.html`** — Page complète :
  - Liste des employés avec statut en temps réel
  - Bouton de pointage (4 états : Absent / En poste / Pause / Terminé)
  - Vue planning de la journée
  - Historique des présences
- [ ] **Créer `public/static/js/personnel.js`** — Logique UI :
  - Fetch liste employés + statuts
  - Bouton pointage avec confirmation
  - Affichage temps travaillé en direct
  - Export présences CSV
- [ ] **API Personnel** :
  - `GET /api/employes` — Liste avec statut actuel
  - `POST /api/employes` — Créer un employé
  - `PUT /api/employes/:id` — Modifier profil
  - `DELETE /api/employes/:id` — Désactiver
- [ ] **API Pointage (machine à états)** :
  - `POST /api/pointage/:employeId/pointer` — Enregistrer un pointage
  - Transitions autorisées : `absent→en_poste`, `en_poste→pause`, `pause→en_poste`, `en_poste→terminé`
  - Refuser les transitions invalides (ex: `absent→terminé`)
  - `GET /api/pointage/:employeId/aujourd-hui` — Pointages du jour
  - `GET /api/pointage/rapport` — Rapport hebdomadaire/mensuel
  - `GET /api/pointage/export` — Export CSV présences
- [ ] **Ajouter le lien `Personnel`** dans la sidebar de toutes les pages HTML
- [ ] **Protéger les routes** — Manager + Admin uniquement

---

### 1.10 — Module Boutiques
> Compléter `settings.html` et créer le backend boutiques

- [ ] **`GET /api/boutiques`** — Liste des boutiques
- [ ] **`POST /api/boutiques`** — Créer une boutique
- [ ] **`GET /api/boutiques/:id`** — Détail boutique
- [ ] **`PUT /api/boutiques/:id`** — Modifier (nom, adresse, SIRET, TVA)
- [ ] **`PUT /api/boutiques/:id/settings`** — Paramètres (horaires, notifications, paiement)
- [ ] **Mettre à jour `settings.html`** — Formulaires branchés sur l'API
- [ ] **Sélecteur de boutique global** — Header avec boutique active (localStorage)

---

### 1.11 — Mise à jour de `wrangler.jsonc`
> Configurer D1, KV et les secrets pour le Sprint 1

- [ ] Ajouter le binding `DB` (D1) avec l'ID obtenu
- [ ] Ajouter le binding `KV` (KV namespace) avec l'ID obtenu
- [ ] Documenter les secrets requis dans `.dev.vars.example`
- [ ] Créer `.dev.vars` (local) avec les valeurs de dev

---

### 1.12 — Mise à jour Frontend (après branchement API)
> Remplacer toutes les données mockées par des appels API réels

- [ ] **`dashboard.js`** — KPIs réels depuis `/api/stats`
- [ ] **`app.js`** — Stocker le JWT réel, décoder les rôles, cacher/montrer les menus selon rôle
- [ ] **Créer `src/api/stats.ts`** — Endpoint `/api/stats` (dashboard KPIs depuis D1)
- [ ] **Gestion des erreurs 401** — Redirection vers login si token expiré

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
- [ ] `GET /api/stats` — CA du jour/semaine/mois, tickets en cours, stock bas
- [ ] Graphiques Chart.js branchés sur données réelles

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

Ces fonctionnalités sont documentées dans le CDC mais hors périmètre des 4 sprints :

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
| Auth JWT | 🔄 | — | OAuth | — |
| RBAC | 🔄 | — | — | — |
| Boutiques | 🔄 | — | — | Multi |
| Clients | 🔄 | Flux | — | RGPD |
| Tickets | 🔄 | Photos | Notifs | — |
| Stock | 🔄 | — | Fournisseurs | Import |
| Devis/Factures | 🔄 | PDF | — | — |
| NF525 | 🔄 | — | — | — |
| Personnel | 🔄 | Commissions | — | Planning |
| Dashboard | 🔄 | Réel | — | Multi |
| Email | — | — | 🔄 | — |
| SMS | — | — | 🔄 | — |
| Qualirépar | — | — | 🔄 | — |

**Légende** : 🔄 En cours / dans ce sprint | — Non concerné

---

## 🏗️ Architecture Technique — Rappel

```
Cloudflare Pages (dist/)
├── HTML statiques servis par Cloudflare CDN (280 PoP mondiaux)
└── /functions/ → Hono Workers (src/index.tsx)
    ├── /api/auth/*    → JWT, OTP, OAuth
    ├── /api/clients/* → D1 : table clients, appareils
    ├── /api/tickets/* → D1 : table tickets, interventions
    ├── /api/produits/ → D1 : table produits, mouvements_stock
    ├── /api/factures/ → D1 : table factures + NF525 journal
    ├── /api/personnel/ → D1 : table employes, pointages
    └── /api/stats     → D1 : requêtes agrégées KPIs

Cloudflare D1 (SQLite edge)
├── 9 migrations SQL
└── Accès via env.DB.prepare()

Cloudflare KV
├── OTP temporaires (TTL 10min)
└── Refresh tokens JWT (TTL 7j)

Cloudflare R2
└── Photos réparations (Sprint 2)
```

---

*Mis à jour automatiquement à chaque sprint — prochaine révision prévue après Sprint 1*
