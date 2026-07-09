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

## `docs/ARCHITECTURE_MODULES.md` §2 (tableau migrations) obsolète
Constaté le 2026-07-09 (Task 3 migration Cloudflare) : le tableau des tables par migration dans `ARCHITECTURE_MODULES.md` ne reflète plus les noms réels (`statuts_historique`→`tickets_statuts_historique`, `otp_codes`→`otp_tokens`, `tickets_sav`→`sav_dossiers`, `lignes_facture`→`lignes_document`, tables `commissions`/`clotures_journalieres`/`sequences` absentes du tableau). Vérifié : le code (`src/services/*.ts`) et `migrations/*.sql` sont cohérents entre eux — seule la doc a pris du retard, pas de risque fonctionnel. À corriger dans une session dédiée doc, sans lien avec la migration Cloudflare.

## `/register` cassé — mauvais chemin API (BLOQUANT pour l'onboarding réel)
Constaté le 2026-07-09 (Task 7 validation migration Cloudflare) sur `izigsm.pages.dev`. `public/static/js/register.js:185` appelle `apiPostPublic('/api/register', ...)`. Le backend n'expose que `/api/auth/register` (`src/routes/auth.ts:116`, monté sous `/api/auth` dans `src/index.tsx:128`) — il n'existe **aucune route `/api/register`**. Résultat : la soumission finale du formulaire d'inscription (après l'étape "OTP") échoue en 404 silencieux, aucun compte n'est réellement créé.

Point additionnel : l'étape "OTP par SMS" du wizard (`registerState.otp`, `public/static/js/register.js:119-140`) est une simulation 100% frontend — code à 6 chiffres généré par `Math.random()` côté navigateur, affiché uniquement dans la console DevTools (`console.log('[iziGSM démo] Code OTP :', otp)`), jamais de SMS ni d'email réellement envoyé à cette étape. Le vrai flow email-OTP documenté (`POST /api/auth/register` + `POST /api/auth/verify-otp`) n'est jamais atteint par ce wizard.

**Impact** : aucune nouvelle boutique ne peut s'inscrire sur l'app actuellement, sur aucun environnement (bug de code, pas lié à l'hébergement). Contournement temporaire utilisé pour valider la migration : connexion directe avec le compte seedé `admin@izigsm.fr` (`seed.sql`, credentials publiques du repo).

**Fix probable** (non appliqué — hors scope de la migration, à valider avec l'utilisateur) : soit corriger `register.js:185` pour appeler `/api/auth/register`, soit refaire tout le wizard pour utiliser le vrai flow email-OTP (`verify-otp`) au lieu du mock SMS — la deuxième option est plus lourde mais évite de faire croire à un SMS qui n'existera jamais sans Twilio (post-MVP, cf. TODO.md).

## Tests sensibles au fuseau horaire local (3 tests, non-bloquant)
Constaté le 2026-07-09 lors de la migration Cloudflare (Task 1 du plan, `npm test` sur HEAD `5106d93`) : 3 tests échouent sur une machine en UTC+2 (`agendaService.test.ts` "fin auto-calculée", `statsService.test.ts` "1er du mois courant" ×2) — écart de 2h exact, cohérent avec `new Date().getTimezoneOffset() === -120` sur cette machine. Les services testés (`agendaService.ts`, `statsService.ts`) utilisent probablement `new Date()` en heure locale au lieu de forcer UTC. 702/705 tests passent. Sans lien avec la migration d'hébergement — dette pré-existante, non corrigée (hors scope).
