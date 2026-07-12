# iziGSM — Bugs connus

## Création de ticket via `/tickets` impossible — CORRIGÉ le 2026-07-11
`saveTicket()` (`public/static/js/tickets.js`) avait **deux bugs cumulés**, chacun suffisant à lui seul pour bloquer toute création de ticket via le formulaire :

1. **`client_id` jamais envoyé** — ni `<select id="t-client">` (client existant) ni le champ texte libre "Ou nouveau client" n'étaient jamais lus dans la charge utile envoyée à l'API, qui exige `client_id`.
2. **4 champs mal nommés** — le payload envoyait `marque`/`modele`/`description`/`devis_montant` alors que l'API (`CreateTicketData`, `ticketService.ts`) attend `appareil_marque`/`appareil_modele`/`description_panne`/`prix_estime`. Ces 3 derniers (marque/modele/description) sont obligatoires côté serveur — silencieusement ignorés, ils déclenchaient la même erreur "Champs obligatoires manquants" même une fois `client_id` corrigé. `prix_estime` (optionnel) était lui aussi perdu sans erreur visible.
3. **Valeurs de priorité non alignées** — le select affiche `Basse`/`Moyenne`/`Haute` (FR capitalisé), l'API attend l'enum `PrioriteTicket` en minuscules (`basse`/`normale`/`haute`/`urgente`). Sans mapping, une modification de priorité en édition (`PUT`, qui valide la valeur) aurait échoué avec une 422 — pas bloquant à la création (le champ n'est même pas accepté par `CreateTicketData`), mais bloquant en édition.

Découvert et corrigé le 2026-07-11 en testant en local le chantier prise en charge. **Fix appliqué** :
- `saveTicket()` résout `client_id` : client sélectionné dans la liste en priorité, sinon création à la volée via `POST /api/clients` (nom libre découpé en prénom/nom sur le premier espace) depuis le champ texte
- Les 4 clés renommées pour matcher l'API (`appareil_marque`, `appareil_modele`, `description_panne`, `prix_estime`)
- `PRIORITE_MAP` ajouté pour convertir les labels FR vers l'enum API
- `t-client` réinitialisé dans `clearTicketForm()` (n'était pas remis à zéro entre deux ouvertures du formulaire)

**Validé en local** (navigateur réel) sur les deux chemins : client existant sélectionné (ticket créé, lié au bon client) et nouveau client tapé en texte libre (client créé avec prénom/nom/téléphone corrects, ticket lié). Tous les champs auparavant perdus (marque, modèle, description, prix, priorité) confirmés persistés via `GET /api/tickets/:id`. Tickets et pas de nouveau client de test laissés en base locale (nettoyés après coup) — aucune donnée de production affectée.

**Non corrigé, hors scope (même famille de bug, mais plus gros)** : l'assignation de technicien à la création reste non fonctionnelle — `<select id="t-technician">` contient des noms en dur ("Jean D.", "Marie L.", "Pierre M.", jamais les vrais employés) et `technicien_id` n'est jamais envoyé par `saveTicket()`. Contrairement aux 3 bugs ci-dessus (renommage de champ), corriger ça demande de construire un vrai `populateTechniciens()` (sur le modèle de `populateClients()`) branché sur l'API personnel — une fonctionnalité à part, pas juste un typo.

## Bouton "+ Nouvelle prise en charge" plantait systématiquement — CORRIGÉ le 2026-07-11
`isSigEmpty()` (`tickets.js`) appelait `getImageData()` sur le canvas de signature alors que celui-ci a une taille 0x0 tant que l'onglet "Signature" n'a jamais été affiché (`.tab-content:not(.active)` est `display:none`, donc `resizeSigCanvas()` mesurait un `#sig-area` de dimensions nulles). `getImageData()` sur une largeur 0 lève `IndexSizeError`, ce qui arrêtait `openNewTicket()` avant l'appel à `openModal()` — **la modal de création de ticket ne s'ouvrait jamais**, silencieusement (aucun message utilisateur, juste un plantage JS). Bug 100% préexistant, indépendant de tout ajout de cette session — découvert en testant en navigateur réel (Claude in Chrome) plutôt qu'en s'arrêtant aux tests unitaires.

**Fix appliqué** : garde dans `isSigEmpty()` (retourne `true` si canvas 0x0) + `resizeSigCanvas()` rappelé au clic sur l'onglet Signature (`tickets.html`), au moment où `#sig-area` devient réellement visible.

## Signature client jamais persistée malgré une UI de capture fonctionnelle — CORRIGÉ le 2026-07-11
L'onglet "Signature" de `tickets.html` a toujours eu un canvas de dessin fonctionnel, mais `saveTicket()` n'envoyait qu'un booléen `hasSignature` — le dessin lui-même n'était jamais transmis ni stocké. Corrigé avec l'ajout de la colonne `tickets.signature_client` (data URL PNG) — voir § chantier prise en charge dans `todo.md`. Sans lien avec la signature devis (`devis.signature_client`), qui elle a une colonne et un endpoint prêts (`saveSignatureDevis()`, `POST /api/public/devis/:token/repondre`) mais aucune UI ne l'appelle encore (`devis-public.html` n'a pas de canvas de signature) — ce gap-là reste non corrigé, `G08` du gap analysis reste valide.

## Signature client vulnérable à l'injection HTML (XSS via attribut `img src`) — CORRIGÉ le 2026-07-11
Trouvé par la revue de sécurité automatique sur le commit du chantier prise en charge. `signature_client` (nouvelle colonne, data URL PNG) était interpolé directement dans `<img src="${t.signature_client}">` sans validation ni échappement fiable, à 3 endroits (`renderEtatSecuriteDetail()`, `_buildTicketHTML()` pour la fiche imprimable, badge signature). `esc()` (utilisé partout ailleurs dans le fichier) n'échappe que `<`/`>`, pas les guillemets — insuffisant en contexte attribut. Un appel API direct à `POST`/`PUT /api/tickets` (pas nécessairement via le canvas de dessin) aurait pu stocker une valeur du type `" onerror="...` et l'exécuter dans le navigateur de tout membre de l'équipe consultant ce ticket.

**Fix appliqué** : validation stricte du format (`^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$`) — côté API (`lib/validators.ts` → `validateSignatureDataUrl()`, appelée dans `POST`/`PUT /api/tickets`, rejette avec 400 sinon) ET côté frontend (`isValidSignatureDataUrl()` dans `tickets.js`, re-vérifiée avant toute interpolation — défense en profondeur, ne fait pas confiance aux données juste parce qu'elles viennent du serveur). Aucune donnée de production affectée (colonne ajoutée cette même session, aucune signature encore écrite en prod).

## Emails transactionnels jamais envoyés depuis la création de la base — CORRIGÉ le 2026-07-10
Découvert en testant les emails automatiques à la demande de l'utilisateur. `email_logs` était **totalement vide depuis toujours** — aucun email transactionnel (ticket créé/terminé/livré, SAV ouvert, devis, relances) n'était jamais réellement parti, malgré le code semblant fonctionnel et documenté comme "✅ Fait" dans `GAP_ANALYSIS_ENRICHI.md`. Trois bugs cumulés, chacun masquant le suivant :

1. **`waitUntil()` manquant** — tous les triggers email (`sendTicketCree` et 4 autres) étaient appelés en fire-and-forget (`.catch(() => {})`) sans être enregistrés auprès du runtime Cloudflare Workers. Résultat : Workers tue l'exécution dès la réponse HTTP envoyée, avant que la promesse n'ait le temps d'aboutir — silencieux, aucune erreur visible côté utilisateur.
2. **`email_api_key` jamais configurée par boutique** — même le `waitUntil()` corrigé, `sendEmail()` serait tombé en mode "simulé" (log sans envoi réel) faute de clé Resend propre à chaque boutique. Aucune boutique n'a jamais configuré ça (pas même un flow d'onboarding pour le faire).
3. **`FRONTEND_URL` jamais configurée en production** — une fois les deux bugs précédents corrigés, l'email partait réellement mais le lien "Suivre ma réparation" pointait vers `http://localhost:3000` (fallback de dev), cassé pour tout client réel.

**Fix appliqué** :
- `waitUntil()` ajouté sur les 5 triggers fire-and-forget (`tickets.ts` ×4, `sav.ts`, `facturation.ts`)
- Fallback plateforme sur `RESEND_API_KEY` globale (même mécanisme que l'email OTP) quand `email_api_key` boutique est vide — expéditeur forcé sur `mail.repairdesk.fr` (domaine vérifié) dans ce cas ; `POST /api/notifications/test` volontairement exclu du fallback (doit tester la vraie config boutique)
- `FRONTEND_URL=https://repairdesk.fr` ajoutée dans `wrangler.jsonc` (var non-secrète)
- Bonus : règle de réécriture `_redirects` pour `/suivi/:token` (format path, inutilisé par les liens réels qui sont en `?token=`, mais laissé cassé aurait été trompeur)

**Validé bout-en-bout en production** (commit `2968bfa`) : ticket `TKT-2026-00009` → email réellement reçu par `telnet@bbox.fr` → lien de suivi correct vers `repairdesk.fr`. Premier enregistrement jamais créé dans `email_logs` (`statut: envoye`, `provider_id` Resend réel).

**Dette restante** : `/factures/:id/emettre` n'envoie pas d'email du tout (jamais implémenté, contrairement à ce que suggérait la doc CDC "MOD-12 envoi email facture ✅") — non corrigé, hors scope de cette session.

## Backup D1 automatique — OPÉRATIONNEL depuis le 2026-07-10
Mis en place suite à une question de l'utilisateur sur la durabilité des données D1 (isolation multi-tenant vérifiée + fiabilité Cloudflare). En plus des garanties natives D1 (Time Travel, export à la demande — vérifiées via l'API Cloudflare), un backup SQL complet est maintenant exporté chaque nuit à 02h00 UTC via `.github/workflows/d1-backup.yml` et commité dans `backups/d1/` (hébergeur différent de Cloudflare — vraie redondance).

**Mise en place mouvementée** (token Cloudflare édité plusieurs fois) :
- Erreur 1 : token scopé "D1 Write" seul → wrangler échoue sur l'appel `/memberships` (auto-détection du compte). Fix tenté : `CLOUDFLARE_ACCOUNT_ID` explicite dans le workflow — insuffisant seul.
- Erreur 2 : toujours `/memberships`, message explicite de wrangler → il manquait les permissions **User → User Details → Read** et **User → Memberships → Read** (catégorie différente de la permission D1, qui est catégorie Account — piège UI, deux menus déroulants séparés).
- Erreur 3 : `git push` rejeté (non-fast-forward) — plusieurs runs déclenchés manuellement pendant le débogage se sont chevauchés. Fix : `git pull --rebase origin main` avant `git push` dans le workflow.
- Erreur 4 (transitoire) : après ajout de la permission User Details Read, l'export D1 a échoué une fois en `Authentication error [code: 10000]` malgré des permissions token vérifiées correctes — résolu en relançant après ~2 min (probable délai de propagation Cloudflare suite aux éditions successives du token).

Premier backup réussi : `backups/d1/backup-2026-07-10.sql` (13669 lignes), commit `b27848f`. Rotation automatique sur les 14 derniers jours.

**Setup requis pour toute recréation du token** : permissions **Account → D1 → Write** + **User → User Details → Read** + **User → Memberships → Read**, "Account Resources" = Contact@soteli.fr's Account. Secret GitHub `CLOUDFLARE_API_TOKEN` à mettre à jour si le token est régénéré (pas juste édité).

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
Constaté le 2026-07-09 lors de la migration Cloudflare (Task 1 du plan, `npm test` sur HEAD `5106d93`) : 3 tests échouent sur une machine en UTC+2 (`agendaService.test.ts` "fin auto-calculée", `statsService.test.ts` "1er du mois courant" ×2) — écart de 2h exact, cohérent avec `new Date().getTimezoneOffset() === -120` sur cette machine. Les services testés (`agendaService.ts`, `statsService.ts`) utilisent probablement `new Date()` en heure locale au lieu de forcer UTC. 702/705 tests passent. Sans lien avec la migration d'hébergement — dette pré-existante, non corrigée (hors scope). Toujours présents le 2026-07-12 (707/710 puis 712/715 après ajout de tests), sans lien avec le chantier Ports & Adapters.

## `technicien_id` jamais validé contre la boutique du ticket — CORRIGÉ le 2026-07-12
Trouvé par la revue finale de branche du chantier Ports & Adapters (`docs/superpowers/plans/2026-07-12-ports-adapters-technicien-assignment.md`). `ticketService.ts` (`createTicket`/`updateTicket`) acceptait `technicien_id` sans vérifier qu'il appartient à la boutique du ticket — un admin/manager aurait pu assigner (via l'API, pas juste l'UI) un technicien d'une autre boutique, exposant son nom via la jointure `LEFT JOIN users`. Champ déjà présent dans l'API avant ce chantier (préexistant), mais devenu réellement atteignable depuis l'UI avec la livraison de `populateTechniciens()` le même jour — d'où la correction immédiate plutôt qu'un report.

**Fix appliqué** : `validateTechnicienBoutique(db, technicienId, boutiqueId)` dans `ticketService.ts` — `SELECT id FROM users WHERE id = ? AND boutique_id = ?`, lève une erreur si absent. Appelée dans `createTicket` (avant l'INSERT) et `updateTicket` (avec le `boutique_id` du ticket existant, récupéré via une extension du `SELECT` de vérification déjà présent). `routes/tickets.ts` : l'appel `POST /api/tickets` est désormais dans un `try/catch` (absent avant), erreur renvoyée en 422 — même convention que `PUT /api/tickets/:id`.

**Validé** : 5 nouveaux tests unitaires (`tests/ticketService.test.ts`, `createTicket()`/`updateTicket()`) couvrant technicien valide même boutique / technicien autre boutique rejeté / technicien absent (pas de vérification). Suite complète 712/715 (mêmes 3 échecs fuseau horaire pré-existants, zéro régression).

## Port `Database` — portabilité driver uniquement, pas dialecte SQL (documenté, pas un bug)
Précision ajoutée le 2026-07-12 au spec (`docs/superpowers/specs/2026-07-12-architecture-ports-adapters-design.md`, addendum) suite à la revue finale de branche : le port `Database` (SQL brut) abstrait le driver de connexion (D1 → Postgres) mais pas le dialecte SQL. Le SQL existant contient des constructions SQLite-only (`julianday()`, `datetime('now', '-N days')`, `||`, `INSERT ... RETURNING`, booléens 0/1) qui devront être traduites service par service au moment de la bascule VPS/Postgres — pas juste un changement d'adaptateur de connexion. Pas un bug actuel, une limite de portée à anticiper.

## `editTicket()` ne présélectionnait plus le technicien assigné — CORRIGÉ le 2026-07-12
Régression introduite par la livraison de `populateTechniciens()` le même jour (les valeurs du `<select id="t-technician">` sont passées de noms texte à des ID numériques, `editTicket()` (`tickets.js:163`) assignait encore `ticket.technician` — un nom — à `.value`, qui ne matchait plus aucune `<option>`). Trouvé et corrigé le même jour lors de la revue finale de branche, avant tout impact utilisateur signalé. **Aucune perte de données** : `updateTicket` utilise `COALESCE(?, technicien_id)`, donc une sauvegarde avec le select vide (`technicien_id: null`) conservait déjà la valeur existante en base — effet purement cosmétique (champ affiché vide en édition), jamais un vrai désassignement silencieux.

**Fix appliqué** : `listTickets()` (`ticketService.ts`) sélectionne désormais aussi `t.technicien_id` (absent avant, seul `technicien_nom` joint était remonté). `loadTickets()` (`tickets.js`) porte ce champ dans le cache (`technicianId`). `editTicket()` assigne `ticket.technicianId ?? ''` au lieu du nom texte.

## `POST /api/tickets` → 500 pour Desk1 (boutique_id=3) — NON corrigé, à investiguer
Découvert le 2026-07-12 pendant la validation en production de `populateTechniciens()` (Task 6 du chantier Ports & Adapters) — création de ticket impossible pour la boutique Desk1 spécifiquement. `D1_ERROR: UNIQUE constraint failed: tickets.numero` dans `nextNumero()` (`src/lib/db.ts`). Reproduit de façon identique avec et sans `technicien_id`, sur 3 essais — confirmé sans lien avec le chantier en cours (aucun fichier touché par Ports & Adapters/populateTechniciens ne touche `lib/db.ts` ni la logique de numérotation). Cause probable : désync de la table `sequences` pour la boutique 3 (`dernier_num` en retard ou en conflit avec des `numero` déjà existants en base). **Non investigué en profondeur, non corrigé** — Desk1 ne peut probablement créer aucun ticket tant que ce n'est pas résolu. Priorité haute, session dédiée recommandée.
