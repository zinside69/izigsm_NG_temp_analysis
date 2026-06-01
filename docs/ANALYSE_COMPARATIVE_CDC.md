# Analyse Comparative — CDC iziGSM vs Implémentation Actuelle
> **Date de l'analyse** : 1er juin 2026  
> **Version analysée** : CDC sections (docx) + LISTE_FONCTIONNALITES v2.4.0 vs webapp Cloudflare Pages v1.0.0  
> **Auteur** : Analyse IA assistée

---

## 1. Vue d'ensemble des deux projets

| Dimension | **CDC izigsm (docs fournis)** | **Implémentation webapp (Cloudflare Pages)** |
|-----------|-------------------------------|---------------------------------------------|
| **Architecture cible** | PHP/HTML + Node.js microservices | HTML/JS statique + Hono (Cloudflare Workers) |
| **Backend** | 6 microservices Node.js (ports 3001-3006) | API unique Hono sur Workers |
| **Frontend** | PHP BFF + Bootstrap 5.3 (MVC complet) | HTML statique + Tailwind CSS |
| **Base de données** | PostgreSQL (multi-BDD par service) | Cloudflare D1 (SQLite) — à implémenter |
| **Stockage fichiers** | MinIO / S3 | Cloudflare R2 — à implémenter |
| **Cache** | Redis | Cloudflare KV — à implémenter |
| **Authentification** | JWT + OAuth2 (Google, Facebook) | JWT démo local (no persistence) |
| **Déploiement** | Docker / VPS (PM2) | Cloudflare Pages (edge) |
| **Statut docs** | v2.4.0 "Production Ready" | Prototype fonctionnel — pages HTML finies |

---

## 2. Cartographie Fonctionnelle — Comparaison Détaillée

### 2.1 Authentification & Autorisation

| Fonctionnalité | **CDC (LISTE v2.4.0)** | **Webapp actuelle** | **Écart** |
|----------------|------------------------|---------------------|-----------|
| Login email/password | ✅ Auth Service :3001 | ✅ `/api/login` (démo) | ⚠️ Démo sans persistance |
| Inscription | ✅ Formulaire complet | ✅ `/api/register` + OTP | ⚠️ OTP non envoyé réellement |
| Vérification email (OTP) | ✅ | ✅ `/api/verify-otp` | ⚠️ Démo (OTP retourné en clair) |
| JWT + Refresh Tokens | ✅ | ⚠️ JWT démo (`demo_timestamp`) | 🔴 JWT réel non implémenté |
| OAuth2 Google | ✅ | ❌ | 🔴 Absent |
| OAuth2 Facebook | ✅ | ❌ | 🔴 Absent |
| RBAC (rôles) | ✅ Admin, Manager, Technicien, Client | ❌ | 🔴 Absent |
| Permissions granulaires | ✅ | ❌ | 🔴 Absent |
| CSRF Protection | ✅ | ❌ (non applicable côté Workers) | ⚠️ Architecture différente |
| Réinitialisation mdp | ✅ | ❌ | 🔴 Absent |
| Gestion sessions | ✅ PHP sessions | ⚠️ localStorage token | ⚠️ Approche différente |

**Score : 3/11 ✅ | 3/11 ⚠️ | 5/11 ❌**

---

### 2.2 Gestion des Boutiques

| Fonctionnalité | **CDC** | **Webapp** | **Écart** |
|----------------|---------|------------|-----------|
| CRUD boutiques | ✅ Boutique Service :3002 | ❌ | 🔴 Absent |
| Multi-boutiques | ✅ | ❌ | 🔴 Absent |
| Horaires d'ouverture | ✅ | ❌ | 🔴 Absent |
| Paramètres facturation (TVA, SIRET) | ✅ | ❌ | 🔴 Absent |
| Paramètres notifications | ✅ | ❌ | 🔴 Absent |

**Score : 0/5 ✅ | 0/5 ⚠️ | 5/5 ❌**

> ⚠️ Module entier manquant dans l'implémentation actuelle. La page `settings.html` existe mais sans backend de boutique.

---

### 2.3 Gestion des Clients

| Fonctionnalité | **CDC** | **Webapp** | **Écart** |
|----------------|---------|------------|-----------|
| CRUD clients | ✅ Client Service :3003 | ✅ `clients.html` + `clients.js` | ⚠️ UI OK, API démo |
| Recherche clients | ✅ | ✅ Filtres dans clients.js | ✅ |
| Profil client | ✅ | ✅ | ⚠️ Données mockées |
| Historique réparations par client | ✅ | ✅ Modal "tickets client" | ⚠️ Données mockées |
| Gestion appareils (IMEI, S/N) | ✅ Appareil Service | ❌ Non présent dans clients.js | 🔴 Absent |
| Adresse de facturation | ✅ | ⚠️ Partiel (champs présents) | ⚠️ Pas de validation |
| Export CSV | ✅ | ✅ Présent dans clients.js | ✅ |
| Signature numérique tablette | ✅ CDC | ❌ | 🔴 Absent |
| Avis clients automatisés | ✅ CDC | ❌ | 🔴 Absent |

**Score : 3/9 ✅ | 3/9 ⚠️ | 3/9 ❌**

---

### 2.4 Gestion des Réparations / Tickets

| Fonctionnalité | **CDC** | **Webapp** | **Écart** |
|----------------|---------|------------|-----------|
| Création tickets réparation | ✅ Réparation Service :3004 | ✅ `tickets.html` + `tickets.js` | ⚠️ UI OK, sans persistance |
| Assignation technicien | ✅ | ⚠️ Champ présent | ⚠️ Non relié |
| Suivi de statut | ✅ Machine à états | ✅ Statuts visuels | ⚠️ Local seulement |
| Photos avant/après (upload AJAX) | ✅ + compression | ❌ | 🔴 Absent |
| Notifications SMS/Email/WhatsApp | ✅ | ❌ | 🔴 Absent |
| Devis → Facture (conversion) | ✅ | ⚠️ `devis.html` séparé | ⚠️ Flux non relié |
| Gestion SAV / Garanties | ✅ CDC | ❌ | 🔴 Absent |
| Prise RDV chatbot IA | ✅ CDC | ❌ | 🔴 Absent (feature avancée) |
| Diagnostics | ✅ | ⚠️ Partiel | ⚠️ |

**Score : 1/9 ✅ | 4/9 ⚠️ | 4/9 ❌**

---

### 2.5 Gestion des Stocks

| Fonctionnalité | **CDC** | **Webapp** | **Écart** |
|----------------|---------|------------|-----------|
| CRUD produits (SKU, prix, fournisseur) | ✅ Stock Service :3005 | ✅ `stock.html` + `stock.js` | ⚠️ UI OK, sans persistance |
| Catégories hiérarchiques | ✅ | ⚠️ Catégories plates | ⚠️ Hiérarchie absente |
| Mouvements de stock | ✅ | ✅ Ajustement quantités dans stock.js | ⚠️ Local seulement |
| Alertes stock bas | ✅ | ✅ KPI + alertes visuelles dans stock.js | ✅ (UI) |
| Calcul de marge temps réel | ✅ | ⚠️ Non présent dans UI | ⚠️ |
| Catalogues fournisseurs (Mobilax, Utopya…) | ✅ CDC | ❌ | 🔴 Absent |
| Scanner codes-barres | ✅ CDC | ❌ | 🔴 Absent |
| Export CSV stock | ✅ | ✅ Présent dans stock.js | ✅ |
| Inventaires | ✅ POS | ❌ | 🔴 Absent |

**Score : 2/9 ✅ | 4/9 ⚠️ | 3/9 ❌**

---

### 2.6 Facturation & Paiements

| Fonctionnalité | **CDC** | **Webapp** | **Écart** |
|----------------|---------|------------|-----------|
| Création factures | ✅ Facturation Service :3006 | ✅ `factures.html` + `factures.js` | ⚠️ UI OK, sans persistance |
| Devis | ✅ | ✅ `devis.html` + `devis.js` | ⚠️ UI OK, sans persistance |
| Calcul HT/TVA/TTC automatique | ✅ | ⚠️ Partiel côté UI | ⚠️ |
| Conformité NF525 (SHA-256) | ✅ | ❌ | 🔴 Absent (critique légal) |
| Paiements Stripe/PayPal | ✅ | ❌ | 🔴 Absent |
| Multi-modes (CB, espèces, chèque…) | ✅ POS | ❌ | 🔴 Absent |
| Signature électronique | ✅ | ❌ | 🔴 Absent |
| Gestion avoirs/retours | ✅ | ❌ | 🔴 Absent |
| Export PDF factures | ✅ CDC | ❌ | 🔴 Absent |

**Score : 0/9 ✅ | 3/9 ⚠️ | 6/9 ❌**

---

### 2.7 Tableau de Bord & Reporting

| Fonctionnalité | **CDC** | **Webapp** | **Écart** |
|----------------|---------|------------|-----------|
| KPI chiffre d'affaires | ✅ | ✅ `dashboard.html` + `dashboard.js` | ⚠️ Données mockées |
| KPI réparations | ✅ | ✅ | ⚠️ Données mockées |
| Graphiques performance | ✅ | ✅ Chart.js présent | ⚠️ Données mockées |
| Reporting par boutique/technicien | ✅ | ❌ | 🔴 Absent |
| Export Excel/PDF/CSV | ✅ | ⚠️ CSV uniquement | ⚠️ Partiel |
| Tableaux de bord personnalisables | ✅ CDC | ❌ | 🔴 Absent |
| Rotation des stocks | ✅ | ⚠️ Partiel dans stock.js | ⚠️ |

**Score : 0/7 ✅ | 4/7 ⚠️ | 3/7 ❌**

---

### 2.8 Personnel & Pointage *(CDC v2.3.0)*

| Fonctionnalité | **CDC** | **Webapp** | **Écart** |
|----------------|---------|------------|-----------|
| Profils employés + rôles | ✅ | ❌ | 🔴 Absent |
| Pointage (4 états : absent/en poste/pause/terminé) | ✅ | ❌ | 🔴 Absent |
| Machine à états pointage | ✅ | ❌ | 🔴 Absent |
| Attribution des tâches | ✅ CDC | ❌ | 🔴 Absent |
| Calcul commissions/primes | ✅ CDC | ❌ | 🔴 Absent |
| Export présences | ✅ | ❌ | 🔴 Absent |
| Planning | ✅ CDC | ❌ | 🔴 Absent |

**Score : 0/7 ✅ | 0/7 ⚠️ | 7/7 ❌**

> ⚠️ Module entier absent dans la webapp.

---

### 2.9 Intégration Qualirépar

| Fonctionnalité | **CDC** | **Webapp** | **Écart** |
|----------------|---------|------------|-----------|
| Page Qualirépar | ✅ | ✅ `qualirepar.html` + `qualirepar.js` | ⚠️ UI présente |
| Déclaration bonus réparation API | ✅ | ❌ | 🔴 Absent |
| Rappels paiement automatisés | ✅ | ❌ | 🔴 Absent |
| Synchronisation API Qualirépar | ✅ | ❌ | 🔴 Absent |

**Score : 0/4 ✅ | 1/4 ⚠️ | 3/4 ❌**

---

### 2.10 Services Communs & Intégrations

| Fonctionnalité | **CDC** | **Webapp** | **Écart** |
|----------------|---------|------------|-----------|
| Email (SMTP/Mailgun/SendGrid) | ✅ email-service.js | ❌ | 🔴 Absent |
| SMS (Twilio/OVH) | ✅ sms-service.js | ❌ | 🔴 Absent |
| WhatsApp Business | ✅ CDC | ❌ | 🔴 Absent |
| Stockage fichiers (MinIO/S3) | ✅ storage-service.js | ❌ (R2 prévu) | 🔴 Non implémenté |
| Cache Redis | ✅ cache-service.js | ❌ (KV prévu) | 🔴 Non implémenté |
| Géolocalisation | ✅ geo-service.js | ❌ | 🔴 Absent |
| Intégration fournisseurs (Mobilax, Utopya, Phone LCD) | ✅ CDC | ❌ | 🔴 Absent |
| Paiement Stripe | ✅ payment-service.js | ❌ | 🔴 Absent |
| OAuth2 Google/Facebook | ✅ oauth-service.js | ❌ | 🔴 Absent |

**Score : 0/9 ✅ | 0/9 ⚠️ | 9/9 ❌**

---

### 2.11 Marketing & CRM *(CDC)*

| Fonctionnalité | **CDC** | **Webapp** | **Écart** |
|----------------|---------|------------|-----------|
| Campagnes Email/SMS | ✅ CDC | ❌ | 🔴 Absent |
| Collecte avis clients automatisée | ✅ CDC | ❌ | 🔴 Absent |
| Réponses avis via IA (ChatGPT) | ✅ CDC | ❌ | 🔴 Absent |
| SEO / Google Ads | ✅ CDC | ❌ | 🔴 Hors périmètre app |
| Boîte de réception unifiée (WhatsApp, SMS, FB, Google) | ✅ CDC | ❌ | 🔴 Absent |
| Fidélisation clients | ✅ CDC | ❌ | 🔴 Absent |

**Score : 0/6 ✅ | 0/6 ⚠️ | 6/6 ❌**

---

### 2.12 Sécurité & Conformité

| Fonctionnalité | **CDC** | **Webapp** | **Écart** |
|----------------|---------|------------|-----------|
| HTTPS | ✅ | ✅ Cloudflare natif | ✅ |
| Chiffrement bcrypt (mots de passe) | ✅ | ❌ (démo) | 🔴 Absent |
| Protection XSS / SQL Injection | ✅ Helmet.js | ⚠️ Cloudflare WAF (partiel) | ⚠️ |
| Rate Limiting | ✅ | ⚠️ Cloudflare natif | ⚠️ Partiel |
| RGPD | ✅ CDC | ⚠️ Mentions légales présentes | ⚠️ Partiel |
| NF525 (conformité caisse) | ✅ SHA-256 | ❌ | 🔴 **CRITIQUE** — légal |
| Sauvegardes automatiques PostgreSQL | ✅ | ❌ (D1 géré Cloudflare) | ⚠️ Différent |
| CORS restreint | ✅ | ⚠️ CORS `*` en dev | ⚠️ À durcir |

**Score : 2/8 ✅ | 4/8 ⚠️ | 2/8 ❌**

---

## 3. Récapitulatif Global — Tableau de Synthèse

| Module | Fonctionnalités CDC | ✅ Implémenté | ⚠️ Partiel | ❌ Absent | % Coverage |
|--------|---------------------|--------------|-----------|----------|------------|
| Authentification | 11 | 3 | 3 | 5 | **27%** |
| Boutiques | 5 | 0 | 0 | 5 | **0%** |
| Clients | 9 | 3 | 3 | 3 | **33%** |
| Réparations/Tickets | 9 | 1 | 4 | 4 | **11%** |
| Stocks | 9 | 2 | 4 | 3 | **22%** |
| Facturation/Paiements | 9 | 0 | 3 | 6 | **0%** |
| Tableau de bord | 7 | 0 | 4 | 3 | **0%** |
| Personnel & Pointage | 7 | 0 | 0 | 7 | **0%** |
| Qualirépar | 4 | 0 | 1 | 3 | **0%** |
| Services communs | 9 | 0 | 0 | 9 | **0%** |
| Marketing & CRM | 6 | 0 | 0 | 6 | **0%** |
| Sécurité | 8 | 2 | 4 | 2 | **25%** |
| **TOTAL** | **93** | **11** | **26** | **56** | **~12%** |

> **Couverture actuelle** : ~12% des fonctionnalités CDC sont pleinement implémentées, ~28% partiellement, ~60% absentes.

---

## 4. Gap Analysis Détaillé — Priorisé

### 🔴 PRIORITÉ CRITIQUE (P0) — Bloquants légaux et fonctionnels

| # | Gap | Impact | Effort | Notes |
|---|-----|--------|--------|-------|
| G01 | **Conformité NF525** (chaîne SHA-256 factures) | Légal obligatoire | Moyen | Requis pour exploiter un logiciel de caisse en France |
| G02 | **Persistance des données** (D1 / PostgreSQL) | Fonctionnel bloquant | Élevé | Toutes les pages utilisent des données mockées |
| G03 | **JWT réel** + refresh tokens | Sécurité critique | Moyen | Actuellement `demo_${Date.now()}` — non sécurisé |
| G04 | **RBAC** rôles et permissions | Sécurité critique | Moyen | Aucun contrôle d'accès en place |

---

### 🟠 PRIORITÉ HAUTE (P1) — Fonctionnalités cœur métier

| # | Gap | Module concerné | Effort |
|---|-----|-----------------|--------|
| G05 | Persistance clients en D1 | Clients | Moyen |
| G06 | Persistance tickets/réparations en D1 | Tickets | Moyen |
| G07 | Persistance stocks en D1 | Stock | Moyen |
| G08 | Persistance factures + devis en D1 | Facturation | Moyen |
| G09 | Calcul HT/TVA/TTC côté API | Facturation | Faible |
| G10 | Gestion des appareils (IMEI, S/N) par client | Clients | Faible |
| G11 | Module Boutiques (CRUD + settings) | Boutiques | Moyen |
| G12 | Upload photos réparation (Cloudflare R2) | Tickets | Élevé |
| G13 | Notifications email (Resend/SendGrid) | Transversal | Moyen |

---

### 🟡 PRIORITÉ MOYENNE (P2) — Fonctionnalités différenciantes

| # | Gap | Module concerné | Effort |
|---|-----|-----------------|--------|
| G14 | Module Personnel & Pointage | Personnel | Élevé |
| G15 | API Qualirépar (déclaration bonus) | Qualirépar | Moyen |
| G16 | OAuth2 Google | Auth | Moyen |
| G17 | SMS notifications (Twilio) | Transversal | Moyen |
| G18 | Import catalogues fournisseurs | Stock | Élevé |
| G19 | Reporting par boutique/technicien | Dashboard | Moyen |
| G20 | Export PDF factures | Facturation | Moyen |
| G21 | Multi-boutiques (filtre par boutique) | Transversal | Élevé |
| G22 | Calcul commissions/primes techniciens | Personnel | Moyen |

---

### 🟢 PRIORITÉ BASSE (P3) — Backlog futur

| # | Gap | Notes |
|---|-----|-------|
| G23 | WhatsApp Business intégration | API Meta — coûteux |
| G24 | Chatbot IA prise de RDV | Feature avancée |
| G25 | Réponses avis IA (ChatGPT) | Intégration OpenAI |
| G26 | Campagnes marketing Email/SMS | Module CRM dédié |
| G27 | Application mobile (React Native) | Développement natif |
| G28 | Mode hors-ligne PWA | Service Worker |
| G29 | Scanner codes-barres (navigateur) | API BarcodeDetector |
| G30 | Signature numérique tablette | Canvas + signature pad |

---

## 5. Analyse des Divergences Architecturales

### 5.1 Architecture CDC vs Implémentation

| Aspect | CDC (documents) | Webapp Cloudflare |
|--------|-----------------|-------------------|
| **Paradigme** | Microservices + BFF PHP | Monolithique edge (Workers) |
| **Base de données** | PostgreSQL par service | D1 SQLite unique |
| **Session** | PHP sessions serveur | JWT localStorage côté client |
| **Rendu** | PHP server-side | HTML statique + JS client-side |
| **Déploiement** | VPS / Docker | Cloudflare Pages/Workers |
| **Cache** | Redis | Cloudflare KV |
| **Fichiers** | MinIO/S3 | Cloudflare R2 |

**Conclusion** : Les deux architectures sont fondamentalement différentes mais compatibles en termes de fonctionnalités. La webapp Cloudflare est une **réinterprétation edge-native** du CDC, avec les adaptations suivantes nécessaires :

- `PostgreSQL` → `Cloudflare D1` (SQLite) ✅ Compatible
- `Redis` → `Cloudflare KV` ✅ Compatible  
- `MinIO/S3` → `Cloudflare R2` ✅ Compatible
- `PHP sessions` → `JWT Worker` ✅ Compatible (plus sécurisé)
- `Microservices` → `Routes Hono` ⚠️ Simplifié mais fonctionnel pour MVP

### 5.2 Avantages de l'Architecture Cloudflare

| Avantage | Détail |
|----------|--------|
| **Coût** | Gratuit jusqu'à 100k req/jour vs VPS dédié |
| **Performance** | Edge mondial, latence < 50ms |
| **Scalabilité** | Automatique, pas de config DevOps |
| **Sécurité** | DDoS, WAF, SSL inclus |
| **Simplicité ops** | Pas de Docker, PM2, serveurs à gérer |

### 5.3 Limitations vs CDC

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| Pas de WebSockets natifs | Notifications temps réel impossibles | Cloudflare Durable Objects |
| CPU 10ms/requête | Calculs lourds limités | Découper les opérations |
| Pas de PHP | Réécriture complète BFF | Déjà fait en JS |
| SQLite D1 (no stored procs) | Logique SQL limitée | Logique métier dans Workers |

---

## 6. Analyse des Actions Manuelles Restantes

*Source : `ACTIONS_MANUELLES.md`*

Les actions manuelles du CDC PHP/Node.js doivent être **réinterprétées** pour l'environnement Cloudflare :

| Action CDC | Équivalent Cloudflare | Statut |
|------------|-----------------------|--------|
| JWT_SECRET dans .env | `wrangler secret put JWT_SECRET` | ❌ À faire |
| OAuth2 Google credentials | `wrangler secret put GOOGLE_CLIENT_ID` | ❌ À faire |
| OAuth2 Facebook credentials | `wrangler secret put FACEBOOK_APP_ID` | ❌ À faire |
| SMTP credentials | `wrangler secret put SMTP_HOST/USER/PASS` | ❌ À faire |
| Twilio credentials | `wrangler secret put TWILIO_*` | ❌ À faire |
| Stripe credentials | `wrangler secret put STRIPE_SECRET_KEY` | ❌ À faire |
| PostgreSQL init (init-db.sh) | Migrations D1 (SQL files) | ❌ À créer |
| Docker compose up | Rien (Cloudflare gère tout) | ✅ N/A |
| PM2 ecosystem config | Rien (Workers serverless) | ✅ N/A |
| Router PHP session validation | Middleware Hono JWT | ❌ À implémenter |

---

## 7. Plan de Développement Recommandé

### Sprint 1 — Fondations (2 semaines)
> Objectif : Rendre les données persistantes et l'auth réelle

1. **[G02]** Créer les migrations D1 (tables : users, boutiques, clients, appareils, tickets, produits, stocks, factures, devis)
2. **[G03]** Implémenter JWT réel avec `hono/jwt` + refresh tokens dans KV
3. **[G04]** Middleware RBAC (rôles : admin, manager, technicien)
4. **[G05-G08]** Connecter tous les endpoints API aux tables D1
5. **[G01]** Implémenter la chaîne NF525 (SHA-256 sur factures)

### Sprint 2 — Fonctionnalités Cœur (3 semaines)
> Objectif : Modules complets opérationnels

1. **[G11]** Module Boutiques complet (CRUD + settings TVA/SIRET)
2. **[G10]** Gestion appareils avec IMEI/S/N
3. **[G12]** Upload photos R2 (tickets réparation)
4. **[G13]** Service email (Resend API)
5. **[G09]** Calcul HT/TVA/TTC automatique
6. **[G20]** Export PDF factures (html-to-pdf côté client)

### Sprint 3 — Intégrations (2 semaines)
> Objectif : Connecter les services tiers

1. **[G15]** API Qualirépar (déclarations bonus)
2. **[G16]** OAuth2 Google (Cloudflare OAuth flow)
3. **[G17]** SMS via Twilio (notifications)
4. **[G19]** Reporting avancé (graphiques par boutique/tech)
5. **[G22]** Calcul commissions simples

### Sprint 4 — Personnel & Avancé (3 semaines)
> Objectif : Module RH + multi-boutiques

1. **[G14]** Module Personnel (profils, pointage, machine à états)
2. **[G21]** Multi-boutiques (sélecteur global, filtrage données)
3. **[G18]** Import catalogues fournisseurs (CSV/XML)
4. Hardening sécurité (CORS restreint, rate limiting API)

---

## 8. État des Pages HTML Actuelles vs CDC

| Page HTML | Présente | JS Associé | API Backend | Persistance | CDC couvert |
|-----------|----------|------------|-------------|-------------|-------------|
| `index.html` (landing) | ✅ | `home.js` | ❌ | N/A | Vitrine |
| `login.html` | ✅ | `app.js` | ✅ `/api/login` | ❌ démo | Auth partiel |
| `register.html` | ✅ | `register.js` | ✅ `/api/register` | ❌ démo | Auth partiel |
| `verify-email.html` | ✅ | `app.js` | ✅ `/api/verify-otp` | ❌ démo | Auth partiel |
| `dashboard.html` | ✅ | `dashboard.js` | ❌ | ❌ mock | Dashboard |
| `clients.html` | ✅ | `clients.js` | ❌ | ❌ mock | Clients |
| `tickets.html` | ✅ | `tickets.js` | ❌ | ❌ mock | Réparations |
| `stock.html` | ✅ | `stock.js` | ❌ | ❌ mock | Stocks |
| `devis.html` | ✅ | `devis.js` | ❌ | ❌ mock | Devis |
| `factures.html` | ✅ | `factures.js` | ❌ | ❌ mock | Facturation |
| `qualirepar.html` | ✅ | `qualirepar.js` | ❌ | ❌ mock | Qualirépar |
| `settings.html` | ✅ | — | ❌ | ❌ | Boutiques |
| `modules.html` | ✅ | — | ❌ | N/A | Info |
| `legal.html` | ✅ | — | ❌ | N/A | RGPD |
| **Personnel** | ❌ **MANQUANT** | ❌ | ❌ | ❌ | Personnel |
| **Boutiques CRUD** | ❌ **MANQUANT** | ❌ | ❌ | ❌ | Boutiques |

---

## 9. Principes Architecturaux — Conformité

*Source : `ARCHITECTURAL_PRINCIPLES.md`*

| Principe | CDC | Webapp actuelle | Conforme ? |
|----------|-----|-----------------|------------|
| Modularité — modules indépendants | ✅ Microservices | ✅ Routes Hono séparées | ✅ |
| Communication exclusive via APIs | ✅ | ✅ | ✅ |
| Frontend découplé du backend | ✅ PHP BFF | ✅ HTML + API Workers | ✅ |
| PHP pour le rendu | ✅ Obligatoire (doc) | ❌ Remplacé par HTML/JS | ⚠️ **Divergence intentionnelle** |
| MVC | ✅ | ⚠️ Non formalisé | ⚠️ |
| Documentation code obligatoire | ✅ | ⚠️ Partielle | ⚠️ |
| Toutes opérations CRUD via API | ✅ | ⚠️ Prévu mais non connecté | ⚠️ |

> **Note importante** : La divergence PHP → HTML/JS est **intentionnelle** et justifiée par le déploiement Cloudflare Pages (impossibilité d'exécuter PHP). L'esprit du principe (découplage BFF) est respecté.

---

## 10. Conclusions et Recommandations

### Ce qui est bien fait ✅
1. **Toutes les pages HTML existent** — l'UI couvre ~90% des écrans nécessaires
2. **Architecture edge-native** — meilleure performance et coût vs VPS
3. **Qualirépar présent** — page dédiée avec UI fonctionnelle
4. **Export CSV** — clients et stocks déjà exportables
5. **Responsive design** — Tailwind CSS, adapté mobile

### Blocages critiques à résoudre 🔴
1. **Aucune persistance des données** — tout est simulé (mockées)
2. **JWT non sécurisé** — `demo_timestamp` non chiffré
3. **NF525 absent** — blocage légal pour utilisation en production
4. **RBAC absent** — n'importe qui peut accéder à n'importe quoi

### Features CDC non présentes dans la webapp 🟠
1. Module **Personnel & Pointage** (page + API)
2. Module **Boutiques CRUD** (settings.html existe mais incomplet)
3. **Upload de photos** (réparations avant/après)
4. **Notifications** (email/SMS)
5. **Intégration fournisseurs** (Mobilax, Utopya, Phone LCD)

### Recommandation de priorité
> **Commencer par le Sprint 1 : Migrations D1 + JWT réel + RBAC**  
> Sans persistance des données, l'application est un prototype non utilisable en production.  
> La conformité NF525 doit être traitée en parallèle dès le Sprint 1 car c'est une obligation légale française.

---

*Document généré le 1er juin 2026 — À mettre à jour après chaque sprint*
