# iziGSM — Bugs connus

## Prod Genspark en retard de version
`/api/health` sur `https://8096d010-efde-413e-a481-72226566aa0b.vip.gensparksite.com` renvoie encore **v2.44.0** (Sprint 2.41-D) alors que HEAD git est à v2.45.0 + 5 commits non versionnés (nav URLs propres, catalogue fallback statique, SEO noindex). Cause probable : `gsk hosted deploy` déclenché mais jamais approuvé dans l'UI Genspark après Sprint 2.41-E.
**Sans objet après migration Cloudflare** (on quitte Genspark) — mais si un retour arrière est nécessaire avant la bascule, en tenir compte.

## `/robots.txt` renvoie 500 en prod Genspark
Constaté le 2026-07-09 : `curl https://.../robots.txt` → `Internal Server Error` (au lieu du contenu statique attendu). Le fichier existe bien dans `public/robots.txt` en local. Cause non investiguée — possiblement lié au retard de déploiement ci-dessus, ou à un conflit de route Hono. À vérifier une fois sur Cloudflare direct ; si le bug persiste, investiguer `src/index.tsx` pour un handler qui intercepterait `/robots.txt`.

## `phoneCatalogService.ts` non testé
Commits `5dec0de`/`eddd3af` (8 juillet 2026) ont ajouté ~1500 lignes (fallback dataset statique 24 marques/6866 modèles + logique retry 429) sans suite de tests. `tests/phoneCatalogService.test.ts` n'existe pas — seul service métier sans couverture Vitest sur les 18 services du projet.

## RGPD — limitation de conservation non implémentée (Art. 5.1.e)
Connu et documenté dans `docs/TODO.md` : `checkAndPurgeExpiredClients()` / `checkAndPurgeExpiredTickets()` pas encore développés. Purge sur demande (Art.17) fonctionne, mais pas de purge automatique après expiration des durées légales.

## Tension IMEI purge RGPD / registre anti-recel (art. 321-7)
La purge RGPD met l'IMEI à `NULL`, mais l'art. 321-7 C.pén. impose un registre IMEI 5 ans minimum. Solution documentée mais non implémentée : registre réglementaire séparé hors CRM avant d'activer la purge auto IMEI.
