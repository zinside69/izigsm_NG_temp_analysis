# Recovery Prompt — iziGSM — 2026-07-30 (checkpoint 64 — création manuelle de facture + socle facture électronique)

## ⚠️ EN ATTENTE D'UNE ACTION HUMAINE — à traiter avant tout nouveau chantier

Deux points bloquants hérités du checkpoint 64, tous deux non automatisables :

1. **Vérifier par une impression réelle que la facture tient sur une seule page A4.**
   Non vérifiable par un agent : `window.print()` et Ctrl+P ouvrent une modale navigateur qui fige toute session pilotée, et mesurer une hauteur hors contexte d'impression réelle donne des chiffres trompeurs (`CLAUDE.md` § Documents imprimables). Le garde-fou automatique `.print-compact` de `_triggerPrint()` (`app.js`, partagé tickets/factures/devis) est censé absorber le contenu ajouté au checkpoint 64 — ventilation TVA par taux, mentions légales, identités figées — mais personne ne l'a constaté sur une vraie impression. **À faire avant le déploiement.**

2. **Décider et exécuter le déploiement — dans le bon ordre.**
   Rien n'a été déployé au checkpoint 64. La migration `0037` doit être appliquée **à distance avant** le déploiement du Worker :
   ```bash
   npx wrangler d1 migrations apply DB --remote
   npm run deploy
   ```
   L'ordre inverse fait échouer en production **toute** émission de facture (`no such column: vendeur_snapshot`) : `POST /factures/:id/emettre`, `POST /api/factures` en `emettre`/`emettre_encaisser`, la création en brouillon (`date_execution`) et la conversion de devis. Voir `CLAUDE.md` § Déploiement.
   Rappel : le déploiement n'est **jamais** automatique sur ce projet, il exige une confirmation explicite de l'utilisateur.

## Vue d'ensemble (checkpoint 64)
SaaS Hono/TypeScript + Cloudflare (Pages + D1 + R2) multi-tenant, `izigsm/webapp/`, branche `main`. Deuxième et dernière « fonctionnalité entière hors service » de l'audit de persistance du 2026-07-30 : la création manuelle de facture. Chantier complet `superpowers:brainstorming` → `writing-plans` → `subagent-driven-development` (9 tâches, 28 commits, branche mergée sur `main` puis supprimée).

*(Le checkpoint 63 — fix `personnel.html`, commit `385c171` : balise `app.js` manquante + pattern `r.success`/`r.data` sur 4 appels — n'avait pas généré d'entrée ici ; comblé rétroactivement à ce checkpoint.)*

## Ce qui a été fait
1. **`POST /api/factures` créé** — l'endpoint n'existait pas, le modal postait dans le vide depuis toujours. `createFacture()` (`factureService.ts`) avec 3 actions (`brouillon`/`emettre`/`emettre_encaisser`), validation intégrale **avant** `nextNumero()`, isolation vérifiée à l'écriture sur `client_id` et `ticket_id`.
2. **Migration `0037`** — socle de la facture électronique (réforme 01/09/2026) : `date_execution`, `vendeur_snapshot`, `acheteur_snapshot`, figés dans `emettreFacture()` (point de passage unique des 3 chemins de création). Corrige au passage un défaut d'immuabilité préexistant : une facture verrouillée NF525 lisait les fiches client/boutique **vivantes**.
3. **Faille d'isolation refermée** sur `PUT /devis/:id/convertir` — conversion cross-boutique possible, démontrée en `200` avant correctif, 2 tests Playwright ajoutés (`bugs.md`).
4. **Modal et document refaits** — signature morte et statut muet retirés, TVA par ligne, date d'exécution, 3 actions explicites, fallback localStorage supprimé (il fabriquait de faux numéros de facture côté client) ; ventilation TVA par taux, mentions légales, identités figées, 2 décimales, `mention_facture` enfin rendue.

## Décisions structurantes
- Régime de franchise TVA **déduit** de `boutique_settings.tva_taux_defaut === 0` — aucune colonne dédiée, le paramétrage existait déjà et était déjà multi-tenant.
- Snapshot posé à l'**émission**, jamais à la création : c'est le moment où le document devient inaltérable, et le seul point commun aux 3 chemins.
- Sur le chemin devis, l'encaissement relit le `total_ttc` **de la facture créée** et non celui du devis — `convertirDevis()` déduit un acompte antérieur.
- Format structuré UBL/CII et raccordement PDP explicitement **hors périmètre** : ce chantier capture et fige les données, il ne les transmet pas.

## Prochaines étapes recommandées
1. **Dette d'isolation sur 5 endpoints facture/avoir** (`todo.md`, priorité critique) — dont `POST /factures/:id/emettre` qui verrouille définitivement la facture d'une autre boutique et écrit dans son journal NF525. Même classe que les failles tickets de juillet.
2. Encaissement sur facture verrouillée (décidé, non implémenté) — sans lui, « j'émets puis le client paie » reste impossible.
3. Facturation automatique à la clôture du ticket (cadrée avec 3 décisions utilisateur).
4. Vérifier la tenue sur une page A4 par une **impression réelle** (non automatisable) avant tout déploiement.
5. Déploiement : `npx wrangler d1 migrations apply DB --remote` **avant** `npm run deploy` — l'inverse casse toute émission de facture en production.

---

# Recovery Prompt — iziGSM — 2026-07-30 (checkpoint 62 — backfill checkpoints, 4 fixes prise en charge/clients, incident CDN, audit persistance complet)

## Vue d'ensemble (checkpoint 62)
SaaS Hono/TypeScript + Cloudflare (Pages + D1 + R2) multi-tenant, `izigsm/webapp/`, branche `main`. Suite du checkpoint 61 (audit rétroactif du protocole checkpoint). Session la plus dense depuis longtemps — 6 chantiers enchaînés en une session.

## Ce qui a été fait
1. **Backfill `recovery-prompt.md`** (22 checkpoints 29-56 reconstruits depuis `current-state.md` + `git log`) — `92ff9df`. 4 invariants remontés dans `CLAUDE.md`/`decisions.md`/`bugs.md`/`loop-runbook.md` (MyDesk rebranding, piège worktree sandbox, fix gates Playwright/tsc, piège `docs/*.pdf` gitignorés).
2. **3 tâches simples corrigées** — `1898da7` : JSDoc MyDesk (`auth.ts`), FontAwesome manquant sur `clients.html` (toutes icônes invisibles), filtre modèle smartphone ignorant la marque sélectionnée.
3. **Bug prise en charge → fiche client** — `71a87a2` : email/téléphone retapés sur un client existant n'étaient jamais reportés sur `clients.email`/`clients.telephone`, restaient piégés sur le ticket seul. Fix : relecture + fusion complète de la fiche client (jamais un objet partiel, risque d'écrasement sinon).
4. **Fiche client obligatoire + autocomplete Raison sociale** — `f84c2e1`, `9e1e82b` : tous les champs obligatoires sauf Notes ; volet Pro : SIRET obligatoire + autocomplete via `recherche-entreprises.api.gouv.fr` (réutilise l'API déjà en place), TVA intracom auto-calculée.
5. **Incident production résolu** — `2bdb4a2` : cache CDN Cloudflare figé sur une mauvaise réponse (200+HTML au lieu du JS) pour `clients.f2fcc753.js`, suite à une course de propagation post-déploiement sur un asset `immutable`. Purge API impossible (permission manquante), fix par changement de hash forcé. Documenté `bugs.md` avec recommandation structurelle (exclure `/static/*` du catch-all SPA) non implémentée.
6. **Audit complet de persistance des champs** (3 subagents parallèles, lecture seule, 22 pages) déclenché par la découverte que `t-imei` (prise en charge) est silencieusement jeté (aucune colonne `imei` sur `tickets`). Rapport : `project-docs/audit-persistance-2026-07-30.md` (`86e5269`), intégré en priorité 1 dans `todo.md` (`0cd436e`).

## Décisions prises
- IMEI : validation format/checksum locale (Luhn), pas d'API tierce payante. IMEI obligatoire uniquement si type d'appareil = smartphone (tablette/PC n'en ont pas).
- Multi-appareils par ticket : déprioritisé en P2 (décision explicite utilisateur ce jour), reconfirmé pertinent par la doc monatelier.net mais pas urgent.
- QualiRépar → vraie API EcoSystem (Fonds Réparation) : passera par `superpowers:brainstorming` avant tout code (chantier non trivial). Utilisateur confirme avoir/pouvoir obtenir des identifiants API réels.

## État courant
Working tree propre, tout commité et poussé sur `main`/origin. Rien de cassé en prod actuellement (incident CDN résolu et vérifié). Deux fonctionnalités entières découvertes hors service par l'audit (`factures.html` création manuelle, `personnel.html` page entière) — **pas encore corrigées**, juste documentées.

## Tâches en attente
- [ ] `superpowers:brainstorming` sur QualiRépar → vraie API EcoSystem — **ne pas démarrer avant que l'utilisateur le redemande explicitement** (il a explicitement mis en pause pour faire ce checkpoint d'abord)
- [ ] `todo.md` § "🔴 P1 — Audit persistance des champs" — rien corrigé, tout reste à faire. Ordre recommandé : `factures.html` (endpoint manquant) → `personnel.html` (app.js non chargé) → `t-imei` → `t-priority` création → 3 fichiers `r.success`/`r.data` (`reconditionnement.js`/`fournisseurs.js`/`caisse.js`) → reste (stock-notes, stock-qty édition, modele-marque-id édition, remise caisse, devise settings, 5 champs agenda)
- [ ] Champ IMEI/N° de série à scoper ensemble avec le fix du bug `t-imei` de l'audit (migration DB nécessaire : colonnes `imei`+`numero_serie` sur `tickets`,+ probablement `appareil_type` pour savoir si IMEI doit être obligatoire)
- [ ] Recommandation structurelle incident CDN (exclure `/static/*` du catch-all SPA `src/index.tsx`) — non implémentée

## Bugs connus
Voir `bugs.md` pour le détail complet du nouvel incident CDN (résolu) et `audit-persistance-2026-07-30.md` pour tous les bugs de persistance trouvés ce jour (aucun corrigé à ce stade).

## Contraintes
Toujours valables : DNS mail Gandi (jamais toucher sans confirmation explicite), pas de secret en clair, commenter le code ajouté, jamais de `Co-Authored-By: Claude`, proposer avant modif/suppression, migrations NF525 = validation explicite, déploiement toujours sur confirmation explicite (et souvent bloqué par le classificateur auto-mode pour `npm run deploy` — l'utilisateur le fait alors manuellement).

## Prochaines étapes recommandées
1. Attendre que l'utilisateur relance le brainstorming QualiRépar (mis en pause volontairement pour ce checkpoint)
2. Une fois repris : `superpowers:brainstorming` → `writing-plans` → implémentation (nouveau service + table DB + frontend + auth tiers)
3. En parallèle ou après : commencer à traiter `todo.md` § P1 dans l'ordre recommandé, en commençant par les 2 fonctionnalités entières hors service (`factures.html`, `personnel.html`) qui ont l'impact métier le plus large

---

# Recovery Prompt — iziGSM — 2026-07-25 (checkpoint 61 — audit rétroactif protocole checkpoint + clôture session refonte A4)

## Vue d'ensemble (checkpoint 61)
Suite directe du checkpoint 57 (refonte A4 déployée + fix débordement 2 pages + spec logo boutique, voir entrée ci-dessous). Cette entrée couvre uniquement l'audit rétroactif du protocole checkpoint lui-même, demandé par l'utilisateur après vérification que le checkpoint 57 était incomplet.

## Ce qui a été fait
- Audit de `CLAUDE.md` vs `decisions.md`/`bugs.md` : 4 invariants manquants ajoutés (DNS `repairdesk.fr`, 2 docs obsolètes à ignorer — `ARCHITECTURAL_PRINCIPLES.md`/`ARCHITECTURE_MODULES.md` §2 —, portabilité SQL du port `Database`)
- Mémoire persistante (`project_izigsm_migration.md`) : trou de 10 jours comblé (checkpoints ~16-56 synthétisés)
- Nouveau fichier mémoire `feedback_checkpoint_protocol.md` : enregistre la règle "checkpoint = protocole complet, jamais partiel"
- `todo.md` : trou `recovery-prompt.md` (checkpoints 29-30, 33-34, 38, 40-56 manquants) tracé pour backfill futur, décision explicite de ne pas le faire maintenant (coût contexte)

## Décisions prises
- Ne pas backfiller les ~17 checkpoints manquants de `recovery-prompt.md` dans cette session (contexte déjà très chargé en fin de session dense) → tracé dans `todo.md`, session dédiée recommandée
- Règle actée : tout futur `/context-guardian checkpoint` sur ce projet doit toucher systématiquement current-state.md + recovery-prompt.md + CLAUDE.md (si nouvel invariant) + mémoire persistante (si changement d'état significatif), jamais un sous-ensemble présenté comme complet

## État courant
Chantier refonte A4 intégralement clos (déployé, validé). Chantier logo boutique + impression devis au stade spec approuvée. Aucun bug ouvert nouveau. Working tree propre, tout poussé sur origin/main.

## Tâches en attente
- [ ] `superpowers:writing-plans` sur `docs/superpowers/specs/2026-07-25-logo-boutique-multi-tenant-design.md` — priorité haute (prochain chantier)
- [ ] Backfill `recovery-prompt.md` (checkpoints 29-30, 33-34, 38, 40-56) — priorité moyenne, session dédiée
- [ ] `todo.md` § impression A4/thermique : options de récupération (texte utilisateur), format thermique (techno), email auto, facturation HT/TTC — priorité moyenne

## Bugs connus
Aucun nouveau depuis checkpoint 57 (voir `bugs.md` pour l'historique complet — print.css cassé par cache-busting et débordement 2 pages, tous deux corrigés et validés le 2026-07-25).

## Contraintes
Voir checkpoint 21 ci-dessous (contraintes générales toujours valables : DNS mail Gandi, pas de secret en clair, commenter le code ajouté, jamais de `Co-Authored-By: Claude`, proposer avant modif/suppression, migrations NF525 = validation explicite).

## Prochaines étapes recommandées
1. `superpowers:writing-plans` sur la spec logo boutique/devis, puis implémentation
2. Quand le contexte le permet : session dédiée backfill `recovery-prompt.md`
3. Reste du chantier impression A4/thermique (voir `todo.md`)

---

# Recovery Prompt — iziGSM — 2026-07-25 (checkpoint 57 — refonte A4 déployée + fix débordement 2 pages + spec logo boutique)

## Vue d'ensemble (checkpoint 57)
SaaS Hono/TypeScript + Cloudflare (Pages + D1 + R2) multi-tenant. Repo `izigsm/webapp/`, branche `main`. Session dédiée à la refonte visuelle de la fiche A4 ticket (brainstorming → plan → subagent-driven-development), avec deux incidents de production trouvés et corrigés en aval, et une nouvelle spec écrite pour la suite.

**Chantier A4 livré et déployé** : système visuel sans aplat noir/indigo/bleu (accent gris ardoise `#334155`, inspiré de `docs/modele-facture.pdf`), en-tête prêt pour logo boutique multi-tenant (texte en fallback), fallback "Non renseigné" sur l'état à l'entrée, mention CGV en pied de page. `todo.md:10` clos, décision de branding dans `decisions.md`.

**Bug 1 trouvé en validation** : `_buildTicketA4HTML()`/`_buildTicketThermique3VoletsHTML()`/`_buildFactureHTML()` référençaient `/static/css/print.css` en dur — cassé silencieusement par le chantier cache-busting (checkpoint 53, 2026-07-24) car `rewriteStaticReferences()` ne réécrit que les `.html`/`sw.js`, jamais les chaînes dans un `.js`. Fiches imprimées sans aucun style depuis le 2026-07-24. Fix : `_resolveStaticHref()` (nouvelle fonction centralisée dans `app.js`, résout le nom hashé via `dist/static/manifest.json` au runtime) — **pattern à réutiliser pour toute future référence `/static/...` codée en dur dans un template JS**, voir `CLAUDE.md` § invariants mis à jour ce checkpoint.

**Bug 2 trouvé après le 1er déploiement** (`v2.72`) : capture d'écran utilisateur montrant la fiche A4 débordant sur 2 pages (ticket réel dense). Root cause (`systematic-debugging`) : marges jamais validées sur contenu dense + absence de règle `@page` (marges navigateur non neutralisées, s'ajoutaient au padding interne). Fix à deux niveaux : resserrage statique (marges/paddings réduits, cadres retirés sur les encarts) + **garde-fou dynamique** dans `_triggerPrint()` (`app.js`, partagé tickets+factures) qui mesure la hauteur réelle avant impression et bascule en `.print-compact` si le contenu dépasse 290mm — garantie "jamais 2 pages" valable pour tout contenu futur, pas seulement le cas observé. Redéployé (`v2.73`), **validation confirmée par l'utilisateur en prod réelle**.

**Collision loop-engineering notée** : pousser spec+plan sur `main` avant la fin du chantier interactif a fait re-interpréter la tâche comme "implémentable" par le run planifié suivant (10:00), qui a échoué en laissant `main` temporairement sale (récupéré par `git stash`, aucune perte). Détail complet + recommandation non implémentée (marqueur "en cours de traitement humain" pour `pick-task.mjs`) dans `decisions.md`.

**Spec écrite, pas encore implémentée** : `docs/superpowers/specs/2026-07-25-logo-boutique-multi-tenant-design.md` — upload logo boutique vers R2 (URL publique stable `GET /api/public/logo/:boutiqueId`), UI `settings.html` onglet Boutique, **+ nouvelle fonctionnalité impression devis** (`_buildDevisHTML()` — `devis.js` n'avait aucune fonction d'impression admin avant ce chantier, ajouté en cours de session sur demande explicite de l'utilisateur).

## État git à la fin de ce checkpoint
Tout commité et poussé sur `main`/origin (dernier commit `81d5804`). Code A4 + les 2 fixs déployés et validés en prod (`repairdesk.fr`, `CACHE_VERSION izigsm-v2.73`). Spec logo boutique écrite/committée, pas encore planifiée ni implémentée.

## Prochaines étapes recommandées
1. `superpowers:writing-plans` sur `docs/superpowers/specs/2026-07-25-logo-boutique-multi-tenant-design.md`, puis `subagent-driven-development` pour l'implémentation
2. `todo.md` § chantier impression A4/thermique : reste "options de récupération" (texte à valider avec l'utilisateur, pas à inventer), format thermique (techno d'impression non tranchée), email auto à l'impression, facturation HT/TTC par boutique
3. Envisager le marqueur anti-collision loop-engineering (`decisions.md`, non fait ce checkpoint)

---

# Recovery Prompt — iziGSM — 2026-07-25 (checkpoint 56 — loop-engineering : IMEI/N° série fiche A4, déjà implémenté)
*(Entrée reconstruite rétroactivement le 2026-07-30 depuis `current-state.md` + `git log` — voir `todo.md` § Backfill recovery-prompt.md)*

Run loop-engineering, `todo.md:19` sélectionnée. Vérification directe du code : `_buildTicketA4HTML()` affiche déjà IMEI et N° Série (`tickets.js:764-765`, alimentés par la jointure `appareils`). Case obsolète cochée, aucun code modifié, aucun worktree créé. Gates : vitest 833/835 relancé par prudence (baseline inchangée).

## État git
Commit doc `490d01f`/`a397a8b`.

---

# Recovery Prompt — iziGSM — 2026-07-25 (checkpoint 55 — loop-engineering : mise en page A4 vs PDF de référence, escaladé)
*(Entrée reconstruite rétroactivement le 2026-07-30)*

Run loop-engineering, `todo.md:10` (garder l'indigo actuel ou aligner sur le bleu marine/ambre du modèle `docs/bon de réparation.pdf`) — escaladé comme décision de branding/produit hors périmètre loop. **Découverte majeure, corrige le checkpoint 54** : `docs/bon de réparation.pdf` et `docs/test impression.pdf` existent réellement sur disque mais sont exclus par la règle générique `*.pdf` du `.gitignore`, donc invisibles à `git status`/`git ls-files` — le checkpoint 54 les avait déclarés absents à tort. Contenu analysé : bandeau bleu marine + encart ambre "Acompte versé" + signatures (PDF cible) vs système indigo actuel en prod. Aucun code modifié, escaladé pour décision humaine (options A/B documentées).

## État git
Commit doc `2b6d4c4`/`d0231fa`.

---

# Recovery Prompt — iziGSM — 2026-07-25 (checkpoint 54 — loop-engineering : audit initial contenu fiche A4, todo.md:7)
*(Entrée reconstruite rétroactivement le 2026-07-30)*

Run loop-engineering, `todo.md:7` — premier travail du chantier 🔴 impression A4/thermique (demandé 2026-07-24). Audit comparé (liste attendue vs `_buildTicketA4HTML()`) : description/client/réparateur/état matériel déjà présents ; **commentaires publics manquants** (aucun champ dédié dans le modèle de données, seul `notes_internes` existe et n'est jamais affiché — pas de fuite mais pas de contenu non plus). Observation complémentaire : `todo.md:11` (IMEI/N° série) déjà obsolète, à revérifier plutôt qu'à recoder (repris et confirmé au checkpoint 56). PDF de référence déclarés absents à tort (corrigé au checkpoint 55). Worktree `.claude/worktrees/audit-impression-a4` (chemin frère bloqué par le sandbox). Aucun code modifié.

## État git
Commit doc `fce1f83`/`4da507c`/`a772b1f`.

---

# Recovery Prompt — iziGSM — 2026-07-24 (checkpoint 53 — cache-busting par hash de contenu, chantier complet mergé sur main)
*(Entrée reconstruite rétroactivement le 2026-07-30)*

Chantier escaladé à répétition par la loop-engineering (architectural), traité en session humaine : `brainstorming` → `writing-plans` → `subagent-driven-development`. `public/static/js/*.js`/`*.css` désormais hashés par contenu au build (`scripts/build-hash-assets.mjs`), éliminant à la source l'incident de propagation CDN du 2026-07-18 (checkpoint 36). `dist/_headers` : cache long+immutable sur assets hashés, no-cache sur `sw.js`/HTML.

**3 régressions attrapées et corrigées avant merge** : retype `Buffer`→`Uint8Array` (régression tsc 32→235 erreurs, dépendance Node incompatible Workers), 2 bugs latents révélés par le nouveau garde-fou "échec bruyant" (CSS orphelines + `dist/` jamais vidé entre builds), bug CRLF Windows sur `scripts/build-hash-assets.mjs` (`.gitattributes` ajouté, `*.mjs text eol=lf`).

Revue finale (opus) : Ready to merge = Yes. Gates finaux : vitest 833/835, tsc 32 (baseline inchangée), Playwright 10/10, build idempotent vérifié (23 fichiers hashés × 2 runs).

## État git
Commits `0b0f793`→`021c19d` (10 commits : spec, plan, 3 tâches, 1 fix régression, corrections), doc `32d1aaf`. **Rien déployé** — `npm run deploy` reste un geste humain explicite.

---

# Recovery Prompt — iziGSM — 2026-07-24 (checkpoint 52 — loop-engineering : devis.js demanderAcompte() refresh manquant, escaladé)
*(Entrée reconstruite rétroactivement le 2026-07-30)*

Run loop-engineering, `todo.md:278` — `demanderAcompte()` (`devis.js`, dupliqué depuis `tickets.js`) ne rafraîchit jamais la fiche après un `POST /api/devis/:id/acompte` réussi (la branche de rafraîchissement post-succès ne couvre que `contextType === 'ticket'`). Fix identifié précisément (1 ligne : `if (contextType === 'devis' && entityId) openDevisDetail(entityId);`) mais **non appliqué** — escaladé par prudence : mot-clé "acompte" (catégorie Paiement de `loop-policy.md`) + signal graphe `sensitiveMatch:true` (auth/isolation/paiement) sur `devis.js`.

## État git
Aucun commit de code. Doc `dd322a3`.

---

# Recovery Prompt — iziGSM — 2026-07-24 (checkpoint 51 — loop-engineering : rebranding register.html « Mon Atelier » → « MyDesk », mergé)
*(Entrée reconstruite rétroactivement le 2026-07-30)*

Loop-engineering, `todo.md:228` — `public/register.html`, 5 occurrences (dont une reformulation non-triviale ligne 158, "Mon atelier est en Belgique"→"Mon entreprise est en Belgique", cohérente avec la terminologie du formulaire plutôt qu'un simple remplacement). `boutique_id`/tokens/logique credential intacts, vérifiés par lecture directe. Gates verts : vitest 824/826, tsc baseline inchangée, build OK, Playwright 10/10. `CACHE_VERSION` v2.69→v2.70.

## État git
Commit `4b5f195` mergé sur `main` (`git merge --ff-only`, poussé). Doc `65fd024`. Reste ouvert rebranding : `auth.ts` L229 (JSDoc, fichier sensible), audit pages internes L230.

---

# Recovery Prompt — iziGSM — 2026-07-24 (checkpoint 50 — loop-engineering : rebranding login.html « Mon Atelier » → « MyDesk », mergé)
*(Entrée reconstruite rétroactivement le 2026-07-30)*

Loop-engineering, `todo.md:227` — `public/login.html`, 5 littéraux (placeholder onboarding + fallback session `boutique_name`/`company` ×2). Ancienne branche `loop/rebrand-login-html-mydesk` (`76eb413`) 15 commits derrière `main` → réimplémentation propre plutôt que merge/rebase. `boutique_id`/tokens/OTP intacts. Gates verts, Playwright 10/10 (gate réparé au checkpoint 47). `CACHE_VERSION` v2.68→v2.69.

## État git
Commit `600ffa6` mergé sur `main`. Doc `a426ea3`. Reste ouvert : `register.html` L228, `auth.ts` L229.

---

# Recovery Prompt — iziGSM — 2026-07-24 (checkpoint 49 — loop-engineering : rebranding app.js « Mon Atelier » → « MyDesk », mergé)
*(Entrée reconstruite rétroactivement le 2026-07-30)*

Loop-engineering, `todo.md:225` — `public/static/js/app.js:27,424-425` (fallback `session.company`/`user.boutique_name`, 3 occurrences dans `buildSidebar()`/`storeSession()`). Tâche précédemment escaladée (checkpoint 45, branche `loop/rebrand-app-js-mydesk` non mergée) débloquée par la réparation du gate Playwright au checkpoint 47 (`d7c5ed1`) — changement de contexte légitime, pas une nouvelle tentative aveugle. Réimplémentation propre (ancienne branche 26 commits derrière `main`). Gates verts, Playwright 10/10. `CACHE_VERSION` v2.67→v2.68.

## État git
Commit `283c8c5` mergé sur `main`. Doc `ec0a038`. Reste ouvert : `login.html` L227, `register.html` L228, `auth.ts` L229.

---

# Recovery Prompt — iziGSM — 2026-07-24 (checkpoint 48 — loop-engineering : fiche imprimée utilise la boutique du ticket, pas la 1ère de la liste)
*(Entrée reconstruite rétroactivement le 2026-07-30)*

Loop-engineering, `todo.md:39` (bug mineur non bloquant, comptes admin uniquement) — `_fetchTicketPrintData()` prenait systématiquement `(GET /api/boutiques)[0]` au lieu de la boutique réelle du ticket. Corrigé via `GET /api/boutiques/:id` avec `t.boutique_id` (même patron que `settings.html`, isolation déjà en place côté route). **2 déviations procédurales signalées** : Étape 1bis (rafraîchissement graphe) exécutée après l'implémentation au lieu d'avant (par omission) ; travail fait directement sur `main` sans worktree isolé (diff trivial, gates tous verts avant commit, pas de risque matériel constaté mais à corriger). Gates verts, Playwright 10/10.

## État git
Commit `ece114d` + `ba3f81f` (`CACHE_VERSION` v2.66→v2.67, rattrapé en commit séparé) directement sur `main`. Doc `86604e0`.

---

# Recovery Prompt — iziGSM — 2026-07-24 (checkpoint 47 — loop-engineering : rebranding register.js « Mon Atelier » → « MyDesk » + gate Playwright réparé, mergé)
*(Entrée reconstruite rétroactivement le 2026-07-30)*

Loop-engineering, `todo.md:226` — repris après réparation des gates Windows par le commit `d7c5ed1` (`@playwright/test` jamais installé + `executablePath` codé en dur vers un chemin Linux inexistant + `typescript` jamais déclaré en devDependency, `npx tsc` exécutait un package factice npm). Cette réparation invalidait la raison d'escalade du run précédent (checkpoint 45) sans nécessiter de décision produit — traité comme changement de contexte légitime. `register.js:230-231` — fallback session `company_name || 'Mon Atelier'` → `'MyDesk'`. Réimplémentation propre sur branche fraîche (ancienne branche antérieure à `d7c5ed1`). Gates verts, **Playwright 10/10 (gate désormais exécutable pour la première fois)**. `CACHE_VERSION` v2.65→v2.66.

## État git
Commit `5506b73` mergé sur `main`. Doc `89c767e`. Reste ouvert : `app.js` L225 (candidat naturel du run suivant, traité checkpoint 49), `login.html` L227, `register.html` L228, `auth.ts` L229.

---

# Recovery Prompt — iziGSM — 2026-07-24 (checkpoint 46 — Graphify : chunks stale réparés, doublons fusionnés, lien QualiRépar↔ecosystem tracé)
*(Entrée reconstruite rétroactivement le 2026-07-30)*

Suite du graphe construit au checkpoint 40 — un `/graphify --update` du 2026-07-23 avait laissé `cache/semantic/` incohérent. **Chunk 11 (index)** retraité intégralement (tronqué par la coupure de quota du checkpoint 40 — ne couvrait que 1/8 PDF). **12 chunks (12-23)** vérifiés à tort suspectés stale (contenu légitimement minimal, favicon+icônes PWA) ; 2 vrais bugs schema corrigés (chunk_13 clé `"type"` au lieu de `"relation"`, chunk_23/`.graphify_detect.json` BOM UTF-8). **Chunk 10** : 11 nœuds doublons découverts et fusionnés (pas supprimés) vers les IDs canoniques du chunk 11. Graphe régénéré (2 passes) : 1937 nœuds/2752 liens, `graph.json`/`graph.html`/`GRAPH_REPORT.md`/vault Obsidian.

**Découverte annexe actionnable** : `public/qualirepar.js` est une simulation UI 100% locale (zéro `fetch()` vers l'API ecosystem réelle), jamais branchée sur le vrai workflow Fonds Réparation documenté dans les PDF partenaires — bonus calculé localement (`Math.min(amount*0.25, maxBonus)` codé en dur) plutôt que via `GET /catalog`.

## État git
Rien commité côté code applicatif (`graphify-out/` gitignoré). Doc `5bc0924`.

---

# Recovery Prompt — iziGSM — 2026-07-23 (checkpoint 45 — loop-engineering : rebranding register.js « Mon Atelier » → « MyDesk », escaladé)
*(Entrée reconstruite rétroactivement le 2026-07-30)*

Loop-engineering, `todo.md:226` — `register.js:230-231` (fallback session OTP `company_name || 'Mon Atelier'` → `'MyDesk'`). Contrôle OTP/tokens/`boutique_id` intacts, signal graphe `sensitiveMatch:false`. **Escaladé** : gate Playwright inexécutable sur Windows (`@playwright/test` non provisionné, `playwright.config.ts` cible un chemin chromium Linux CI) = condition dure L2 non satisfaite. Réparé ensuite au checkpoint 47 (`d7c5ed1`).

## État git
Commit `f029415` sur branche `loop/rebrand-register-js-mydesk`, **non mergé** (en attente jusqu'au checkpoint 47). Doc `fd0c95e`.

---

# Recovery Prompt — iziGSM — 2026-07-23 (checkpoint 44 — loop-engineering : case obsolète /robots.txt 500 Genspark réconciliée)
*(Entrée reconstruite rétroactivement le 2026-07-30)*

Loop-engineering, `todo.md:169` — Genspark abandonné depuis la migration Cloudflare (2026-07-10), le 500 spécifique à cet hébergeur est sans objet. Sur Cloudflare, `/robots.txt` renvoie 200 (asset statique `public/robots.txt` + route Hono de redondance `src/index.tsx:242`). Case cochée, **delta code nul**. **Constat durable noté** : sur cet environnement Windows, la loop ne peut auto-commiter aucun vrai changement de code tant que le gate Playwright n'est pas réparé (fait ensuite au checkpoint 47) — seules les réconciliations docs-only restent auto-committables jusque-là.

## État git
Docs uniquement, sur `main` directement (pas de worktree isolé — contrainte sandbox). Doc `f02c5a4`.

---

# Recovery Prompt — iziGSM — 2026-07-23 (checkpoint 43 — loop-engineering : case obsolète tests/phoneCatalogService.test.ts réconciliée)
*(Entrée reconstruite rétroactivement le 2026-07-30)*

Loop-engineering, `todo.md:168` — le fichier existe déjà depuis la migration Ports & Adapters (checkpoint 14, 2026-07-15) : 209 lignes, 11 tests couvrant les 5 fonctions de `phoneCatalogService.ts`. Case obsolète (même classe de décalage doc/code que le bug slug boutiques et la réconciliation r.success/r.data). Cochée, **delta code nul** (pas d'ajout de couverture supplémentaire — le sous-item plus large "0 test sur ~1500 lignes du fallback catalogue" reste hors scope, laissé décoché).

## État git
Docs uniquement, sur `main` directement. Doc `cb87767`/`8ee0a56`.

---

# Recovery Prompt — iziGSM — 2026-07-20 (checkpoint 42 — garde-fou anti-dump SKILL.md + collision git évitée avec un run planifié en cours)
*(Entrée reconstruite rétroactivement le 2026-07-30)*

Incident `alltasks.tmp.json` (29 Ko, dump `pick-task.mjs --all`) trouvé non suivi dans le working tree — bloquait le prochain run planifié dès l'Étape 0 (précondition working tree propre). Supprimé, pattern `*.tmp.json` ajouté au `.gitignore`. Garde-fou ajouté dans `SKILL.md` § Garde-fous globaux : toute investigation ponctuelle (dump/debug) doit rediriger hors du repo ou être nettoyée avant la fin du run. **Collision git évitée** : `git status` a révélé des changements déjà indexés par un run planifié actif (`.loop-lock` présent, ~13 min) — attente explicite de la disparition du lock plutôt que de committer par-dessus (le run planifié a terminé proprement de son côté, checkpoint 41).

## État git
Commit `9305d0b`. Doc `d4d710c`.

---

# Recovery Prompt — iziGSM — 2026-07-20 (checkpoint 41 — loop-engineering : docs/ARCHITECTURE_MODULES.md §2 noms de tables corrigés)
*(Entrée reconstruite rétroactivement le 2026-07-30)*

Loop-engineering, `todo.md:163` — 5 noms de tables obsolètes corrigés dans le tableau §2 "Schéma de base de données", chacun vérifié contre les vrais `CREATE TABLE` de `migrations/*.sql` : `statuts_historique`→`tickets_statuts_historique` (0004), `lignes_facture`→`lignes_document` (0006), `sessions_caisse`/`lignes_caisse`→`clotures_journalieres` (0008, les deux premiers noms n'existent dans aucune migration), `otp_codes`→`otp_tokens` (0009), `tickets_sav`→`sav_dossiers` (0019). Portée volontairement limitée aux noms erronés (pas d'ajout de complétude type migrations 0032-0036, éviterait le scope creep). Gates verts (docs-only, Playwright n/a).

## État git
Commit `2e6da16`. Doc `112d925`.

---

# Recovery Prompt — iziGSM — 2026-07-20 (checkpoint 40 — graphe de connaissance /graphify sur tout le repo + /approve Telegram validé)
*(Entrée reconstruite rétroactivement le 2026-07-30)*

`/graphify` lancé sur `izigsm/webapp` en entier (255 fichiers, ~1.63M mots) — 1867 nœuds, 2643 relations, 418 communautés, sorties dans `graphify-out/` (gitignoré) : `graph.json`, `graph.html`, `GRAPH_REPORT.md`, vault Obsidian (2282 notes). **Incident en cours de route** : la limite de dépense mensuelle du compte a coupé 24 sous-agents d'extraction en plein run (23/24 chunks sauvés malgré la coupure, 1 refait manuellement) ; fichiers temporaires Graphify non gitignorés au départ ont sali le working tree et fait échouer le run planifié suivant — corrigé (`.graphify_*`/`graphify-out/` ajoutés au `.gitignore`).

**Commande `/approve` validée en conditions réelles** (tâche déploiement groupé taguée `[loop-safe]` via Telegram) — sans effet pratique ici : `loop-policy.md` interdit tout `wrangler pages deploy` automatique quel que soit le tag, le prochain run qui la sélectionnerait devrait constater qu'il ne peut rien déployer et escalader. Les 4 commandes Telegram (`/status`, `/digest`, `/run`, `/approve`) désormais toutes confirmées en usage réel au moins une fois.

## État git
Doc `40fb393`.

---

# Recovery Prompt — iziGSM — 2026-07-20 (checkpoint 39 — loop-engineering pilotable à distance : Telegram + cadence horaire)

## Vue d'ensemble (checkpoint 39)
Suite du checkpoint 38 (loop-engineering mise en place au 37, premier commit auto réussi au 38). Session consacrée à rendre la loop **observable et pilotable sans session Claude Code ouverte** : bot Telegram (`iziGSM Loop Bot`), 3 tâches planifiées Windows tournant en parallèle.

**Ce qui a été construit** :
1. **Notifications** (`run-loop.ps1`) : message au démarrage (checkpoint backlog + tête de file visée) et à la fin (actions faites via `git log`, prochaine tâche) de chaque run — voir `loop-runbook.md` §9-10.
2. **Watchdog** (`scripts/loop/watchdog.ps1`, tâche « iziGSM Loop Watchdog », 30 min) : alerte si `.loop-lock` a plus de 60 min — silencieux sinon.
3. **Cadence horaire** : `iziGSM Loop Engineering` passée de 1x/jour à toutes les heures (`MultipleInstances=IgnoreNew`). Budget « 1 tâche/run » de `loop-policy.md` inchangé.
4. **Commandes Telegram** (`scripts/loop/telegram-listener.mjs`, tâche « iziGSM Loop Telegram Listener », polling 5 min) : `/status`, `/digest` (tâches complexes, purement informatif), `/run`, `/approve <id>` (tag `[loop-safe]` + commit/push), `/help`. Set fixe décidé explicitement — pas de prompt libre transmis à `claude -p` (voir `decisions.md` 2026-07-20).

**3 bugs trouvés et corrigés en route** (détail complet `bugs.md`) :
- Working tree sale (diff résiduel oublié) bloquait le run planifié du 09:30
- **Confiance workspace jamais acceptée** (`hasTrustDialogAccepted: false` pour `izigsm/webapp`) — bloquait tous les gates `node`/`npm` en session non-interactive, faisait escalader des runs pour de mauvaises raisons. Fix one-time : session interactive `claude` + accepter le dialogue.
- Dates PowerShell brutes (`/Date(...)/`) dans `/status` — corrigé (`.ToString()` avant `ConvertTo-Json`)

**2 runs réels validés de bout en bout** après le fix de confiance workspace : 1 escalade légitime (isolation multi-tenant, deep-link admin) + 1 commit réussi (réconciliation `todo.md` pattern `r.success`/`r.data`, checkpoint 38). Notifications Telegram confirmées reçues par l'utilisateur sur les deux, plus `/status` testé en conditions réelles.

**Reste ouvert pour une prochaine session** :
- `/digest` et `/approve <id>` **pas encore testés en conditions réelles** (seul `/status` confirmé fonctionnel) — à valider dès que possible
- Watchdog jamais déclenché sur un vrai run bloqué (testé uniquement à vide, comportement silencieux confirmé correct)
- 48 tâches ouvertes dans `todo.md`, majoritairement à risque élevé (isolation/NF525/paiement/migrations/architecture) — continueront d'escalader vers une session humaine quelle que soit la cadence de la loop ; chantier cache-busting (checkpoint 36) et deep-link admin (isolation) restent les 2 plus gros items en attente de décision humaine
- Si le dossier de travail change à nouveau (nouvelle machine/clone) : refaire le fix de confiance workspace avant de compter sur la tâche planifiée

## État git à la fin de ce checkpoint
Tout commité et pushé sur `main` (`d13976c`/`d87de2a` checkpoint 38, `6051332`, `a480f5d`, `7fb2436` — infra notifications/commandes Telegram de ce checkpoint). Aucun changement de code applicatif — uniquement infra loop-engineering + documentation.

---

# Recovery Prompt — iziGSM — 2026-07-20 (checkpoint 38 — loop-engineering : réconciliation backlog « pattern r.success/r.data »)
*(Entrée reconstruite rétroactivement le 2026-07-30 depuis `current-state.md` + `git log`)*

Run loop-engineering autonome (une tâche, de bout en bout). Après skips Étape 1 (cache-busting déjà escaladé, deep-link admin déjà escaladé), première tâche risque faible implémentable : audit de `agenda.js` fonction par fonction (`todo.md` § "Bug étendu — pattern r.success/r.data"). **Résultat : déjà corrigé** — le commit `c281411` (2026-07-17) avait déjà traité `agenda.js` (8 fonctions), `sav.js` (8 fonctions), `stats.html` (3+4 fonctions), validé en local live à l'époque. Seules les checkboxes `todo.md` étaient restées décochées (même décalage documentation/code que le bug slug boutiques `92f0db8`). Réconciliation documentaire uniquement, gates baseline vérifiés verts (vitest 824/826, tsc sans nouvelle erreur, build OK).

## État git
Commits `d13976c`/`d87de2a`.

---

# Recovery Prompt — iziGSM — 2026-07-19 (checkpoint 37 — faille isolation GET /api/tickets/:id corrigée et déployée)

## Vue d'ensemble (checkpoint 37)
Suite du checkpoint 36. La loop-engineering (automatisation autonome introduite ce jour-là, `project-docs/loop-policy.md`) a détecté via son gate Playwright (`tests/e2e/isolation.spec.ts`) une faille critique d'isolation multi-tenant : `GET /api/tickets/:id` n'avait aucune vérification `boutique_id`, permettant à n'importe quel compte de lire l'intégralité de n'importe quel ticket, toutes boutiques confondues (client, IMEI, diagnostic, facture d'acompte). Classée risque élevé par la politique L2 → escaladée sans auto-fix (comportement attendu, pas un bug de la loop).

**Fix traité en session interactive**, sur demande explicite de l'utilisateur : même patron déjà en place sur `GET /:id/photos`/`GET /:id/photos/:photoId/url` (`user.role !== 'admin' && data.boutique_id !== user.boutique_id → 403`) appliqué à `tickets.get('/:id', ...)` (`src/routes/tickets.ts:160`). `tsc --noEmit` et tests unitaires (824/826) inchangés — aucune régression.

**Validation en prod réelle avant tout commit** : test navigateur direct via Claude in Chrome sur `repairdesk.fr`, connecté en `telnet@bbox.fr` (manager, boutique 2 réelle) — `GET /api/tickets/1` (boutique 1, étrangère) confirmé 200 avant fix puis 403 après ; `GET /api/tickets/12` (boutique 2, propre) resté 200. Séquence respectée : déploiement (`wrangler pages deploy`) → validation prod → commit (`ae6795f`) → push.

**Doc mise à jour en parallèle par la loop-engineering** : pendant que `bugs.md`/`todo.md` étaient mis à jour côté session interactive, la loop a écrit sa propre doc sur les mêmes fichiers (confirmation via sa suite Playwright relancée, 7/7 verts) + un ledger d'escalade. Conflit de merge sur `bugs.md`/`todo.md` résolu par rebase, fusion manuelle des deux versions sans perte d'information (commit `6a4a4e0`).

**Reste ouvert pour une prochaine session** : auditer `PUT /:id`, `PUT /:id/statut`, `DELETE /:id`, `POST /:id/acompte` (même service `tickets.ts`, même risque potentiel d'isolation manquante, pas vérifiés un par un dans ce passage). Le chantier cache-busting du checkpoint 36 reste également en attente, non retouché ce checkpoint.

**Note d'environnement (Windows)** : `git config core.fileMode false` appliqué localement sur ce poste — `scripts/loop/*` (`.ps1`/`.mjs`/`.py`) perdaient leur bit exécutable à chaque checkout NTFS, provoquant un diff de mode fantôme bloquant les rebases (`git pull --rebase` refuse tant que le working tree n'est pas propre). Config locale non commitée, à reproduire sur toute autre machine Windows de ce projet si le même symptôme apparaît.

## État git à la fin de ce checkpoint
Tout commité et pushé sur `main` (`ae6795f` fix de code, `6a4a4e0` doc post-merge avec la loop-engineering). Fix en prod. Aucun autre changement de code en attente.

---

# Recovery Prompt — iziGSM — 2026-07-18 (checkpoint 36 — incident propagation CDN corrigé, chantier cache-busting priorisé pour la prochaine session)

## Vue d'ensemble (checkpoint 36)
Suite immédiate du checkpoint 35 (contenu ticket 3 volets/A4 déployé en `v2.64`). Juste après ce déploiement, l'utilisateur a signalé le nouveau contenu absent malgré `CACHE_VERSION` à jour dans son navigateur.

**Root cause confirmée en investiguant en direct (Claude in Chrome, poste réel de l'utilisateur)** : le Service Worker avait bien installé/activé `v2.64` (cache keys versionnés correctement), mais son précache (`cache.add()` sur l'App Shell) avait fetché `/static/js/tickets.js` **pendant la fenêtre de propagation du cache CDN Cloudflare** juste après le déploiement — ce fichier n'a pas de nom hashé par contenu, donc Cloudflare pouvait légitimement servir une version encore ancienne à certains edges pendant quelques secondes/minutes post-déploiement. Le précache a figé cette version transitoire dans le nouveau `CACHE_VERSION` : cohérent en apparence (bon numéro affiché) mais avec un contenu réellement obsolète à l'intérieur. Piège découvert au passage : `fetch(url, {cache:'reload'})` côté page n'a AUCUN effet sur la logique interne du Service Worker qui intercepte la requête avant que ce mode de cache ne s'applique — un `cache:'no-store'` sur une requête page ne garantit jamais de contourner le cache du SW lui-même.

**Fix immédiat** : désinscription du Service Worker + purge des caches directement sur le poste de l'utilisateur via Claude in Chrome — confirmé résolu (`tickets.js` re-fetché correct après coup).

**Fix structurel déployé** (`public/sw.js`, commit `796be8d`, `CACHE_VERSION v2.65`) : `cache.add(url)` → `cache.add(new Request(url, { cache: 'reload' }))` au précache — force le fetch à ignorer tout cache HTTP local/intermédiaire au moment de l'installation. **Limite reconnue et documentée** : ne garantit pas la fraîcheur du edge cache CDN Cloudflare lui-même (hors de notre contrôle) — réduit le risque, ne l'élimine pas structurellement.

## Chantier prioritaire identifié pour la PROCHAINE SESSION (voir `todo.md`, section 🔴 en tête de fichier)
**Cache-busting par hash de contenu** des fichiers statiques (`tickets.a3f8e1.js` au lieu de `tickets.js`) — élimination structurelle de toute cette classe de bug, puisqu'une URL hashée par contenu ne peut jamais être servie périmée sous ce nom (changement de contenu = changement de nom = jamais de collision de cache possible, à aucune couche : CDN, navigateur, ou Service Worker).
Sous-tâches identifiées (détail dans `todo.md`) : config Vite pour hasher `public/static/js/*.js`/`*.css`, manifeste de build, adaptation des balises `<script src>`/`<link href>` dans les pages HTML pour référencer les noms hashés via le manifeste, régénération dynamique de la liste `APP_SHELL` du Service Worker à partir de ce manifeste (au lieu de la liste statique actuelle), puis passage des fichiers hashés en cache long+immutable. **Rien commencé** — décision utilisateur du 2026-07-18 : inscrire en priorité pour la prochaine session, pas traité dans celle-ci.

## État git à la fin de ce checkpoint
Tout commité et pushé sur `main`. Fix structurel en prod (`v2.65`). Chantier cache-busting priorisé mais pas démarré.

---

# Recovery Prompt — iziGSM — 2026-07-18 (checkpoint 35 — chantier impression ticket 8/8 déployé, incident NoScript résolu, contenu amendé et déployé)

## Vue d'ensemble (checkpoint 35)
Suite des checkpoints 32-34. Trois événements majeurs depuis :

**1. Chantier impression ticket terminé et déployé (8/8 tâches)** — Task 7 (2 boutons d'impression, dispatch `printTicket(id, format)`) et Task 8 (deep-link technicien `tickets.html?open=<token>`) terminées et approuvées après le checkpoint 32. Task 8 a révélé un vrai bug (pas juste un défaut de preuve cette fois) : le deep-link ne fonctionne jamais pour un compte admin (`boutique_id: null`) — `GET /api/tickets` exige `boutique_id` sans exception admin. Documenté dans `bugs.md`, non corrigé (fix nécessite de toucher la route partagée, hors scope, décision utilisateur de reporter). Déployé le 2026-07-18 (`CACHE_VERSION v2.62`, commit non pushé initialement puis rattrapé).

**2. Incident client — /login cassé sur Chrome — VRAIE CAUSE : extension NoScript, pas l'app.** Utilisateur a signalé une connexion impossible + identifiants visibles dans l'URL sur `repairdesk.fr/login`, puis un dashboard vide après un premier correctif partiel. Fausse piste explorée d'abord (Service Worker servant `/login` en cache obsolète — fix appliqué quand même, `NETWORK_ONLY_PATHS` dans `sw.js`, légitime en soi mais pas la vraie cause). **Vraie cause trouvée en investiguant en direct sur le poste de l'utilisateur avec Claude in Chrome** : l'extension NoScript bloquait l'exécution JS sur des domaines non approuvés (`repairdesk.fr`, `jsdelivr.net`, `accounts.google.com`, `gstatic.com`). Résolu par l'utilisateur en les ajoutant aux domaines de confiance NoScript. Leçon méthodologique documentée dans `bugs.md` : un test qui "confirme" une hypothèse (navigation privée → ça marche) peut avoir une autre cause quand plusieurs facteurs changent simultanément (ici cache local ET extensions désactivées en navigation privée).

**3. Amendement contenu ticket 3 volets + fiche A4 — DÉPLOYÉ.** Suite comparaison directe demandée par l'utilisateur avec `docs/bon de réparation.pdf` et `izigsm_app/frontend/app/Views/pages/reparations/print-prise-en-charge.php` (ancien système abandonné) :
- IMEI/N° Série désormais **toujours affichés** (fallback "—" si vide) sur les 2 volets thermiques (client + technicien) — avant : ligne masquée si champ vide
- Texte légal acompte remplacé par **3 mentions exactes fournies par l'utilisateur** : "Déduit du total si devis accepté." / "Conservé par l'atelier si devis refusé par le client (frais diagnostic)." / "Si appareil non récupéré sous 4 semaines après notification → recyclage possible selon législation." — appliqué à la fois sur la fiche A4 ET le ticket 3 volets (cohérence demandée explicitement)
- Vérifié avec l'utilisateur avant implémentation : les 2 premiers cas (devis refusé → acompte conservé, annulation → avoir automatique) sont déjà le comportement réel du système, aucun nouveau développement métier nécessaire — seul le texte imprimé changeait
- **Décisions confirmées de NE PAS changer** : pas de niveau de gravité sur l'état à l'entrée (resterait un chantier backend séparé, schema DB), format Marque+Modèle groupé conservé (pas de labels séparés comme le vieux modèle), volet technicien reste minimal (pas d'acompte, pas de signature), le cas d'annulation/avoir reste absent du texte légal (sur demande explicite)
- Déployé (`CACHE_VERSION v2.64`, commits `fbc28c4`+`8aff690`), vérifié en prod (nouvelles chaînes confirmées présentes sur `repairdesk.fr/static/js/tickets.js`)

## Limite de validation notée pour la suite
L'extension NoScript de l'utilisateur interfère aussi avec `localhost` (pas seulement les domaines de prod), bloquant l'exécution JS de la page dans les sessions Claude in Chrome de test. Pour ce checkpoint, la validation du dernier amendement a été faite autrement (relecture de diff, `node --check`, simulation isolée en Node de la logique de fallback) plutôt qu'en navigateur réel. Si une future tâche nécessite une vraie validation navigateur locale, il faudra soit ajouter `localhost`/`127.0.0.1` aux domaines de confiance NoScript de l'utilisateur, soit accepter cette limite et documenter la validation alternative comme fait ici.

## État git à la fin de ce checkpoint
Tout commité et pushé sur `main`. Chantier impression ticket 8/8 tâches + tous les amendements et corrections associées sont en production sur `repairdesk.fr` (`CACHE_VERSION v2.64`). Seuls fichiers non trackés restants : PDF/docx de référence + archives ZIP de backup (intentionnellement hors git, non liés au code).

## Prochaines étapes recommandées
1. Décider si/quand corriger le bug deep-link admin (`bugs.md`) — nécessite de retravailler la route partagée `GET /api/tickets`
2. Décider si un vrai restyle visuel A4 (bandeau bleu marine façon `bon de réparation.pdf`) reste souhaité (toujours en attente depuis checkpoint 31, système indigo actuel conservé pour l'instant)
3. Namespacer les futurs fichiers `.superpowers/sdd/` créés hors plan écrit (convention déjà appliquée depuis l'incident du 2026-07-18, à poursuivre)
4. Rien d'autre en attente identifié à ce jour pour le chantier impression ticket — chantier clos

---

# Recovery Prompt — iziGSM — 2026-07-18 (checkpoint 34 — incident sécurité /login corrigé, cause réelle : extension NoScript)
*(Entrée reconstruite rétroactivement le 2026-07-30 depuis `current-state.md` + `git log` — voir aussi checkpoint 35 ci-dessus qui consolide ce contenu)*

Incident client — /login + dashboard cassés sur Chrome, **RÉSOLU**. Utilisateur a signalé une connexion impossible + identifiants visibles dans l'URL, puis un dashboard vide. Vraie cause trouvée en investiguant en direct sur le poste de l'utilisateur (Claude in Chrome) : l'extension **NoScript** bloquait l'exécution JS sur `repairdesk.fr` (pas encore en site de confiance) — logs `DocumentFreezer`/`SyncMessage loops` confirmés en console. Résolu par l'utilisateur en ajoutant le domaine aux domaines de confiance NoScript. **Le code applicatif n'était jamais en cause.** Un fix Service Worker déployé en parallèle (retirer `/login`/`/register`/`/reset-password` du cache, `CACHE_VERSION v2.63`) reste une amélioration légitime mais ne réglait pas ce symptôme précis.

## État git
Commits `40ac842` (fix SW), `13036a9`/`d68646b` (doc, correction de la vraie cause).

---

# Recovery Prompt — iziGSM — 2026-07-18 (checkpoint 33 — déploiement production, chantier impression ticket 8/8 tâches)
*(Entrée reconstruite rétroactivement le 2026-07-30)*

Les 8 tâches du chantier impression ticket (+ 2 amendements hors plan, Tasks 4bis/4b) déployées sur `repairdesk.fr`, sur confirmation explicite de l'utilisateur. Tests avant déploiement : 824/826 (2 échecs fuseau horaire pré-existants connus). `CACHE_VERSION` v2.61→v2.62 (fichiers frontend touchés : `tickets.js`/`tickets.html`/`print.css`). Vérifié après déploiement : `GET /api/health` → 200, `sw.js` confirme `CACHE_VERSION izigsm-v2.62`.

**2 bugs connus non corrigés, documentés dans `bugs.md`** : le deep-link technicien (`tickets.html?open=<token>`) ne fonctionne jamais pour un compte admin (route `GET /api/tickets` exige `boutique_id` sans exception admin), et une confusion connexe erreur/introuvable dans `_checkOpenDeepLink()`.

## État git
Commits `a756c5e`/`e8cdd61`/`c2df45f`/`2d1dd74`.

---

# Recovery Prompt — iziGSM — 2026-07-18 (checkpoint 32 — chantier impression ticket, Tasks 1-6/8 terminées et approuvées, Task 7 EN COURS)

## Vue d'ensemble (checkpoint 32)
Suite directe du checkpoint 31. Architecture inchangée. Le cadrage de Task 6 a nécessité plusieurs tours de clarification avec l'utilisateur (voir section dédiée ci-dessous) avant implémentation — important à lire en cas de reprise, car la compréhension initiale de la tâche était erronée et corrigée en cours de route.

## Clarification majeure Task 6 — à bien comprendre avant toute reprise
L'utilisateur a d'abord demandé un déploiement + une archive locale, puis a dévié la conversation vers Task 6 en affirmant (à tort) que Task 4/4b contenait déjà un "ticket technicien". **Vérifié par grep et corrigé factuellement** : Task 4/4b (fiche A4) ne contient qu'un champ texte "Technicien : [nom]" et une case de signature vide — rien qui ressemble à un document autonome sans infos client. Après clarification, la vraie demande était : à la prise en charge, **2 choix d'impression** (pas 3) — la fiche A4, OU un **"ticket 3 volets"** thermique 72/80mm imprimé en **un seul job continu** avec pointillés de découpe : 2 exemplaires client identiques + 1 exemplaire technicien (zéro info client). Task 5 (ticket client seul, déjà fait) n'était pas du travail perdu — son contenu a été refactorisé en fragment réutilisable pour les 2 volets client, la fonction standalone de Task 5 a été supprimée (plus de bouton "ticket client seul").

## État des tâches du chantier impression ticket
- Tasks 1-5 : terminées et approuvées (voir checkpoint 31 ci-dessous pour le détail)
- **Task 6 (révisée) : terminée et approuvée** (commit `62b03e4`) — `_buildTicketVoletClientHTML`/`_buildTicketVoletTechnicienHTML`/`_buildTicketThermique3VoletsHTML`, ancienne fonction Task 5 proprement supprimée (pas de code mort), confidentialité du volet technicien vérifiée directement dans le diff par le reviewer (pas sur la foi du rapport) — aucune référence à `d.client`/`d.tel`/`d.email`/`d.adresse` dans la fonction technicien
- **Task 7 (révisée) : EN COURS au moment de ce checkpoint** — dispatchée (2 boutons d'impression "Fiche A4"/"Ticket 3 volets" + dispatch `printTicket(id, format)`, `format ∈ 'a4'|'3volets'`), fichiers `public/static/js/tickets.js`/`public/tickets.html` modifiés mais **pas encore commités** au moment de l'écriture de ce recovery prompt — NE PAS re-dispatcher cette tâche si elle est toujours en cours, vérifier d'abord `git status`/le ledger `.superpowers/sdd/progress.md`
- Task 8 (deep-link technicien `tickets.html?open=<token>`) — pas commencée, dernière tâche du plan. Note : le QR du volet technicien (Task 6) encode déjà l'URL `/tickets.html?open=<token>` par anticipation — cette tâche doit câbler le frontend pour que ce lien soit réellement fonctionnel.

## Convention de nommage SDD à respecter pour toute nouvelle tâche ad-hoc
Depuis l'incident du 2026-07-18 (fichier `task-5-report.md` d'un autre chantier écrasé sans proposition), tout fichier `.superpowers/sdd/` créé pour une tâche hors plan écrit de ce chantier doit être namespacé `impression-ticket-task-N-brief.md`/`-report.md` — jamais la convention générique `task-N-*.md` qui collisionne entre chantiers différents réutilisant la même numérotation.

## Prochaines étapes recommandées
1. Vérifier l'état de Task 7 (probablement terminée entre-temps) → revue si pas encore faite
2. Task 8 (deep-link technicien)
3. Décider du timing de déploiement (question posée à l'utilisateur le 2026-07-18, réponse "no preference" — a dévié vers la clarification Task 6 sans trancher) — à retrancher une fois Task 7/8 terminées
4. Archive locale du dossier webapp demandée par l'utilisateur (snapshot complet daté, même convention que `izigsm_v2.45.0_backup_2026-07-16.zip`) — **pas encore faite**, en attente du déploiement (l'utilisateur avait dit "après avoir déployé en production, créez une archive")
5. Voir `todo.md`/`bugs.md`/`decisions.md` pour le détail complet des décisions et bugs de ce chantier

## État git à la fin de ce checkpoint
Task 6 commitée et pushée. Task 7 en cours, fichiers modifiés non commités au moment de ce checkpoint — le sous-agent Task 7 committera lui-même à la fin de son travail.

---

# Recovery Prompt — iziGSM — 2026-07-18 (checkpoint 31 — chantier impression ticket, Tasks 1-5/8 terminées et approuvées)

## Vue d'ensemble (checkpoint 31)
SaaS Hono/TypeScript + Cloudflare (Pages + D1 + R2) multi-tenant de gestion pour centres de réparation GSM. Repo : `izigsm/webapp/` (racine git), remote GitHub `zinside69/izigsm_NG_temp_analysis`, branche `main`. Architecture inchangée depuis checkpoint 25 (Ports & Adapters terminé, `lib/timezone.ts` généralisé). Deux chantiers traités depuis checkpoint 25 :

**Chantier acompte structuré (checkpoint 29) : DÉPLOYÉ le 2026-07-18.** 10/10 tâches + revue finale (déjà terminées le 2026-07-17), buildées et déployées sur confirmation explicite utilisateur (`repairdesk.fr`, `sw.js` confirme `CACHE_VERSION izigsm-v2.61`). Tests 824/826 avant déploiement (2 échecs fuseau horaire pré-existants). HEAD au déploiement incluait aussi les Tasks 1-3 (alors en cours) du chantier impression ticket — code additif/inerte, revues et approuvées, sans risque.

**Chantier impression ticket (checkpoint 30→31) : Tasks 1-5 terminées et approuvées, mode subagent-driven-development, directement sur `main`.**
- Task 1 : `_fetchTicketPrintData()` expose l'ID numérique (commit `a9bf783`)
- Task 2 : `listTickets()` reconnaît token/EAN-13 en recherche, additif (commit `236f8c2`)
- Task 3 : helpers `_renderQrDataUrl()`/`_renderEan13DataUrl()` + libs CDN (commit `3408f62`)
- Task 4 : fiche A4 — retrait fuite notes internes + QR/EAN (commit `9f19e31`, + fix JSDoc `356c073`)
- **Task 4bis (amendement hors plan écrit)** : backend expose IMEI/N° série (JOIN `appareils` via `ticket.appareil_id`)/adresse client (commit `c62c1a2`)
- **Task 4b (amendement hors plan écrit)** : contenu de la fiche A4 enrichi (N° série, adresse, section "Acompte versé" encadrée) — **système visuel indigo existant conservé** (pas le bandeau bleu marine du modèle de référence, pour ne pas impacter factures/devis qui partagent les mêmes classes CSS) (commit `165c57b`)
- Task 5 (révisée) : `_buildTicketThermiqueHTML()` — ticket client 72mm, contenu repris de l'ancien template `izigsm_app` (une seule copie, sans zone de signature — signature électronique déjà captée ailleurs) (commit `88afdc9`)
- Fix hors-plan : bug préexistant `panne` toujours vide sur les fiches imprimables (`t.description`/`t.panne_declaree` inexistants, vrai champ `description_panne`) — corrigé et validé en réel (commit `b351132`)

## Décisions importantes de cette session (2026-07-18)
1. **Amendement de plan** : l'utilisateur a fourni 2 PDF de référence (`docs/test impression.pdf`, `docs/bon de réparation.pdf`, issus de l'ancien template `izigsm_app/frontend/app/Views/pages/reparations/print-prise-en-charge.php`, POS 80mm/A4, 3 exemplaires découpés). Décision : garder le format thermique 72mm déjà validé pour Task 5 (pas le format A4 3-copies de l'ancien template), reprendre le CONTENU (IMEI/N° série/adresse/acompte), sans signature.
2. **Système visuel A4 conservé** (indigo, classes partagées avec factures/devis) plutôt que le bandeau bleu marine du modèle — à rediscuter avec l'utilisateur si un vrai restyle est souhaité plus tard (pas encore tranché explicitement).
3. **Texte légal acompte** volontairement différent du vieux modèle PDF (déduction/avoir automatiques déjà implémentés vs process manuel jamais implémenté par ce système) — ne pas promettre un comportement inexistant.
4. **Incident process** : un sous-agent (Task 5) a écrasé `.superpowers/sdd/task-5-report.md` (contenu d'un chantier précédent déjà terminé/documenté ailleurs, non tracké git) sans proposer avant — violation de la règle CLAUDE.md "jamais écraser sans proposer". Cause : naming générique `task-N-brief/report.md` réutilisé sans namespace entre chantiers différents partageant la même numérotation. **Non récupérable** (fichier git-ignoré, pas de sauvegarde système/cloud disponible), mais aucune information unique perdue. **À corriger pour la suite** : namespacer les futurs fichiers ad-hoc (ex. `impression-ticket-task-N-*.md`) avant de dispatcher d'autres sous-agents sur des tâches hors plan écrit.

## Bugs préexistants trouvés et corrigés pendant ce chantier (sans lien avec le chantier lui-même)
- `panne` vide sur les fiches (corrigé, voir ci-dessus)
- marque/modèle lisaient les mauvaises clés API dans `_fetchTicketPrintData()` (corrigé en Task 4b)
- Commentaire JSDoc obsolète référençant l'ancien nom de fonction (corrigé en Task 4)

## Bugs connus non corrigés (mineurs, notés par les reviewers, hors scope)
- Nom de boutique sur la fiche imprimée : lit la 1ère boutique de `GET /api/boutiques` (non filtrée), pas forcément celle du ticket — signalé par l'implémenteur Task 5, pas encore corrigé
- Ambiguïté HT/TTC non explicitée sur le montant "Acompte versé" affiché (le champ source est `total_ttc`)
- LEFT JOIN `facture_acompte` dans `getTicketById()` sans `ORDER BY`/`LIMIT 1` — comportement non défini si un ticket avait un jour plusieurs factures d'acompte (anomalie de données théorique)
- Check unicité acompte non atomique (déjà documenté depuis le chantier acompte structuré)

## Prochaines étapes recommandées
1. **Task 6** (étiquette technicien 72mm à coller sur l'appareil) — à revalider le contenu exact avec l'utilisateur avant de dispatcher (la copie "atelier" de l'ancien template — appareil+panne+QR standalone, sans infos client — est un bon point de départ conceptuel, pas encore décidé formellement)
2. **Task 7** (3 boutons d'impression + dispatch `printTicket(id, format)`) — dépend de Task 6
3. **Task 8** (deep-link technicien `tickets.html?open=<token>`) — dernière tâche du plan
4. Décider si un vrai restyle visuel A4 (bandeau bleu marine façon `bon de réparation.pdf`) est souhaité, séparément du contenu déjà ajouté
5. Corriger si prioritaire : nom de boutique sur fiche imprimée (bug mineur non bloquant)
6. Rien de ce chantier n'est encore déployé en prod (seul l'acompte structuré l'est) — déploiement groupé à prévoir après Task 8, sur confirmation explicite

## État git à la fin de cette session
Tout commité sur `main` local. **Pas encore pushé au moment de l'écriture de ce recovery prompt** — à vérifier au prochain `git status`/`git push`.

---

# Recovery Prompt — iziGSM — 2026-07-17 (checkpoint 30 — chantier impression ticket démarré, session suspendue le soir même)
*(Entrée reconstruite rétroactivement le 2026-07-30 depuis `current-state.md` + `git log`)*

Nouveau chantier, brainstormé et planifié dans la foulée du checkpoint 29 (acompte structuré). Objectif : 2 nouveaux formats d'impression ticket thermique (72mm) — ticket client à emporter + étiquette technicien à coller sur l'appareil — en plus de la fiche A4 existante (corrigée au passage : elle affichait les notes internes, une fuite de confidentialité). QR code + code-barre EAN-13 sur les 3 formats. Pas d'agent d'impression externe (QZ Tray écarté) — `window.print()` natif, l'imprimante thermique reconnue comme imprimante système standard.

Spec `docs/superpowers/specs/2026-07-17-impression-ticket-design.md` (commit `2b63d23`), plan `docs/superpowers/plans/2026-07-17-impression-ticket.md` (commit `10cd47e`, 8 tâches TDD/local-live).

**État d'avancement — 2/8 tâches, session suspendue avant la revue de Task 2** : Task 1 (`_fetchTicketPrintData()` expose l'ID numérique, `a9bf783`) terminée et revue. Task 2 (`listTickets()` reconnaît token/EAN-13 en recherche, `236f8c2`) **implémentée mais pas encore revue**. Tasks 3-8 pas commencées.

## Prochaine étape au retour
Dispatcher le reviewer sur Task 2 (BASE `a9bf783`, HEAD `236f8c2`) avant de continuer vers Task 3 — ne pas re-dispatcher l'implémenteur.

## État git
Doc `954b5d1`.

---

# Recovery Prompt — iziGSM — 2026-07-17 (checkpoint 29 — acompte structuré implémenté de bout en bout)
*(Entrée reconstruite rétroactivement le 2026-07-30)*

Suite du checkpoint 28 (plan écrit). Exécution des 10 tâches du plan via `superpowers:subagent-driven-development`, directement sur `main` — un subagent implémenteur + un subagent reviewer par tâche, revue finale de branche (opus) sur l'ensemble.

**Avant le chantier acompte, même session** : bug étendu `r.success`/`r.data` corrigé dans `agenda.js`/`sav.js`/`stats.html` — 19 fonctions cassées depuis toujours, ces 3 pages intégralement non fonctionnelles (KPIs jamais affichés, formulaires en échec silencieux). Commit `c281411`.

**10 tâches terminées et approuvées** — résumé fonctionnel : acompte facturé immédiatement (vraie facture verrouillée, séquence `FAC-` partagée), déduit automatiquement à la facture finale, annulation avec acompte perçu → avoir automatique (2 mois), UI staff (tickets/devis) + UI publique (`suivi.html`).

**Revue finale de branche** (`33d9a739`..`09d7e23`, 17 commits, verdict initial "With fixes") : 2 findings Important corrigés après la revue (commit `a9d28d5`) — validation `montant_ht` durcie, et surtout `changeStatus()` (annulation avec avoir) qui approximait le HT/taux TVA de l'acompte à 20% fixe au lieu de lire les valeurs réelles.

## État git
Commits `33d9a739`..`09d7e23`, doc `03992c0`.

---

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
