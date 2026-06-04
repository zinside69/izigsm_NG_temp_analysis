# Analyse Comparative — CDC iziGSM vs Implémentation Actuelle

> **Date de mise à jour** : 4 juin 2026  
> **Version analysée** : CDC Manus v1.0 (juin 2026) + monatelier_observations.md  
> **État implémentation** : Sprint 2.4 ✅ — v2.4.0  
> **Auteur** : Analyse IA assistée (session sprint 2.4)

---

## ⚠️ Note de mise à jour

Ce document remplace la version du 1er juin 2026 qui analysait un **prototype sans persistance**.
Depuis les sprints 2.1 → 2.4, l'implémentation a radicalement évolué :
- **D1 réel** connecté (10+ migrations appliquées)
- **JWT sécurisé** (PBKDF2, KV sessions)
- **NF525** implémenté (SHA-256 factures/avoirs)
- **Livre de police** conforme (art. 321-7)
- **Permissions granulaires** (table `permissions`)
- **Catalogue services** MVC complet (Sprint 2.4)

---

## 1. Comparatif par Module CDC

### MOD-01 — Tickets / Prises en charge ⚠️ PARTIEL
**Priorité CDC : CRITIQUE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| CRUD tickets (création, modification) | ✅ | `routes/tickets.ts` + D1 |
| 8 statuts workflow : INTAKE→DIAGNOSIS→TO_ORDER→ORDERED→PARTS_RECEIVED→IN_REPAIR→READY_TO_RETURN→RETURNED | ⚠️ | **6 statuts implém.** — manque `TO_ORDER`, `ORDERED`, `PARTS_RECEIVED` |
| Assignation technicien | ✅ | Champ `assigned_to` en base |
| Indicateurs d'ancienneté (vert/orange/rouge/alerte) | ⚠️ | Calcul côté client uniquement |
| Lien de suivi client (`tracking_token`) | ⚠️ | Colonne en base, page publique `/suivi.html` **non créée** |
| Archivage automatique (`archived_at`) | ❌ | Non implémenté |
| Vue Kanban drag & drop | ❌ | Non implémenté (différenciateur monatelier) |
| GET /api/tickets/kanban | ❌ | Endpoint absent |
| Noms de statuts personnalisables par tenant | ❌ | Non implémenté |
| Mode création rapide / complet | ⚠️ | UI présente, non différenciée côté API |

**Score : 3✅ / 4⚠️ / 3❌ — Couverture ~45%**

**Gaps critiques :**
- Statuts `TO_ORDER`, `ORDERED`, `PARTS_RECEIVED` indispensables pour le flux commandes (lié MOD-10)
- Page suivi client publique (`/suivi/:token`) — promesse UX clé
- Kanban : différenciateur fort vs concurrents

---

### MOD-02 — Facturation ✅ COMPLET (fonctionnel)
**Priorité CDC : CRITIQUE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| Création factures (brouillon) | ✅ | `routes/facturation.ts` + D1 |
| Émission avec verrouillage (`locked=1`) | ✅ | Conforme CGI art. 289 |
| Chaîne SHA-256 NF525 | ✅ | `enregistrerTransaction()` Sprint 2.1 |
| Numérotation séquentielle sans trou | ✅ | `nextNumero()` atomique |
| Enregistrement paiements (multi-modes) | ✅ | Table `paiements` |
| Avoirs (AV-AAAA-XXXXX) | ✅ | Sprint 2.1 complet |
| Export CSV factures | ✅ | Via `apiBlobGet()` |
| KPIs (CA, encaissements, retards) | ✅ | `/api/stats` inline `index.tsx` |
| Numérotation configurable par tenant (préfixe, séparateur, format date) | ❌ | Hard-coded `FA/DEV/AV/LP` — **différenciateur monatelier** |
| Export PDF factures | ❌ | Sprint 2.10 backlog |
| Envoi au comptable | ❌ | Non implémenté |
| Paiement Stripe | ❌ | Non prévu (hors périmètre actuel) |

**Score : 8✅ / 0⚠️ / 4❌ — Couverture ~67%**

**Note :** La numérotation configurable est une fonctionnalité phare de monatelier.net (onboarding), absente ici.

---

### MOD-03 — Devis ⚠️ PARTIEL
**Priorité CDC : HAUTE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| CRUD devis | ✅ | `routes/facturation.ts` (devis intégrés) |
| Statuts (DRAFT/SENT/ACCEPTED/REFUSED/EXPIRED) | ⚠️ | Statuts en base, workflow non enforced |
| Conversion devis → facture | ✅ | Endpoint `/api/devis/:id/convertir` |
| Page publique signature client (`/quotes/public/:token`) | ❌ | Non implémentée |
| Signature eIDAS conforme | ❌ | Non implémentée (Sprint futur) |
| Envoi devis au client (email) | ❌ | Dépend MOD-12 (notifications) |
| Relance devis expirés | ❌ | Non implémentée |
| Acceptation/refus en ligne | ❌ | Page publique manquante |

**Score : 2✅ / 1⚠️ / 5❌ — Couverture ~25%**

**Gap critique :** La signature eIDAS et la page publique d'acceptation sont des fonctionnalités **standard** chez monatelier.net.

---

### MOD-04 — Stock et Catalogue produits ⚠️ PARTIEL
**Priorité CDC : CRITIQUE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| CRUD produits (SKU, prix achat/vente, TVA) | ✅ | `routes/stocks.ts` + D1 |
| Mouvements de stock (entrées/sorties) | ✅ | Table `mouvements_stock` |
| Alertes stock bas / ruptures | ✅ | `seuil_alerte` + KPIs |
| Export CSV stock | ✅ | Via `apiBlobGet()` |
| Catégories hiérarchiques produits | ⚠️ | Catégories plates uniquement |
| CUMP (Coût Unitaire Moyen Pondéré) | ❌ | **Absent — Sprint 2.5 prévu** |
| Liaison stock → réception bon de commande | ❌ | Dépend MOD-10 (fournisseurs) |
| Valeur stock / marge potentielle / stock dormant | ⚠️ | KPIs partiels sans CUMP |
| Scanner codes-barres | ❌ | Non prévu |
| Familles produits (pièce/accessoire/appareil/consommable) | ❌ | Champ `famille` absent |

**Score : 4✅ / 2⚠️ / 4❌ — Couverture ~45%**

**Gap bloquant :** CUMP est **requis** pour valoriser correctement le stock et calculer les marges. Sans fournisseurs (MOD-10), le CUMP ne peut pas être calculé.

---

### MOD-05 — Reconditionnement ❌ ABSENT
**Priorité CDC : MOYENNE**

| Fonctionnalité CDC | Statut |
|---|---|
| Ordres de reconditionnement (lié rachats) | ❌ |
| Suivi coût de revient (pièces + MO) | ❌ |
| Passage stock occasion | ❌ |
| Calcul marge reconditionné | ❌ |

**Score : 0/4 — Couverture 0%**  
**Dépendance :** Requiert MOD-06 (Rachats ✅) + MOD-04 Stock. À planifier après Sprint 2.5.

---

### MOD-06 — Rachats (Livre de police) ✅ COMPLET
**Priorité CDC : HAUTE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| Enregistrement rachat (30 champs) | ✅ | Migration 0011 |
| Numérotation séquentielle `LP-AAAA-XXXXX` | ✅ | `nextNumero('rachat')` |
| Conformité art. 321-7 Code pénal | ✅ | Validations obligatoires |
| Doublon IMEI détecté | ✅ | Check avant insertion |
| Statuts (en_stock / vendu / reconditionne) | ✅ | `PATCH /rachats/:id/statut` |
| Export CSV livre de police | ✅ | `apiBlobGet()` |
| KPIs (total, stock, vendu, valeur) | ✅ | `/api/rachats/kpis` |
| Liaison vers reconditionnement | ❌ | MOD-05 absent |

**Score : 7✅ / 0⚠️ / 1❌ — Couverture ~88%**

---

### MOD-07 — Clients (CRM) ⚠️ PARTIEL
**Priorité CDC : HAUTE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| CRUD clients | ✅ | `routes/clients.ts` + D1 |
| Recherche full-text (nom, société, tél, email) | ✅ | Filtres SQL |
| Historique tickets par client | ⚠️ | JOIN cross-module (violation P1 backlog) |
| Export CSV clients | ✅ | Présent |
| Import CSV/Excel avec mapping | ❌ | Non implémenté — **différenciateur monatelier** |
| Parrainage (code unique + filleuls) | ❌ | Champs `referral_code`, `referred_by` absents |
| Historique consolidé (tickets+factures+devis+RDV+SAV) | ❌ | Vue unifiée absente |
| Adresse structurée (JSONB) | ⚠️ | Champs texte simples |
| Gestion appareils par client (IMEI, S/N) | ❌ | Non implémenté |

**Score : 3✅ / 2⚠️ / 4❌ — Couverture ~40%**

---

### MOD-08 — Agenda / Rendez-vous ❌ NON DÉMARRÉ
**Priorité CDC : MOYENNE**

| Fonctionnalité CDC | Statut |
|---|---|
| CRUD rendez-vous | ❌ |
| Vues jour/semaine/mois | ❌ |
| Statuts (PENDING/SCHEDULED/DONE/NO_SHOW/CANCELLED/CONVERTED) | ❌ |
| Filtres par technicien | ❌ |
| Conversion RDV → ticket | ❌ |
| Export iCal/webcal | ❌ |
| Prise de RDV en ligne (page publique) | ❌ |

**Score : 0/7 — Couverture 0%** — Sprint 2.6 planifié

---

### MOD-09 — SAV et Garanties ❌ ABSENT
**Priorité CDC : MOYENNE**

| Fonctionnalité CDC | Statut |
|---|---|
| Garanties actives depuis factures | ❌ |
| Alerte garanties expirant < 30j / < 7j | ❌ |
| Tickets SAV (workflow identique MOD-01) | ❌ |
| Retours client (échange/avoir/refus) | ❌ |
| RMA fournisseurs | ❌ |

**Score : 0/5 — Couverture 0%**  
**Note :** Visible et complet chez monatelier.net. À planifier.

---

### MOD-10 — Achats / Approvisionnement ❌ NON DÉMARRÉ
**Priorité CDC : HAUTE**

| Fonctionnalité CDC | Statut |
|---|---|
| CRUD fournisseurs | ❌ |
| Bons de commande (draft/awaiting_delivery/received/cancelled) | ❌ |
| Vue "À commander" (besoins détectés) | ❌ |
| Réception commande → MAJ stock + CUMP | ❌ |
| Notification ticket "pièces reçues" | ❌ |
| États paiement fournisseur (pending/partial/paid) | ❌ |

**Score : 0/6 — Couverture 0%** — Sprint 2.5 planifié

---

### MOD-11 — Avoirs et Bons d'achat ✅ COMPLET
**Priorité CDC : BASSE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| Avoirs de remboursement (annulation facture) | ✅ | Sprint 2.1 |
| Numérotation séquentielle AV-AAAA-XXXXX | ✅ | `nextNumero('avoir')` |
| Chaîne NF525 sur avoirs | ✅ | `enregistrerTransaction()` |
| Bons d'achat (geste commercial) | ❌ | Non implémenté |
| Expiration bons d'achat | ❌ | Non implémenté |

**Score : 3✅ / 0⚠️ / 2❌ — Couverture ~60%**

---

### MOD-12 — Communication et Automatisations ❌ ABSENT
**Priorité CDC : HAUTE**

| Fonctionnalité CDC | Statut |
|---|---|
| Email transactionnel (SMTP/provider) | ❌ |
| SMS Gateway | ❌ |
| Templates avec variables dynamiques | ❌ |
| Automatisations (changement statut, anniversaire, tréso...) | ❌ |
| Notifications réception/pièces/prêt | ❌ |

**Score : 0/5 — Couverture 0%**  
**Note :** Très développé chez monatelier.net (5 automatisations configurées).

---

### MOD-13 — Caisse POS ❌ NON DÉMARRÉ
**Priorité CDC : MOYENNE**

| Fonctionnalité CDC | Statut |
|---|---|
| Interface POS tactile | ❌ |
| Journal de caisse NF525 | ❌ |
| Impression QZ Tray (thermique 80mm) | ❌ |
| Multi-modes paiement avec PIN | ❌ |

**Score : 0/4 — Couverture 0%** — Sprint 2.8 planifié

---

### MOD-14 — Vitrine publique ❌ NON DÉMARRÉ
**Priorité CDC : MOYENNE**

| Fonctionnalité CDC | Statut |
|---|---|
| Page `/pro/:slug` (vitrine atelier) | ❌ |
| Catalogue public des services | ❌ |
| Prise de RDV en ligne | ❌ |
| Dépôt à distance | ❌ |
| Demande de devis avec photos | ❌ |

**Score : 0/5 — Couverture 0%** — Sprint 2.7 planifié

---

### MOD-15 — Catalogue de services ✅ COMPLET (Sprint 2.4)
**Priorité CDC : HAUTE (implicite)**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| Catégories hiérarchiques (parent/enfant) | ✅ | `categories_services` + `parent_id` |
| CRUD services (nom, prix HT, TVA, durée, garantie, ref) | ✅ | `routes/services.ts` Controller pur |
| Calcul prix TTC automatique | ✅ | Côté API |
| Catalogue arbre (`getCatalogueArbre`) | ✅ | `servicesService.ts` |
| Color picker catégories | ✅ | 10 couleurs prédéfinies |
| Référence interne service | ✅ | Champ `reference` |
| **Liaison service → modèle appareil** | ❌ | Non implémenté (arbre Domaine>Marque>Modèle CDC) |
| Prix de revient (coût interne) | ❌ | Absent — calcul marge impossible |

**Score : 6✅ / 0⚠️ / 2❌ — Couverture ~75%**

**Note :** Le CDC prévoit une hiérarchie `Domaine > Marque > Modèle > Service`. L'implémentation actuelle fait `Catégorie > Sous-catégorie > Service` — plus simple mais fonctionnel.

---

### MOD-16 — Réseau et Multi-sites ❌ NON PRÉVU
**Priorité CDC : MOYENNE**

Non planifié dans les sprints actuels. Dépend de l'existence d'une base clients suffisante.

---

### MOD-17 — Rapports et Exports ⚠️ PARTIEL
**Priorité CDC : HAUTE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| Export CSV rachats/factures/stock | ✅ | `apiBlobGet()` présent |
| KPIs dashboard (CA, tickets, stock) | ⚠️ | `/api/stats` inline dans `index.tsx` — violation backlog |
| Rapport activité par technicien | ❌ | Non implémenté |
| Rapport caisse quotidien | ❌ | Dépend MOD-13 |
| Export Excel / PDF | ❌ | Sprint 2.10 |
| Filtres (période, type, statut) | ⚠️ | Partiels |

**Score : 1✅ / 3⚠️ / 3❌ — Couverture ~25%**

---

### MOD-18 — Gestion d'équipe ⚠️ PARTIEL
**Priorité CDC : MOYENNE**

| Fonctionnalité CDC | Statut | Détail |
|---|---|---|
| CRUD utilisateurs | ✅ | `routes/users.ts` |
| Rôles (owner/admin/manager/technicien) | ✅ | Colonne `role` + `requireRole()` |
| PIN switch rapide (PBKDF2) | ✅ | Sprint 2.3 complet |
| Sessions KV TTL 15min | ✅ | `pin_session:{userId}` |
| Permissions granulaires | ✅ | Table `permissions` + `hasPermission()` |
| Stats utilisateur (JSONB) | ❌ | Non implémenté |
| OAuth2 Google | ❌ | Non implémenté |
| Pointage (absent/en poste/pause/terminé) | ❌ | Non prévu |

**Score : 5✅ / 0⚠️ / 3❌ — Couverture ~62%**

---

## 2. Synthèse Globale — Tableau de Couverture

| Module CDC | Priorité | Couverture | Statut |
|---|---|---|---|
| MOD-01 Tickets | CRITIQUE | ~45% | ⚠️ Statuts incomplets |
| MOD-02 Facturation | CRITIQUE | ~67% | ✅ Fonctionnel |
| MOD-03 Devis | HAUTE | ~25% | ⚠️ Flux incomplet |
| MOD-04 Stock + CUMP | CRITIQUE | ~45% | ⚠️ CUMP manquant |
| MOD-05 Reconditionnement | MOYENNE | 0% | ❌ Absent |
| MOD-06 Rachats | HAUTE | ~88% | ✅ Quasi-complet |
| MOD-07 CRM Clients | HAUTE | ~40% | ⚠️ Partiel |
| MOD-08 Agenda/RDV | MOYENNE | 0% | ❌ Sprint 2.6 |
| MOD-09 SAV/Garanties | MOYENNE | 0% | ❌ Non planifié |
| MOD-10 Achats/Approv. | HAUTE | 0% | ❌ Sprint 2.5 |
| MOD-11 Avoirs | BASSE | ~60% | ✅ Bon avancement |
| MOD-12 Communication | HAUTE | 0% | ❌ Non planifié |
| MOD-13 Caisse POS | MOYENNE | 0% | ❌ Sprint 2.8 |
| MOD-14 Vitrine publique | MOYENNE | 0% | ❌ Sprint 2.7 |
| MOD-15 Catalogue services | HAUTE | ~75% | ✅ Sprint 2.4 |
| MOD-16 Réseau multi-sites | MOYENNE | 0% | ❌ Non planifié |
| MOD-17 Rapports/Exports | HAUTE | ~25% | ⚠️ Partiel |
| MOD-18 Gestion équipe | MOYENNE | ~62% | ✅ Bon avancement |

**Couverture globale estimée : ~35%** (vs ~12% avant sprint 2.1)

---

## 3. Différenciateurs monatelier.net vs iziGSM actuel

| Fonctionnalité monatelier | iziGSM | Priorité pour rattraper |
|---|---|---|
| Google OAuth (Sign in with Google) | ❌ | HAUTE — friction login réduite |
| Essai gratuit 14 jours sans CB | ❌ | HAUTE — conversion SaaS |
| PWA installable (banner native) | ❌ | Sprint 2.11 planifié |
| Kanban drag & drop (8 colonnes) | ❌ | HAUTE — UX opérationnelle |
| Numérotation configurable par tenant | ❌ | HAUTE — onboarding / migration |
| Types d'appareils configurables par tenant | ❌ | HAUTE — personnalisation |
| Vue "À commander" dédiée | ❌ | HAUTE — flux opérationnel quotidien |
| Import CSV clients | ❌ | HAUTE — migration depuis autre logiciel |
| Parrainage client (code + filleuls) | ❌ | MOYENNE |
| Notifications automatisées (5 types) | ❌ | HAUTE — rétention client |
| eIDAS signature devis | ❌ | HAUTE — conformité |
| SAV & Garanties complet | ❌ | HAUTE — suivi post-vente |
| Avoirs & Bons d'achat | ⚠️ Avoir ✅, bon d'achat ❌ | MOYENNE |
| Onboarding guidé (numérotation + types dès dashboard) | ❌ | HAUTE — activation utilisateur |
| Multi-boutiques (PDV) | ❌ | MOYENNE |

---

## 4. Gaps Critiques à Résoudre (P0 / P1)

### 🔴 P0 — Bloquants fonctionnels majeurs

| # | Gap | Module | Sprint cible |
|---|---|---|---|
| G01 | 3 statuts ticket manquants (`TO_ORDER`, `ORDERED`, `PARTS_RECEIVED`) | MOD-01 | **2.5** (lié commandes) |
| G02 | CUMP non calculé à réception commande | MOD-04 | **2.5** |
| G03 | Fournisseurs + Bons de commande absents | MOD-10 | **2.5** |
| G04 | Page suivi client public (`/suivi/:token`) | MOD-01/14 | **2.7** |

### 🟠 P1 — Fonctionnalités cœur manquantes

| # | Gap | Module | Sprint cible |
|---|---|---|---|
| G05 | Numérotation configurable par tenant (préfixe, séparateur, date) | MOD-02 | **nouveau sprint** |
| G06 | Types d'appareils configurables par tenant | MOD-01/18 | **nouveau sprint** |
| G07 | Kanban tickets avec drag & drop | MOD-01 | **nouveau sprint** |
| G08 | Notifications automatisées email/SMS | MOD-12 | **futur** |
| G09 | Import CSV clients | MOD-07 | **2.12** |
| G10 | eIDAS signature devis (page publique) | MOD-03 | **futur** |
| G11 | SAV & Garanties | MOD-09 | **nouveau sprint** |
| G12 | Vue "À commander" (besoins pièces depuis tickets) | MOD-10 | **2.5** |

---

## 5. Proposition de Réordonnancement des Sprints

### Justification

Le plan actuel 2.5→2.12 doit être réajusté selon :
1. **Priorités CDC** : CRITIQUE > HAUTE > MOYENNE
2. **Dépendances** : MOD-10 (fournisseurs) débloque CUMP (MOD-04) qui débloque marges (MOD-17)
3. **Différenciateurs monatelier** : Kanban, numérotation config, SAV
4. **Flux métier complet** : Ticket → Commande pièces → Réparation → Facture = chaîne critique

### Plan révisé

| Sprint | Contenu | Modules CDC | Priorité |
|---|---|---|---|
| **2.5** ✅ planifié | Fournisseurs + Bons commande + CUMP | MOD-10 + MOD-04 | CRITIQUE/HAUTE |
| **2.6** ✅ planifié | Agenda / RDV + iCal | MOD-08 | MOYENNE |
| **2.7** ✅ planifié | Vitrine publique + Tracking token | MOD-14 + MOD-01 | MOYENNE |
| **2.8** 🔄 **modifier** | ~~Caisse POS~~ → **Statuts tickets complets + Kanban** | MOD-01 | **CRITIQUE** |
| **2.9** 🔄 **modifier** | ~~Flux métier~~ → **Numérotation configurable + Settings tenant** | MOD-02/18 | **HAUTE** |
| **2.10** 🔄 **modifier** | ~~PDF+Stats~~ → **SAV & Garanties** | MOD-09 | **HAUTE** |
| **2.11** 🔄 **modifier** | ~~PWA~~ → **Notifications email (Resend) + Automatisations** | MOD-12 | **HAUTE** |
| **2.12** 🆕 | Caisse POS + Journal NF525 | MOD-13 | MOYENNE |
| **2.13** 🆕 | Export PDF + Dashboard graphiques réels | MOD-17 | HAUTE |
| **2.14** 🆕 | PWA manifest + Service Worker | — | MOYENNE |
| **2.15** 🆕 | CRM étendu (parrainage, import CSV, historique consolidé) | MOD-07 | HAUTE |
| **2.16** 🆕 | Reconditionnement + Bons d'achat | MOD-05/11 | MOYENNE |

### Raisonnement des changements clés

**Pourquoi avancer Kanban (Sprint 2.8) avant Caisse POS :**
- Kanban = différenciateur majeur vs monatelier.net
- Statuts `TO_ORDER`/`ORDERED`/`PARTS_RECEIVED` = prérequis du flux commandes (MOD-10 Sprint 2.5)
- Sans kanban complet, le flux ticket→commande→réparation n'est pas visualisable

**Pourquoi avancer Numérotation configurable (Sprint 2.9) :**
- Onboarding : c'est la **première chose** que configure un atelier (vu chez monatelier)
- Bloque l'adoption par des ateliers migrant depuis un autre logiciel (numéros existants)

**Pourquoi avancer SAV/Garanties (Sprint 2.10) :**
- MOD-09 priorité MOYENNE mais très visible chez monatelier
- Dépend de factures ✅ et tickets ✅ — tout est en place
- Rétention client : suivi garanties = fidélisation

**Pourquoi déplacer Caisse POS à 2.12 :**
- Priorité CDC MOYENNE
- Dépend de notifications (MOD-12) pour les tickets de caisse
- QZ Tray complexité technique non bloquante pour le MVP

---

## 6. Conformité Réglementaire — État

| Réglementation | Exigence | Statut |
|---|---|---|
| CGI art. 289 | Verrouillage post-émission (`locked=1`) | ✅ Sprint 2.1 |
| NF525 | Chaîne SHA-256 factures/avoirs | ✅ Sprint 2.1 |
| Code pénal art. 321-7 | Livre de police rachats | ✅ Sprint 2.2 |
| PBKDF2 / Hachage PIN | Format `100000:salt:hash` | ✅ Sprint 2.3 |
| RGPD | Hébergement UE (Cloudflare EU), mentions légales | ✅ partiel |
| eIDAS | Signature électronique devis | ❌ Non implémenté |
| NF525 Journal caisse | Chaîne SHA-256 sessions POS | ❌ Sprint 2.12 |

---

## 7. Architecture — Points de Divergence CDC vs Implémentation

| Aspect | CDC (Manus) | iziGSM Cloudflare | Compatibilité |
|---|---|---|---|
| Stack | PHP BFF + PostgreSQL + Redis | Hono TS + D1 + KV | ✅ Équivalent fonctionnel |
| Auth sessions | PHP sessions serveur | JWT + KV TTL | ✅ Plus sécurisé |
| Base de données | PostgreSQL 15+ | Cloudflare D1 (SQLite) | ✅ Adapté |
| Stockage fichiers | S3/MinIO | Cloudflare R2 | ✅ Équivalent |
| Scalabilité | Load Balancer + replicas | Edge mondial CF | ✅ Supérieur |
| WebSockets (notifs temps réel) | WebSocket server | Non disponible CF | ⚠️ Durable Objects si besoin |
| Worker email/SMS async | Queue + workers dédiés | Fetch direct depuis Workers | ⚠️ Synchrone — OK pour MVP |
| OAuth Google | oauth-service.js | Non implémenté | ❌ À prévoir |

---

*Document mis à jour — 4 juin 2026 — Sprint 2.4 ✅*  
*Remplace la version du 1er juin 2026 (pré-sprints 2.1-2.4)*
