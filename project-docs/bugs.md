# iziGSM — Bugs connus

## Service Worker `sw.js` — CACHE_VERSION jamais bumpée depuis Sprint 2.14/2.17 — CORRIGÉ le 2026-07-10
Constaté le 2026-07-10 en testant l'onboarding Google : `/login` (et le reste de l'`APP_SHELL` : `/dashboard`, `/tickets`, etc.) est précaché en stratégie "Cache First" par `sw.js`. `CACHE_VERSION` était resté à `'izigsm-v2.17'` alors que l'app est en v2.45.0 — **tout déploiement depuis le Sprint 2.17 n'a jamais invalidé le cache des pages App Shell** pour les navigateurs ayant déjà installé le service worker. Symptôme concret : un utilisateur avec le SW déjà installé continuait de voir l'ancienne version de `/login` (sans le fix onboarding Google de cette session) malgré un déploiement réussi — `handleGoogleCredential` exécutait l'ancien code, aucune erreur visible, juste un comportement silencieusement obsolète.

**Fix appliqué** : `CACHE_VERSION` bumpée à `'izigsm-v2.46'` (commit à venir). Le mécanisme d'invalidation existant (`activate` → `caches.delete()` des anciennes versions, `skipWaiting()`) fonctionne correctement — il suffisait de déclencher le bump.

**Dette restante** : rien n'automatise ce bump à chaque déploiement — à faire manuellement (ou scripter dans le process de build) pour éviter que ça se reproduise sur plusieurs sprints. Impact potentiel rétroactif : des utilisateurs ont pu voir des versions obsolètes de l'App Shell entre Sprint 2.17 et ce fix sans s'en rendre compte.

## `www.repairdesk.fr` → Error 521 (Web server down)
Constaté le 2026-07-10 par l'utilisateur juste après l'attachement de `repairdesk.fr` à Cloudflare Pages. `www.repairdesk.fr` (CNAME → `webredir.vip.gandi.net`, proxied, non modifié par la migration) renvoie 521 de façon reproductible (Cloudflare ne joint pas le service de redirection Gandi). **L'apex `repairdesk.fr` fonctionne normalement (200)** — vérifié à plusieurs reprises, aucun lien avec la migration Cloudflare. Cause probable : panne ou changement côté service de redirection Gandi, indépendant de nos actions. Non-bloquant (le lien canonique de l'app est l'apex), mais à corriger si des liens/favoris externes pointent vers `www.`.

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

## `/register` cassé — CORRIGÉ le 2026-07-10 (commits `e6b75b9`, `3129836`)
Constaté le 2026-07-09 (Task 7 validation migration Cloudflare) sur `izigsm.pages.dev`. `public/static/js/register.js:185` appelait `apiPostPublic('/api/register', ...)` — chemin inexistant, ET `apiPostPublic` lui-même n'était pas défini sur la page register (fonction déclarée uniquement dans `app.js`, non chargé par `register.html`). L'étape "OTP" était un mock 100% frontend (`Math.random()`, jamais de SMS/email réel). Aucun compte ne pouvait être créé.

**Fix appliqué (option "flow complet par email", validée avec l'utilisateur)** :
- `emailService.ts` : nouvelle fonction `sendOtpInscription()` — email système via Resend (`RESEND_API_KEY` global, domaine `mail.repairdesk.fr`), hors du système `sendEmail()`/`email_logs` scopé par boutique (pas de boutique au moment de l'inscription)
- `auth.ts` : `/register` envoie le vrai OTP par email ; nouvel endpoint `/resend-otp` ; `verify-otp` renvoie aussi `boutique_id` (alignement avec `/login`)
- `register.js` : appels réels à `/api/auth/register`, `/api/auth/resend-otp`, `/api/auth/verify-otp` ; stockage des vrais tokens JWT
- `register.html` : libellés SMS→email, CTA finale vers `/dashboard`

**3 failles introduites puis corrigées avant déploiement final** (review de sécurité automatique sur le commit) :
- `otpDemo` fuitait le code OTP en clair dès que l'envoi Resend échouait (pas seulement si la clé était absente) — contournement total de la vérification email possible. Corrigé : `otpDemo` uniquement si `RESEND_API_KEY` n'est pas configurée du tout.
- `/resend-otp` distinguait 404 (compte inconnu) / 409 (déjà vérifié) → énumération de comptes. Corrigé : réponse 200 générique dans tous les cas, même principe que `/login`.
- Prénom utilisateur (saisie libre) interpolé sans échappement dans le HTML de l'email → injection possible. Corrigé : `escapeHtml()` ajouté dans `emailService.ts`.

**Validé bout-en-bout le 2026-07-10 par l'utilisateur** : inscription réelle (`telnet@bbox.fr`), email reçu, code vérifié, compte activé, arrivée sur `/dashboard`. Un log d'erreur a été ajouté sur l'échec HTTP Resend (`sendOtpInscription`, absent jusque-là — un échec non-exception restait totalement silencieux). Déploiement final : `8bcbb1d4`.

**Dette restante, hors scope de ce fix** : les 5 autres templates email de `emailService.ts` (`sendTicketCree`, `sendTicketTermine`, `sendTicketLivre`, `sendSavOuvert`, `sendRelance`, `sendRelanceDevis`) interpolent aussi `client_prenom` sans échappement — même classe de faille, préexistante, à corriger dans une passe dédiée.

## Tests sensibles au fuseau horaire local (3 tests, non-bloquant)
Constaté le 2026-07-09 lors de la migration Cloudflare (Task 1 du plan, `npm test` sur HEAD `5106d93`) : 3 tests échouent sur une machine en UTC+2 (`agendaService.test.ts` "fin auto-calculée", `statsService.test.ts` "1er du mois courant" ×2) — écart de 2h exact, cohérent avec `new Date().getTimezoneOffset() === -120` sur cette machine. Les services testés (`agendaService.ts`, `statsService.ts`) utilisent probablement `new Date()` en heure locale au lieu de forcer UTC. 702/705 tests passent. Sans lien avec la migration d'hébergement — dette pré-existante, non corrigée (hors scope).
