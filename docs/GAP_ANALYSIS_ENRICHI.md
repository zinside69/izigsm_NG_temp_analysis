# Gap Analysis Enrichi — iziGSM
> **Version** : 2.0 (enrichi avec les documents CDC fournis)  
> **Date** : 1er juin 2026  
> **Périmètre** : Webapp Cloudflare Pages vs CDC technique + LISTE_FONCTIONNALITES v2.4.0

---

## Légende
- ✅ **Implémenté** — Fonctionnel ou partiellement fonctionnel
- ⚠️ **Partiel** — UI présente mais sans persistance / connexion API
- ❌ **Absent** — Non développé
- 🔴 **Critique** — Bloquant légal ou fonctionnel

---

## MODULE 1 : Authentification & Autorisation

| Réf | Fonctionnalité | CDC | Webapp | Priorité |
|-----|----------------|-----|--------|----------|
| A01 | Login email/password | ✅ | ⚠️ démo | P0 |
| A02 | Inscription + validation email OTP | ✅ | ⚠️ démo | P0 |
| A03 | JWT sécurisé + refresh tokens | ✅ | ❌ | P0 🔴 |
| A04 | RBAC (Admin, Manager, Technicien) | ✅ | ❌ | P0 🔴 |
| A05 | Permissions granulaires par rôle | ✅ | ❌ | P1 |
| A06 | OAuth2 Google | ✅ | ❌ | P2 |
| A07 | OAuth2 Facebook | ✅ | ❌ | P3 |
| A08 | Réinitialisation mot de passe | ✅ | ❌ | P1 |
| A09 | Gestion utilisateurs (CRUD) | ✅ | ❌ | P1 |
| A10 | CSRF Protection | ✅ (PHP) | ⚠️ N/A Workers | — |
| A11 | Expiration session inactive | ✅ | ❌ | P2 |

---

## MODULE 2 : Boutiques

| Réf | Fonctionnalité | CDC | Webapp | Priorité |
|-----|----------------|-----|--------|----------|
| B01 | Créer/modifier/supprimer boutique | ✅ | ❌ | P1 |
| B02 | Lister boutiques | ✅ | ❌ | P1 |
| B03 | Multi-boutiques (filtre global) | ✅ | ❌ | P2 |
| B04 | Horaires d'ouverture | ✅ | ❌ | P2 |
| B05 | Paramètres TVA / SIRET | ✅ | ❌ | P1 🔴 |
| B06 | Paramètres notifications boutique | ✅ | ❌ | P2 |
| B07 | Paramètres de paiement | ✅ | ❌ | P1 |

---

## MODULE 3 : Clients

| Réf | Fonctionnalité | CDC | Webapp | Priorité |
|-----|----------------|-----|--------|----------|
| C01 | CRUD clients | ✅ | ⚠️ UI mock | P0 |
| C02 | Recherche + filtres avancés | ✅ | ✅ UI | P0 |
| C03 | Profil client complet | ✅ | ⚠️ UI mock | P0 |
| C04 | Historique réparations | ✅ | ⚠️ modal mock | P1 |
| C05 | Gestion appareils (IMEI, S/N, modèle) | ✅ | ❌ | P1 |
| C06 | Adresse de facturation | ✅ | ⚠️ partiel | P1 |
| C07 | Export CSV clients | ✅ | ✅ | ✅ |
| C08 | Signature numérique tablette | ✅ (CDC) | ❌ | P3 |
| C09 | Collecte avis clients | ✅ (CDC) | ❌ | P3 |
| C10 | Fiches clients persistantes D1 | — | ❌ | P0 🔴 |

---

## MODULE 4 : Réparations / Tickets

| Réf | Fonctionnalité | CDC | Webapp | Priorité |
|-----|----------------|-----|--------|----------|
| R01 | Création ticket réparation | ✅ | ⚠️ UI mock | P0 |
| R02 | Assignation technicien | ✅ | ⚠️ champ UI | P1 |
| R03 | Suivi statut (machine à états) | ✅ | ⚠️ visuel | P1 |
| R04 | Changement statut avec historique | ✅ | ❌ | P1 |
| R05 | Upload photos avant/après (AJAX) | ✅ + compression | ❌ | P1 |
| R06 | Stockage photos R2 | — | ❌ | P1 |
| R07 | Notification SMS à réception | ✅ | ❌ | P2 |
| R08 | Notification Email livraison | ✅ | ❌ | P1 |
| R09 | Notification WhatsApp | ✅ (CDC) | ❌ | P3 |
| R10 | Conversion devis → ticket → facture | ✅ | ❌ flux relié | P1 |
| R11 | SAV / Garanties | ✅ (CDC) | ❌ | P2 |
| R12 | Diagnostics techniques | ✅ | ⚠️ partiel | P2 |
| R13 | Prise RDV chatbot IA | ✅ (CDC) | ❌ | P3 |
| R14 | Persistance tickets D1 | — | ❌ | P0 🔴 |

---

## MODULE 5 : Stocks

| Réf | Fonctionnalité | CDC | Webapp | Priorité |
|-----|----------------|-----|--------|----------|
| S01 | CRUD produits (SKU, prix) | ✅ | ⚠️ UI mock | P0 |
| S02 | Catégories hiérarchiques | ✅ | ⚠️ plates | P1 |
| S03 | Mouvements de stock | ✅ | ⚠️ UI local | P1 |
| S04 | Alertes stock bas | ✅ | ✅ UI | ⚠️ sans D1 |
| S05 | Calcul marge temps réel | ✅ | ❌ | P1 |
| S06 | Import catalogues fournisseurs CSV/XML | ✅ (CDC) | ❌ | P2 |
| S07 | Scanner codes-barres | ✅ (CDC) | ❌ | P3 |
| S08 | Export CSV stock | ✅ | ✅ | ✅ |
| S09 | Inventaires | ✅ (CDC) | ❌ | P2 |
| S10 | Commandes fournisseurs (Mobilax, Utopya) | ✅ (CDC) | ❌ | P2 |
| S11 | Persistance stocks D1 | — | ❌ | P0 🔴 |

---

## MODULE 6 : Facturation & Paiements

| Réf | Fonctionnalité | CDC | Webapp | Priorité |
|-----|----------------|-----|--------|----------|
| F01 | Création factures | ✅ | ⚠️ UI mock | P0 |
| F02 | Création devis | ✅ | ⚠️ UI mock | P0 |
| F03 | Calcul HT / TVA / TTC automatique | ✅ | ⚠️ partiel UI | P0 |
| F04 | **Conformité NF525 (SHA-256)** | ✅ | ❌ | P0 🔴 **LÉGAL** |
| F05 | Paiements Stripe | ✅ | ❌ | P2 |
| F06 | Multi-modes paiement (CB, espèces, chèque) | ✅ (CDC) | ❌ | P2 |
| F07 | Gestion avoirs / retours | ✅ | ❌ | P2 |
| F08 | Export PDF factures | ✅ (CDC) | ❌ | P1 |
| F09 | Signature électronique | ✅ | ❌ | P2 |
| F10 | Persistance factures D1 | — | ❌ | P0 🔴 |
| F11 | Numérotation automatique | ✅ | ❌ | P0 |

---

## MODULE 7 : Tableau de Bord & Reporting

| Réf | Fonctionnalité | CDC | Webapp | Priorité |
|-----|----------------|-----|--------|----------|
| D01 | KPI CA total | ✅ | ⚠️ mock | P0 |
| D02 | KPI réparations | ✅ | ⚠️ mock | P0 |
| D03 | Graphiques Chart.js | ✅ | ✅ UI | ⚠️ mock |
| D04 | Reporting par boutique | ✅ | ❌ | P2 |
| D05 | Reporting par technicien | ✅ | ❌ | P2 |
| D06 | Export Excel/PDF | ✅ (CDC) | ❌ | P2 |
| D07 | Tableaux de bord personnalisables | ✅ (CDC) | ❌ | P3 |
| D08 | Rotation des stocks | ✅ | ⚠️ partiel | P2 |

---

## MODULE 8 : Personnel & Pointage *(CDC v2.3.0 — entièrement absent)*

| Réf | Fonctionnalité | CDC | Webapp | Priorité |
|-----|----------------|-----|--------|----------|
| P01 | Profils employés | ✅ | ❌ | P2 |
| P02 | Pointage (absent/en poste/pause/terminé) | ✅ | ❌ | P2 |
| P03 | Machine à états pointage | ✅ | ❌ | P2 |
| P04 | Attribution tâches | ✅ (CDC) | ❌ | P2 |
| P05 | Calcul commissions/primes | ✅ (CDC) | ❌ | P2 |
| P06 | Export présences | ✅ | ❌ | P2 |
| P07 | Planning techniciens | ✅ (CDC) | ❌ | P3 |
| P08 | Page `personnel.html` | — | ❌ **À CRÉER** | P2 |

---

## MODULE 9 : Qualirépar

| Réf | Fonctionnalité | CDC | Webapp | Priorité |
|-----|----------------|-----|--------|----------|
| Q01 | Page Qualirépar | ✅ | ✅ | ✅ |
| Q02 | Déclaration bonus réparation API | ✅ | ❌ | P2 |
| Q03 | Rappels paiement automatisés | ✅ | ❌ | P2 |
| Q04 | Sync API Qualirépar | ✅ | ❌ | P2 |

---

## MODULE 10 : Services Communs & Intégrations

| Réf | Fonctionnalité | CDC | Webapp | Priorité |
|-----|----------------|-----|--------|----------|
| I01 | Email transactionnel (Resend/SendGrid) | ✅ | ❌ | P1 |
| I02 | SMS Twilio | ✅ | ❌ | P2 |
| I03 | WhatsApp Business | ✅ (CDC) | ❌ | P3 |
| I04 | Stockage fichiers R2 | ✅ → R2 | ❌ | P1 |
| I05 | Cache KV | ✅ → KV | ❌ | P1 |
| I06 | Géolocalisation | ✅ | ❌ | P3 |
| I07 | Paiement Stripe | ✅ | ❌ | P2 |
| I08 | Import Mobilax API | ✅ (CDC) | ❌ | P2 |
| I09 | Import Utopya API | ✅ (CDC) | ❌ | P2 |
| I10 | Import Phone LCD | ✅ (CDC) | ❌ | P3 |

---

## MODULE 11 : Sécurité & Conformité

| Réf | Fonctionnalité | CDC | Webapp | Priorité |
|-----|----------------|-----|--------|----------|
| SEC01 | HTTPS | ✅ | ✅ (CF natif) | ✅ |
| SEC02 | Chiffrement bcrypt mots de passe | ✅ | ❌ | P0 🔴 |
| SEC03 | Validation côté serveur | ✅ | ⚠️ partiel | P0 |
| SEC04 | Rate Limiting API | ✅ | ⚠️ CF natif | ⚠️ |
| SEC05 | **NF525 conformité** | ✅ | ❌ | P0 🔴 **LÉGAL** |
| SEC06 | RGPD — mentions légales | ✅ | ✅ `legal.html` | ✅ |
| SEC07 | RGPD — export données client | ✅ (CDC) | ❌ | P2 |
| SEC08 | CORS restreint (domaine prod) | ✅ | ⚠️ `*` | P0 |
| SEC09 | Headers sécurité (CSP, HSTS) | ✅ (Helmet) | ⚠️ CF WAF | ⚠️ |
| SEC10 | Logs d'audit | ✅ (Winston) | ❌ | P2 |

---

## Résumé des Actions Manuelles Cloudflare (vs ACTIONS_MANUELLES.md)

Ces secrets doivent être configurés via `wrangler secret put` **avant mise en production** :

```bash
# Auth
wrangler secret put JWT_SECRET          # openssl rand -base64 64

# OAuth (Sprint 3)
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET

# Email (Sprint 2)
wrangler secret put RESEND_API_KEY      # ou SENDGRID_API_KEY

# SMS (Sprint 3)
wrangler secret put TWILIO_ACCOUNT_SID
wrangler secret put TWILIO_AUTH_TOKEN
wrangler secret put TWILIO_PHONE_NUMBER

# Paiements (Sprint 3)
wrangler secret put STRIPE_SECRET_KEY

# Environnement
wrangler secret put APP_ENV             # production
wrangler secret put FRONTEND_URL        # https://izigsm.pages.dev
```

---

## Migrations D1 à Créer (Sprint 1)

```
migrations/
├── 0001_users_and_roles.sql          # users, roles, user_roles
├── 0002_boutiques.sql                 # boutiques, boutique_settings
├── 0003_clients_and_appareils.sql     # clients, appareils
├── 0004_tickets_and_interventions.sql # tickets, interventions, statuts
├── 0005_stocks.sql                    # categories, produits, mouvements_stock
├── 0006_facturation.sql               # devis, factures, lignes_facture, paiements
├── 0007_personnel.sql                 # employes, pointages
└── 0008_indexes.sql                   # Tous les index de performance
```

---

## Compteur Global de Couverture

| Priorité | Total items | ✅ Fait | ⚠️ Partiel | ❌ Absent |
|----------|-------------|---------|-----------|---------|
| P0 Critique | 18 | 2 | 8 | 8 |
| P1 Haute | 28 | 3 | 6 | 19 |
| P2 Moyenne | 31 | 0 | 0 | 31 |
| P3 Basse | 14 | 0 | 0 | 14 |
| **TOTAL** | **91** | **5** | **14** | **72** |

> **Couverture P0 (critique)** : 2/18 = 11% — **À traiter en priorité absolue**

---

*Gap Analysis v2.0 — Enrichi avec CDC izigsm_sections.docx + LISTE_FONCTIONNALITES_TECHNIQUES v2.4.0*
