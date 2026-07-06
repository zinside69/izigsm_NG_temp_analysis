# iziGSM — Logiciel de gestion d'atelier téléphonie

> **Version** : v2.38.0 stable · v2.39.0 en cours (Sprint 2.39 WIP)  
> **Tests** : 633/633 · **Build** : 72 modules / 287.42 kB  
> **Stack** : Hono + TypeScript + Cloudflare Workers/Pages + D1 SQLite + R2  
> **Sprint courant** : 2.39 — Sync référentiel global phone-specs-api (backend ✅, UI ⚠️ partielle)

---

## Présentation

iziGSM est un logiciel de gestion d'atelier dédié aux réparateurs de smartphones et appareils électroniques. Il couvre l'intégralité du cycle de vie d'un atelier : tickets de réparation, caisse NF525, facturation, devis, CRM, stock, kanban, agenda, fournisseurs, SAV, reconditionnement, et un référentiel global de marques/modèles synchronisé depuis GSMArena via phone-specs-api.

Conçu pour fonctionner **100% sur Cloudflare Workers + D1** : pas de serveur, pas de Node.js, déploiement mondial en quelques secondes.

---

## URLs

| Environnement | URL |
|---|---|
| **Production** | `https://8096d010-efde-413e-a481-72226566aa0b.vip.gensparksite.com` |
| **Health check** | `/api/health` |
| **Sandbox dev** | `https://3000-il2cuybdycdo29jt8b6zi-5c13a017.sandbox.novita.ai` |

---

## Fonctionnalités implémentées (v2.39 en cours)

### Core métier
| Module | Statut | Description |
|---|---|---|
| **MOD-01 Tickets / Kanban** | ✅ ~95% | Machine à états 10 statuts, drag & drop, ancienneté couleur, photos R2, archivage RGPD auto |
| **MOD-02 Facturation NF525** | ✅ ~95% | Hash SHA-256 chaîné, avoirs, paiements partiels, tracking UUID, rapport comptable |
| **MOD-03 Devis** | ✅ ~88% | Page publique client, signature, conversion → facture, expiration auto |
| **MOD-04 Stock + CUMP** | ✅ 100% | Familles (pièce/accessoire/appareil/consommable), import CSV, UPSERT SKU, CUMP |
| **MOD-05 Reconditionnement** | ✅ ~90% | Ordres reconditionnement, bons d'achat, création produit occasion |
| **MOD-06 Rachats** | ✅ ~92% | Livre de police art. 321-7, export CSV, IMEI dédup |
| **MOD-07 CRM Clients** | ✅ ~90% | Historique 360°, import CSV, appareils, export RGPD Art.15, purge Art.17 |
| **MOD-08 Agenda / iCal** | ✅ ~88% | RFC 5545, créneaux publics, prise de RDV en ligne |
| **MOD-09 SAV + Garanties** | ✅ ~85% | Machine à états SAV, garanties auto, KPIs |
| **MOD-10 Fournisseurs + BC** | ✅ ~90% | Bons de commande, réception + CUMP, À commander |
| **MOD-12 Notifications email** | ✅ ~80% | Resend API, triggers statut ticket (termine + livré), relances |
| **MOD-13 Caisse POS NF525** | ✅ ~85% | Multi-modes paiement, ouverture/fermeture session, journal NF525 |
| **MOD-14 Vitrine publique** | ✅ ~75% | Tracking token QR, prise de RDV public, catalogue services |
| **MOD-15 Catalogue services** | ✅ ~98% | Hiérarchique catégories/services, référentiel global marques/modèles, sync phone-specs-api (🔜 UI) |
| **MOD-17 Rapports / Exports** | ✅ ~90% | CSV tickets/CA/techniciens, rapport comptable TVA, filtres date |
| **MOD-18 Auth avancée** | ✅ ~90% | Reset password (KV TTL 1h), OAuth Google One Tap, PIN PBKDF2 |

### Infrastructure
- **Auth JWT** : PBKDF2-SHA256, refresh tokens, sessions D1, PIN par action sensible
- **P1 MVC strict** : 0 SQL dans aucun controller — 18 services, ~240 endpoints
- **D1AsKV** : table `kv_store` émulant l'interface `KVNamespace` (pas de KV binding)
- **R2 Storage** : bucket `izigsm-photos` — upload/proxy photos tickets
- **PWA** : manifest.json, service worker cache-first, install prompt
- **31 migrations D1** (0031 non encore appliquée en local)

---

## Architecture

```
src/
├── index.tsx              # Entry point Hono — health, routing, D1AsKV init — v2.38.0
├── lib/
│   ├── db.ts              # nextNumero(), helpers D1, auditLog()
│   └── d1kv.ts            # D1AsKV — émulation KVNamespace via D1
├── middleware.ts           # requireAuth, requireRole, requirePin, hasPermission
├── routes/                # 18 fichiers — controllers purs (0 SQL)
│   ├── auth.ts            # Login, register, OTP, refresh, reset-password, OAuth Google
│   ├── tickets.ts         # CRUD tickets + statuts + kanban + photos R2 + archivage RGPD
│   ├── clients.ts         # CRUD clients + export RGPD Art.15 + purge Art.17
│   ├── stocks.ts          # CRUD produits + familles + import CSV + mouvements
│   ├── services.ts        # Catalogue + marques/modèles + sync phone-specs-api (Sprint 2.39)
│   ├── facturation.ts     # Factures + avoirs + paiements
│   ├── devis.ts           # Devis + conversion + public token
│   └── ...                # agenda, caisse, fournisseurs, sav, stats, notifications...
└── services/              # 18 fichiers — Model layer (toute la logique SQL)
    ├── authService.ts     # Auth + sessions + reset password + OAuth Google
    ├── ticketService.ts   # Tickets + archivage RGPD + archived_at IS NULL filter
    ├── clientService.ts   # CRM + exportClientRgpd() + purgeClient()
    ├── stockService.ts    # Produits + familles + import CSV + CUMP
    ├── servicesService.ts # Catalogue + marques/modèles sans boutique_id (Sprint 2.39)
    ├── phoneCatalogService.ts  # Sync phone-specs-api — 5 fonctions (Sprint 2.39)
    ├── factureService.ts  # Facturation NF525
    ├── emailService.ts    # Resend API + templates HTML
    └── ...
```

---

## Modèles de données principaux

| Table | Description |
|---|---|
| `boutiques` | Multi-tenant — 1 boutique = 1 instance |
| `users` + `roles` | Employés, rôles (admin/gérant/technicien/caissier), `google_id` OAuth |
| `tickets` | Réparations — 10 statuts, priorité, pièces commandées, `archived_at` RGPD |
| `ticket_photos` | Photos avant/après/autre — clé R2 + metadata |
| `factures` + `lignes_facture` | NF525 — hash SHA-256 chaîné, avoirs |
| `devis` + `lignes_devis` | Devis avec page publique et signature client |
| `produits` + `categories_produits` | Stock — familles, CUMP, mouvements |
| `fournisseurs` + `bons_commande` | Achats + réception CUMP |
| `clients` + `appareils_client` | CRM — historique 360° |
| `rendez_vous` + `boutique_creneaux` | Agenda — iCal RFC 5545 + RDV public |
| `garanties` + `tickets_sav` | SAV post-réparation |
| `rachats` | Livre de police art. 321-7 CP |
| `caisse_sessions` + `caisse_mouvements` | POS NF525 |
| `marques_appareils` | Référentiel global marques (sans boutique_id) — `brand_slug UNIQUE`, `source` |
| `modeles_appareils` | Référentiel global modèles — `phone_slug UNIQUE`, `source`, `synced_at` |
| `service_modeles` | Liaison M2M services ↔ modèles (prix override) |
| `phone_catalog_sync_log` | Log sync phone-specs-api par marque (Sprint 2.39) |
| `kv_store` | D1AsKV — sessions, tokens, reset-password |
| `email_logs` | Journal emails transactionnels |
| `audit_log` | Traçabilité actions sensibles |

---

## Endpoints clés — Sprint 2.39 (nouveaux)

| Méthode | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/api/services/catalog/stats` | JWT | Statistiques référentiel (nb marques/modèles, dernière sync) |
| `GET` | `/api/services/catalog/sync-status` | Admin | État détaillé sync par marque |
| `POST` | `/api/services/catalog/sync-brands` | Admin | Synchronise liste marques depuis phone-specs-api |
| `POST` | `/api/services/catalog/sync-modeles/:slug` | Admin | Synchronise modèles d'une marque (slug) |
| `POST` | `/api/services/catalog/sync-selected` | Admin | Sync sélection de marques `{ slugs: string[] }` |
| `GET` | `/api/tickets/:id/photos` | JWT | Liste photos d'un ticket |
| `POST` | `/api/tickets/:id/photos` | JWT | Upload photo (multipart/form-data) |
| `GET` | `/api/tickets/:id/photos/:photoId/view` | JWT | Proxy R2 — affichage photo |
| `DELETE` | `/api/tickets/:id/photos/:photoId` | Admin/Manager/Tech | Suppression photo |
| `POST` | `/api/tickets/:id/archiver` | JWT | Archivage manuel ticket terminal |
| `GET` | `/api/tickets?archived=true` | JWT | Liste tickets archivés |
| `GET` | `/api/clients/:id/export-rgpd` | Admin | Export JSON données client (Art.15) |
| `DELETE` | `/api/clients/:id/purge` | Admin | Anonymisation RGPD (Art.17) |

---

## Guide de démarrage rapide

### Développement local (sandbox)
```bash
cd /home/user/webapp
npm run build
pm2 start ecosystem.config.cjs
# → http://localhost:3000
```

### Comptes de test (seed.sql)
| Email | Mot de passe | Rôle |
|---|---|---|
| `admin@izigsm.fr` | `Admin123!` | Admin |
| `technicien@izigsm.fr` | `Tech123!` | Technicien |

### Migrations D1 (local)
```bash
npx wrangler d1 migrations apply izigsm-production --local
npx wrangler d1 execute izigsm-production --local --file=./seed.sql
```

### Migration 0031 (Sprint 2.39 — non encore appliquée)
```bash
# ⚠️ Refonte schéma marques/modèles sans boutique_id
npx wrangler d1 migrations apply izigsm-production --local
# Vérifie que les données Sprint 2.38 sont bien migrées (INSERT OR IGNORE)
```

---

## Déploiement Cloudflare Pages

```bash
# Build + déploiement via gsk hosted
npm run build
gsk hosted deploy

# Appliquer migrations en production
npx wrangler d1 migrations apply izigsm-production
```

### Secrets production configurés
| Secret | Usage |
|---|---|
| `JWT_SECRET` | ✅ Auth JWT HMAC-SHA256 |
| `RESEND_API_KEY` | ✅ Emails transactionnels |
| `GOOGLE_CLIENT_ID` | ⚠️ À configurer — OAuth Google One Tap |
| `FRONTEND_URL` | ⚠️ À confirmer — liens emails reset-password |

---

## Tests

```bash
npm test          # 633/633 — 16 suites Vitest
npm run build     # TypeScript strict — 0 erreur
```

**Couverture** : authService, boutiqueService, caisseService, ticketService, emailService, garantiesService, agendaService, fournisseursService, stockService, devisService, factureService, clientService, personnelService, reconditionnementService, publicService, **servicesService** (26 tests — ⚠️ à adapter Sprint 2.39)

> **⚠️ Note Sprint 2.39** : `tests/servicesService.test.ts` utilise encore les SQL constants avec `boutique_id` de Sprint 2.38. À mettre à jour avant le commit v2.39.0.

---

## RGPD — État conformité

| Droit | Implémentation | Statut |
|---|---|---|
| Art. 15 — Accès données | `GET /api/clients/:id/export-rgpd` | ✅ Sprint 2.37 |
| Art. 17 — Effacement | `DELETE /api/clients/:id/purge` (pseudonymisation) | ✅ Sprint 2.37 |
| Art. 5.1.e — Limitation conservation | `checkAndArchiveTickets()` batch auto 90j | ✅ Sprint 2.37 |
| Auto-purge clients inactifs | `checkAndPurgeExpiredClients()` | ❌ Post-MVP |
| Auto-purge tickets >10 ans | `checkAndPurgeExpiredTickets()` | ❌ Post-MVP |

---

## Prochains sprints

| Sprint | Module | Description |
|---|---|---|
| **2.39** | MOD-15 | ⚠️ **En cours** — Modal sync UI + tests mis à jour + migration 0031 locale |
| **2.40** | RGPD | Auto-purge clients inactifs >3 ans (Art. 5.1.e) |
| **Post-MVP** | MOD-16 | Multi-boutiques réseau (cockpit consolidé) |

---

## Documentation technique

| Document | Contenu |
|---|---|
| `docs/TODO.md` | Suivi complet des sprints et backlog |
| `docs/GAP_ANALYSIS_ENRICHI.md` | Gap analysis CDC vs implémentation |
| `docs/CDC_Manus.md` | Cahier des charges technique et fonctionnel |
| `docs/DEPLOIEMENT.md` | Mode opératoire déploiement Cloudflare 10 étapes |
| `docs/JOURNAL_MODIFICATIONS.md` | Fichiers modifiés par sprint |
| `docs/ARCHITECTURE_MODULES.md` | Architecture détaillée P1 MVC |
| `docs/PRINCIPES.md` | Principes de conception — P1 MVC, conventions |
| `docs/CDC_izigsm.pdf` | Cahier des charges original |

---

*Dernière mise à jour : 6 juillet 2026 — v2.38.0 stable — Sprint 2.39 en cours (backend complet, UI partielle)*
