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
