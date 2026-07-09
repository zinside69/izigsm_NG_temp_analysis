# iziGSM — Architecture

## Objectif
SaaS multi-tenant de gestion de boutique de réparation téléphone/GSM : tickets SAV, stock, facturation NF525, caisse POS, CRM, agenda/RDV, rachats (livre de police), reconditionnement.

## Stack
- Backend : Hono (TypeScript) sur Cloudflare Workers
- Frontend : HTML/JS statique servi par CDN Cloudflare — 0 framework JS, 0 axios, 0 ApiService (voir P2 ci-dessous)
- DB : Cloudflare D1 (SQLite edge), 31 migrations
- KV : D1KV maison (`src/lib/d1kv.ts`) — remplace le KV natif Cloudflare (bloqué sur l'ancien déploiement Genspark)
- Stockage fichiers : R2 (photos tickets avant/après — en cours d'activation, voir decisions.md)
- Hébergement build : Vite + `@hono/vite-build`, déploiement `wrangler pages deploy` (Cloudflare **Pages**, pas Workers — voir decisions.md)

## Architecture applicative — MVC strict (principes P1→P4)

**P1 — MVC strict**
- `src/routes/*.ts` = Controllers PURS, 0 `.prepare()`, 0 SQL inline
- `src/services/*.ts` = Models, tout le SQL y réside
- `src/lib/db.ts` = helpers partagés (`nextNumero()`, `auditLog()`, `parsePagination()`, `calculLignes()`, `sha256()`)

**P2 — DRY frontend**
- `public/static/js/app.js` = helpers globaux uniques (`apiGet/apiPost/apiPut/apiPatch/apiDelete`, `_money`, `_fmtDate`)

**P3 — Auth pattern**
- `localStorage.izigsm_session` → `{ boutique_id, role, user_id }`
- `getBoutiqueId(user, queryParam)` → isolation multi-tenant
- Jamais de JWT exposé côté frontend

**P4 — Documentation JSDoc**
- Chaque service/route documenté (`@param`, `@returns`, rôles requis)

## Modules (18 routes / 18 services / ~240 endpoints)
Détail complet endpoint-par-endpoint : `docs/ARCHITECTURE_MODULES.md` (source de vérité, mise à jour à chaque sprint).

Modules principaux : Auth, Boutiques, Clients (CRM+RGPD), Tickets (kanban, photos R2, archivage RGPD), Stock (CUMP, familles), Facturation (devis/factures/avoirs NF525), Fournisseurs (BC+CUMP), Agenda (RDV+iCal RFC5545), Personnel (pointage), SAV/Garanties, Caisse POS (NF525), Stats, Notifications (email Resend), Rachats (livre de police art. 321-7), Reconditionnement, Services (catalogue hiérarchique + sync phone-specs-api).

## Conformité réglementaire
- **NF525** : chaînage SHA-256 sur factures/avoirs/journal caisse
- **RGPD** : export Art.15 + purge Art.17 implémentés ; limitation de conservation Art.5.1.e **non implémentée** (voir bugs.md)
- **Art. 321-7 C.pén.** : registre rachats (livre de police), IMEI conservé 5 ans min — tension avec purge RGPD (voir bugs.md)

## Historique hébergement (important pour comprendre l'état du repo)
1. **Genspark sandbox** (`8096d010-efde-413e-a481-72226566aa0b.vip.gensparksite.com`) — dev/staging, déployé via `gsk hosted deploy` (outil propriétaire Genspark, approbation manuelle UI). D1 `85f74dc6-...`.
2. **Migration en cours → Cloudflare direct** (compte `Contact@soteli.fr`), domaine cible `repairdesk.fr`. Nouvelle D1 `1e5c6e26-6b55-4b00-bf83-72ba26b6b112` créée 2026-07-08, vide (pas de migration de données — Genspark n'a jamais servi qu'au dev/staging). Voir `decisions.md` pour le détail du plan.
