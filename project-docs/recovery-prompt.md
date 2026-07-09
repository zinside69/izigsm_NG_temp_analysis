# Recovery Prompt — iziGSM — 2026-07-09 (checkpoint pause)

## Vue d'ensemble
SaaS Hono/TypeScript + Cloudflare (Pages + D1 + R2) de gestion boutique réparation GSM. Repo : `izigsm/webapp/` (remote GitHub `zinside69/izigsm_NG_temp_analysis`).

## Ce qu'on fait
Migration de l'hébergement Genspark (dev/staging, `gsk hosted deploy`) vers Cloudflare direct (compte `Contact@soteli.fr`), domaine cible `repairdesk.fr`. Design et plan approuvés, exécution en mode subagent-driven hybride (voir `decisions.md` pour le détail complet du cadrage).

- Spec : `docs/superpowers/specs/2026-07-09-migration-cloudflare-design.md`
- Plan (9 tâches) : `docs/superpowers/plans/2026-07-09-migration-cloudflare.md`
- Suivi tâche par tâche : `todo.md`

## Où on s'est arrêté — TASK 7, EN COURS

Tasks 1 à 6 sont terminées et vérifiées (D1 migrée, R2 actif avec bucket `izigsm-photos`, secrets `JWT_SECRET`+`RESEND_API_KEY` posés, code HEAD déployé sur `izigsm.pages.dev` — déploiement `885cc1e3`, commit `6f26a51`).

**Task 7 (validation fonctionnelle) est à moitié faite** :
- ✅ `/api/health` répond v2.45.0
- ✅ `/register` et `/login` s'affichent correctement
- ❌ Bug découvert : `/register` ne peut pas créer de compte (mauvais chemin API — voir `bugs.md` § "/register cassé"). Contournement : se connecter avec le compte seedé `admin@izigsm.fr` / `Admin@2026!`.
- ⏳ **Reste à faire pour clore Task 7** : se connecter avec le compte seedé, vérifier le dashboard, créer un client + ticket, uploader une photo sur le ticket (valide le binding R2), en surveillant les logs d'erreur (`npx wrangler pages deployment tail 885cc1e3-a173-4578-b4a1-bda708436e62 --project-name izigsm --format json --status error`)

**Ensuite** : Task 8 (attacher `repairdesk.fr` — nécessite une confirmation explicite de l'utilisateur juste avant, c'est une action DNS de production) puis Task 9 (vérifier MX/SPF/webmail intacts, clôturer les docs).

## Décisions de cadrage (résumé — détail complet dans `decisions.md`)
1. Pas de migration de données — D1 neuve (schéma seul)
2. Pages maintenant, Workers plus tard (chantier séparé futur)
3. Même compte Cloudflare pour DNS `repairdesk.fr` et D1/Pages
4. R2 activé dans le cadre de cette migration
5. Secrets régénérés à neuf
6. Bascule DNS en 2 temps : validation `*.pages.dev` d'abord, `repairdesk.fr` ensuite

## Décisions prises pendant l'exécution (à ajouter à decisions.md si pas déjà fait)
- R2 : bucket nommé `izigsm-photos` (pas de nom générique type "medias"/"backups" — un seul usage aujourd'hui, photos tickets)
- Resend : domaine d'envoi configuré sur le **sous-domaine** `mail.repairdesk.fr` (pas la racine `repairdesk.fr`) pour ne jamais toucher aux MX/SPF/webmail Gandi existants. DNS (MX + TXT SPF + TXT DKIM) déjà présents dans la zone au moment de la vérification — probablement posés lors du travail du 08/07.
- Mode d'exécution : hybride — infra pilotée directement par l'agent en session (pas de worktree, pas de subagent pour les opérations Cloudflare/DNS/secrets qui touchent le compte de prod réel), subagent-driven uniquement pour Task 4 (le seul vrai diff de code, review Approved après un cycle de fix mineur)

## Fichiers importants
- `wrangler.jsonc` → config Pages, D1 `izigsm-production` (uuid `1e5c6e26-6b55-4b00-bf83-72ba26b6b112`), R2 `izigsm-photos` actif
- `docs/ARCHITECTURE_MODULES.md` → architecture (⚠️ §2 tableau migrations obsolète, voir bugs.md)
- `seed.sql` → compte de test `admin@izigsm.fr` / `Admin@2026!`

## Bugs connus (détail complet dans `bugs.md`)
- **`/register` cassé** (bloquant, découvert pendant Task 7, hors scope migration mais à traiter vite pour un vrai lancement)
- Prod Genspark en retard de version (sans objet une fois la migration terminée)
- `/robots.txt` 500 sur Genspark
- `phoneCatalogService.ts` non testé
- RGPD Art.5.1.e non implémenté
- `docs/ARCHITECTURE_MODULES.md` §2 obsolète
- 3 tests unitaires sensibles au fuseau horaire (non-bloquant)

## Contraintes
- Ne jamais toucher aux records MX/SPF/webmail de `repairdesk.fr`
- Ne jamais faire transiter de secret en clair dans la conversation
- Confirmation explicite de l'utilisateur requise avant Task 8 (bascule DNS de production)
- Toujours proposer avant modification/suppression de fichier existant (règle globale)
- Historiques de version : toujours ajouter en dessous, jamais écraser (règle globale)

## Prochaine étape immédiate à la reprise
Reprendre Task 7 : demander à l'utilisateur de se connecter avec `admin@izigsm.fr` / `Admin@2026!` sur `https://izigsm.pages.dev/login`, puis créer client + ticket + upload photo, avec l'écoute de logs d'erreur active en parallèle.
