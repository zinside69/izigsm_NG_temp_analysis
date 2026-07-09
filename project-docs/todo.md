# iziGSM — TODO (project-docs, distinct de docs/TODO.md qui suit les sprints produit)

## En cours — Migration Cloudflare (2026-07-09)
- [x] Brainstorming : 6 décisions validées (voir decisions.md)
- [x] Authentification Cloudflare MCP (OAuth)
- [x] Vérifier état réel côté Cloudflare — **setup déjà partiellement fait le 08/07** : projet Pages `izigsm` existe, D1 liée, `JWT_SECRET` présent, mais D1 vide (0 tables), `RESEND_API_KEY` absent, R2 désactivé compte, dernier déploiement au commit `eddd3af` (pas `f578781`), pas de custom domain — détail `current-state.md`
- [ ] Présenter le design complet (brainstorming) avec l'état réel connu
- [ ] Rédiger et faire approuver la spec (`docs/superpowers/specs/2026-07-09-migration-cloudflare-design.md`)
- [ ] Passer à `writing-plans` pour le plan d'implémentation détaillé
- [ ] `npm install` (node_modules absent localement)
- [ ] **Action utilisateur** : activer R2 dans le dashboard Cloudflare (impossible via API — erreur 10042)
- [ ] Créer bucket R2 `izigsm-photos`, décommenter binding dans `wrangler.jsonc`
- [ ] **Action utilisateur** : récupérer `RESEND_API_KEY` (dashboard Resend)
- [ ] Appliquer les 31 migrations sur D1 `1e5c6e26-...` (0 tables actuellement — bloquant, l'app plante sans ça)
- [ ] Redéployer le code à jour (`wrangler pages deploy`) — dernier déploiement date du commit `eddd3af`, pas du HEAD actuel
- [ ] Valider intégralement sur `izigsm.pages.dev`
- [ ] Attacher `repairdesk.fr` en custom domain (uniquement record A/CNAME racine — ne pas toucher MX/SPF/webmail)

## Dette technique héritée (voir bugs.md)
- [ ] `tests/phoneCatalogService.test.ts` à créer
- [ ] Investiguer `/robots.txt` 500 (peut se résoudre de lui-même après migration)
