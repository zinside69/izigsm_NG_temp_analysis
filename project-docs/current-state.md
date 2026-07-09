# iziGSM — État courant (MàJ : 2026-07-09, checkpoint pause)

## Ce qui fonctionne
- App déployée et fonctionnelle sur Cloudflare Pages direct (`izigsm.pages.dev`), plus dépendante de Genspark pour ce déploiement
- Repo git propre côté code, HEAD `6f26a51`
- D1 `izigsm-production` peuplée (48 tables réelles, cohérentes avec le code), R2 actif avec bucket `izigsm-photos`, secrets `JWT_SECRET` + `RESEND_API_KEY` configurés

## Migration Cloudflare — état des 9 tâches du plan (`docs/superpowers/plans/2026-07-09-migration-cloudflare.md`)

| # | Tâche | Statut |
|---|---|---|
| 1 | npm install + vérif tooling | ✅ (702/705 tests, 3 échecs TZ non-bloquants) |
| 2 | R2 activé compte Cloudflare | ✅ |
| 3 | Migrations D1 | ✅ (déjà appliquées avant même le début de cette session — 48 tables confirmées par SQL direct) |
| 4 | Bucket R2 + binding `PHOTOS` | ✅ (commits `e1b1c58` + fix `6f26a51`, review subagent Approved) |
| 5 | Secret `RESEND_API_KEY` | ✅ (sous-domaine `mail.repairdesk.fr` déjà vérifié dans Resend, DNS déjà en place) |
| 6 | Build + déploiement HEAD | ✅ (déploiement `885cc1e3`, commit `6f26a51`, succès confirmé API) |
| 7 | **Validation fonctionnelle** | 🔶 **EN COURS — PAUSE ICI** (voir détail ci-dessous) |
| 8 | Attacher `repairdesk.fr` (confirmation explicite requise) | ⏸ pas commencé |
| 9 | Vérifier DNS mail intact + clôture docs | ⏸ pas commencé |

## Task 7 — détail précis de la reprise

Validé jusqu'ici :
- ✅ `https://izigsm.pages.dev/api/health` → `{"status":"ok","version":"2.45.0","sprint":"2.45 — D09..."}`
- ✅ `/register` et `/login` se chargent (pas de sidebar cassée)
- ❌ **Bug découvert, non lié à la migration** : le formulaire `/register` ne peut pas créer de compte (mauvais chemin API `/api/register` au lieu de `/api/auth/register`, voir `bugs.md` § "/register cassé"). L'étape "OTP SMS" du wizard est un mock frontend, pas un vrai envoi.
- **Contournement en place** : connexion avec le compte seedé `admin@izigsm.fr` / `Admin@2026!` (credentials publiques de `seed.sql`, pas un secret)

**Reste à faire pour clore Task 7** (reprendre ici) :
1. Se connecter avec `admin@izigsm.fr` / `Admin@2026!` sur `https://izigsm.pages.dev/login`
2. Vérifier l'arrivée sur `/dashboard`
3. Créer un client + un ticket
4. Uploader une photo sur ce ticket (valide le binding R2 `PHOTOS`)
5. Relancer l'écoute des logs d'erreur pendant ce test : `npx wrangler pages deployment tail 885cc1e3-a173-4578-b4a1-bda708436e62 --project-name izigsm --format json --status error` (le monitor précédent a été arrêté à la pause — le déploiement `885cc1e3` reste valide tant que Task 6 n'est pas re-exécutée)
6. Si tout passe → Task 8 (confirmation explicite utilisateur requise avant d'attacher `repairdesk.fr`)

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
