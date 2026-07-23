---
name: loop-engineering
description: "Use when triggered by a local scheduled task (cron/Task Scheduler calling scripts/loop/run-loop.sh|.ps1) or a manual run to execute exactly one backlog item autonomously end-to-end: pick, plan (via superpowers), implement in an isolated worktree, verify (unit + typecheck + Playwright + browser-use), and either auto-commit/push (low risk, all gates green) or escalate to the human with a full report. Governed by project-docs/loop-policy.md (autonomy level L2)."
risk: high
source: internal
date_added: "2026-07-19"
---

# loop-engineering

Cette skill implémente une **loop d'ingénierie autonome** pour iziGSM, inspirée de
https://github.com/cobusgreyling/loop-engineering (5 blocs : automations/scheduling,
worktrees, skills, plugins/MCP, sub-agents maker/checker, + mémoire/état durable).

**Elle n'invente pas de nouveau workflow de dev** : elle automatise l'enchaînement des
skills `superpowers` déjà utilisés manuellement sur ce repo (`brainstorming` →
`writing-plans` → `subagent-driven-development` / `executing-plans`), et y ajoute
des gates de vérification + une politique de commit/escalade explicite.

**Avant toute chose : lire `project-docs/loop-policy.md` en entier.** Ce document est
la source de vérité du niveau d'autonomie (L2), de la classification du risque, et de
ce que la loop n'a jamais le droit de faire (déployer en prod, force-push, toucher aux
secrets). Cette skill ne fait qu'exécuter cette politique — en cas de contradiction
apparente entre ce fichier et `loop-policy.md`, **`loop-policy.md` fait foi**.

Traiter **une seule tâche du backlog par exécution de cette skill**, pas une rafale —
la cadence est contrôlée par le déclencheur (tâche planifiée locale cron/Planificateur,
ou lancement manuel), pas par la skill elle-même.

## Étape 0 — Prérequis de session

- Confirmer qu'on est bien dans le repo `izigsm_NG_temp_analysis` (remote `origin` doit
  pointer vers `zinside69/izigsm_NG_temp_analysis`), branche `main` propre
  (`git status` sans modification en attente). Si le working tree n'est pas propre,
  **s'arrêter et escalader** — ne jamais partir d'un état sale (travail humain en cours
  possible).
- Charger le contexte durable : `project-docs/current-state.md` (derniers checkpoints),
  `project-docs/bugs.md` (bugs connus, pour ne pas les re-découvrir comme si c'était
  nouveau), `project-docs/decisions.md`.

## Étape 0bis — Vérifier le quota du plan (avant tout le reste)

**Premier geste de tout run, avant même Étape 1.** La loop ne doit jamais épuiser le
quota d'usage du compte Claude sans que l'utilisateur ne le sache.

```bash
node scripts/loop/check-quota.mjs
```

Ce script exécute `npx ccusage@latest blocks --active --json` (lit les logs locaux
Claude Code de **cet environnement uniquement** — ne voit pas l'usage d'autres
machines/sessions de l'utilisateur, c'est une estimation locale, pas une vérité
absolue du compte) et compare l'usage réel du bloc actif à une limite
(`LOOP_TOKEN_LIMIT`, défaut `max` = plus haut bloc historique observé — voir
`project-docs/loop-policy.md`).

Ce gate tourne dans une session Claude Code **locale normale** (lancée par
`scripts/loop/run-loop.sh`/`.ps1`) — pas de restriction d'outils particulière ici,
contrairement à une éventuelle session cloud. Décision finale du 2026-07-19 :
planification via `cron`/Planificateur de tâches local plutôt qu'un Routine Claude Code
Remote (abandonné — voir `project-docs/loop-policy.md` § "Exécution automatisée").

- **Code retour 0 (< 80 %)** → continuer normalement à l'étape 1.
- **Code retour 1 (≥ 80 %)** → **s'arrêter immédiatement, ne rien implémenter.** En
  pratique, avec la planification locale, `check-quota.mjs` fait déjà sortir
  `run-loop.sh`/`.ps1` en erreur AVANT même de lancer cette session — ce cas ne devrait
  se produire dans le skill que sur un lancement manuel direct. Si ça arrive quand même :
  1. Terminer la réponse par un rapport clair : quota estimé, bloc actif, heure de fin
     de bloc si pertinente.
  2. Ajouter une entrée dans `.superpowers/sdd/loop-runs.md` (étape 7) même si aucune
     tâche n'a été traitée.
- **Code retour 2 (données insuffisantes)** → pas assez d'historique pour estimer un
  pourcentage fiable. Continuer (fail-open, ne jamais bloquer sur une estimation
  absente), mais le signaler dans le rapport final.
une session qui a les outils).

## Surveillance du context window (context-guardian)

Règle transversale, applicable à tout moment de l'exécution (pas seulement à la fin) —
protocole `~/claude-projects/context-guardian.md` du workspace, seuil resserré à 80 %
pour la loop (au lieu de la fourchette 70–85 % du protocole général) :

- S'auto-évaluer régulièrement (nombre d'échanges, taille des sorties d'outils, nombre
  de sous-agents déjà dispatchés dans ce run) — pas d'API exacte pour mesurer le
  pourcentage, jugement du même ordre que `/context-guardian status`.
- **Dès qu'on approche ~80 % du context window** (typiquement : plan à plusieurs tâches
  avec plusieurs sous-agents implémenteur/reviewer déjà dispatchés dans le même run) :
  1. Ne pas continuer à dispatcher de nouveaux sous-agents dans cette session.
  2. Écrire un **checkpoint** : mettre à jour `project-docs/current-state.md` (état
     exact — quelle tâche du plan, quelle étape, quels fichiers touchés, quels tests
     passent) et régénérer `project-docs/recovery-prompt.md` (prompt clé-en-main pour
     reprendre exactement où on s'arrête).
  3. Committer le travail déjà vérifié (si les gates de l'étape 5 sont déjà passés pour
     les tâches terminées) — ne jamais laisser du travail non commité perdu par
     compaction/fin de session.
  4. Traiter ce point d'arrêt comme une **escalade** (étape 7) : le prochain run de la
     loop (nouvelle session, contexte neuf) reprend via `recovery-prompt.md`, pas de
     tentative de continuer dans la même session au-delà de ce seuil.

## Étape 1 — Sélectionner la tâche

```bash
node scripts/loop/pick-task.mjs
```

Retourne la prochaine tâche non cochée (priorité 🔴 d'abord) depuis
`project-docs/todo.md` puis `docs/TODO.md`, avec un `riskHint` (mots-clés détectés,
purement indicatif — la classification faisant foi est celle de l'étape 2).

- Si `{"empty": true}` → rien à faire. Écrire une entrée dans le ledger
  (étape 7) et s'arrêter proprement. Ne pas inventer de tâche.
- Si la tâche a déjà été escaladée lors d'un run précédent (voir ledger
  `.superpowers/sdd/loop-runs.md`) et qu'aucune décision humaine n'a été actée depuis
  (pas de mise à jour dans `decisions.md` ou de changement du texte de la tâche) →
  la passer avec `--skip <id>` et reprendre la suivante. Ne jamais re-tenter en boucle
  une tâche déjà refusée par les gates sans changement de contexte.

## Étape 1bis — Rafraîchir et consulter le graphe de connaissance

Exécutée dans le checkout principal, **avant** toute création de worktree (voir
`docs/superpowers/specs/2026-07-23-graphify-loop-integration-design.md` pour le
design complet — `git worktree add` ne copie jamais `graphify-out/`, gitignoré).

1. **Recommandation de rafraîchissement** :
   ```bash
   node scripts/loop/graphify-refresh.mjs plan
   ```
   - `{"action":"skip",...}` → rien à faire, passer directement au point 3.
   - `{"action":"update",...}` → invoquer `/graphify . --update --obsidian --obsidian-dir graphify-out/obsidian` (skill graphify, dans cette même session).
   - `{"action":"update_no_semantic",...}` → invoquer `/graphify . --update --no-semantic` (extraction AST seule, gratuite — l'extraction sémantique différée attendra un prochain run).
2. **Enregistrer le résultat** (best-effort, ne bloque jamais) :
   ```bash
   node scripts/loop/graphify-refresh.mjs record-result success   # si l'update (ou le skip) a réussi
   node scripts/loop/graphify-refresh.mjs record-result failure   # si /graphify --update a échoué
   ```
   Si la sortie contient `"alertThresholdReached":true` → envoyer une alerte dédiée :
   ```bash
   node scripts/loop/notify-telegram.mjs "iziGSM Loop : graphe non rafraichi depuis 3 runs consecutifs - verifier manuellement (voir loop-runs.md)."
   ```
3. **Vérifier la lisibilité du graphe (gate dur)** :
   ```bash
   node scripts/loop/graphify-refresh.mjs verify
   ```
   - Exit 0 → continuer normalement à l'Étape 2.
   - Exit 1 → **escalader immédiatement (Étape 7)**, catégorie `Risque : graphe indisponible`. Aucun sous-agent dispatché, worktree jamais créé. C'est le seul cas où l'indisponibilité du graphe bloque le run — un échec de l'étape 1 ci-dessus (update) est volontairement non bloquant tant que le graphe existant reste lisible.
4. **Signal de risque** pour le(s) fichier(s) que la tâche va probablement toucher —
   identifiés en lisant le texte de la tâche et, si nécessaire, en explorant
   brièvement le code concerné (même logique déjà en place à l'Étape 2 pour la
   classification par mots-clés — ne pas se fier uniquement au texte brut de la
   tâche) :
   ```bash
   node scripts/loop/graphify-refresh.mjs risk <fichier1> [fichier2...]
   ```
   `sensitiveMatch: true` → traiter comme un signal supplémentaire à l'Étape 2, en complément (jamais en remplacement) de la classification par mots-clés. Voir `project-docs/loop-policy.md` § 2026-07-23 pour la table des catégories.
5. **Brief d'implémentation** — généré à l'Étape 3 (voir ci-dessous), pas ici (il doit être écrit directement dans le worktree qui n'existe pas encore à ce stade).

## Étape 2 — Classifier le risque

Appliquer les règles de `project-docs/loop-policy.md` § "Classification du risque" au
texte de la tâche **et** aux fichiers qu'elle va probablement toucher (déduits en
lisant le code concerné, pas seulement le texte de la tâche — un `riskHint` vide ne
garantit rien, ex. "corriger l'autocomplete marque" peut sembler anodin mais toucher
`getBoutiqueId`).

- **Risque élevé ou ambigu → escalader immédiatement (étape 7), ne pas implémenter.**
  Le coût d'une escalade inutile est faible ; celui d'un auto-push sur de l'auth, de
  l'isolation multi-tenant, du NF525, du RGPD, du paiement ou une migration SQL ne
  l'est pas (voir l'historique de failles dans `bugs.md`, découvertes après des tests
  unitaires verts).
- **Risque faible → continuer à l'étape 3.**

## Étape 3 — Isoler le travail dans un worktree

```bash
git worktree add ../izigsm-loop-<slug-tache> -b loop/<slug-tache> main
node scripts/loop/graphify-refresh.mjs brief <fichier1> [fichier2...] > ../izigsm-loop-<slug-tache>/.superpowers/sdd/<slug-tache>-graph-context.md
cd ../izigsm-loop-<slug-tache>
npm install
```

Le brief est généré **avant** le `cd` (depuis le checkout principal, seul endroit où
`graphify-out/` existe) et redirigé directement dans le worktree fraîchement créé —
convention de namespacing `<slug-tache>-graph-context.md` déjà en place depuis
l'incident du 2026-07-18 (éviter toute collision entre chantiers).

Tout le travail de cette exécution se fait dans ce worktree, jamais directement sur le
checkout principal. `<slug-tache>` : dérivé du texte de la tâche, court, kebab-case.

## Étape 4 — Planifier et implémenter via superpowers

Choisir le mode selon la taille de la tâche (même logique que l'usage manuel documenté
dans `project-docs/current-state.md`) :

- **Bug isolé / correction ciblée (< ~3 fichiers, comportement attendu déjà clair)** :
  invoquer directement `superpowers:executing-plans` en mode inline sur un mini-plan
  d'une tâche, ou implémenter directement avec le sous-agent implémenteur +
  sous-agent reviewer (maker/checker), sans passer par `brainstorming`/`writing-plans`
  complets — ce serait disproportionné.
- **Feature nouvelle / ambiguë / touchant plusieurs fichiers** : suivre le pipeline
  complet — `superpowers:brainstorming` (si la tâche du backlog est sous-spécifiée)
  → `superpowers:writing-plans` (écrit le plan dans `docs/superpowers/plans/`) →
  `superpowers:subagent-driven-development` (un sous-agent implémenteur + un
  sous-agent reviewer par tâche du plan, dans ce worktree).
  - Si `brainstorming` révèle une ambiguïté qu'un humain doit trancher (plusieurs
    interprétations valables, pas juste un détail technique) → **escalader avant
    d'écrire le spec**, ne pas deviner. C'est le hard-gate déjà en place manuellement
    sur ce repo (voir checkpoint 26-27 dans `current-state.md`).

Le fichier `.superpowers/sdd/<slug-tache>-graph-context.md` (créé à l'Étape 3) est
disponible dans le worktree — le sous-agent implémenteur/reviewer le lit comme
n'importe quel autre fichier du worktree, aucun accès à `graphify-out/` n'est
nécessaire ni possible depuis le worktree (gitignoré, non copié par `git worktree add`).

Chaque sous-tâche se termine par `npx vitest run` vert avant de passer à la suivante
(convention déjà documentée dans les plans existants, ex.
`docs/superpowers/plans/2026-07-16-acompte-structure.md`).

## Étape 5 — Gate de vérification (bloquant)

Dans l'ordre, chaque étape doit passer avant la suivante. Le premier échec arrête la
séquence et déclenche l'escalade (étape 7) — jamais de commit partiel.

1. `npx vitest run` — 100 % vert, **y compris** les échecs pré-existants connus
   (actuellement 2 tests fuseau horaire `computeFin()`) qui doivent rester stables en
   nombre et en identité (pas de nouvel échec, même si le total ne change pas).
2. `npx tsc --noEmit` — aucune nouvelle erreur par rapport à `main` (comparer avec
   `git stash`/`git diff` si des erreurs préexistantes sont suspectées, même méthode
   que documentée dans `bugs.md`).
3. `npm run build` — doit réussir (le build Vite fait aussi office de vérification
   supplémentaire, historiquement plusieurs bugs de cache-busting trouvés ici).
4. `npm run test:e2e` (Playwright, voir `playwright.config.ts` et `tests/e2e/`) —
   gate de non-régression déterministe. Démarrer le serveur local requis
   (`npx wrangler pages dev dist --local --port 3000` — **jamais** `--d1=DB` en plus,
   ce flag crée une base locale distincte de celle utilisée par `wrangler d1
   migrations`/`execute`, voir `docs/INSTALLATION.md`; migrations D1 locales
   déjà appliquées) avant de lancer la suite. 100 % vert obligatoire.
5. **Si la tâche introduit un nouveau parcours utilisateur** (pas une simple
   correction de régression) : lancer la validation exploratoire
   `python3 scripts/loop/browser_use_explore.py --task "<description du parcours à
   valider>" --base-url http://localhost:3000`. C'est un signal complémentaire
   (agent LLM, moins déterministe que Playwright) — un échec ici n'est **pas**
   forcément bloquant en soi, mais doit être lu et compris avant de continuer : s'il
   révèle un vrai bug fonctionnel → traiter comme un échec de gate. S'il échoue pour
   une raison non liée au code (timeout réseau, ambiguïté de sélecteur) → le noter
   dans le rapport de commit sans bloquer, mais ne jamais l'ignorer silencieusement.

## Étape 6 — Décision : commit/push ou escalade

- **Tous les gates verts + risque faible confirmé** → commit avec message conventionnel
  (français, format `type: message`, cohérent avec l'historique `git log`), puis
  `git push -u origin loop/<slug-tache>` et merge fast-forward sur `main` en local
  (`git checkout main && git merge --ff-only loop/<slug-tache> && git push origin
  main`) — reproduit la convention "push direct sur main" déjà utilisée manuellement
  sur ce repo. Ne jamais utiliser `--force`.
  - Cocher la case correspondante dans `todo.md`/`TODO.md`.
  - Ajouter une entrée de checkpoint dans `project-docs/current-state.md` (même format
    que les checkpoints existants : quoi, pourquoi, comment validé, commit hash) —
    **ajouter en haut, jamais écraser l'historique**.
  - Supprimer le worktree (`git worktree remove ../izigsm-loop-<slug-tache>`).
- **Sinon** → ne rien pousser. Passer à l'étape 7.

## Étape 7 — Escalade / ledger (toujours exécuté, succès ou échec)

Ajouter une entrée en fin de `.superpowers/sdd/loop-runs.md` (créer le fichier avec un
en-tête si absent — append-only, jamais réécrit) :

```markdown
## Run <horodatage ISO> — <id tâche>

- Tâche : <texte, fichier:ligne>
- Issue : commit `<hash>` | escaladé | backlog vide
- Risque : faible | élevé (<catégorie>)
- Graphe : rafraîchi | périmé (<raison>, <N> échecs consécutifs) | illisible (escalade)
- Gates : vitest <✅/❌> · tsc <✅/❌> · build <✅/❌> · playwright <✅/❌> · browser-use <✅/❌/n·a>
- Worktree : <chemin, conservé si escaladé, supprimé si commité>
- Détail / recommandation : <1-3 phrases>
```

Afficher ce rapport en sortie console (capturé par les logs du planificateur local
cron/Planificateur de tâches) — c'est le seul endroit où l'utilisateur verra le
résultat, pas de silence en fin de run.

## Garde-fous globaux (rappel — détail complet dans `loop-policy.md`)

- Jamais de `wrangler pages deploy` automatique.
- Jamais de force-push, jamais de réécriture d'historique.
- Jamais de modification d'un spec déjà approuvé sans repasser par
  `superpowers:brainstorming`.
- Jamais de suppression de fichier sous `docs/` ou `project-docs/`.
- Jamais de lecture/écriture de secrets (`.dev.vars`, `wrangler secret`).
- **Jamais de fichier de dump/debug laissé dans le repo** (ex. `pick-task.mjs --all >
  fichier.json` pour inspecter le backlog en entier) — rediriger vers un fichier hors
  du repo (dossier temp système) ou supprimer le fichier avant la fin du run. Un
  fichier non suivi qui traîne dans `izigsm/webapp/` fait échouer le **prochain** run
  planifié dès l'Étape 0 (précondition working tree propre) — incident réel rencontré
  le 2026-07-20 (`alltasks.tmp.json`, voir `bugs.md`).
- En cas de doute non couvert explicitement par ce document ou par
  `project-docs/loop-policy.md` → escalader. Le silence ou une supposition optimiste
  n'est jamais une réponse acceptable pour cette skill.
