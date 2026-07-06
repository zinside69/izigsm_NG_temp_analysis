# iziGSM — Logiciel de gestion d'atelier téléphonie

> **Version** : v2.35.0 · **Tests** : 607/607 · **Build** : 71 modules / 268.31 kB  
> **Stack** : Hono + TypeScript + Cloudflare Workers/Pages + D1 SQLite  
> **Sprint courant** : 2.35 clôturé — Sprint 2.36 à démarrer

---

## Présentation

iziGSM est un logiciel de gestion d'atelier dédié aux réparateurs de smartphones et appareils électroniques. Il couvre l'intégralité du cycle de vie d'un atelier : tickets de réparation, caisse NF525, facturation, devis, CRM, stock, kanban, agenda, fournisseurs, SAV et reconditionnement.

Conçu pour fonctionner **100% sur Cloudflare Workers + D1** : pas de serveur, pas de Node.js, déploiement mondial en quelques secondes.

---

## URLs

| Environnement | URL |
|---|---|
| **Production** | `https://8096d010-efde-413e-a481-72226566aa0b.vip.gensparksite.com` |
| **Health check** | `/api/health` |
| **Sandbox dev** | `https://3000-il2cuybdycdo29jt8b6zi-5c13a017.sandbox.novita.ai` |

---

## Fonctionnalités implémentées (v2.35.0)

### Core métier
| Module | Statut | Description |
|---|---|---|
| **MOD-01 Tickets / Kanban** | ✅ ~90% | Machine à états 10 statuts, drag & drop, ancienneté couleur, export PDF |
| **MOD-02 Facturation NF525** | ✅ ~92% | Hash SHA-256 chaîné, avoirs, paiements partiels, tracking UUID |
| **MOD-03 Devis** | ✅ ~88% | Page publique client, signature, conversion → facture, expiration auto |
| **MOD-04 Stock + CUMP** | ✅ 100% | Familles (pièce/accessoire/appareil/consommable), import CSV, UPSERT SKU, CUMP |
| **MOD-05 Reconditionnement** | ✅ ~90% | Ordres reconditionnement, bons d'achat, création produit occasion |
| **MOD-06 Rachats** | ✅ ~92% | Livre de police art. 321-7, export CSV, IMEI dédup |
| **MOD-07 CRM Clients** | ✅ ~85% | Historique 360°, import CSV, appareils, KPIs |
| **MOD-08 Agenda / iCal** | ✅ ~88% | RFC 5545, créneaux publics, prise de RDV en ligne |
| **MOD-09 SAV + Garanties** | ✅ ~85% | Machine à états SAV, garanties auto, KPIs |
| **MOD-10 Fournisseurs + BC** | ✅ ~90% | Bons de commande, réception + CUMP, À commander |
| **MOD-12 Notifications email** | ✅ ~75% | Resend API, triggers statut ticket (termine + livré), relances |
| **MOD-13 Caisse POS NF525** | ✅ ~85% | Multi-modes paiement, ouverture/fermeture session, journal NF525 |
| **MOD-14 Vitrine publique** | ✅ ~75% | Tracking token QR, prise de RDV public, catalogue services |
| **MOD-15 Catalogue services** | ✅ ~80% | Hiérarchique catégories/services, color picker |
| **MOD-17 Rapports / Exports** | ✅ ~90% | CSV tickets/CA/techniciens, rapport comptable TVA, filtres date |
| **MOD-18 Auth avancée** | ✅ ~90% | Reset password (KV TTL 1h), OAuth Google One Tap, PIN PBKDF2 |

### Infrastructure
- **Auth JWT** : PBKDF2-SHA256, refresh tokens, sessions D1, PIN par action sensible
- **P1 MVC strict** : 0 SQL dans aucun controller — 17 services, ~230 endpoints
- **D1AsKV** : table `kv_store` émulant l'interface `KVNamespace` (pas de KV binding)
- **PWA** : manifest.json, service worker cache-first, install prompt
- **27 migrations D1** appliquées en production

---

## Architecture

```
src/
├── index.tsx              # Entry point Hono — health, routing, D1AsKV init
├── lib/
│   ├── db.ts              # nextNumero(), helpers D1
│   └── d1kv.ts            # D1AsKV — émulation KVNamespace via D1
├── middleware.ts           # requireAuth, requireRole, requirePin, hasPermission
├── routes/                # 18 fichiers — controllers purs (0 SQL)
│   ├── auth.ts            # Login, register, OTP, refresh, reset-password, OAuth Google
│   ├── tickets.ts         # CRUD tickets + statuts + kanban + photos (R2 Sprint 2.36)
│   ├── stocks.ts          # CRUD produits + familles + import CSV + mouvements
│   ├── facturation.ts     # Factures + avoirs + paiements
│   ├── devis.ts           # Devis + conversion + public token
│   └── ...                # agenda, caisse, clients, fournisseurs, sav, stats...
└── services/              # 17 fichiers — Model layer (toute la logique SQL)
    ├── authService.ts     # Auth + sessions + reset password + OAuth Google
    ├── stockService.ts    # Produits + familles + import CSV + CUMP
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
| `tickets` | Réparations — 10 statuts, priorité, pièces commandées |
| `factures` + `lignes_facture` | NF525 — hash SHA-256 chaîné, avoirs |
| `devis` + `lignes_devis` | Devis avec page publique et signature client |
| `produits` + `categories_produits` | Stock — familles, CUMP, mouvements |
| `fournisseurs` + `bons_commande` | Achats + réception CUMP |
| `clients` + `appareils_client` | CRM — historique 360° |
| `rendez_vous` + `boutique_creneaux` | Agenda — iCal RFC 5545 + RDV public |
| `garanties` + `tickets_sav` | SAV post-réparation |
| `rachats` | Livre de police art. 321-7 CP |
| `caisse_sessions` + `caisse_mouvements` | POS NF525 |
| `kv_store` | D1AsKV — sessions, tokens, reset-password |
| `email_logs` | Journal emails transactionnels |
| `audit_log` | Traçabilité actions sensibles |

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

### Configurer GOOGLE_CLIENT_ID en production
```bash
gsk hosted secret_put GOOGLE_CLIENT_ID
# → Entrer la valeur depuis Google Cloud Console
```

---

## Tests

```bash
npm test          # 607/607 — 15 suites Vitest
npm run build     # TypeScript strict — 0 erreur
```

**Couverture** : authService, boutiqueService, caisseService, ticketService, emailService, garantiesService, agendaService, fournisseursService, stockService, devisService, factureService, clientService, personnelService, reconditionnementService, publicService

---

## Prochains sprints

| Sprint | Module | Description |
|---|---|---|
| **2.36** | MOD-01 | Photos tickets R2 — upload drag & drop, galerie avant/après |
| **2.37** | RGPD | Export données client JSON + anonymisation + archivage tickets 90j |

---

## Documentation technique

| Document | Contenu |
|---|---|
| `docs/TODO.md` | Suivi complet des sprints et backlog |
| `docs/DEPLOIEMENT.md` | Mode opératoire déploiement Cloudflare 10 étapes |
| `docs/JOURNAL_MODIFICATIONS.md` | Fichiers modifiés par sprint |
| `docs/ARCHITECTURE_MODULES.md` | Architecture détaillée P1 MVC |
| `docs/PRINCIPES.md` | Principes de conception — P1 MVC, conventions |
| `docs/CDC_izigsm.pdf` | Cahier des charges original |

---

*Dernière mise à jour : 6 juillet 2026 — v2.35.0 — Sprint 2.36 à démarrer*
