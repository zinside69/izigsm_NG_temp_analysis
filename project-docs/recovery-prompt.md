# Recovery Prompt — iziGSM — 2026-07-16 (checkpoint 28, plan d'implémentation acompte écrit — RIEN CODÉ)

## Vue d'ensemble (checkpoint 28)
Suite du checkpoint 27 (spec approuvée). Skill `superpowers:writing-plans` invoqué, plan complet écrit et pushé : `docs/superpowers/plans/2026-07-16-acompte-structure.md` (commit `15bdea8`) — 10 tâches TDD. **Aucune tâche du plan n'a été commencée.**

## Où on en est
- **Bonus avant le plan** : bug `devis.js` trouvé et corrigé (3 fonctions cassées, même classe que `settings.html` checkpoint 23) — déployé (`d876981`). Balayage plus large repéré (`agenda.js`/`sav.js`/`stats.html`, ~17 endpoints) mais pas traité, documenté dans `todo.md`.
- **Plan** : auto-relecture a trouvé et comblé un trou de couverture (déduction acompte à la facture finale, devenue Task 7) avant validation.
- **10 tâches** : (1) migration DB, (2) `createFactureAcompte()`, (3) `createAvoir()`+`date_expiration`, (4) exposer l'acompte sur `getTicketById()`/`getDevis()`, (5-6) routes ticket/devis, (7) déduction à `convertirDevis()`, (8-9) UI `tickets.js`/`devis.js`, (10) `suivi.html`.

## Prochaine étape
**Choisir le mode d'exécution** avant de reprendre :
1. Subagent-driven (`superpowers:subagent-driven-development`) — un subagent frais par tâche, relecture entre chaque
2. Inline (`superpowers:executing-plans`) — exécution dans la session, par lots avec points de contrôle

Puis exécuter les 10 tâches du plan dans l'ordre (dépendances strictes : 1→2→{3,4}→{5,6}→7→{8,9}→10).

---

# Recovery Prompt — iziGSM — 2026-07-16 (checkpoint 27, spec acompte structuré écrite — en attente de relecture)

## Vue d'ensemble (checkpoint 27)
Suite directe du checkpoint 26. Session de conception pure (skill `superpowers:brainstorming`) pour le chantier "acompte structuré" — **aucun code modifié à ce stade**. Repo/stack inchangés, voir vue d'ensemble checkpoint 25 ci-dessous pour le contexte technique complet.

## Où on en est
Le design complet (sous-projet A — acompte manuel) a été présenté section par section et **entièrement approuvé** par l'utilisateur :
1. Un seul acompte par dossier, montant libre saisi par la boutique
2. **Modèle "facture d'acompte"** (pas de nouvelle table) — réutilise `factures`/`avoirs`/`journal_nf525` tels quels, pas d'extension NF525
3. **Numérotation `FAC-` partagée** avec les factures normales (pas de séquence dédiée) — une facture d'acompte est légalement une "facture", pas une catégorie distincte comme devis/avoir ; deux séquences indépendantes pour la même catégorie créerait une chaîne de facturation parallèle, contraire au principe de NF525
4. **Facture finale = solde restant uniquement** (ligne négative de déduction "Acompte déjà facturé") — tranché après avoir identifié une tension entre "l'acompte doit compter dans le CA du jour" et "facture finale = montant total" (qui aurait exigé d'exclure l'acompte du CA pour éviter le double comptage)
5. Annulation avec acompte perçu → `createAvoir()` existant réutilisé, motif fixe pré-rempli, `date_expiration` +2 mois réellement appliquée (nouvelle colonne sur `avoirs`)
6. Rôles : admin/manager uniquement (cohérent avec le reste de la gestion financière)

**Spec écrit, auto-relu et pushé** : `docs/superpowers/specs/2026-07-16-acompte-structure-design.md` (commit `ae094a7`). Un edge case a été corrigé pendant l'auto-relecture : `convertirDevis()` n'est pas gatée par le statut du ticket, donc une facture finale et une annulation pourraient théoriquement coexister sur un même dossier — documenté comme non couvert par ce MVP plutôt que présenté comme un cas impossible.

## Prochaine étape
**En attente de la relecture du spec écrit par l'utilisateur** (hard-gate du skill brainstorming — distinct de l'approbation section-par-section déjà obtenue pendant la conception). Une fois confirmé → invoquer le skill `writing-plans` pour transformer le spec en plan d'implémentation détaillé, avant tout code.

---

# Recovery Prompt — iziGSM — 2026-07-16 (checkpoint 26, brainstorming acompte structuré EN COURS)

## Vue d'ensemble (checkpoint 26)
Session de conception pure (skill `superpowers:brainstorming`) pour le chantier "acompte structuré" reporté au checkpoint 25 — **aucun code modifié**. Repo/stack inchangés, voir vue d'ensemble checkpoint 25 ci-dessous pour le contexte technique complet.

## Où on en est
Décomposé en 2 sous-projets : **(A) acompte manuel** (cette session) / **(B) paiement en ligne Stripe** (session future). Décisions validées pour (A) :
1. Un seul acompte par dossier (ticket ou devis), pas de cumul
2. Montant libre saisi par la boutique, pas de %
3. **Modèle "facture d'acompte"** (pas de nouvelle table) — l'acompte génère une vraie facture émise/verrouillée dès sa perception. Découvert nécessaire : `createAvoir()` exige une facture verrouillée existante, et l'utilisateur veut un avoir (pas un remboursement) sur annulation. Réutilise `factures`/`avoirs`/`journal_nf525` tels quels — pas d'extension de la chaîne NF525.
4. Avoir sur acompte annulé : validité 2 mois **réellement appliquée** (nouvelle colonne `date_expiration` sur `avoirs` + expiration automatique à construire, sur le modèle de `expireDevisPerimes()`)

Design "Vue d'ensemble" (le flow complet) présenté à l'utilisateur, **pas encore approuvé** — interrompu pour un checkpoint. Détail complet dans `todo.md` § Chantier futur — acompte structuré.

## Prochaine étape
Reprendre la présentation du design (skill `superpowers:brainstorming`) : sections restantes = modèle de données détaillé (colonne pour distinguer facture d'acompte vs normale, numérotation), mécanisme de déduction à la facturation finale, portée de `date_expiration`, UI (bouton + écran d'encaissement + affichage solde restant sur `suivi.html`). Une fois toutes les sections approuvées → écrire `docs/superpowers/specs/2026-07-16-acompte-structure-design.md` → self-review → faire relire à l'utilisateur → invoquer `writing-plans`. **Ne pas coder avant l'approbation du spec écrit** (hard-gate du skill).

---

# Recovery Prompt — iziGSM — 2026-07-16 (checkpoint 25, feature Accord + override)

## Vue d'ensemble
SaaS Hono/TypeScript + Cloudflare (Pages + D1 + R2) multi-tenant de gestion pour centres de réparation GSM. Repo : `izigsm/webapp/` (racine git), remote GitHub `zinside69/izigsm_NG_temp_analysis`, branche `main`. Suite du checkpoint 24. Implémente la feature "Accord" spécifiée le 2026-07-10 + un override staff demandé le 2026-07-16.

## Ce qui a été fait ce checkpoint (25)

**Timeline "Accord" (`suivi.html`)** : réutilise le flow devis existant (pas de nouveau système de token, décision du 2026-07-10). L'étape passe orange quand un devis est `envoye`, vert quand `accepte` — même si le ticket est encore littéralement au statut `attente_accord` (fenêtre avant que l'équipe change manuellement le statut). `getTicketPublicByToken()`/`getTicketById()` exposent `devis_statut` via `LEFT JOIN devis` (le plus récent lié au ticket). **Bug annexe trouvé et corrigé** : `routes/public.ts` filtrait explicitement les champs renvoyés au client public — `devis_statut` résolu par le service mais jamais exposé, corrigé dans le même commit.

**Override staff — "client injoignable"** (demandé en complément, pas dans la spec initiale) : `POST /api/devis/:id/accord-manuel`, autorisé `admin`/`manager`/`technicien` (décision 2026-07-16 : sans délai imposé, jugement laissé à l'équipe). Volontairement étroit — seule la transition `envoye→accepte`, contrairement à `PUT /devis/:id/statut` (admin/manager, toutes transitions) — pour ne pas élargir tout le pouvoir de gestion des devis au rôle technicien. Tracé (`ACCORD_MANUEL_STAFF`, audit log distinct). Bouton "Valider l'accord manuellement" dans la fiche détail ticket (`tickets.js`), visible seulement si le devis est en attente.

**Acompte structuré — reporté à une session dédiée** (décision explicite 2026-07-16) : demandé dans la foulée de la feature Accord, mais scope plus lourd (paiement en ligne = intégration Stripe à choisir, + implications NF525 sur le moment où l'acompte transite par le journal fiscal). Décisions déjà actées : encaissement manuel ET en ligne, demandé au devis ET à la prise en charge, déduit à la livraison. Détail complet `todo.md`.

Détail complet dans `todo.md`/`bugs.md`.

## État git à la fin de ce checkpoint
Commité, pushé et déployé (`271accb`), `repairdesk.fr/api/health` → 200 et `sw.js` confirme `izigsm-v2.56` après déploiement. Tests 803/805 (fixtures SQL `ticketService.test.ts`/`publicService.test.ts` mises à jour suite au nouveau LEFT JOIN devis).

## Prochaines étapes recommandées
1. Session dédiée pour l'acompte structuré (voir `todo.md` § Chantier futur — décisions déjà prises, reste à cadrer le modèle de données + l'intégration paiement)
2. SMS pour la feature Accord : décision fournisseur (Twilio) toujours en attente
3. Nuance mineure notée dans `todo.md` : badge de statut principal peut être en léger décalage visuel avec la timeline juste après un override (pas une régression)

---

# Recovery Prompt — iziGSM — 2026-07-16 (checkpoint 24, populateTechniciens() + CACHE_VERSION v2.55)

## Vue d'ensemble
SaaS Hono/TypeScript + Cloudflare (Pages + D1 + R2) multi-tenant de gestion pour centres de réparation GSM. Repo : `izigsm/webapp/` (racine git), remote GitHub `zinside69/izigsm_NG_temp_analysis`, branche `main`. Suite du checkpoint 23. Deux items traités : bug slug boutiques (déjà corrigé, doc rattrapée) et `populateTechniciens()` (filtre par rôle).

## Ce qui a été fait ce checkpoint (24)

**Bug slug boutiques libre-service — pas de code à changer, doc corrigée** : revérification a montré que ce bug (todo.md le listait comme ouvert) était en réalité déjà corrigé et backfillé en prod depuis le commit `92f0db8` (2026-07-11). Les 3 boutiques prod (`iziGSM Paris 11`, `SOTELI`, `Desk1`) ont toutes un slug valide, confirmé via `GET /api/boutiques`. La checkbox n'avait simplement jamais été cochée.

**`populateTechniciens()` filtré par rôle** : `tickets.js` listait tous les rôles (admin/manager/technicien) dans le select d'assignation, pas seulement les techniciens. Fix : `.filter(u => u.role === 'technicien')`.

**Découverte importante pendant la validation — `CACHE_VERSION` bumpée `v2.54`→`v2.55`** : le Service Worker (Cache First) servait encore l'ancien `tickets.js` malgré un rebuild/redéploiement complet — `CACHE_VERSION` n'avait pas été bumpée depuis le lot B du checkpoint 22, alors que les lots C (`clients.js`, SIRET) et G (`settings.html`) de cette session ont changé du frontend sans bump correspondant. Le bump de ce checkpoint invalide rétroactivement le cache pour TOUS ces changements accumulés depuis `v2.54`, pas seulement `populateTechniciens()`. **Point de vigilance pour les prochains checkpoints** : penser à bumper `CACHE_VERSION` à chaque déploiement touchant un fichier `public/static/js/*.js` ou `public/*.html`, pas seulement en fin de session.

Détail complet dans `todo.md`/`bugs.md`.

## État git à la fin de ce checkpoint
Commité, pushé et déployé (`d3a3592`), `repairdesk.fr/api/health` → 200 et `sw.js` confirme `CACHE_VERSION izigsm-v2.55` après déploiement. Tests 803/805 inchangés (mêmes 2 échecs pré-existants `computeFin()`).

## Prochaines étapes recommandées
1. Reste ouvert : limite RGPD purge automatique, multi-sites géré, rebranding MyDesk, feature "Accord" timeline suivi ticket — voir `todo.md`
2. Vigilance `CACHE_VERSION` à chaque futur déploiement frontend (voir note ci-dessus)

---

# Recovery Prompt — iziGSM — 2026-07-16 (checkpoint 23, bugs reset password + créneaux RDV traités)

## Vue d'ensemble
SaaS Hono/TypeScript + Cloudflare (Pages + D1 + R2) multi-tenant de gestion pour centres de réparation GSM. Repo : `izigsm/webapp/` (racine git), remote GitHub `zinside69/izigsm_NG_temp_analysis`, branche `main`. Suite directe du checkpoint 22 (lots A-D déployés) : traite les 2 derniers bugs connus + 1 bug annexe découvert en cours de route.

## Ce qui a été fait ce checkpoint (23)

**E. Reset password jamais envoyé — commité, pushé, déployé (`2dbb297`), validé en prod avec envoi réel**
- `sendResetPasswordEmail()` (nouveau, `emailService.ts`) remplace l'appel `sendEmail()` mal paramétré dans `routes/auth.ts` — même modèle que `sendOtpInscription()` (email système, clé Resend globale, pas de `boutique_id`)
- `tsc` : erreur historique `Expected 1 arguments, but got 5` disparue
- **Validé en prod le 2026-07-16** : `POST /api/auth/reset-password-request` avec `telnet@bbox.fr` (compte réel, sur confirmation explicite utilisateur) → email de réinitialisation réellement reçu, confirmé par l'utilisateur. Flux fonctionnel de bout en bout.

**F. Créneaux RDV bookables (`boutique_creneaux` vide) — commité, pushé, déployé (`2dbb297`)**
- `src/services/creneauxService.ts` (nouveau) + `GET`/`PUT /api/boutiques/:id/creneaux` (`routes/boutiques.ts`) + onglet "Horaires RDV" dans `settings.html` (grille 7 jours, plages multiples)
- 12 tests nouveaux (`tests/creneauxService.test.ts`, 0 test existant avant)
- **Cycle complet validé en local live** : API (GET vide→PUT→GET) + `getDisponibilites()` publique confirme 14 créneaux générés pour un lundi type + round-trip navigateur réel (compte manager boutique 2, ajout plage, "✅ Planning enregistré")

**G. Bug annexe — `settings.html` entier cassé depuis la migration ApiService→apiGet — commité, pushé, déployé (`2dbb297`)**
- 10 sites (`r.success`/`r.data` au lieu de `r.data.success`/`r.data.data`) — les 5 onglets existants (Boutique, Numérotation, Facturation, Paiements, Emails) ne préaffichaient jamais les valeurs réelles et le toast de sauvegarde affichait toujours "❌ échec" même en cas de succès, depuis le commit `a62c4fd`. Risque réel avant fix : écraser des vraies données par des champs vides en sauvegardant un onglet jamais pré-rempli.

Détail complet des 3 items dans `todo.md` § Checkpoint 23 et `bugs.md`.

## État git à la fin de ce checkpoint
`tsc --noEmit` : aucune nouvelle erreur (2 pré-existantes `auth.ts:335`/`622`, sans lien, confirmées `git stash`). Tests 803/805 (12 nouveaux, mêmes 2 échecs pré-existants `computeFin()`). Lots E, F, G commités (`2dbb297`), pushés et déployés (`repairdesk.fr/api/health` → 200 après déploiement). Working tree propre (hors archive `izigsm_v2.45.0_backup_2026-07-16.zip`, non trackée intentionnellement).

## Prochaines étapes recommandées
1. Reste ouvert : limite admin `boutique_id: null` sur endpoints photos, dette technique diverse — voir `bugs.md`/`todo.md`

---

# Recovery Prompt — iziGSM — 2026-07-16 (checkpoint 22, lot C déployé)

## Vue d'ensemble
SaaS Hono/TypeScript + Cloudflare (Pages + D1 + R2) multi-tenant de gestion pour centres de réparation GSM. Repo : `izigsm/webapp/` (racine git), remote GitHub `zinside69/izigsm_NG_temp_analysis`, branche `main`. Chantier Ports & Adapters terminé et déployé depuis le checkpoint 21. Ce checkpoint (22) couvre 3 lots distincts sur l'écran Prise en charge et la fiche Client.

## Ce qui a été fait ce checkpoint

**A. Prise en charge — autocomplete + schéma (déployé, commits `c30984e`/`03e384d`)**
- Bug corrigé : autocomplete Modèle ne renvoyait jamais rien (`res.data` vs `res.data.data`)
- Champ Marque : `<select>` 7 options → autocomplete sur 126 marques réelles
- Grille schéma déverrouillage 9 points (État & Sécurité) — stockée dans `code_deverrouillage` existant, pas de migration
- Faille XSS corrigée (onclick interpolé dans les 2 autocompletes → `data-*`/listener délégué)
- `sw.js` v2.52→v2.53

**B. Fiche client type société (déployé, commit `f3938c5`, migration `0035` en prod)**
- Toggle particulier/professionnel + raison sociale/SIRET/TVA (migration additive, aucune perte de données)
- Autocomplete adresse via API BAN gouvernementale (`api-adresse.data.gouv.fr`, sans clé)
- Bug corrigé : `listClients()` ne renvoyait jamais adresse/code_postal (édition perdait ces champs)
- Sidebar : Clients remonté sous Tableau de bord
- `sw.js` v2.53→v2.54

**C. Recherche entreprise par SIRET — pushé et déployé le 2026-07-16**
- `recherche-entreprises.api.gouv.fr` (remplace l'ancienne API Sirene INSEE à clé), auto-déclenché à 14 chiffres
- Pré-remplit raison sociale/adresse/TVA (calculée depuis SIREN) sans écraser une saisie manuelle
- Validé en local avec un SIRET réel (DINUM), puis **rebasé sur `origin/main` sans conflit** (commit auto `3d05bab` chore backup D1 intercalé), pushé (`a25c472`), buildé et déployé (`wrangler pages deploy dist --project-name izigsm`)
- **Validé en prod le 2026-07-16** (Claude in Chrome, `admin@izigsm.fr`, même SIRET DINUM `13002526500013`) : toast "Fiche entreprise trouvée et pré-remplie", raison sociale/adresse/code postal/ville/TVA (`FR07130025265`) tous corrects, round-trip complet confirmé

**D. Fix sécurité — isolation photos tickets (corrigé, testé, commité, pushé et déployé le 2026-07-16, commit `506990f`)**
- `GET`/`POST /api/tickets/:id/photos` (`routes/tickets.ts`) appelaient `getBoutiqueId(c)` (contexte Hono seul) au lieu de `getBoutiqueId(user, queryBoutiqueId)` — l'isolation multi-tenant ne se déclenchait jamais (bug ouvert depuis le checkpoint 21)
- Fix : même pattern que `/photos/:photoId/url` (déjà correct), condition durcie en deny-by-default
- **Test d'isolation dédié en local live** : technicien boutique 2 → 403 sur ticket boutique 1 (avant fix : 200, faille reproduite) ; accès légitime toujours 200 ; `tsc`/tests 791/793 inchangés
- Limite découverte (non corrigée, hors périmètre) : `admin@izigsm.fr` a `boutique_id: null`, reçoit désormais 403 sur ces 3 endpoints photos sans `boutique_id` explicite — déjà le cas pour `/url` depuis le 2026-07-15, pas une régression. Détail `bugs.md`.

Détail complet dans `todo.md` § Checkpoint 22 et `bugs.md` (3 bugs documentés le 2026-07-15 + 1 corrigé le 2026-07-16).

## État git à la fin de ce checkpoint
Les lots A, B, C et D sont tous sur `origin/main` et déployés en prod (`repairdesk.fr/api/health` → 200 après déploiement du lot D, commit `506990f`). Working tree propre (hors archive `izigsm_v2.45.0_backup_2026-07-16.zip`, non trackée intentionnellement). Tests 791/793 sur toute la session (2 échecs pré-existants `computeFin()`).

## Prochaines étapes recommandées
1. Reste ouvert : reset password jamais envoyé, `boutique_creneaux` vide, limite admin `boutique_id: null` sur endpoints photos — voir `bugs.md`
2. Mettre à jour ces 4 fichiers project-docs si un nouveau chantier démarre (checkpoint 23)

---

# Recovery Prompt — iziGSM — 2026-07-15 (checkpoint 21)

## Vue d'ensemble
SaaS Hono/TypeScript + Cloudflare (Pages + D1 + R2) multi-tenant de gestion pour centres de réparation GSM. Repo : `izigsm/webapp/` (racine git), remote GitHub `zinside69/izigsm_NG_temp_analysis`, branche `main`. Le chantier Ports & Adapters (démarré 2026-07-12) est **terminé et déployé en production** depuis le 2026-07-15.

## Architecture actuelle
- Backend Hono/TypeScript sur Cloudflare Workers, pattern Controller (`routes/`) → Service (`services/`) → jamais de SQL inline dans une route
- **Pattern Ports & Adapters, chantier complet et déployé** : `src/ports/database.ts` (interface `Database`) + `src/adapters/cloudflare/d1Database.ts`, injecté via `src/index.tsx` (`c.set('db', new D1DatabaseAdapter(c.env.DB))`), lu via `c.get('db')`. 20/20 services passés par le chantier, chacun migré au moins partiellement (règle constante : toute fonction dépendant d'`auditLog()`/`nextNumero()`/`enregistrerTransaction()`/`db.batch()` reste sur `D1Database` brut).
- **`src/lib/timezone.ts`** : `parseUtcTimestamp()`/`todayParis()`/`currentMonthParis()`, appliqués partout où une borne "aujourd'hui" dépendait de `DATE('now')`/`new Date()` ambigu. Détail service par service dans `todo.md`.
- **`src/lib/photoToken.ts`** (nouveau, 2026-07-15) : jetons HMAC-SHA256 courte durée (5 min) pour l'accès direct aux photos de tickets via `<img src>` (qui ne peut jamais porter de header `Authorization`). Émis par `GET /api/tickets/:id/photos/:photoId/url` (authentifié), consommés par `GET /api/photo-view/:token` (public, `index.tsx`, hors `authMiddleware` — même pattern que la route iCal publique).

## Déploiement — état réel (important, corrige les checkpoints précédents)
**Tout est déployé en production** (`repairdesk.fr`) depuis le 2026-07-15 : les checkpoints 6 à 20 (chantier Ports & Adapters complet) ont été buildés et déployés (`wrangler pages deploy`), plus une série de correctifs post-déploiement trouvés par test utilisateur réel (`telnet@bbox.fr`) :
- Auth frontend cassée (token photo/archivage vide, refresh JWT jamais fonctionnel)
- Impression fiche ticket, changement de statut, création de ticket non persistée
- Vignettes/lightbox photos 401 silencieux + fiche détail vidée (mauvais noms de champs API)
- `openLightbox()` manquée au premier correctif (oubli), puis corrigée
- Jeton signé courte durée pour les photos (remplace le blob+fetch, ce checkpoint)

`sw.js` `CACHE_VERSION` bumpée à chaque déploiement (`v2.45` → `v2.52` sur cette session) pour forcer l'invalidation du cache App Shell.

## Bug de sécurité ouvert — priorité à évaluer avec l'utilisateur
`GET`/`POST /api/tickets/:id/photos` (`routes/tickets.ts`) appellent `getBoutiqueId(c)` avec un seul argument (le contexte Hono) au lieu de `(user, paramBoutiqueId)` attendu par `lib/middleware.ts`. Confirmé par `tsc --noEmit` (erreur de type, pas juste suspecté) : `user` reçoit le contexte Hono entier, `user.role`/`user.boutique_id` valent `undefined`, la garde d'isolation `if (boutiqueId && ticket.boutique_id !== ...)` ne se déclenche jamais. **Impact potentiel : un utilisateur authentifié pourrait lister/uploader des photos sur un ticket d'une autre boutique en devinant son ID.** Le nouvel endpoint `/url` (jeton signé) utilise le bon pattern et n'est pas concerné. Détail complet dans `bugs.md` — mérite un test d'isolation dédié avant tout déploiement du fix (pas un correctif de passage).

## Autres bugs connus non corrigés (détail complet `bugs.md`)
- `routes/auth.ts:481` — `sendEmail()` appelée avec une arité incorrecte, email de réinitialisation mot de passe jamais envoyé. Nécessite une décision de conception (adapter `sendEmail()` vs nouveau helper système).
- `computeFin()` (`agendaService.ts`) — `new Date(debut)` sans suffixe fuseau, ambigu hors UTC. Sans impact prod (Workers = UTC). 2 tests non-bloquants.
- `boutique_creneaux` vide, aucune UI de config → prise de RDV en ligne sans créneaux
- `www.repairdesk.fr` → 521 (Gandi, hors de notre contrôle)
- `/factures/:id/emettre` n'envoie aucun email
- `populateTechniciens()` liste tous les rôles, pas seulement les techniciens

## Contraintes
- Ne jamais toucher aux records MX/SPF/webmail de `repairdesk.fr`
- Ne jamais faire transiter de secret en clair dans la conversation
- Commenter systématiquement le code ajouté (JSDoc backend expliquant le rôle architectural)
- Ne jamais ajouter `Co-Authored-By: Claude` dans les commits
- Toujours proposer avant modification/suppression de fichier existant
- Migrations de schéma touchant `factures`/`avoirs`/`journal_nf525` (NF525) → validation explicite obligatoire avant exécution
- Bandeaux `════` pour les regroupements logiques d'endpoints dans les fichiers routes

## État git au moment de ce checkpoint
Tout commité et pushé sur `origin/main` (dernier commit du fix photo token). Working tree propre après ce checkpoint. Suite de tests : 791/793 (2 échecs pré-existants confirmés, `computeFin()` sensible au fuseau machine, sans impact production).

## Prochaines étapes recommandées
1. **Décider de la priorité du bug d'isolation photos** (`getBoutiqueId(c)` mal appelé) — recommandé avant tout usage multi-boutiques actif sur ces 2 endpoints spécifiques
2. Traiter les autres bugs non corrigés si prioritaires (reset password, `computeFin`)
3. Hors chantier Ports & Adapters : purge RGPD automatique, multi-sites géré, rebranding "Mon Atelier"→"MyDesk", programme de parrainage — voir `todo.md`
4. Si la bascule VPS/Postgres est engagée un jour : adaptateur `PostgresDatabase` + traduction des dialectes SQLite-only (`julianday()`, `datetime('now', ...)`, `||`, `INSERT ... RETURNING`) — documenté comme limite connue dans `bugs.md`
