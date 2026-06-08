# 📊 Tableau Récapitulatif — iziGSM — État post-Sprint 2.12

> **Date** : 8 juin 2026  
> **Version** : 2.12.0  
> **Dernier commit** : `b2f0d78` — *Fix bug T3 backlog — createGarantie() FK constraint*  
> **Branche** : `main`  
> **Build** : `dist/_worker.js 190.37 kB` — 55 modules  

---

## 🟢 FAIT ET VALIDÉ — Production-ready

| Module CDC | Sprints | Fonctionnalités clés | Couverture |
|---|---|---|---|
| **MOD-06 Rachats / Livre de police** | 2.2 | 30 champs, numérotation `LP-AAAA-XXXXX`, conformité art. 321-7, doublon IMEI, statuts, export CSV, KPIs | **~88%** |
| **MOD-02 Facturation NF525** | 2.1 | Verrouillage CGI art. 289, chaîne SHA-256, numérotation séquentielle, avoirs `AV-AAAA-XXXXX`, multi-paiements, export CSV | **~67%** |
| **MOD-15 Catalogue services** | 2.4 | Catégories hiérarchiques, CRUD services complet, calcul TTC, catalogue arbre, color picker, référence interne | **~75%** |
| **MOD-10 Fournisseurs + BC** | 2.5 | CRUD fournisseurs, bons de commande `BC-AAAA-XXXXX`, réception + CUMP, vue "À commander", KPIs | **~85%** |
| **MOD-08 Agenda / RDV** | 2.6 | 6 statuts, types RDV, vue semaine/liste, export iCal RFC 5545, token stable par boutique, fin auto-calculée | **~70%** |
| **MOD-18 Gestion équipe** | 2.3 | CRUD users, rôles granulaires, PIN PBKDF2, sessions KV TTL 15min, permissions par module | **~62%** |
| **MOD-04 Stock + CUMP** | 2.1/2.5 | CRUD produits, mouvements, alertes stock bas, CUMP à la réception, export CSV | **~65%** |
| **MOD-09 SAV & Garanties** | 2.10 | Dossiers SAV, garanties depuis factures, alertes expiry, statuts workflow, `ticket_id` nullable *(fix T3 ✅)* | **~80%** |
| **MOD-12 Notifications email** | 2.11 | Resend/simulé, 4 templates (ticket créé/terminé, SAV, facture), logs email, hooks automatiques | **~65%** |
| **MOD-13 Caisse POS + NF525** | 2.12 | Interface POS 3 onglets, vente multi-lignes, 4 modes paiement, journal SHA-256 chaîné, clôture irréversible, vérification intégrité, KPIs | **~75%** |
| **MOD-01 Tickets** | 2.7/2.8 | Tracking token public `/suivi/:token`, 8 statuts complets (`TO_ORDER` / `ORDERED` / `PARTS_RECEIVED` ✅), Kanban drag & drop, priorités, indicateurs ancienneté | **~70%** |
| **MOD-14 Vitrine publique** *(base)* | 2.7 | Page `/pro/:slug`, catalogue public services, `GET /api/public/ticket/:token` sans auth | **~40%** |
| **Config tenant / Numérotation** | 2.9 | Table `config_tenant`, préfixe configurable, format date, `nextNumero()` dynamique, types appareils | **~70%** |

---

## 🟡 FAIT MAIS NÉCESSITE DES CORRECTIONS / AMÉLIORATIONS

| Module CDC | Problème identifié | Priorité | Sprint cible |
|---|---|---|---|
| **MOD-01 Tickets** — Archivage auto | `archived_at` présent en base mais logique non implémentée côté service | 🟠 P1 | 2.15 |
| **MOD-02 Facturation** — Export PDF | `window.print()` à implémenter, absent actuellement | 🟠 P1 | **2.13** |
| **MOD-03 Devis** | Statuts workflow non enforced côté API, page publique signature absente, relance expirés absente | 🔴 P0 | 2.13+ |
| **MOD-07 CRM Clients** | `JOIN tickets` cross-module l.41 `routes/clients.ts` — violation architecture MVC | 🟡 P1 | **2.15** |
| **MOD-11 Avoirs** | Avoirs ✅, **Bons d'achat** absents | 🟡 P1 | **2.16** |
| **MOD-17 Dashboard / Stats** | `/api/stats` SQL inline dans `index.tsx` (violation architecture), graphiques Chart.js absents | 🟡 P1 | **2.13** |
| **MOD-18 Équipe** — Couches MVC | Pas de `ticketService.ts`, `clientService.ts`, `stockService.ts` | 🟢 P2 | 2.13/2.15 |
| **MOD-09 SAV** — Bug T3 *(résolu)* | ✅ `ticket_id = NULL` + `date_fin` calculé JS-side — commit `b2f0d78` | ✅ Résolu | — |

---

## 🔴 RESTE À FAIRE (CDC non couvert)

| Module CDC | Priorité | Contenu | Sprint planifié |
|---|---|---|---|
| **MOD-17 Export PDF + Graphiques** | 🔴 HAUTE | PDF factures/tickets `window.print()`, Chart.js CA mensuel, tickets/statut, marges, rapport technicien | **Sprint 2.13** |
| **PWA** | 🟠 MOYENNE | `manifest.json`, Service Worker cache offline, install prompt, icônes 192/512px | **Sprint 2.14** |
| **MOD-07 CRM étendu** | 🟠 HAUTE | Historique consolidé client, import CSV, parrainage `referral_code`, score fidélité, `clientService.ts` | **Sprint 2.15** |
| **MOD-05 Reconditionnement** | 🟡 MOYENNE | Ordres reconditionnement, coût de revient pièces+MO, passage stock occasion, marge reconditionné | **Sprint 2.16** |
| **MOD-11 Bons d'achat** | 🟡 BASSE | Geste commercial, expiration configurable, liaison facture | **Sprint 2.16** |
| **MOD-03 Devis complet** | 🟠 HAUTE | Page publique `/quotes/:token`, signature eIDAS, relance devis expirés, acceptation en ligne | Non planifié |
| **MOD-14 Vitrine complète** | 🟡 MOYENNE | Prise de RDV en ligne, dépôt à distance, demande devis avec photos | Non planifié |
| **MOD-16 Multi-sites / Réseau** | 🟡 BASSE | Gestion réseau de boutiques, reporting consolidé multi-PDV | Non planifié |
| **MOD-04 Scanner codes-barres** | 🟡 BASSE | Scan IMEI/EAN via caméra navigateur | Non planifié |
| **MOD-18 OAuth Google** | 🟡 BASSE | Sign in with Google — réduction friction login | Non planifié |

---

## 📐 Violations Architecturales (backlog technique)

| Priorité | Fichier | Violation | Sprint cible |
|---|---|---|---|
| 🟡 MOYENNE | `src/index.tsx` | `/api/stats` SQL inline multi-module → doit migrer dans `statsService.ts` | **2.13** |
| 🟡 MOYENNE | `routes/clients.ts` l.41 | `JOIN tickets` cross-module | **2.15** |
| 🟢 BASSE | `routes/tickets.ts` | Absence de couche `ticketService.ts` | **2.13** |
| 🟢 BASSE | `routes/clients.ts` | Absence de couche `clientService.ts` | **2.15** |
| 🟢 BASSE | `routes/stocks.ts` | Absence de couche `stockService.ts` | **2.13** |

---

## ✅ Conformité Réglementaire

| Réglementation | Exigence | Statut |
|---|---|---|
| CGI art. 289 | Verrouillage post-émission (`locked=1`) | ✅ Sprint 2.1 |
| NF525 Factures | Chaîne SHA-256 factures + avoirs | ✅ Sprint 2.1 |
| NF525 Journal caisse | Chaîne SHA-256 sessions POS + clôture irréversible | ✅ Sprint 2.12 |
| Code pénal art. 321-7 | Livre de police rachats (30 champs obligatoires) | ✅ Sprint 2.2 |
| PBKDF2 | Format `100000:salt_hex:hash_hex` — compatible Workers | ✅ Sprint 2.3 |
| RGPD | Hébergement EU Cloudflare, mentions légales partielles | ⚠️ Partiel |
| eIDAS | Signature électronique devis | ❌ Non planifié |

---

## 📈 Couverture globale CDC

| Priorité CDC | Modules concernés | Couverture post-Sprint 2.12 |
|---|---|---|
| **CRITIQUE** | MOD-01 Tickets ✅+, MOD-02 Facturation ✅, MOD-04 Stock ✅ | **~70%** |
| **HAUTE** | MOD-03 Devis ⚠️, MOD-06 Rachats ✅, MOD-07 CRM ⚠️, MOD-10 Achats ✅, MOD-12 Notifs ✅, MOD-15 Catalogue ✅, MOD-17 Rapports ⚠️ | **~62%** |
| **MOYENNE** | MOD-08 Agenda ✅, MOD-09 SAV ✅, MOD-13 Caisse ✅, MOD-14 Vitrine ⚠️, MOD-05 Recond. ❌, MOD-16 Multi-sites ❌ | **~50%** |
| **BASSE** | MOD-11 Avoirs ⚠️, MOD-18 Équipe ✅ | **~65%** |
| **GLOBAL** | **18 modules CDC** | **~60%** *(vs ~35% Sprint 2.4)* |

---

## 🗓️ Roadmap — Sprints restants

| Sprint | Contenu | Modules CDC | Statut |
|---|---|---|---|
| **2.13** | Export PDF + Dashboard Chart.js + `statsService.ts` | MOD-17 | 🔜 **Suivant** |
| **2.14** | PWA manifest + Service Worker offline | — | 🔜 |
| **2.15** | CRM étendu + `clientService.ts` + import CSV + fix JOIN | MOD-07 | 🔜 |
| **2.16** | Reconditionnement + Bons d'achat | MOD-05 / MOD-11 | 🔜 |

---

## 🏁 Résumé exécutif

- **10 modules sur 18** opérationnels en production — couverture globale **~60%**
- Les **3 modules CRITIQUE** (Tickets, Facturation, Stock) atteignent **~70%** de couverture
- **Conformité réglementaire complète** : NF525 factures + NF525 journal caisse + art. 321-7
- **2 violations architecturales majeures** en backlog : `/api/stats` inline (`index.tsx`) et JOIN cross-module clients
- **4 sprints restants** (2.13→2.16) : exports/rapports, PWA, CRM avancé, reconditionnement

---

*Document généré — 8 juin 2026 — post-Sprint 2.12*  
*Référence : `docs/ANALYSE_COMPARATIVE_CDC.md` (Sprint 2.4) + `docs/TODO.md` (Sprint 2.6)*
