# Recovery Prompt — iziGSM — 2026-07-09

## Vue d'ensemble
SaaS Hono/TypeScript + Cloudflare (Workers/Pages + D1 + R2) de gestion boutique réparation GSM. Repo réel : `izigsm/webapp/` (remote GitHub `zinside69/izigsm_NG_temp_analysis`).

## Architecture actuelle
Voir `architecture.md` — MVC strict (P1→P4), 18 routes/18 services/~240 endpoints, 31 migrations D1, conformité NF525 + RGPD partielle.

## Fichiers importants
- `docs/ARCHITECTURE_MODULES.md` → architecture + endpoints (source de vérité, mis à jour à chaque sprint produit)
- `docs/TODO.md` → suivi sprints produit
- `wrangler.jsonc` → config déploiement (Pages, D1 `1e5c6e26-...`, R2 commenté)
- `project-docs/decisions.md` → décisions de la migration Cloudflare en cours

## Décisions prises (session 2026-07-09, migration Cloudflare)
1. Pas de migration de données — nouvelle D1 vide
2. Pages maintenant, Workers plus tard
3. Même compte Cloudflare (`Contact@soteli.fr`) pour DNS `repairdesk.fr` et D1
4. R2 activé maintenant (bucket `izigsm-photos`)
5. Secrets régénérés à neuf (`JWT_SECRET` généré par l'outillage, `RESEND_API_KEY` à récupérer par l'utilisateur)
6. Bascule DNS en 2 temps : `*.pages.dev` d'abord, `repairdesk.fr` custom domain ensuite (ne jamais toucher MX/SPF/webmail Gandi)

Détail complet : `decisions.md`.

## État courant
**Brainstorming en cours, design pas encore présenté.** Cloudflare MCP authentifié avec succès (2026-07-09). Dossier repo renommé `izigsm_backup_2026-07-08.tar/webapp/` → `izigsm/webapp/`. Prochaine étape : inspecter l'état réel côté Cloudflare (projet Pages `izigsm` existe-t-il déjà, migrations D1 appliquées, secrets déjà présents) avant de présenter le design final.

## Tâches en attente
- [x] Compléter l'auth Cloudflare
- [ ] Inspecter état Cloudflare réel (Pages/D1/R2/secrets)
- [ ] Présenter le design de migration (sections : architecture cible, étapes, rollback)
- [ ] Rédiger la spec, la committer, la faire approuver
- [ ] `writing-plans` → plan d'implémentation détaillé
- [ ] Exécution (npm install, R2, secrets, migrations D1, déploiement pages.dev, tests, attachement custom domain)

## Bugs connus
Voir `bugs.md` — prod Genspark en retard de version (sans objet après migration), `/robots.txt` 500, `phoneCatalogService.ts` non testé, RGPD Art.5.1.e non implémenté.

## Contraintes
- Ne jamais toucher aux records MX/SPF/webmail de `repairdesk.fr` lors de l'attachement du custom domain
- `RESEND_API_KEY` doit être récupérée par l'utilisateur (compte Resend externe)
- Toujours proposer avant modification/suppression de fichier existant (règle globale)
- Historiques de version : toujours ajouter en dessous, jamais écraser (règle globale)

## Prochaines étapes recommandées
1. Attendre/relancer la complétion OAuth Cloudflare
2. Appeler les tools Cloudflare pour lister projets Pages / D1 / R2 existants sur le compte
3. Reprendre le brainstorming : proposer 2-3 approches pour l'ordre d'exécution technique, présenter le design, écrire la spec
