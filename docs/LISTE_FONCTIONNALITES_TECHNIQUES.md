# LISTE TECHNIQUE COMPLÈTE - PLATEFORME IZIGSM

**Date** : 1er mars 2026
**Version** : 2.4.0
**Statut** : Production Ready

---

## 📋 INDEX DES FONCTIONNALITÉS

1. [Authentification & Autorisation](#1-fonctionnalités-dauthentification--autorisation)
2. [Gestion des Boutiques](#2-gestion-des-boutiques)
3. [Gestion des Clients](#3-gestion-des-clients)
4. [Gestion des Réparations](#4-gestion-des-réparations)
5. [Gestion des Stocks](#5-gestion-des-stocks)
6. [Facturation & Paiements](#6-facturation--paiements)
7. [Tableau de Bord & Reporting](#7-tableau-de-bord--reporting)
8. [Services Communs & Intégrations](#8-services-communs--intégrations)
9. [Intégration Qualirépar](#9-intégration-qualirépar)
10. [Interface Utilisateur Frontend](#10-interface-utilisateur-frontend)
11. [Sécurité & Protection](#11-sécurité--protection)
12. [API Gateway & Orchestration](#12-api-gateway--orchestration)
13. [Infrastructure & Déploiement](#13-infrastructure--déploiement)
14. [Performances & Monitoring](#14-performances--monitoring)
15. [Documentation & Support](#15-documentation--support)
16. [Personnel & Pointage *(nouveau — v2.3.0)*](#16-personnel--pointage)
17. [Gestion des Processus — PM2 *(nouveau — v2.4.0)*](#17-gestion-des-processus--pm2)
18. [Changelog des Modifications](#18-changelog-des-modifications)

---

## 1. FONCTIONNALITÉS D'AUTHENTIFICATION & AUTORISATION

**Service** : Auth Service (:3001)

### Authentification
- ✅ Connexion utilisateur (email/password)
- ✅ Inscription de nouveaux utilisateurs
- ✅ Réinitialisation de mot de passe
- ✅ Authentification JWT avec refresh tokens
- ✅ Authentification OAuth2 (Google, Facebook)
- ✅ Gestion des sessions utilisateur
- ✅ Vérification CSRF sur tous les formulaires

### Autorisation & Rôles
- ✅ Système RBAC (Role-Based Access Control)
- ✅ Gestion des rôles (créer, modifier, supprimer)
- ✅ Permissions granulaires par rôle
- ✅ Gestion des utilisateurs (CRUD)
- ✅ Middleware de permission pour protéger les routes
- ✅ Rôles par défaut : Admin, Manager, Technicien, Client

---

## 2. GESTION DES BOUTIQUES

**Service** : Boutique Service (:3002)

### Fonctionnalités Boutiques
- ✅ Créer/Modifier/Supprimer une boutique
- ✅ Lister toutes les boutiques
- ✅ Afficher les détails d'une boutique
- ✅ Gestion des informations boutique (nom, adresse, téléphone, email)
- ✅ Support multi-boutiques

### Paramètres Boutique
- ✅ Configuration des paramètres de boutique
- ✅ Gestion des horaires d'ouverture
- ✅ Paramètres de facturation (taux TVA, numéro SIRET, etc.)
- ✅ Configuration des notifications
- ✅ Paramètres de paiement

---

## 3. GESTION DES CLIENTS

**Service** : Client Service (:3003)

### Gestion Clients
- ✅ Créer/Modifier/Supprimer clients
- ✅ Lister et rechercher clients
- ✅ Afficher le profil client
- ✅ Historique des réparations par client
- ✅ Contact (email, téléphone)
- ✅ Adresse de facturation

### Gestion des Appareils
- ✅ Ajouter/Modifier/Supprimer appareils client
- ✅ Typage des appareils (Smartphone, Tablette, Portable, etc.)
- ✅ Marques et modèles
- ✅ Numéros de série
- ✅ IMEI/Numéro d'identification
- ✅ Note de description de l'appareil
- ✅ Historique de réparations par appareil

---

## 4. GESTION DES RÉPARATIONS

**Service** : Réparation Service (:3004)

### Création & Suivi des Réparations
- ✅ Créer une réparation (ticket)
- ✅ Assigner une réparation à un technicien
- ✅ Détailler le diagnostic initial
- ✅ Estimation des frais de réparation
- ✅ Durée estimée
- ✅ Pièces requises

### Gestion des Statuts de Réparation
- ✅ Statuts : En attente → Acceptée → En cours → Complétée → Livrée
- ✅ Changer le statut d'une réparation
- ✅ Historique des changements de statut
- ✅ Raisons de rejet/annulation

### Interventions & Photos
- ✅ Enregistrer les interventions effectuées
- ✅ Décrire les actions réalisées
- ✅ Ajouter/modifier une description
- ✅ **Upload AJAX de photos avant/après** *(v2.4.0)* — 5 slots par section, sans rechargement de page
- ✅ **Compression client-side** *(v2.4.0)* — Canvas API : JPEG 80 %, max 1200 px (réduit la bande passante et le stockage)
- ✅ **Support HEIC/HEIF** *(v2.4.0)* — photos iPhone converties en JPEG via `heic2any` avant envoi ; fallback natif Safari
- ✅ **Formats acceptés** *(v2.4.0)* — JPG · PNG · WebP · HEIC/HEIF (whitelist Multer côté Node.js)
- ✅ **Suppression AJAX** *(v2.4.0)* — suppression photo depuis MinIO/S3 + base de données sans rechargement
- ✅ **Purge automatique 6 mois** *(v2.4.0)* — cron quotidien 2h00 (`node-cron`) dans `cleanup-tasks.js` (conformité RGPD)
- ✅ **API photos complète** *(v2.4.0)* — 5 endpoints REST (liste, détail, URL signée, upload, suppression)
- ✅ **URL pré-signée S3** *(v2.4.0)* — endpoint `GET /:id/url` compatible stockage local et S3/MinIO privé
- ✅ Gestion des photos (stockage local ou MinIO/S3 selon `STORAGE_DRIVER`)
- ✅ Historique des modifications

### Notifications
- ✅ Notifications au client sur changement de statut
- ✅ Notifications par email
- ✅ Notifications par SMS
- ✅ Rappels de réparations en attente
- ✅ Notifications de clôture de réparation

---

## 5. GESTION DES STOCKS

**Service** : Stock Service (:3005)

### Catégories de Produits
- ✅ Créer/Modifier/Supprimer catégories
- ✅ Hiérarchie de catégories
- ✅ Statut actif/inactif des catégories

### Gestion des Produits
- ✅ Ajouter/Modifier/Supprimer produits
- ✅ Codes produits/SKU
- ✅ Descriptions détaillées
- ✅ Prix d'achat et prix de vente
- ✅ Fournisseurs associés
- ✅ Marges commerciales
- ✅ **Vues catalogue produits** *(v2.3.0)* — pages liste, création, modification
- ✅ **Modèles compatibles** *(v2.3.0)* — tag-input multi-valeur (Tagify) avec autocomplete
- ✅ **Calcul de marge en temps réel** *(v2.3.0)* — affichage immédiat à la saisie des prix
- ✅ **Autocomplete phone-specs-api** *(v2.3.0)* — suggestions depuis `phone-specs-api.vercel.app` + fallback JSON local (200+ modèles, 12 marques)

### Gestion des Stocks
- ✅ Affichage des quantités en stock
- ✅ Seuil minimum d'alerte
- ✅ Localisation en magasin (bac, rayon, etc.)
- ✅ Mouvements de stock (entrées/sorties)
- ✅ Historique des mouvements
- ✅ Ajustements d'inventaire
- ✅ Consommation lors des réparations

### Mouvements de Stock
- ✅ Entrée de stock (achat fournisseur)
- ✅ Sortie de stock (utilisation réparation)
- ✅ Retour fournisseur
- ✅ Inventaire (ajustement)
- ✅ Traçabilité complète

---

## 6. FACTURATION & PAIEMENTS

**Service** : Facturation Service (:3006)

### Gestion des Factures
- ✅ Créer factures automatiquement ou manuellement
- ✅ Générer factures à partir des réparations
- ✅ Numérotation séquentielle automatique
- ✅ Date d'émission et d'échéance
- ✅ Conditions de paiement configurables
- ✅ Devis avant facturation

### Détails de Facture
- ✅ Lignes de facture (articles, prestations)
- ✅ Tarification avec TVA
- ✅ Remises applicables
- ✅ Total avec/sans TVA
- ✅ Frais additionnels (port, emballage, etc.)
- ✅ Notes et conditions générales

### Paiements
- ✅ Paiement par carte bancaire (Stripe)
- ✅ Paiement PayPal
- ✅ Suivi des paiements (payée, partiellement payée, impayée)
- ✅ Historique des paiements
- ✅ Retenues et remboursements
- ✅ Rappels de paiement automatisés

### Conformité Légale
- ✅ Conformité NF525 (chaîne de hachage SHA-256)
- ✅ Signature électronique sur factures
- ✅ Archivage légal (durée de conservation)
- ✅ Génération PDF compliant

---

## 7. TABLEAU DE BORD & REPORTING

**Frontend PHP + Microservices**

### Dashboard Principal
- ✅ Statistiques globales (réparations, revenus, stocks)
- ✅ Réparations en cours
- ✅ Réparations à livrer
- ✅ Revenus du mois
- ✅ Alertes stocks critique
- ✅ Factures impayées
- ✅ Graphiques de performance

### Indicateurs Clés (KPI)
- ✅ Nombre de réparations par période
- ✅ Montant moyen par réparation
- ✅ Taux de fermeture (réparations complétées)
- ✅ Taux de satisfaction client (si implémenté)
- ✅ Chiffre d'affaires par boutique
- ✅ Rotation des stocks

---

## 8. SERVICES COMMUNS & INTÉGRATIONS

**Services Réutilisables**

### Services de Communication
- ✅ **Email Service** : SMTP/Mailgun/SendGrid
  - Envoi d'emails transactionnels
  - Rappels de paiement
  - Notifications de statut
  - Templates HTML

- ✅ **SMS Service** : Twilio/OVH
  - Notifications par SMS
  - Rappels de réparations
  - Confirmations de paiement

### Services de Stockage & Fichiers
- ✅ **Storage Service** : Stockage local/S3/MinIO
  - Upload de fichiers
  - Gestion de photos de réparation
  - Génération de PDF

- ✅ **MinIO Client**
  - Stockage d'objets compatible S3
  - Upload/Download de fichiers
  - Gestion des buckets

### Services de Paiement
- ✅ **Payment Service** : Stripe/PayPal
  - Traitement des paiements
  - Gestion des tokens
  - Remboursements
  - Webhooks de confirmation

### Services d'accès & Authentification
- ✅ **OAuth Service** : Google, Facebook
  - Authentification sociale
  - Récupération d'informations utilisateur
  - Gestion des tokens OAuth

### Services de Géolocalisation
- ✅ **Geo Service**
  - Géocodage (adresse → coordonnées)
  - Reverse géocodage (coordonnées → adresse)
  - Calcul de distances
  - Localisation des boutiques

### Services de Surveillance
- ✅ **Monitoring Service**
  - Health checks des microservices
  - Métriques de performance
  - Temps de réponse API
  - Logs d'erreur centralisés
  - Alertes système

### Services de Cache
- ✅ **Cache Service** : Redis
  - Cache des données fréquemment accédées
  - Sessions utilisateur
  - Fallback mémoire
  - Gestion de l'expiration

### Services de Recherche
- ✅ **Search Service** : Elasticsearch
  - Recherche full-text
  - Indexation des données
  - Filtrage avancé

### Services de Signature
- ✅ **Signature Service**
  - Signature électronique NF525
  - Horodatage

---

## 9. INTÉGRATION QUALIRÉPAR

**Service Externe (Écosystème Éco-Organisme)**

### Gestion du Bonus Réparation
- ✅ Déclaration de réparation éligible au bonus
- ✅ Calcul du bonus selon spécifications éco-organisme
- ✅ Suivi des bonus déclarés

### Rappels de Paiement
- ✅ Rappels de paiement automatisés
- ✅ Communication via email/SMS
- ✅ Historique des rappels

---

## 10. INTERFACE UTILISATEUR FRONTEND

**Frontend PHP/HTML**

### Pages d'Authentification
- ✅ Page de connexion
- ✅ Page d'inscription
- ✅ Page "Mot de passe oublié"
- ✅ Page "Réinitialiser mot de passe"

### Pages Principales
- ✅ Dashboard/Accueil
- ✅ Gestion des boutiques (Liste, Créer, Modifier)
- ✅ Gestion des clients (Liste, Créer, Modifier)
- ✅ Gestion des réparations (Liste, Créer, Modifier)
- ✅ Gestion des stocks (Liste, Créer, Modifier)
- ✅ Gestion des factures (Liste, Créer, Modifier, Visualiser PDF)

### Composants UI
- ✅ Header avec navigation
- ✅ Sidebar de navigation
- ✅ Footer
- ✅ Breadcrumb de navigation
- ✅ Système d'alertes (succès, erreur, avertissement)
- ✅ Pagination
- ✅ Filtres et recherche
- ✅ Formulaires validés
- ✅ Modales de confirmation (Bootstrap 5 universelle avec confirmation CSRF)

### Design & Responsive
- ✅ Interface responsive (mobile, tablette, desktop)
- ✅ Bootstrap 5.3 intégré
- ✅ CSS optimisé (~83 KB)
- ✅ Compatibilité navigateurs (Chrome, Firefox, Safari, Edge)

---

## 11. SÉCURITÉ & PROTECTION

**Tous les niveaux**

### Protection des Données
- ✅ HTTPS obligatoire
- ✅ Chiffrement des mots de passe (bcrypt 12 rounds)
- ✅ Protection CSRF (tokens)
- ✅ Protection XSS (échappement automatique)
- ✅ Protection SQL Injection (Sequelize ORM)
- ✅ Validation d'entrée stricte

### Headers de Sécurité
- ✅ Helmet.js pour headers HTTP sécurisés
- ✅ Content-Security-Policy (CSP)
- ✅ X-Frame-Options
- ✅ Strict-Transport-Security (HSTS)

### Rate Limiting
- ✅ 100 requêtes/15min globalement
- ✅ 10 requêtes/15min pour authentification
- ✅ Limitation par IP

### SSL/TLS - Vérification Certificat
- ✅ **ApiService.php** : Vérification SSL dynamique selon environnement
  - Production (`APP_ENV=production`) : `CURLOPT_SSL_VERIFYPEER = true`
  - Développement : `CURLOPT_SSL_VERIFYPEER = false`
- ✅ Configuration session HTTPS en production (`SESSION_SECURE`)
- ✅ Cookies OAuth avec flag `secure` en production uniquement

---

## 12. API GATEWAY & ORCHESTRATION

**Port 4000** *(corrigé v2.4.0 — était documenté 3000, réel : 4000)*

### Fonctionnalités API Gateway
- ✅ Proxy vers microservices
- ✅ Authentification centralisée JWT
- ✅ Rate limiting global
- ✅ Gestion des erreurs
- ✅ CORS configuré
- ✅ Logging centralisé
- ✅ Health checks

### Routes Proxy
- ✅ `/api/auth` → Auth Service (4001)
- ✅ `/api/boutiques` → Boutique Service (4002)
- ✅ `/api/clients` → Client Service (4003)
- ✅ `/api/reparations` → Réparation Service (4004)
- ✅ `/api/stocks` → Stock Service (4005)
- ✅ `/api/factures` → Facturation Service (4006)

---

## 13. INFRASTRUCTURE & DÉPLOIEMENT

**Technologie & Configuration**

### Technologies Stack
- **Frontend** : PHP 8.1+, HTML5, CSS3, JavaScript ES6+
- **Backend** : Node.js 22.x, Express.js 4.18.x
- **Database** : PostgreSQL 15+
- **Cache** : Redis 7+
- **Stockage** : MinIO (compatible S3)
- **Monitoring** : Winston Logger
- **Testing** : PHPUnit, Jest

### Services Déployés *(ports réels — corrigés v2.4.0)*
- ✅ API Gateway sur port **4000**
- ✅ Auth Service sur port **4001**
- ✅ Boutique Service sur port **4002**
- ✅ Client Service sur port **4003**
- ✅ Réparation Service sur port **4004**
- ✅ Stock Service sur port **4005**
- ✅ Facturation Service sur port **4006**
- ✅ Frontend PHP sur port **8000** (PHP built-in server + `public/router.php`)

### Gestionnaire de Processus
- ✅ **PM2** — maintient tous les services actifs après fermeture du terminal
- ✅ `ecosystem.config.js` — configuration centralisée, mode `fork` obligatoire (évite conflit `cluster`)
- ✅ Redémarrage automatique en cas de crash (`autorestart: true`, `max_restarts: 10`)
- ✅ `pm2 save` — liste mémorisée pour restauration automatique

### Scripts de Démarrage
- ✅ `start.ps1` — Docker + PM2 en une commande
- ✅ `stop.ps1` — arrêt propre de tous les services

### Bases de Données Séparées (Database per Service)
- ✅ izigsm_auth
- ✅ izigsm_boutique
- ✅ izigsm_client
- ✅ izigsm_reparation
- ✅ izigsm_stock
- ✅ izigsm_facturation

---

## 14. PERFORMANCES & MONITORING

**Métriques Cibles**

### Frontend
- ✅ Temps de chargement initial < 1.8s
- ✅ Lighthouse Performance : 92/100
- ✅ Lighthouse SEO : 90/100
- ✅ Taille assets minifiée : ~83 KB
- ✅ **Routeur statique PHP** *(v2.4.0)* — `public/router.php` sert CSS/JS directement (5ms vs 9s avant)
- ✅ **Timeout API réduit** *(v2.4.0)* — 30s → 5s (fail-fast si microservice indisponible)

### Backend
- ✅ Temps réponse API : < 100ms
- ✅ Débit : > 1000 req/s
- ✅ Disponibilité : 99.9%
- ✅ Démarrage service : < 3s

### Monitoring
- ✅ Logs centralisés Winston
- ✅ Health checks `/health`
- ✅ Métriques de performance
- ✅ Alertes d'erreur
- ✅ Rotation des logs

---

## 15. DOCUMENTATION & SUPPORT

**Livrables**

### Documentation Fournie
- ✅ Guide d'installation complet
- ✅ Documentation technique complète
- ✅ Principes architecturaux
- ✅ Plan de tests frontend
- ✅ Rapport de validation frontend
- ✅ Structure du projet détaillée
- ✅ TODO de développement

---

## 16. PERSONNEL & POINTAGE

**Service** : Auth Service (:3001) + Frontend PHP

> Fonctionnalité ajoutée en **v2.3.0** — système de pointage journalier pour les employés.

### Machine à États — Pointage Journalier

Le pointage suit une progression linéaire à 4 étapes, calculée automatiquement
à partir des champs DB :

```
absent → en_poste → en_pause → repris → terminé
```

- ✅ **Pointer arrivée** — enregistre `heure_arrivee`
- ✅ **Pause déjeuner** — enregistre `heure_pause`
- ✅ **Reprendre le travail** — enregistre `heure_reprise` (bloqué 1h min après la pause)
- ✅ **Pointer départ** — enregistre `heure_depart` + calcul `duree_minutes`
- ✅ **Countdown JS** — décompte en temps réel, débloque le bouton reprise automatiquement
- ✅ **Bandeau coloré dynamique** — gris (absent) / bleu (en poste) / jaune (pause) / vert (terminé)
- ✅ **Toast de confirmation** — feedback Bootstrap 5 après chaque pointage

### Suivi des Présences

- ✅ **Tableau de présences** — colonnes Arrivée, Pause, Reprise, Départ, Durée, Statut
- ✅ **Badges de statut** — Absent, En poste, En pause, Après-midi, Terminé
- ✅ **Export multi-format** — CSV / Excel / PDF avec colonnes pause & reprise
- ✅ **Filtres multi-select** — filtre par membre(s) et période

### Backend (Auth Service — Node.js)

- ✅ Colonnes `heure_pause` et `heure_reprise` en base (Sequelize ALTER TABLE automatique)
- ✅ Endpoint `POST /api/presences/pointer` — avance l'état courant, retourne `{ success, message, etat, duree }`
- ✅ Règle métier : reprise refusée si `heure_pause + 1h` non atteinte

### Fichiers Concernés

| Fichier | Rôle |
|---------|------|
| `auth-service/src/models/presence.model.js` | Champs `heure_pause`, `heure_reprise` |
| `auth-service/src/controllers/presence.controller.js` | Logique machine à états |
| `frontend/app/Controllers/PersonnelController.php` | Headers export mis à jour |
| `frontend/app/Views/pages/personnel/index.php` | Bandeau 4 états + JS countdown |
| `frontend/app/Views/pages/personnel/presences.php` | Tableau + bandeau + export |
| `frontend/app/Views/pages/personnel/presences-export.php` | Colonnes pause/reprise |
| `frontend/app/Views/layouts/print.php` | CSS badge-pause pour PDF |

---

## 📊 RÉSUMÉ CHIFFRÉ

| Élément | Nombre |
|---------|--------|
| **Services Microservices** | 7 (API Gateway + 6 services métier) — ports 4000–4006 |
| **Services Communs** | 11 |
| **Fichiers Backend** | 80+ |
| **Fichiers Frontend** | 60+ |
| **Contrôleurs Frontend** | 8 |
| **Modèles Frontend** | 9 |
| **Vues Frontend** | 28+ |
| **Lignes de code estimées** | ~19,500 |
| **Bases de données** | 6 (Database per Service) |
| **Rôles d'utilisateur** | 4 |
| **Endpoints API** | 82+ |
| **APIs externes intégrées** | 1 (phone-specs-api.vercel.app) |

---

## 17. GESTION DES PROCESSUS — PM2

**Rôle architectural** : Gestionnaire de processus (pattern *Process Supervisor*) — garantit la disponibilité continue de tous les microservices sans intervention manuelle, conforme au principe §1 (modules indépendants et disponibles en permanence).

### Installation

```powershell
npm install -g pm2
```

### Démarrage de l'application

```powershell
# 1. Démarrer les bases de données (Docker)
docker-compose up -d

# 2. Démarrer tous les services via PM2
pm2 start ecosystem.config.js
```

> **Raccourci** : utiliser `.\start.ps1` depuis le dossier `izigsm_app/`

### Commandes courantes

| Commande | Description |
|---|---|
| `pm2 status` | État de chaque service (online / stopped / erroring) |
| `pm2 logs` | Logs en temps réel de tous les services |
| `pm2 logs stock-service` | Logs d'un service spécifique |
| `pm2 restart all` | Redémarrer tous les services |
| `pm2 restart stock-service` | Redémarrer un service après modification |
| `pm2 stop all` | Arrêter tous les services |
| `pm2 save` | Mémoriser la liste pour restauration automatique |

### Arrêt de l'application

```powershell
.\stop.ps1
# ou
pm2 stop all && pm2 delete all
```

### Configuration — `ecosystem.config.js`

- **`exec_mode: 'fork'`** obligatoire — les services gèrent leur propre clustering en interne ; le mode `cluster` de PM2 provoquerait des conflits de ports (`EADDRINUSE`)
- **`autorestart: true`** — redémarre automatiquement en cas de crash
- **`max_restarts: 10`** — évite une boucle infinie si le service est en erreur persistante
- **`watch: false`** — le rechargement à chaud est géré manuellement (`pm2 restart`)

### Ports de l'application

| Service | Port |
|---|---|
| API Gateway | 4000 |
| Auth Service | 4001 |
| Boutique Service | 4002 |
| Client Service | 4003 |
| Réparation Service | 4004 |
| Stock Service | 4005 |
| Facturation Service | 4006 |
| Frontend PHP | 8000 |

### Routeur PHP — `public/router.php`

Pattern *Front Controller* étendu : distingue les fichiers statiques (CSS, JS, images) des routes applicatives.

- Fichiers statiques existants → servis directement par le serveur PHP intégré (`return false`) — **5ms**
- Routes applicatives → délégation à `index.php` avec injection de `$_GET['route']` depuis le chemin URL
- Permet des URLs propres : `/clients`, `/reparations`, `/logout` au lieu de `/?route=clients`

```powershell
# Commande de démarrage du frontend (intégrée dans ecosystem.config.js)
php -S 0.0.0.0:8000 -t public/ public/router.php
```

---

## 18. CHANGELOG DES MODIFICATIONS

### v2.4.0 — 1er mars 2026

#### Corrections d'infrastructure

**Ports microservices** — Mise à jour de la documentation (ports réels 4001–4006, gateway 4000)
- `frontend/config/api.php` : `base_url` corrigée de `localhost:3000` → `localhost:4000`

**Routeur PHP — `public/router.php`** (pattern *Front Controller* + *Static File Bypass*)
- Serveur PHP intégré : assets CSS/JS désormais servis directement (5ms vs 9s avant)
- Traduction chemin URL → `$_GET['route']` : navigation par onglets et déconnexion fonctionnelles
- Timeout API réduit de 30s → 5s (fail-fast si microservice indisponible)

**PM2 — Gestionnaire de processus** (pattern *Process Supervisor*)
- Installation globale `pm2@6.0.14`
- `ecosystem.config.js` : configuration de 8 processus, `exec_mode: 'fork'` (évite conflit cluster)
- `start.ps1` amélioré : Docker → PM2 en une commande
- `stop.ps1` créé : arrêt propre

**Script npm** — `start:frontend` corrigé : `php -S 0.0.0.0:8000 -t public/ public/router.php`

#### Corrections de bugs

**Upload photos réparation** — Correction du flux multipart complet
- `frontend/app/Controllers/ReparationController.php` — `addPhoto()` :
  - Endpoint corrigé : `/api/reparations/{id}/photos` (inexistant) → `/api/photos-reparation`
  - Champ manquant ajouté : `reparation_id` (UUID de la fiche, obligatoire côté Multer)
  - Champ renommé : `type` → `type_photo` (nom attendu par le service Node.js)
  - Docblock architectural ajouté : flux cURL multipart, pattern Proxy, champs transmis, sécurité
- `frontend/config/api.php` — endpoint `photos` corrigé + commentaire d'avertissement `⚠️ NE PAS utiliser /api/reparations/{id}/photos`

#### Upload photos réparation — Refonte complète

**Interface 5 slots Avant/Après** (`reparations/show.php`)
- 2 sections indépendantes : « Avant » et « Après » réparation (max 5 photos chacune)
- Slots visuels 110×110 px avec 3 états : vide (pointillés + icône +), chargement (spinner CSS), rempli (miniature + badge + bouton ×)
- Compteur en temps réel `(x/5)` mis à jour après chaque upload ou suppression
- AJAX pur — aucun rechargement de page (`fetch()` + `FormData`)
- Header `X-Requested-With: XMLHttpRequest` pour déclenchement JSON dans `ReparationController`
- Token CSRF embarqué directement en JS via PHP (`const CSRF_TOKEN = '<?= csrf_token() ?>'`) — évite le problème d'ordre d'exécution DOM

**Compression client-side** (`compressImage()` — Canvas API)
- Redimensionnement : largeur max 1200 px, ratio conservé
- Encodage : JPEG 80 % via `canvas.toBlob(resolve, 'image/jpeg', 0.80)`
- Support HEIC/HEIF (iPhone) : conversion préalable via `heic2any@0.0.4` (CDN jsdelivr) ; fallback décodage natif Safari si `heic2any` échoue

**Formats acceptés**
- Frontend : `input.accept` = `image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif`
- Backend Multer : whitelist `ALLOWED_MIMES` = `{ image/jpeg, image/jpg, image/png, image/webp, image/heic, image/heif }`

**Purge automatique 6 mois** (`cleanup-tasks.js` — `node-cron`)
- Cron quotidien à 2h00 : `cron.schedule('0 2 * * *', ...)`
- Supprime du stockage MinIO/S3 via `storageService.delete(key)`, puis de la base SQL via `photo.destroy()`
- Enregistré au démarrage via `cleanupTasks.init()` dans `app.js`
- Conformité RGPD — rétention limitée à 6 mois

#### Corrections techniques — Photos (suite)

**Bug 1 — CURLFile sans MIME type** (`ApiService.php` — `upload()`)
- Symptôme : Multer rejetait tout upload avec "Seules les images sont acceptées"
- Cause : `new \CURLFile($filePath)` sans MIME type → envoi de `application/octet-stream`
- Fix : `mime_content_type($filePath)` détecte les magic bytes du fichier temporaire
- Impact : corrige tous les uploads de fichiers de la plateforme (pas seulement les photos)
- Principe §4 — responsabilité unique : l'ApiService gère maintenant correctement le transport multipart

**Bug 2 — Cross-Origin-Resource-Policy bloquant les miniatures** (`reparation-service/src/app.js`)
- Symptôme : miniatures affichées en noir (images non chargées par le navigateur)
- Cause : Helmet v7 impose `Cross-Origin-Resource-Policy: same-origin` sur toutes les réponses ;
  le navigateur à `127.0.0.1:8000` refusait les ressources de `localhost:4004`
- Fix : middleware inline sur `/uploads` surcharge l'en-tête à `cross-origin` avant `express.static`
- Principe §1 — modularité : seule la route statique est assouplie ; les routes API gardent la protection `same-origin`

**Nouveaux endpoints API photos** (`photo-reparation.controller.js` + `photo-reparation.routes.js`)

| Endpoint | Méthode | Fonction | Pattern |
|---|---|---|---|
| `/reparation/:id` | GET | Liste toutes les photos d'une réparation | Query |
| `/:id` | GET | Métadonnées d'une photo individuelle | Resource |
| `/:id/url` | GET | URL d'accès (directe local / pré-signée S3) | Strategy |
| `/` | POST | Upload multipart (champ : `photo`) | Command |
| `/:id` | DELETE | Suppression stockage + BDD | Command |

- Pattern **Strategy** sur `getAccessUrl` : comportement variable selon `STORAGE_DRIVER`
  (`local` → URL directe sans expiration ; `s3` → URL pré-signée AWS SDK, durée configurable)
- Pattern **Bridge** sur `StorageService` : changement de driver sans modification du contrôleur
- Pattern **Middleware Chain** : `authMiddleware → fileFilter → controller` (responsabilité unique par couche)
- Principe §1 — toutes les routes groupées sous `/api/photos-reparation`, module autonome dans `app.js`
- Principe §5 — tous les accès BDD passent par Sequelize ORM (pas d'accès direct SQL brut)

**Documentation des fichiers scripts** (`photo-reparation.controller.js` + `photo-reparation.routes.js`)
- Header JSDoc ajouté sur chaque fichier avec référence explicite aux principes architecturaux (§ numéro)
- Design patterns nommés dans les commentaires (Bridge, Strategy, Middleware Chain)
- Table des routes documentée directement dans le fichier routes
- Règles de sécurité (JWT, whitelist MIME, fileSize) documentées dans le header routes

#### Ajouts UX

**Réparations — Phrases prédéfinies** (`create.php` + `edit.php`)
- Boutons "Remplacement de…", "Désoxydation", "Diagnostic" au-dessus du champ description
- `app.js::initPhrasePresets()` : insère la phrase + focus + curseur en fin de texte

#### Fichiers modifiés

| Fichier | Modification |
|---|---|
| `frontend/config/api.php` | Port 3000 → 4000, timeout 30s → 5s |
| `frontend/public/router.php` | **Nouveau** — routeur statique + traduction URL |
| `ecosystem.config.js` | **Nouveau** — configuration PM2 |
| `start.ps1` | Refonte complète (Docker + PM2) |
| `stop.ps1` | **Nouveau** — arrêt propre |
| `package.json` | `start:frontend` corrigé |
| `frontend/public/assets/js/app.js` | `initPhrasePresets()` ajoutée |
| `frontend/app/Views/pages/reparations/create.php` | Boutons phrases prédéfinies |
| `frontend/app/Views/pages/reparations/edit.php` | Boutons phrases prédéfinies |
| `frontend/app/Controllers/BaseController.php` | `extractList()` déplacée depuis StockController |
| `frontend/app/Controllers/ReparationController.php` | `addPhoto()` AJAX-aware + `deletePhoto()` ajouté |
| `frontend/app/Services/ApiService.php` | `upload()` : `CURLFile` avec MIME type détecté par `mime_content_type()` |
| `frontend/config/routes.php` | Routes `reparations/photo` et `reparations/photo/delete` ajoutées |
| `frontend/app/Views/pages/reparations/show.php` | Refonte section photos : 5 slots Avant/Après, Canvas compression, HEIC, AJAX |
| `reparation-service/src/app.js` | `Cross-Origin-Resource-Policy: cross-origin` sur `/uploads` |
| `reparation-service/src/routes/photo-reparation.routes.js` | Whitelist MIME + 2 nouvelles routes (`/:id`, `/:id/url`) + header archi |
| `reparation-service/src/controllers/photo-reparation.controller.js` | `getById()` + `getAccessUrl()` ajoutés + header JSDoc archi |
| `reparation-service/.env` | `SERVICE_URL=http://localhost:4004` ajouté |
| `reparation-service/src/utils/cleanup-tasks.js` | Cron 6 mois (préexistant, documenté dans cette version) |

---

### v2.3.0 — 20 février 2026

#### Ajouts

**Module Personnel — Pointage 4 états**
- Machine à états : `absent → en_poste → en_pause → repris → terminé`
- Colonnes DB `heure_pause` + `heure_reprise` (Sequelize auto-ALTER)
- Countdown JS avec blocage du bouton reprise (1h minimum)
- Bandeau coloré dynamique sur index.php et presences.php
- Export CSV/XLS/PDF mis à jour avec les colonnes pause & reprise

**Module Stocks — Vues produits**
- `produits.php` — liste paginée avec filtre catégorie + recherche
- `produits-create.php` — formulaire complet de création produit
- `produits-edit.php` — formulaire de modification pré-rempli
- Champ "Modèles compatibles" (Tagify multi-tag) dans les deux formulaires
- Calcul de marge en temps réel (JS)

**Module Stocks — Autocomplete modèles de téléphones**
- Endpoint `GET /stocks/phone-models?q=...` dans `StockController`
- Stratégie : `phone-specs-api.vercel.app/search` en priorité, fallback JSON local
- Catalogue local `phone-models.json` : 12 marques, 200+ modèles
- Route `stocks/phone-models` ajoutée dans `routes.php`

#### Corrections

- **Syntax error PHP** sur `/personnel` : double tag `<?php` supprimé dans `index.php`
- **Vue introuvable** `stocks/produits-create` : 3 vues stocks créées de zéro

---

### v2.2.0 — 21 février 2026
- Ajout : SSL/TLS — Vérification Certificat dans section Sécurité (`ApiService.php`)

---

## 📝 NOTES

- Cette liste représente l'intégralité des fonctionnalités décrites dans le cahier des charges et la documentation technique
- Architecture microservices avec Frontend PHP/HTML — modules indépendants via API REST
- Développement assisté par Claude Code (Anthropic)

---

**Document maintenu à jour à chaque session de développement**
