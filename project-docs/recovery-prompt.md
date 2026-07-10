# Recovery Prompt — iziGSM — 2026-07-10 (Migration Cloudflare TERMINÉE)

## Vue d'ensemble
SaaS Hono/TypeScript + Cloudflare (Pages + D1 + R2) de gestion boutique réparation GSM. Repo : `izigsm/webapp/` (remote GitHub `zinside69/izigsm_NG_temp_analysis`).

## Ce qu'on fait
Migration de l'hébergement Genspark (dev/staging, `gsk hosted deploy`) vers Cloudflare direct (compte `Contact@soteli.fr`), domaine cible `repairdesk.fr`. Design et plan approuvés, exécution en mode subagent-driven hybride (voir `decisions.md` pour le détail complet du cadrage).

- Spec : `docs/superpowers/specs/2026-07-09-migration-cloudflare-design.md`
- Plan (9 tâches) : `docs/superpowers/plans/2026-07-09-migration-cloudflare.md`
- Suivi tâche par tâche : `todo.md`

## Migration terminée — les 9 tâches sont closes (2026-07-10)

Tasks 1 à 9 terminées et vérifiées (D1 migrée, R2 actif avec bucket `izigsm-photos`, secrets `JWT_SECRET`+`RESEND_API_KEY` posés, code HEAD déployé — déploiement `885cc1e3`, commit `6f26a51` — Task 7 validée via API, `repairdesk.fr` attaché et actif, DNS mail re-vérifié intact).

**Task 7 (validation fonctionnelle)** — faite via API (navigateur Chrome indisponible, extension non connectée) : login seedé `admin@izigsm.fr`/`Admin@2026!` → JWT valide, client + ticket créés, photo uploadée+relue sur R2, 0 erreur en logs.

**Task 8 (attacher `repairdesk.fr`)** — écart au plan : l'A record préexistant (Gandi, `217.70.184.38`) a empêché l'auto-provisioning Cloudflare du CNAME (`"CNAME record not set"`). Confirmation explicite obtenue avant chaque mutation DNS : suppression de l'A record, puis création manuelle du CNAME (`repairdesk.fr → izigsm.pages.dev`, proxied). Domaine `active` ~2 min après, certificat SSL Google CA provisionné. `https://repairdesk.fr/api/health` répond 200 en prod.

**Task 9 (vérification DNS mail)** — MX, SPF, DKIM (`gm1`/`gm2`/`resend`), `webmail.repairdesk.fr`, `www.repairdesk.fr` tous confirmés inchangés. Seul le record racine a changé (A → CNAME), comme prévu.

**Migration Cloudflare terminée.** `repairdesk.fr` sert l'app iziGSM en production. Plus rien en attente sur ce chantier — la reprise concerne maintenant la dette technique (voir Bugs connus) ou de nouvelles demandes.

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
- Ne jamais toucher aux records MX/SPF/webmail de `repairdesk.fr` (validé intacts au 2026-07-10)
- Ne jamais faire transiter de secret en clair dans la conversation
- Toujours proposer avant modification/suppression de fichier existant (règle globale)
- Historiques de version : toujours ajouter en dessous, jamais écraser (règle globale)

## Prochaine étape immédiate à la reprise
Aucune action en attente sur la migration — chantier clos. Points ouverts pour une future session : fixer le bug `/register` (bloquant onboarding réel, voir `bugs.md`), ou traiter la dette technique listée ci-dessus.
