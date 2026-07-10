# iziGSM — État courant (MàJ : 2026-07-10, migration Cloudflare TERMINÉE)

## Ce qui fonctionne
- **`https://repairdesk.fr` sert l'app iziGSM en production sur Cloudflare Pages** (`/api/health` → 200, v2.45.0), plus aucune dépendance à Genspark
- `izigsm.pages.dev` reste actif (sous-domaine par défaut du projet Pages)
- Repo git propre côté code, HEAD `6f26a51`
- D1 `izigsm-production` peuplée (48 tables réelles, cohérentes avec le code), R2 actif avec bucket `izigsm-photos`, secrets `JWT_SECRET` + `RESEND_API_KEY` configurés
- DNS mail Gandi (MX, SPF, DKIM, webmail, www) intacts — vérifiés après bascule du domaine

## Migration Cloudflare — état des 9 tâches du plan (`docs/superpowers/plans/2026-07-09-migration-cloudflare.md`)

| # | Tâche | Statut |
|---|---|---|
| 1 | npm install + vérif tooling | ✅ (702/705 tests, 3 échecs TZ non-bloquants) |
| 2 | R2 activé compte Cloudflare | ✅ |
| 3 | Migrations D1 | ✅ (déjà appliquées avant même le début de cette session — 48 tables confirmées par SQL direct) |
| 4 | Bucket R2 + binding `PHOTOS` | ✅ (commits `e1b1c58` + fix `6f26a51`, review subagent Approved) |
| 5 | Secret `RESEND_API_KEY` | ✅ (sous-domaine `mail.repairdesk.fr` déjà vérifié dans Resend, DNS déjà en place) |
| 6 | Build + déploiement HEAD | ✅ (déploiement `885cc1e3`, commit `6f26a51`, succès confirmé API) |
| 7 | **Validation fonctionnelle** | ✅ **TERMINÉE (2026-07-10)** — via API, navigateur Chrome indisponible (voir détail ci-dessous) |
| 8 | Attacher `repairdesk.fr` (confirmation explicite requise) | ✅ **TERMINÉE (2026-07-10)** — voir détail ci-dessous |
| 9 | Vérifier DNS mail intact + clôture docs | ✅ **TERMINÉE (2026-07-10)** |

## Task 8 — attachement du domaine (2026-07-10)

- Confirmation explicite utilisateur obtenue avant exécution
- `POST /accounts/{id}/pages/projects/izigsm/domains` → domaine `repairdesk.fr` attaché (`domain_id: 83642e8d-ca8c-42b6-ba33-f3880d5d1cfe`)
- Blocage rencontré : l'ancien A record racine (`repairdesk.fr → 217.70.184.38`, IP Gandi) empêchait le provisionnement auto du CNAME Cloudflare (`verification_data.error_message: "CNAME record not set"`)
- Confirmation explicite utilisateur obtenue avant suppression de cet A record (id `b950995fa59517f1faffb7ca5339714a`)
- L'auto-provisioning Cloudflare n'a pas créé le CNAME de remplacement après suppression → créé manuellement : `CNAME repairdesk.fr → izigsm.pages.dev` (proxied, id `42b8c4081fad3d760a2f5e721c7b0e6f`)
- Statut domaine passé à `active` (~2 min après création du CNAME) : `verification_data.status: active`, `validation_data.status: active` (certificat SSL Google CA)
- Vérifié : `https://repairdesk.fr/api/health` → 200, `v2.45.0` en production

## Task 9 — vérification DNS mail (2026-07-10)

Relecture complète de la zone `repairdesk.fr` après bascule — tous les enregistrements mail confirmés inchangés :
- MX → `spool.mail.gandi.net`, `fb.mail.gandi.net` ✅ (+ `send.mail.repairdesk.fr` → Amazon SES, préexistant)
- TXT SPF → `v=spf1 include:_mailcust.gandi.net ?all` ✅
- DKIM → `gm1._domainkey`, `gm2._domainkey` → `gandimail.net` ✅, `resend._domainkey.mail.repairdesk.fr` ✅
- CNAME `webmail.repairdesk.fr` → `webmail.gandi.net` ✅
- CNAME `www.repairdesk.fr` → `webredir.vip.gandi.net` ✅
- Seul changement : record racine `repairdesk.fr`, A → CNAME (`izigsm.pages.dev`), comme prévu

**Migration Cloudflare terminée.** Déploiement final : commit `6f26a51`, déploiement Pages `885cc1e3`, domaine `repairdesk.fr` actif.

## Task 7 — résultat de la validation (2026-07-10)

Faute de navigateur Chrome connecté (extension non détectée), validation faite en pilotant directement l'API REST (mêmes endpoints que le frontend) :
- ✅ `https://izigsm.pages.dev/api/health` → `{"status":"ok","version":"2.45.0","sprint":"2.45 — D09..."}`
- ✅ `/register` et `/login` se chargent (pas de sidebar cassée)
- ❌ **Bug confirmé, non lié à la migration** : `/register` ne peut pas créer de compte (mauvais chemin API, voir `bugs.md` § "/register cassé")
- ✅ `POST /api/auth/login` avec `admin@izigsm.fr` / `Admin@2026!` → 200, JWT valide, `GET /api/auth/me` confirme la session (role admin)
- ✅ `POST /api/clients` → client `id: 6` créé (boutique `iziGSM Paris 11`, `id: 1`, seed data)
- ✅ `POST /api/tickets` → ticket `TKT-2026-00006` créé
- ✅ `POST /api/tickets/6/photos` → 201, upload R2 réussi (`r2_key: tickets/6/photos/a04dbb1e-....jpg`)
- ✅ `GET /api/tickets/6/photos/1/view` → 200, contenu relu identique à l'upload — **binding R2 `PHOTOS` validé bout-en-bout**
- ✅ `wrangler pages deployment tail 885cc1e3-... --status error` actif pendant les 6 appels → aucune erreur

**Task 7 close.** Prochaine étape : Task 8 — attacher `repairdesk.fr` en custom domain (confirmation explicite utilisateur requise avant exécution, action DNS de prod).

## Bugs découverts pendant l'exécution (voir `bugs.md` pour le détail complet)
- `/register` cassé (bloquant onboarding réel, hors scope migration)
- `docs/ARCHITECTURE_MODULES.md` §2 obsolète (noms de tables)
- 3 tests unitaires sensibles au fuseau horaire (UTC+2 machine locale)
- Dette pré-existante déjà connue : `phoneCatalogService.ts` non testé, RGPD Art.5.1.e

## Fichiers non commités au moment de la pause
- `project-docs/bugs.md` (mis à jour, à committer avec ce checkpoint)
- `project-docs/current-state.md` (ce fichier)
- `project-docs/todo.md` (à mettre à jour)
- `project-docs/recovery-prompt.md` (à mettre à jour)
- `docs/superpowers/plans/` était déjà untracked avant — à committer aussi si pas encore fait
- `.superpowers/sdd/` — scratch du skill subagent-driven-development, **gitignored, ne pas committer** (vérifier avant commit)
