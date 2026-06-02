# iziGSM — Architecture des Modules & Liens Fonctionnels

> **Version** : 1.1.0  
> **Dernière mise à jour** : 1er juin 2026  
> **Référence CDC** : `docs/CDC_izigsm.pdf` — v1.0  
> **Stack** : Hono + Cloudflare Pages/Workers + D1 + KV + R2

---

## 1. Vue d'ensemble — Architecture globale

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND (HTML/JS statique — Cloudflare CDN mondial)           │
│                                                                  │
│  dashboard.js ──┐                                               │
│  clients.js  ───┤                                               │
│  tickets.js  ───┤──→  api() wrapper (app.js)                   │
│  stock.js    ───┤     ├─ JWT Bearer token (auto-refresh)        │
│  devis.js    ───┤     ├─ 401 → tryRefreshToken() → retry        │
│  factures.js ───┤     └─ fallback localStorage si API down      │
│  personnel.js───┘                                               │
│  rachats.js  ─── (Sprint 2)                                     │
│  agenda.js   ─── (Sprint 2)                                     │
│  caisse.js   ─── (Sprint 2)                                     │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS fetch() — JWT dans Authorization header
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  BACKEND (Hono TypeScript Worker — Cloudflare Edge)             │
│                                                                  │
│  authMiddleware  ──→ Vérifie JWT HMAC-SHA256 sur toutes routes  │
│  requireRole()   ──→ RBAC par endpoint                          │
│  getBoutiqueId() ──→ Isolation multi-tenant automatique         │
│                                                                  │
│  /api/auth/*       → src/routes/auth.ts                         │
│  /api/clients/*    → src/routes/clients.ts                      │
│  /api/tickets/*    → src/routes/tickets.ts                      │
│  /api/produits/*   → src/routes/stocks.ts                       │
│  /api/categories/* → src/routes/stocks.ts                       │
│  /api/devis/*      → src/routes/facturation.ts                  │
│  /api/factures/*   → src/routes/facturation.ts                  │
│  /api/avoirs/*     → src/routes/facturation.ts  (Sprint 2)      │
│  /api/employes/*   → src/routes/personnel.ts                    │
│  /api/pointage/*   → src/routes/personnel.ts                    │
│  /api/boutiques/*  → src/routes/boutiques.ts                    │
│  /api/nf525/*      → src/routes/boutiques.ts                    │
│  /api/stats        → src/index.tsx                              │
│  /api/buybacks/*   → src/routes/rachats.ts      (Sprint 2)      │
│  /api/agenda/*     → src/routes/agenda.ts       (Sprint 2)      │
│  /api/catalogue/*  → src/routes/catalogue.ts    (Sprint 2)      │
│  /api/fournisseurs → src/routes/achats.ts       (Sprint 2)      │
│  /api/caisse/*     → src/routes/caisse.ts       (Sprint 2)      │
│  /api/tracking/*   → public, sans auth          (Sprint 2)      │
│  /api/public/*     → public, sans auth          (Sprint 2)      │
└──────────────────────────┬──────────────────────────────────────┘
                           │ D1 prepare().bind() — SQLite edge
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  CLOUDFLARE D1 (SQLite distribué — même PoP que le Worker)      │
│                                                                  │
│  users ──────────────────── FK → boutiques                      │
│  boutiques                                                       │
│  boutique_settings ──────── FK → boutiques                      │
│  clients ────────────────── FK → boutiques                      │
│  appareils ──────────────── FK → clients                        │
│  tickets ────────────────── FK → clients, employes, boutiques   │
│  statuts_historique ─────── FK → tickets, users                 │
│  categories                                                      │
│  produits ───────────────── FK → categories, boutiques          │
│  mouvements_stock ───────── FK → produits, tickets (Sprint 2)   │
│  devis ──────────────────── FK → clients, tickets, boutiques    │
│  factures ───────────────── FK → devis, clients, boutiques      │
│  avoirs ─────────────────── FK → factures          (Sprint 2)   │
│  lignes_document ────────── FK → devis | factures               │
│  paiements ──────────────── FK → factures, boutiques            │
│  employes ───────────────── FK → boutiques                      │
│  pointages ──────────────── FK → employes                       │
│  journal_nf525 ──────────── FK → factures, boutiques            │
│  rachats ────────────────── FK → boutiques, produits (Sprint 2) │
│  rendez_vous ────────────── FK → clients, employes  (Sprint 2)  │
│  domaines / marques / modeles_appareils / services_catalogue     │
│                              (FK hiérarchiques)     (Sprint 2)  │
│  fournisseurs / bons_commande / lignes_commande     (Sprint 2)  │
│  garanties ──────────────── FK → factures, tickets (Sprint 3)   │
│  templates_communication                            (Sprint 3)  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  CLOUDFLARE KV (clé-valeur distribué)                           │
│  ├─ OTP inscription        TTL 10 min                           │
│  └─ Refresh tokens JWT     TTL 7 jours                          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  CLOUDFLARE R2 (object storage S3-compatible)                   │
│  ├─ photos tickets         /tickets/:id/photos/    (Sprint 2)   │
│  └─ documents devis/PDF    /documents/:id/         (Sprint 2)   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Liens entre modules — Opérationnels (Sprint 1 ✅)

Ces flux fonctionnent **en production** dès maintenant.

| # | Action utilisateur | Module déclencheur | Appel API | Module cible | Effet en base D1 |
|---|---|---|---|---|---|
| 1 | Créer un client | Clients | `POST /api/clients` | — | INSERT `clients` avec `boutique_id` |
| 2 | Ajouter un appareil à un client | Clients | `POST /api/clients/:id/appareils` | — | INSERT `appareils` avec `client_id` |
| 3 | Créer un ticket de réparation | Tickets | `POST /api/tickets` avec `client_id` | Clients | `tickets.client_id = clients.id` |
| 4 | Changer le statut d'un ticket | Tickets | `PUT /api/tickets/:id/statut` | Tickets | INSERT `statuts_historique` + UPDATE `tickets.statut` |
| 5 | Créer un devis depuis un ticket | Devis | `POST /api/devis` avec `ticket_id` | Tickets | `devis.ticket_id = tickets.id` + INSERT `lignes_document` |
| 6 | Convertir devis → facture | Devis | `PUT /api/devis/:id/convertir` | Factures + NF525 | INSERT `factures`, copie `lignes_document`, UPDATE `devis.facture_id`, INSERT `journal_nf525` (hash SHA-256 chaîné) |
| 7 | Enregistrer un paiement | Factures | `POST /api/factures/:id/paiement` | Paiements | INSERT `paiements`, UPDATE `factures.montant_paye` + `factures.statut` (payee / partiellement_payee) |
| 8 | Entrée stock (réception produit) | Stock | `POST /api/produits/:id/mouvement` type `entree` | Stocks | INSERT `mouvements_stock`, UPDATE `produits.stock_actuel` += quantité |
| 9 | Sortie stock (consommation) | Stock | `POST /api/produits/:id/mouvement` type `sortie` | Stocks | INSERT `mouvements_stock`, UPDATE `produits.stock_actuel` -= quantité |
| 10 | Ajustement inventaire | Stock | `POST /api/produits/:id/mouvement` type `ajustement` | Stocks | INSERT `mouvements_stock`, SET `produits.stock_actuel` = nouvelle valeur |
| 11 | Pointer un employé | Personnel | `POST /api/pointage/:id/pointer` | Pointage | INSERT `pointages`, UPDATE `employes.statut_actuel` (machine à états) |
| 12 | Consulter le dashboard | Dashboard | `GET /api/stats` | Tous modules | JOIN D1 : COUNT tickets en cours + SUM CA mois + COUNT stock bas + COUNT employés en poste |
| 13 | Connexion utilisateur | Auth | `POST /api/login` | KV + D1 | Vérification PBKDF2, génération JWT HMAC-SHA256, stockage refresh token KV |
| 14 | Refresh token expiré | Auth (auto) | `POST /api/auth/refresh` | KV | Lecture KV, nouveau JWT, mise à jour KV |

---

## 3. Liens entre modules — À implémenter (Sprint 2 🔄)

Ces flux sont **définis dans le CDC** et seront câblés au Sprint 2.

| # | Action utilisateur | Module déclencheur | Appel API | Module cible | Effet attendu |
|---|---|---|---|---|---|
| 15 | Émettre une facture | Factures | `POST /api/factures/:id/emettre` | NF525 | SET `factures.locked = true`, `factures.issued_at = NOW()`, INSERT `journal_nf525` |
| 16 | Créer un avoir (annulation) | Factures | `POST /api/avoirs` avec `facture_id` | NF525 | INSERT `avoirs` numéro `AV-YYYY-XXXX`, INSERT `journal_nf525` (avoir dans chaîne NF525) |
| 17 | Enregistrer un rachat | Rachats | `POST /api/buybacks` | Stock (optionnel) | INSERT `rachats` (livre de police), INSERT `produits` si remis en vente |
| 18 | Vendre un objet racheté | Rachats | `PATCH /api/buybacks/:id` statut `vendu` | Stock + Factures | UPDATE `rachats.statut`, sortie stock, génération facture vente |
| 19 | Prendre un RDV | Agenda | `POST /api/agenda` | Clients | INSERT `rendez_vous` avec `client_id`, email confirmation (Sprint 3) |
| 20 | Convertir RDV → Ticket | Agenda | `PUT /api/agenda/:id/convertir` | Tickets | INSERT `tickets` avec `appointment_id`, UPDATE `rendez_vous.ticket_id` |
| 21 | Suivi ticket public (client) | Vitrine | `GET /api/tracking/:token` | Tickets | SELECT `tickets` par `tracking_token` (champ UUID généré à la création) |
| 22 | Réservation publique RDV | Vitrine | `POST /api/public/rdv` | Agenda | INSERT `rendez_vous` statut PENDING, sans auth |
| 23 | Sélectionner service catalogue | Tickets | `GET /api/catalogue` | Catalogue | SELECT `services_catalogue` → pré-remplit lignes devis/ticket |
| 24 | Créer commande fournisseur | Achats | `POST /api/commandes` | Fournisseurs | INSERT `bons_commande` + `lignes_commande` |
| 25 | Réceptionner commande | Achats | `POST /api/commandes/:id/recevoir` | Stock | UPDATE `produits.stock_actuel` += qté, recalcul CUMP : `(ancien_stock × ancien_cump + qté × prix) / total_qté` |
| 26 | Encaissement caisse | Caisse POS | `POST /api/caisse/encaisser` | Factures + NF525 | INSERT `paiements`, UPDATE `factures.statut`, enregistrement journal caisse |
| 27 | Clôture journalière caisse | Caisse POS | `POST /api/caisse/cloture` | NF525 | INSERT `journal_nf525` clôture du jour (total + hash) |
| 28 | Switch PIN technicien | Auth | `POST /api/auth/pin` | KV | Vérification `pin_hash` D1, nouveau JWT contexte technicien (sans déconnexion) |
| 29 | Upload photo ticket | Tickets | `POST /api/tickets/:id/photos` | R2 | PUT objet R2 `/tickets/:id/photos/:uuid`, INSERT URL dans D1 |
| 30 | Export iCal agenda | Agenda | `GET /api/calendar/:tenant/:token.ics` | Agenda | SELECT `rendez_vous`, génération flux `.ics` (webcal) |

---

## 4. Liens entre modules — Sprint 3 & 4 (📅 Planifiés)

| # | Action | Déclencheur | API | Cible | Effet |
|---|---|---|---|---|---|
| 31 | Trigger email statut ticket | Automation | Webhook interne statut change | Resend API | Email client "Votre réparation est terminée" |
| 32 | Trigger SMS RDV J-1 | Automation | Cron-like KV scheduled | Twilio API | SMS rappel rendez-vous |
| 33 | Déclaration Qualirépar | Qualirépar | `POST /api/qualirepar/declarer` | API officielle Qualirépar | Soumission dossier bonus réparation |
| 34 | Déclenchement SAV sous garantie | SAV | `POST /api/tickets` type `sav` avec `garantie_id` | Garanties + Tickets | INSERT ticket SAV lié à la facture d'origine |
| 35 | Retour client → Avoir SAV | SAV | `POST /api/avoirs` motif `sav` | Avoirs + Stock | INSERT avoir, retour produit en stock |
| 36 | Connexion Google OAuth | Auth | `POST /api/auth/google` | KV + D1 | Exchange code → profil Google → JWT iziGSM |
| 37 | Switch boutique réseau | Multi-site | `POST /api/network/switch` | D1 | Nouveau JWT avec `boutique_id` cible, accès cockpit consolidé |

---

## 5. Règles métier critiques — Conformité légale

### 5.1 NF525 — Anti-fraude TVA (Loi 2018)
> **Obligatoire** pour tout logiciel de caisse en France. Amende 7 500 € par logiciel.

| Règle | Implémentation |
|---|---|
| Numérotation séquentielle sans trou | `nextNumero()` dans `src/lib/db.ts` — séquence atomique D1 |
| Chaîne SHA-256 inaltérable | `enregistrerTransaction()` dans `src/lib/nf525.ts` — hash(data + hash_précédent) |
| Verrouillage post-émission | **Sprint 2** — `factures.locked = true` après `POST /api/factures/:id/emettre` |
| Avoirs dans la chaîne | **Sprint 2** — avoirs avec préfixe `AV-` aussi chaînés en NF525 |
| Clôture journalière | **Sprint 2** — `POST /api/caisse/cloture` avec hash du total journée |
| Vérification intégrité | `GET /api/nf525/verify` ✅ opérationnel |
| Export journal | `GET /api/nf525/export` ✅ opérationnel |

### 5.2 Livre de police — Rachats (Code pénal art. 321-7)
> **Obligatoire** pour tout achat de matériel d'occasion.

| Champ obligatoire | Colonne D1 | Validation |
|---|---|---|
| Date d'acquisition | `date_acquisition` | NOT NULL |
| Identité vendeur (nom, prénom) | `vendeur_nom`, `vendeur_prenom` | NOT NULL |
| Adresse vendeur | `vendeur_adresse` | NOT NULL |
| Pièce d'identité | `vendeur_piece_identite` | NOT NULL |
| Description objet | `description_objet` | NOT NULL |
| IMEI / N° série | `imei_serie` | NOT NULL si électronique |
| Prix d'achat | `prix_achat_ht` | NOT NULL, > 0 |
| N° séquentiel registre | `numero_registre` | Auto-incrémenté, format `LP-YYYY-XXXX` |

### 5.3 RGPD — Données personnelles
| Droit | Endpoint | Sprint |
|---|---|---|
| Accès aux données | `GET /api/clients/:id/export` | S4 |
| Rectification | `PUT /api/clients/:id` | ✅ S1 |
| Effacement | `DELETE /api/clients/:id/purge` | S4 |
| Portabilité | Export JSON/CSV depuis `GET /api/clients/:id/export` | S4 |

---

## 6. Flux métier complets — De bout en bout

### Flux A — Réparation standard (le plus fréquent)
```
Client dépose appareil
    → POST /api/clients (si nouveau)
    → POST /api/tickets {client_id, appareil, description}
        → tracking_token généré (UUID) → envoyé par SMS/email (Sprint 3)
    → PUT /api/tickets/:id/statut "diagnostic"
    → POST /api/devis {ticket_id, lignes [service catalogue]}
        → Client approuve (lien public /api/quotes/public/:token)
    → PUT /api/devis/:id/convertir
        → INSERT factures + NF525 hash
    → Technicien répare
        → POST /api/produits/:id/mouvement type "sortie" (pièces utilisées)
    → PUT /api/tickets/:id/statut "termine"
    → POST /api/factures/:id/emettre → locked = true
    → POST /api/factures/:id/paiement {montant, mode}
        → factures.statut = "payee"
    → SMS/Email "Votre appareil est prêt" (Sprint 3)
    → Client récupère → PUT /api/tickets/:id/statut "livre"
```

### Flux B — Rachat + Revente
```
Client vend un appareil d'occasion
    → POST /api/buybacks {vendeur, imei, prix_achat}
        → numero_registre auto (LP-2026-XXXX)
        → livre de police mis à jour
    → Technicien remet en état
        → POST /api/produits/:id/mouvement type "entree" (mise en stock)
    → Vente à un autre client
        → PATCH /api/buybacks/:id {statut: "vendu"}
        → POST /api/factures → NF525 chaîné
```

### Flux C — RDV en ligne (vitrine publique)
```
Client visite /pro/mon-atelier (sans login)
    → POST /api/public/rdv {nom, email, date, service}
        → INSERT rendez_vous statut PENDING
        → Email confirmation (Sprint 3)
    → Admin confirme → PUT /api/agenda/:id/statut "scheduled"
        → SMS rappel J-1 (Sprint 3)
    → Client arrive → PUT /api/agenda/:id/convertir
        → INSERT tickets lié au RDV
```

### Flux D — Commande fournisseur → Stock
```
Stock bas détecté (produit.stock_actuel <= produit.stock_minimum)
    → Alerte dashboard (kpi-stock-bas)
    → POST /api/commandes {fournisseur_id, lignes}
        → statut "awaiting_delivery"
    → Réception marchandise
        → POST /api/commandes/:id/recevoir {lignes_recues}
            → UPDATE produits.stock_actuel += qté
            → Recalcul CUMP : (ancien_stock × ancien_cump + qté × prix) / total_qté
            → INSERT mouvements_stock type "entree"
```

---

## 7. Contraintes techniques Cloudflare Pages

| Contrainte | Impact | Solution retenue |
|---|---|---|
| Pas de filesystem runtime | Pas de lecture/écriture fichiers | Cloudflare R2 pour les fichiers |
| Pas de WebSocket persistent | Pas de notifications push natives | Polling 30s (Personnel) + Durable Objects si besoin (Sprint 4) |
| CPU limit 10ms/req (free) | Pas de calculs lourds | Calculs CUMP/NF525 optimisés, SHA-256 via Web Crypto API |
| Taille Worker max 10MB | Bundle léger obligatoire | Hono léger, CDN pour frontend libs |
| Pas de `fs`, `path`, `child_process` | Pas de Node.js APIs | Web APIs uniquement (fetch, crypto, TextEncoder) |
| QZ Tray impression thermique | Bridge Java local WS `localhost:8181` | JS client-side uniquement, `window.print()` + CSS @media print en alternative |
| Signature eIDAS certifiée | Tiers de confiance nécessaire | Canvas signature OK en interne, intégration Yousign/Docusign Sprint 4 |

---

*Document généré le 1er juin 2026 — maintenu en synchronisation avec `docs/TODO.md` et `docs/CDC_izigsm.pdf`*
