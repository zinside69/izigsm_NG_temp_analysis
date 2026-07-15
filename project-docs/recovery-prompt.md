# Recovery Prompt — iziGSM — 2026-07-15 (checkpoint 22)

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

**C. Recherche entreprise par SIRET — commité, PAS déployé, PAS pushé**
- `recherche-entreprises.api.gouv.fr` (remplace l'ancienne API Sirene INSEE à clé), auto-déclenché à 14 chiffres
- Pré-remplit raison sociale/adresse/TVA (calculée depuis SIREN) sans écraser une saisie manuelle
- Validé en local avec un SIRET réel (DINUM). **L'utilisateur pousse lui-même depuis son terminal ("je ferai le push sur le terminal") et déploiera plus tard ("on déploiera plus tard")** — ne pas pousser ni déployer ce commit sans qu'il le redemande explicitement.

Détail complet dans `todo.md` § Checkpoint 22 et `bugs.md` (3 bugs documentés ce jour).

## État git à la fin de ce checkpoint
Le lot C (recherche SIRET + mise à jour de ces 4 fichiers project-docs) est **commité localement, pas pushé** — geste volontaire de l'utilisateur. Les lots A et B sont déjà sur `origin/main` et déployés en prod. Tests 791/793 sur toute la session (2 échecs pré-existants `computeFin()`).

## Prochaines étapes recommandées
1. L'utilisateur pousse le commit du lot C depuis son terminal quand il le souhaite
2. Déploiement du lot C (build + `wrangler pages deploy`) à faire plus tard, sur demande explicite — pas de migration DB requise pour ce lot (pur frontend)
3. Reste ouvert : bug isolation photos (`getBoutiqueId(c)`), reset password jamais envoyé, `boutique_creneaux` vide — voir `bugs.md`

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
