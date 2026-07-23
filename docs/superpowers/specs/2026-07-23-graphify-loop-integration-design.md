# Design — Intégration du knowledge graph (graphify) dans la loop-engineering

_Version 1.0 — 2026-07-23_

## Contexte

La loop-engineering (`.claude/skills/loop-engineering/SKILL.md`, gouvernée par
`project-docs/loop-policy.md`) traite une tâche du backlog par déclenchement horaire,
en s'appuyant aujourd'hui sur une exploration à froid du code (Grep/Glob) pour la
classification du risque (Étape 2) et l'implémentation (Étape 4).

Un graphe de connaissance a été généré le 2026-07-20 (`/graphify` sur
`izigsm/webapp/` entier — 255 fichiers, 1867 nœuds, 2643 relations) mais n'a jamais
été branché à la loop : décision d'intégration explicitement différée au checkpoint 40
de `project-docs/current-state.md`. Ce document formalise cette intégration.

**Préalable hors périmètre de ce plan** : le graphe actuel présente deux anomalies
(incohérence 418 vs 179 communautés entre `MODE-OPERATOIRE.md` et `GRAPH_REPORT.md`,
`cache/semantic/` vide malgré 24 chunks déjà produits). L'utilisateur relance un
`/graphify` complet en session interactive **avant** toute implémentation de ce plan,
pour repartir d'un graphe sain. Ce plan suppose un `graph.json` cohérent au départ.

## Objectifs

Deux objectifs à parts égales :
1. **Classification du risque (Étape 2)** — détecter des connexions vers des zones
   sensibles (isolation multi-tenant, NF525, auth, paiement) qu'un simple grep de
   mots-clés dans le texte de la tâche peut rater.
2. **Contexte d'implémentation (Étape 4)** — donner aux sous-agents
   implémenteur/reviewer un résumé structuré des relations du fichier ciblé (God
   Nodes, communauté, relations directes) au lieu d'une exploration Grep/Glob à froid.

## Contrainte technique déterminante

`git worktree add` (Étape 3 du SKILL.md) ne copie **jamais** les fichiers non
trackés/gitignorés dans le nouveau worktree. Or `graphify-out/` est entièrement
gitignoré (`.gitignore`, ajouté le 2026-07-20). **Le worktree isolé où travaillent les
sous-agents n'a donc jamais accès à `graphify-out/`.** Toute consultation du graphe
doit se faire dans le checkout principal, avant la création du worktree, et son
résultat doit être transporté sous forme de fichier texte autonome dans le worktree.

## Architecture retenue

Une seule nouvelle étape, **Étape 1bis — "Rafraîchir et consulter le graphe"**,
insérée entre l'Étape 1 (sélection de tâche, backlog non vide) et l'Étape 2
(classification du risque), exécutée dans le checkout principal.

```
Étape 1 (pick-task, backlog non vide)
   │
   ▼
Étape 1bis — Rafraîchir et consulter le graphe   ← NOUVEAU
   │  1. Refresh incrémental (borné)
   │  2. Signal de proximité aux communautés sensibles
   │  3. Extraction du brief d'implémentation (texte)
   ▼
Étape 2 — Classification du risque (enrichie par le signal graphe)
   │
   ▼
Étape 3 — Worktree (le brief texte y est copié à la création)
   │
   ▼
Étape 4 — Implémentation (sous-agents lisent le brief, pas le graphe directement)
```

### 1. Refresh incrémental (borné)

```bash
python -c "from graphify.detect import detect_incremental; from pathlib import Path; print(detect_incremental(Path('.')))"
```

- Aucun fichier modifié depuis le dernier `graph.json` → skip, coût nul.
- Fichiers modifiés détectés → `/graphify . --update` (invoqué comme les autres
  skills superpowers, par Claude lui-même dans la session `claude -p`, pas par un
  script séparé).
- **Extraction sémantique plafonnée** : `GRAPH_UPDATE_MAX_SEMANTIC_FILES` (défaut `5`,
  variable d'environnement, même pattern que `LOOP_TOKEN_LIMIT`). Au-delà de ce
  nombre de fichiers non-code modifiés, l'update se limite à l'extraction AST
  (gratuite, illimitée) pour ce run ; le reste attend le prochain passage. Ce n'est
  **pas** un échec — dégradation silencieuse, notée dans le rapport de l'Étape 7.

### 2. Signal de proximité aux fichiers/nœuds sensibles

**Révisé après vérification empirique (2026-07-23, pendant l'écriture du plan
d'implémentation)** : l'idée initiale d'un mapping par nom de communauté a été
testée directement contre `graph.json` et rejetée — les communautés du graphe
n'ont pas de granularité par feature. La plus grosse contient à elle seule 170
nœuds sur 1867 (9% du graphe), et un fichier totalement sans rapport
(`public/static/js/rachats.js`) partageait une communauté avec les fichiers auth —
un signal basé sur le partage de communauté aurait été un faux-positif quasi
systématique. `graph.json` n'expose d'ailleurs aucun nom de communauté lisible (ce
mapping n'existe que dans les fichiers `_COMMUNITY_*.md` du vault Obsidian,
inaccessibles depuis un signal programmatique simple).

**Mécanisme retenu : relation directe (1 saut) dans le graphe**, entre un nœud du
fichier ciblé par la tâche et un nœud d'un fichier ancre, via le champ
`source_file` des nœuds et les entrées `links` (`_src`/`_tgt`). Testé et validé
(2026-07-23) : `src/lib/nf525.ts` → matche `nf525`+`paiement` uniquement (cohérent),
`src/routes/clients.ts` → aucun match (pas de faux-positif).

Nouvelle sous-section ajoutée dans `project-docs/loop-policy.md` §
"Classification du risque" (ajout sous la table existante, jamais d'écrasement) :

| Catégorie (table mots-clés existante) | Fichier(s) ancre(s) |
|---|---|
| Auth / sessions | `src/services/authService.ts`, `src/routes/auth.ts`, `src/lib/middleware.ts` |
| Isolation multi-tenant | `src/lib/middleware.ts` (héberge `getBoutiqueId()`) |
| NF525 / comptabilité | `src/lib/nf525.ts`, `migrations/0008_nf525.sql` |
| Paiement / acompte | `migrations/0036_acompte_structure.sql`, `src/services/factureService.ts` |
| RGPD | `src/services/clientService.ts` |

Ce mapping est un **signal secondaire**, jamais un remplacement de la table
mots-clés. En cas de contradiction (mots-clés = risque faible, graphe = relation
directe vers un fichier ancre sensible) → la règle déjà en place prévaut : **en cas
de doute, risque élevé**.

### 3. Brief d'implémentation

Pour le(s) fichier(s) que la tâche va probablement toucher : extraire un résumé texte
(communauté d'appartenance, God Nodes connectés, relations directes — équivalent
condensé de `/graphify explain "<fichier>"`). Écrit à la création du worktree
(Étape 3) sous :

```
.superpowers/sdd/<slug-tache>-graph-context.md
```

(convention de namespacing déjà en place depuis l'incident du 2026-07-18, évite toute
collision entre chantiers). Les sous-agents implémenteur/reviewer le lisent comme
n'importe quel autre fichier du worktree — aucun accès à `graphify-out/` requis.

## Gestion d'erreur

| Situation | Comportement |
|---|---|
| `detect_incremental()`/`/graphify --update` échoue (réseau, sous-agent coupé, etc.) | **Non bloquant.** Continue avec le `graph.json` existant (même périmé). Note "graphe non rafraîchi (raison)" dans le rapport Étape 7. Compteur `graphUpdateFailures` incrémenté dans le ledger. |
| Cap `GRAPH_UPDATE_MAX_SEMANTIC_FILES` dépassé | Dégradation silencieuse (AST seulement) — pas un échec, pas de compteur. |
| `graph.json` absent ou JSON invalide (illisible même périmé) | **Escalade** (gate rouge standard de l'Étape 7) — aucun repli possible, aucun sous-agent dispatché, worktree jamais créé. |
| `graphUpdateFailures ≥ 3` consécutifs | Message Telegram dédié ("⚠ graphe non rafraîchi depuis 3 runs"), en plus du message de fin de run habituel. Remis à 0 dès qu'une mise à jour réussit. |

Cette gestion volontairement asymétrique (souple sur le rafraîchissement, stricte sur
la lisibilité) évite qu'un simple aléa réseau bloque un run entier pour une tâche par
ailleurs triviale, tout en gardant une garantie dure sur l'intégrité du graphe utilisé
pour classifier le risque.

## Format du rapport (Étape 7, ledger)

Le format existant de `.superpowers/sdd/loop-runs.md` est étendu d'une ligne :

```markdown
## Run <horodatage ISO> — <id tâche>

- Tâche : <texte, fichier:ligne>
- Issue : commit `<hash>` | escaladé | backlog vide
- Risque : faible | élevé (<catégorie>)
- Graphe : rafraîchi | périmé (raison, N échecs consécutifs) | illisible (escalade)
- Gates : vitest <✅/❌> · tsc <✅/❌> · build <✅/❌> · playwright <✅/❌> · browser-use <✅/❌/n·a>
- Worktree : <chemin, conservé si escaladé, supprimé si commité>
- Détail / recommandation : <1-3 phrases>
```

## Fichiers modifiés par ce chantier

- `.claude/skills/loop-engineering/SKILL.md` — ajout Étape 1bis, mise à jour du
  format de ledger (Étape 7), mise à jour Étape 3 (copie du brief), mise à jour
  Étape 4 (le sous-agent reçoit le brief).
- `project-docs/loop-policy.md` — nouvelle sous-section "Communautés sensibles
  (graphe de connaissance)", nouvelle variable `GRAPH_UPDATE_MAX_SEMANTIC_FILES`,
  section datée ajoutée en bas (jamais d'écrasement, cohérent avec § "Évolution").
- `scripts/loop/telegram.local.json`/`notify-telegram.mjs` — pas de modification de
  structure, réutilisation du mécanisme best-effort existant pour l'alerte
  `graphUpdateFailures ≥ 3`.

## Tests / validation

1. **Test unitaire du refresh** : mock `detect_incremental()` retournant 0 / quelques
   / beaucoup de fichiers modifiés → vérifier skip / update normal / cap AST-only.
2. **Test du mapping communautés sensibles** : cas construit à la main (fichier connu
   de `NF525 Hash Chain Integrity`) → vérifier que le signal remonte à la
   classification sans remplacer la table mots-clés.
3. **Test de dégradation** : `graph.json` corrompu → escalade ; update seul en échec
   (graph.json intact) → continue + `graphUpdateFailures` incrémenté, pas
   d'escalade.
4. **Test du compteur** : 3 échecs consécutifs simulés → vérifier le message Telegram
   dédié déclenché, remis à 0 après un succès.
5. **Run manuel en conditions réelles** (`$env:LOOP_PERMISSION_MODE = "plan"`, comme
   documenté dans `project-docs/loop-runbook.md` § 7) sur une tâche `todo.md`
   connue à faible risque, avant d'activer sur la tâche planifiée horaire — vérifier
   concrètement le contenu de `.superpowers/sdd/<slug>-graph-context.md` généré.
6. **Pas de nouveau test Playwright/browser-use nécessaire** — chantier infra pur, ne
   touche aucun parcours utilisateur de l'application.

## Hors périmètre (explicitement)

- Résolution de l'incohérence 418/179 communautés et du cache sémantique vide —
  action manuelle préalable de l'utilisateur, pas une tâche de ce plan.
- Intégration du graphe dans d'autres skills que `loop-engineering` (ex. usage
  manuel en session interactive) — déjà fonctionnel via `/graphify query|path|explain`,
  inchangé par ce plan.
- Changement de la fréquence de la tâche planifiée Windows (reste horaire).
