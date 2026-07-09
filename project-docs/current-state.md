# iziGSM — État courant (MàJ : 2026-07-09)

## Ce qui fonctionne
- App complète et fonctionnelle sur Genspark sandbox (dev/staging), v2.44.0 déployé (v2.45.0 + 5 commits non déployés, voir bugs.md)
- Repo git propre, HEAD == origin/main, 705+ tests (18 suites), couverture CDC ~97%

## En cours
- **Migration Genspark → Cloudflare direct** (brainstorming en cours, skill `superpowers:brainstorming`)
- 6 décisions de cadrage validées avec l'utilisateur (voir `decisions.md`)
- Cloudflare MCP authentifié avec succès (2026-07-09)

## État réel Cloudflare constaté (2026-07-09, via API)
Setup **partiellement déjà fait** le 2026-07-08 (9 déploiements ad-hoc `wrangler pages deploy` en local, hors CI) :
- Projet Pages `izigsm` existe (`izigsm.pages.dev`), lié à D1 `1e5c6e26-6b55-4b00-bf83-72ba26b6b112`
- Secret `JWT_SECRET` déjà configuré en prod
- Secret `RESEND_API_KEY` **absent**
- D1 `izigsm-production` : **0 tables** — migrations jamais appliquées, app cassée sur toute route DB
- R2 **désactivé au niveau du compte Cloudflare** (erreur API 10042 "Please enable R2 through the Cloudflare Dashboard" — action manuelle dashboard requise, impossible via API)
- Dernier déploiement au commit `eddd3af` (2026-07-08 17:50) — commits `f578781` (SEO noindex) et `23f007a` (docs) **non déployés**
- Custom domain `repairdesk.fr` pas encore attaché (seul `izigsm.pages.dev`)
- Zone DNS `repairdesk.fr` confirmée sur le même compte Cloudflare (`88cfb31e7023ac0740536222bda8a8ae`)
- 3 déploiements en échec avant 16h08 le 8 juillet (essais/erreurs initiaux de config `wrangler.jsonc`, sans conséquence — supersédés)

## Pas encore commencé
- Rédaction de la spec de migration (`docs/superpowers/specs/`)
- Plan d'implémentation (`writing-plans`)
- Application des migrations D1, secret RESEND_API_KEY, activation R2, redéploiement code à jour, attachement custom domain

## Documenté récemment (session du 2026-07-09)
- Commit `23f007a` : rattrapage doc rétroactif de 5 commits non documentés (nav URLs propres, catalogue fallback statique, SEO noindex) — pushé sur `origin/main`
- Structure `project-docs/` créée (ce dossier)
