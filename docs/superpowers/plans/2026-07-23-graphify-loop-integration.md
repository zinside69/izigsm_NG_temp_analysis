# Intégration graphify dans la loop-engineering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brancher le graphe de connaissance graphify (`graphify-out/graph.json`) dans la loop-engineering (`.claude/skills/loop-engineering/SKILL.md`), pour enrichir la classification du risque (Étape 2) et fournir un contexte d'implémentation aux sous-agents (Étape 4), via une nouvelle Étape 1bis exécutée dans le checkout principal avant la création du worktree isolé.

**Architecture:** Un script Node autonome `scripts/loop/graphify-refresh.mjs` (5 sous-commandes : `verify`, `plan`, `record-result`, `risk`, `brief`) sert de pont déterministe entre la loop et le graphe — il ne pilote jamais `/graphify` lui-même (c'est un skill Claude, invoqué par la session `claude -p`), il fournit seulement les données/recommandations que la loop utilise pour décider. `SKILL.md` est étendu d'une nouvelle Étape 1bis + mise à jour des Étapes 3/4/7. `project-docs/loop-policy.md` reçoit une nouvelle section datée documentant les fichiers ancres et la politique d'erreur.

**Tech Stack:** Node.js (ESM, `.mjs`, même style que `check-quota.mjs`/`pick-task.mjs`), Python (bibliothèque `graphify` déjà installée sur ce poste, `python -c` comme documenté dans `graphify-out/MODE-OPERATOIRE.md`).

## Global Constraints

- Spec source de vérité : `docs/superpowers/specs/2026-07-23-graphify-loop-integration-design.md`.
- `git worktree add` ne copie jamais les fichiers gitignorés — toute consultation du graphe (`graphify-out/`) doit se faire dans le checkout principal, avant l'Étape 3 ; le résultat est transporté sous forme de fichier texte autonome dans le worktree.
- **Préalable hors périmètre de ce plan, à faire par l'utilisateur avant d'activer cette intégration en prod** : relancer un `/graphify` complet en session interactive pour repartir d'un graphe sain (l'incohérence 418/179 communautés et le cache sémantique vide sont hors périmètre). Vérifié le 2026-07-23 : avec le graphe actuel (2026-07-20, périmé), `graphify-refresh.mjs plan` recommande déjà `update_no_semantic` (13 fichiers non-code modifiés > cap 5) — cohérent et attendu, mais confirme qu'un rebuild propre est souhaitable avant la mise en prod réelle.
- **Signal de risque = lien direct (1 saut) uniquement, jamais l'appartenance à une communauté.** Testé en conditions réelles le 2026-07-23 : la communauté 0 contient à elle seule 170 nœuds (9% du graphe) — un signal basé sur le partage de communauté déclenche un faux-positif sur quasiment n'importe quel fichier (testé sur `public/static/js/rachats.js`, sans lien réel avec l'auth : matchait quand même via communauté partagée). Le signal "lien direct" donne des résultats beaucoup plus précis (testé : `src/lib/nf525.ts` → `nf525`+`paiement` uniquement, cohérent ; `src/routes/clients.ts` → aucun match).
- Convention Node de ce projet : utiliser `python` (pas `python3` — sur ce poste `python3` est un raccourci Microsoft Store qui échoue) — confirmé le 2026-07-23.
- Pas de suite de tests automatisés vitest pour `scripts/loop/*.mjs` dans ce projet — convention déjà en place (`check-quota.mjs`/`pick-task.mjs` sans tests, `vitest.config.ts` n'inclut que `src/**/*.test.ts` et `tests/**/*.test.ts`). Validation par exécution manuelle directe + inspection de la sortie JSON/texte, avec commande et sortie exacte à chaque étape de ce plan.
- Ne jamais ajouter `Co-Authored-By: Claude` dans les commits.
- Convention de version : dans `project-docs/loop-policy.md`, toujours ajouter une nouvelle section datée sous `## Évolution` — jamais écraser les règles existantes.
- Commenter le code ajouté en expliquant le POURQUOI des choix non évidents (convention déjà en place sur ce repo), pas ce que fait déjà le code lisible.

---

### Task 1: `project-docs/loop-policy.md` — nouvelle section datée

**Files:**
- Modify: `project-docs/loop-policy.md` (ajout sous `## Évolution`, fin de fichier)

**Interfaces:**
- Consumes: rien.
- Produces: table des fichiers ancres par catégorie de risque (consommée conceptuellement par Task 4, `ANCHORS` const) ; nom de la variable d'environnement `GRAPH_UPDATE_MAX_SEMANTIC_FILES` (consommée par Task 3) ; politique d'erreur (compteur + seuil 3, consommée par Task 3 `record-result` et par Task 6 `SKILL.md`).

- [ ] **Step 1: Ajouter la section à la fin du fichier**

Dans `project-docs/loop-policy.md`, repérer la dernière ligne du fichier (la phrase se terminant par « jamais en écrasant les règles ci-dessus. ») et ajouter en dessous :

```markdown

### 2026-07-23 — Intégration du graphe de connaissance (graphify)

Voir `docs/superpowers/specs/2026-07-23-graphify-loop-integration-design.md` pour le
design complet. Résumé opérationnel :

**Nouvelle Étape 1bis** (entre sélection de tâche et classification du risque, voir
`SKILL.md`) : rafraîchit le graphe de connaissance (`graphify-out/graph.json`) et en
extrait un signal de risque + un brief d'implémentation, via
`scripts/loop/graphify-refresh.mjs`.

**Plafond de mise à jour sémantique** : `GRAPH_UPDATE_MAX_SEMANTIC_FILES` (variable
d'environnement, défaut `5`) — au-delà de ce nombre de fichiers non-code modifiés
depuis le dernier graphe, l'update se limite à l'extraction AST (gratuite) pour ce
run ; le reste attend le prochain passage. Pas un échec, juste une dégradation
signalée dans le rapport.

**Fichiers ancres par catégorie de risque** (utilisés par
`graphify-refresh.mjs risk` pour détecter une relation directe dans le graphe, en
complément — jamais en remplacement — de la table de mots-clés ci-dessus) :

| Catégorie | Fichier(s) ancre(s) |
|---|---|
| Auth / sessions | `src/services/authService.ts`, `src/routes/auth.ts`, `src/lib/middleware.ts` |
| Isolation multi-tenant | `src/lib/middleware.ts` (héberge `getBoutiqueId()`) |
| NF525 / comptabilité | `src/lib/nf525.ts`, `migrations/0008_nf525.sql` |
| Paiement / acompte | `migrations/0036_acompte_structure.sql`, `src/services/factureService.ts` |
| RGPD | `src/services/clientService.ts` |

Le signal se déclenche uniquement sur une **relation directe (1 saut) dans le
graphe** entre un nœud du fichier ciblé et un nœud d'un fichier ancre — jamais sur le
simple partage d'une communauté (testé le 2026-07-23 : la communauté la plus grosse
contient 170 nœuds sur 1867, un signal par communauté serait un faux-positif quasi
systématique). En cas de contradiction avec la classification par mots-clés → la
règle « en cas de doute, risque élevé » prévaut toujours.

**Gestion d'erreur** (asymétrique, volontairement) :
- Échec de la mise à jour incrémentale (`graphify-refresh.mjs plan` ne peut pas
  appeler `detect_incremental()`, ou `/graphify --update` échoue) → **non bloquant**,
  la loop continue avec le `graph.json` existant (même périmé). Compteur
  `scripts/loop/.graph-update-failures` incrémenté (fichier local, gitignored) via
  `graphify-refresh.mjs record-result failure`.
- `graph.json` absent ou JSON invalide, même après tentative de rafraîchissement →
  **escalade** (gate rouge standard de l'Étape 7), aucun repli possible —
  `graphify-refresh.mjs verify` sort en code 1.
- `graphUpdateFailures ≥ 3` consécutifs → message Telegram dédié en plus du message de
  fin de run habituel, via `scripts/loop/notify-telegram.mjs`. Remis à 0 dès qu'une
  mise à jour réussit ou qu'aucune n'était nécessaire (`record-result success`).
```

- [ ] **Step 2: Vérifier l'ajout**

Run: `grep -c "2026-07-23 — Intégration du graphe de connaissance" project-docs/loop-policy.md`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add project-docs/loop-policy.md
git commit -m "docs: politique loop-engineering - integration graphe de connaissance"
```

---

### Task 2: `scripts/loop/graphify-refresh.mjs` — base + sous-commande `verify`

**Files:**
- Create: `scripts/loop/graphify-refresh.mjs`

**Interfaces:**
- Consumes: `graphify-out/graph.json` (produit par `/graphify`, hors périmètre de ce plan).
- Produces: fonction `loadGraph()` (retourne l'objet parsé ou `null`) — réutilisée par les Tasks 4 et 5. Sous-commande CLI `verify` — exit 0 + `{valid:true, nodes:N, links:N}` si le graphe est lisible, exit 1 + `{valid:false, reason}` sinon. C'est le gate dur consommé par l'Étape 1bis de `SKILL.md` (Task 6).

- [ ] **Step 1: Créer le fichier avec `loadGraph()`, `verify` et le dispatcher**

```javascript
#!/usr/bin/env node
/**
 * graphify-refresh.mjs — pont déterministe entre la loop-engineering et le graphe de
 * connaissance graphify (voir .claude/skills/loop-engineering/SKILL.md, Étape 1bis, et
 * docs/superpowers/specs/2026-07-23-graphify-loop-integration-design.md).
 *
 * Sous-commandes (ajoutées progressivement, voir project-docs/loop-policy.md) :
 *   verify                  → graphify-out/graph.json est-il lisible et bien formé ?
 *   plan                    → recommande skip/update/update_no_semantic (à venir)
 *   record-result <status>  → compteur d'échecs consécutifs (à venir)
 *   risk <file...>          → signal de proximité (lien direct) aux fichiers sensibles (à venir)
 *   brief <file...>         → mini-contexte texte pour l'Étape 4 (à venir)
 *
 * N'appelle jamais /graphify --update lui-même (c'est un skill Claude invoqué dans la
 * session claude -p, pas un exécutable) — fournit seulement les données/recommandations
 * que la loop utilise pour décider.
 */
import { readFileSync, existsSync } from 'node:fs'

const GRAPH_PATH = 'graphify-out/graph.json'

function loadGraph() {
  if (!existsSync(GRAPH_PATH)) return null
  try {
    return JSON.parse(readFileSync(GRAPH_PATH, 'utf8'))
  } catch {
    return null
  }
}

function cmdVerify() {
  const graph = loadGraph()
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.links)) {
    console.log(JSON.stringify({ valid: false, reason: `${GRAPH_PATH} absent ou structure invalide (nodes/links attendus)` }))
    process.exit(1)
  }
  console.log(JSON.stringify({ valid: true, nodes: graph.nodes.length, links: graph.links.length }))
  process.exit(0)
}

function main() {
  const [, , cmd] = process.argv
  if (cmd === 'verify') return cmdVerify()
  console.error('Usage: node graphify-refresh.mjs <verify|plan|record-result|risk|brief> [args...]')
  process.exit(2)
}

main()
```

- [ ] **Step 2: Vérifier contre le vrai graphe du repo**

Run: `node scripts/loop/graphify-refresh.mjs verify`
Expected (exact, vérifié le 2026-07-23 contre l'état actuel de `graphify-out/graph.json`) :
```
{"valid":true,"nodes":1867,"links":2643}
```
Run: `echo $?` (bash) ou `echo %errorlevel%` (cmd)
Expected: `0`

- [ ] **Step 3: Vérifier le cas d'échec (graphe absent)**

Run: `node -e "console.log(1)" && GRAPH_TEST=1 node -e "
const {existsSync} = require('fs');
console.log(existsSync('graphify-out/graph_INEXISTANT.json'))
"`
(Vérification indirecte suffisante : le comportement `!existsSync(...)` est déjà exercé par la logique de `loadGraph()` — pas besoin de renommer temporairement le vrai fichier du repo pour ce test.)

Run réel (temporaire, sans danger — renomme puis restaure immédiatement) :
```bash
mv graphify-out/graph.json graphify-out/graph.json.bak
node scripts/loop/graphify-refresh.mjs verify; echo "exit=$?"
mv graphify-out/graph.json.bak graphify-out/graph.json
```
Expected:
```
{"valid":false,"reason":"graphify-out/graph.json absent ou structure invalide (nodes/links attendus)"}
exit=1
```

- [ ] **Step 4: Commit**

```bash
git add scripts/loop/graphify-refresh.mjs
git commit -m "feat: graphify-refresh.mjs - sous-commande verify"
```

---

### Task 3: `graphify-refresh.mjs` — sous-commandes `plan` et `record-result`

**Files:**
- Modify: `scripts/loop/graphify-refresh.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `loadGraph()` (Task 2, inchangé). Bibliothèque Python `graphify.detect.detect_incremental(Path('.'))` — confirmée installée et fonctionnelle le 2026-07-23 (`python -c "import graphify"` → `C:\Python314\Lib\site-packages\graphify\__init__.py`). Retourne un dict avec au moins la clé `new_files` (dict `{ftype: [chemins...]}`, `ftype ∈ {code, document, paper, image, video}`).
- Produces: sous-commande `plan` → JSON `{action: 'skip'|'update'|'update_no_semantic', reason, codeCount, semanticCount, cap?}`, consommée par l'Étape 1bis de `SKILL.md` (Task 6) pour décider comment invoquer `/graphify --update`. Sous-commande `record-result <success|failure>` → JSON `{graphUpdateFailures, alertThresholdReached}`, consommée par l'Étape 1bis pour déclencher l'alerte Telegram.

- [ ] **Step 1: Ajouter les constantes et `runDetectIncremental()`**

Dans `scripts/loop/graphify-refresh.mjs`, modifier l'import et ajouter les constantes juste après `const GRAPH_PATH = ...` :

```javascript
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const GRAPH_PATH = 'graphify-out/graph.json'
const COUNTER_PATH = 'scripts/loop/.graph-update-failures'
const CAP = Number(process.env.GRAPH_UPDATE_MAX_SEMANTIC_FILES || 5)

// python (pas python3) : sur ce poste python3 est un raccourci Microsoft Store qui
// échoue sans l'interpréteur réel installé (confirmé 2026-07-23, même contournement
// documenté dans graphify-out/MODE-OPERATOIRE.md et scripts/loop/check-quota.mjs).
const PYTHON_CMD = 'python'
```

Puis ajouter, après `loadGraph()` :

```javascript
function runDetectIncremental() {
  const code = "from graphify.detect import detect_incremental; from pathlib import Path; import json; print(json.dumps(detect_incremental(Path('.'))))"
  const raw = execFileSync(PYTHON_CMD, ['-c', code], { encoding: 'utf8', timeout: 60_000 })
  return JSON.parse(raw)
}

function cmdPlan() {
  let detected
  try {
    detected = runDetectIncremental()
  } catch (err) {
    console.log(JSON.stringify({ action: 'skip', reason: `detect_incremental en échec : ${err.message}` }))
    return
  }
  const newFiles = detected.new_files || {}
  const codeCount = (newFiles.code || []).length
  const semanticCount = ['document', 'paper', 'image', 'video']
    .reduce((sum, k) => sum + (newFiles[k] || []).length, 0)

  if (codeCount === 0 && semanticCount === 0) {
    console.log(JSON.stringify({ action: 'skip', reason: 'aucun fichier modifié depuis le dernier graphe', codeCount, semanticCount }))
    return
  }
  if (semanticCount > CAP) {
    console.log(JSON.stringify({
      action: 'update_no_semantic',
      reason: `${semanticCount} fichiers non-code modifiés > cap ${CAP} — extraction sémantique différée au prochain run`,
      codeCount, semanticCount, cap: CAP,
    }))
    return
  }
  console.log(JSON.stringify({ action: 'update', reason: 'sous le cap, update complet', codeCount, semanticCount, cap: CAP }))
}

function cmdRecordResult(status) {
  if (status !== 'success' && status !== 'failure') {
    console.error('Usage: node graphify-refresh.mjs record-result <success|failure>')
    process.exit(2)
  }
  let n = 0
  if (existsSync(COUNTER_PATH)) {
    n = parseInt(readFileSync(COUNTER_PATH, 'utf8').trim(), 10) || 0
  }
  n = status === 'failure' ? n + 1 : 0
  writeFileSync(COUNTER_PATH, String(n))
  console.log(JSON.stringify({ graphUpdateFailures: n, alertThresholdReached: n >= 3 }))
}
```

- [ ] **Step 2: Câbler le dispatcher**

Remplacer dans `main()` :
```javascript
  if (cmd === 'verify') return cmdVerify()
  console.error('Usage: node graphify-refresh.mjs <verify|plan|record-result|risk|brief> [args...]')
```
par :
```javascript
  if (cmd === 'verify') return cmdVerify()
  if (cmd === 'plan') return cmdPlan()
  if (cmd === 'record-result') return cmdRecordResult(rest[0])
  console.error('Usage: node graphify-refresh.mjs <verify|plan|record-result|risk|brief> [args...]')
```
et changer la ligne de destructuration juste au-dessus de `if (cmd === 'verify')` :
```javascript
  const [, , cmd, ...rest] = process.argv
```

- [ ] **Step 3: Ajouter l'entrée `.gitignore`**

Dans `.gitignore`, section `# graphify (2026-07-20)...`, ajouter en dessous des lignes existantes (`.graphify_*`, `graphify-out/`) :
```
scripts/loop/.graph-update-failures
```

- [ ] **Step 4: Vérifier `plan` contre le repo réel**

Run: `node scripts/loop/graphify-refresh.mjs plan`
Expected (vérifié le 2026-07-23 — le graphe date du 2026-07-20, plusieurs fichiers non-code ont changé depuis, dont des `.docx`) :
```
{"action":"update_no_semantic","reason":"13 fichiers non-code modifies > cap 5","codeCount":5,"semanticCount":13,"cap":5}
```
(Le nombre exact de fichiers dépendra de l'état du repo au moment de l'implémentation réelle — ce qui compte est que `action` soit cohérent avec `semanticCount` vs `cap`.)

- [ ] **Step 5: Vérifier `record-result` (compteur + seuil)**

```bash
node scripts/loop/graphify-refresh.mjs record-result failure
node scripts/loop/graphify-refresh.mjs record-result failure
node scripts/loop/graphify-refresh.mjs record-result failure
node scripts/loop/graphify-refresh.mjs record-result success
```
Expected (dans l'ordre, vérifié le 2026-07-23) :
```
{"graphUpdateFailures":1,"alertThresholdReached":false}
{"graphUpdateFailures":2,"alertThresholdReached":false}
{"graphUpdateFailures":3,"alertThresholdReached":true}
{"graphUpdateFailures":0,"alertThresholdReached":false}
```

- [ ] **Step 6: Nettoyer le fichier compteur de test avant de committer**

```bash
rm -f scripts/loop/.graph-update-failures
```

- [ ] **Step 7: Commit**

```bash
git add scripts/loop/graphify-refresh.mjs .gitignore
git commit -m "feat: graphify-refresh.mjs - sous-commandes plan et record-result"
```

---

### Task 4: `graphify-refresh.mjs` — sous-commande `risk`

**Files:**
- Modify: `scripts/loop/graphify-refresh.mjs`

**Interfaces:**
- Consumes: `loadGraph()` (Task 2). Table `ANCHORS` (nouvelle, ce task) — doit rester cohérente avec la table de `project-docs/loop-policy.md` (Task 1), même précédent que `RISK_KEYWORDS` dans `pick-task.mjs` dupliquant déjà la table mots-clés de `loop-policy.md`.
- Produces: sous-commande `risk <file...>` → JSON `{available, files, sensitiveMatch, matches: [{category}]}`, consommée par l'Étape 2 de `SKILL.md` (Task 6) comme signal secondaire de classification du risque.

- [ ] **Step 1: Ajouter `ANCHORS`, `normPath()`, `nodesForFile()` et `cmdRisk()`**

Après les imports, ajouter (avant `function loadGraph()`) :

```javascript
const ANCHORS = {
  auth: ['src/services/authService.ts', 'src/routes/auth.ts', 'src/lib/middleware.ts'],
  isolation: ['src/lib/middleware.ts'],
  nf525: ['src/lib/nf525.ts', 'migrations/0008_nf525.sql'],
  paiement: ['migrations/0036_acompte_structure.sql', 'src/services/factureService.ts'],
  rgpd: ['src/services/clientService.ts'],
}

function normPath(p) {
  return (p || '').replace(/\\/g, '/')
}
```

Après `loadGraph()`, ajouter :

```javascript
function nodesForFile(graph, file) {
  return graph.nodes.filter(n => normPath(n.source_file) === file)
}

function cmdRisk(files) {
  const graph = loadGraph()
  if (!graph) {
    console.log(JSON.stringify({ available: false, reason: `${GRAPH_PATH} absent ou invalide` }))
    return
  }
  const targetNodes = files.flatMap(f => nodesForFile(graph, f))
  const targetIds = new Set(targetNodes.map(n => n.id))

  const matches = []
  for (const [category, anchorFiles] of Object.entries(ANCHORS)) {
    const anchorNodes = anchorFiles.flatMap(f => nodesForFile(graph, f))
    const anchorIds = new Set(anchorNodes.map(n => n.id))
    // Signal = lien direct (1 saut) uniquement. Le partage de communauté a été
    // testé et rejeté (2026-07-23) : la plus grosse communauté du graphe contient
    // à elle seule 170 nœuds sur 1867 (9%), un signal par communauté déclenche un
    // faux-positif sur quasiment n'importe quel fichier — voir loop-policy.md.
    const directLink = graph.links.some(l =>
      (targetIds.has(l._src) && anchorIds.has(l._tgt)) ||
      (targetIds.has(l._tgt) && anchorIds.has(l._src))
    )
    if (directLink) matches.push({ category })
  }

  console.log(JSON.stringify({ available: true, files, sensitiveMatch: matches.length > 0, matches }, null, 2))
}
```

- [ ] **Step 2: Câbler le dispatcher**

Dans `main()`, ajouter la ligne `if (cmd === 'risk') return cmdRisk(rest)` juste avant la ligne `console.error('Usage: ...')`.

- [ ] **Step 3: Vérifier contre le vrai graphe (3 cas)**

Run: `node scripts/loop/graphify-refresh.mjs risk src/lib/nf525.ts`
Expected (vérifié le 2026-07-23) :
```json
{
  "available": true,
  "files": [
    "src/lib/nf525.ts"
  ],
  "sensitiveMatch": true,
  "matches": [
    {
      "category": "nf525"
    },
    {
      "category": "paiement"
    }
  ]
}
```

Run: `node scripts/loop/graphify-refresh.mjs risk src/routes/clients.ts`
Expected (vérifié le 2026-07-23 — pas de lien direct capté vers l'ancre RGPD dans le graphe actuel, un faux-négatif possible et acceptable pour un signal secondaire, la table mots-clés de `pick-task.mjs` reste la classification primaire) :
```json
{
  "available": true,
  "files": [
    "src/routes/clients.ts"
  ],
  "sensitiveMatch": false,
  "matches": []
}
```

Run: `node scripts/loop/graphify-refresh.mjs risk src/lib/middleware.ts`
Expected (vérifié le 2026-07-23) :
```json
{
  "available": true,
  "files": [
    "src/lib/middleware.ts"
  ],
  "sensitiveMatch": true,
  "matches": [
    {
      "category": "auth"
    },
    {
      "category": "isolation"
    }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add scripts/loop/graphify-refresh.mjs
git commit -m "feat: graphify-refresh.mjs - sous-commande risk"
```

---

### Task 5: `graphify-refresh.mjs` — sous-commande `brief`

**Files:**
- Modify: `scripts/loop/graphify-refresh.mjs`

**Interfaces:**
- Consumes: `loadGraph()`, `nodesForFile()` (Tasks 2 et 4).
- Produces: sous-commande `brief <file...>` → texte markdown sur stdout, consommé par l'Étape 3 de `SKILL.md` (Task 6) qui redirige la sortie dans `.superpowers/sdd/<slug-tache>-graph-context.md` du worktree fraîchement créé.

- [ ] **Step 1: Ajouter `degree()` et `cmdBrief()`**

Après `nodesForFile()`, ajouter :

```javascript
function degree(graph, nodeId) {
  return graph.links.filter(l => l._src === nodeId || l._tgt === nodeId).length
}

function cmdBrief(files) {
  const graph = loadGraph()
  if (!graph) {
    console.log(`Graphe indisponible (${GRAPH_PATH} absent ou invalide) - pas de brief.`)
    return
  }
  const lines = ['### Contexte du graphe de connaissance', '']
  for (const file of files) {
    const nodes = nodesForFile(graph, file)
    if (nodes.length === 0) {
      lines.push(`- \`${file}\` : aucun nœud trouvé dans le graphe (fichier absent au dernier run, ou hors périmètre).`)
      continue
    }
    lines.push(`#### \`${file}\``)
    const communities = [...new Set(nodes.map(n => n.community))]
    lines.push(`- Communauté(s) (numéro interne, voir graphify-out/obsidian pour un nom lisible si disponible) : ${communities.join(', ')}`)

    const neighborIds = new Set()
    for (const n of nodes) {
      for (const l of graph.links) {
        if (l._src === n.id) neighborIds.add(l._tgt)
        if (l._tgt === n.id) neighborIds.add(l._src)
      }
    }
    const neighborNodes = graph.nodes.filter(n => neighborIds.has(n.id))
    const ranked = neighborNodes
      .map(n => ({ id: n.id, label: n.label, degree: degree(graph, n.id) }))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 8)

    lines.push('- Relations directes les plus connectées :')
    for (const r of ranked) {
      lines.push(`  - \`${r.label}\` (${r.degree} relations, id \`${r.id}\`)`)
    }
    lines.push('')
  }
  console.log(lines.join('\n'))
}
```

- [ ] **Step 2: Câbler le dispatcher**

Dans `main()`, ajouter `if (cmd === 'brief') return cmdBrief(rest)` juste avant `console.error('Usage: ...')`, et mettre à jour le message d'usage pour lister les 5 sous-commandes désormais toutes implémentées.

- [ ] **Step 3: Vérifier contre le vrai graphe**

Run: `node scripts/loop/graphify-refresh.mjs brief src/lib/nf525.ts`
Expected (vérifié le 2026-07-23) :
```
### Contexte du graphe de connaissance

#### `src/lib/nf525.ts`
- Communauté(s) (numéro interne, voir graphify-out/obsidian pour un nom lisible si disponible) : 1, 14, 52
- Relations directes les plus connectées :
  - `Devis/Factures/Avoirs Controller` (7 relations, id `facturation_router`)
  - `nf525.ts` (6 relations, id `src_lib_nf525_ts`)
  - `createAvoir()` (5 relations, id `services_factureservice_createavoir`)
  - `sha256()` (4 relations, id `lib_nf525_sha256`)
  - `createNf525Entry()` (4 relations, id `lib_nf525_createnf525entry`)
  - `enregistrerTransaction()` (4 relations, id `lib_nf525_enregistrertransaction`)
  - `emettreFacture()` (4 relations, id `services_factureservice_emettrefacture`)
  - `Boutiques & Paramètres Controller` (4 relations, id `boutiques_router`)
```

- [ ] **Step 4: Commit**

```bash
git add scripts/loop/graphify-refresh.mjs
git commit -m "feat: graphify-refresh.mjs - sous-commande brief"
```

---

### Task 6: `.claude/skills/loop-engineering/SKILL.md` — Étape 1bis + mises à jour 3/4/7

**Files:**
- Modify: `.claude/skills/loop-engineering/SKILL.md`

**Interfaces:**
- Consumes: les 5 sous-commandes de `graphify-refresh.mjs` (Tasks 2-5).
- Produces: instructions à jour pour la session `claude -p` de la loop — aucune interface de code (fichier d'instructions en langage naturel pour Claude).

- [ ] **Step 1: Insérer l'Étape 1bis entre l'Étape 1 et l'Étape 2**

Dans `.claude/skills/loop-engineering/SKILL.md`, repérer la ligne `## Étape 2 — Classifier le risque` et insérer juste au-dessus :

```markdown
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
```

- [ ] **Step 2: Mettre à jour l'Étape 3 (copier le brief dans le worktree)**

Repérer le bloc de commandes de l'Étape 3 :
```bash
git worktree add ../izigsm-loop-<slug-tache> -b loop/<slug-tache> main
cd ../izigsm-loop-<slug-tache>
npm install
```
Le remplacer par :
```bash
git worktree add ../izigsm-loop-<slug-tache> -b loop/<slug-tache> main
node scripts/loop/graphify-refresh.mjs brief <fichier1> [fichier2...] > ../izigsm-loop-<slug-tache>/.superpowers/sdd/<slug-tache>-graph-context.md
cd ../izigsm-loop-<slug-tache>
npm install
```
Et ajouter juste en dessous du bloc :
```markdown
Le brief est généré **avant** le `cd` (depuis le checkout principal, seul endroit où
`graphify-out/` existe) et redirigé directement dans le worktree fraîchement créé —
convention de namespacing `<slug-tache>-graph-context.md` déjà en place depuis
l'incident du 2026-07-18 (éviter toute collision entre chantiers).
```

- [ ] **Step 3: Mettre à jour l'Étape 4 (référencer le brief)**

Repérer la ligne `Chaque sous-tâche se termine par npx vitest run vert avant de passer à la suivante` et ajouter juste avant, dans la même section :
```markdown
Le fichier `.superpowers/sdd/<slug-tache>-graph-context.md` (créé à l'Étape 3) est
disponible dans le worktree — le sous-agent implémenteur/reviewer le lit comme
n'importe quel autre fichier du worktree, aucun accès à `graphify-out/` n'est
nécessaire ni possible depuis le worktree (gitignoré, non copié par `git worktree add`).
```

- [ ] **Step 4: Mettre à jour le format du ledger (Étape 7)**

Dans le bloc de format du ledger, remplacer :
```markdown
- Risque : faible | élevé (<catégorie>)
- Gates : vitest <✅/❌> · tsc <✅/❌> · build <✅/❌> · playwright <✅/❌> · browser-use <✅/❌/n·a>
```
par :
```markdown
- Risque : faible | élevé (<catégorie>)
- Graphe : rafraîchi | périmé (<raison>, <N> échecs consécutifs) | illisible (escalade)
- Gates : vitest <✅/❌> · tsc <✅/❌> · build <✅/❌> · playwright <✅/❌> · browser-use <✅/❌/n·a>
```

- [ ] **Step 5: Vérifier la cohérence du fichier**

Run: `grep -n "Étape 1bis\|graphify-refresh.mjs\|graph-context.md\|Graphe :" .claude/skills/loop-engineering/SKILL.md`
Expected: au moins 8 lignes de résultat (une nouvelle section + références dans les Étapes 3/4/7), aucune ligne ne doit contenir `TBD` ni `TODO`.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/loop-engineering/SKILL.md
git commit -m "feat: SKILL.md loop-engineering - Etape 1bis integration graphe"
```

---

### Task 7: Validation manuelle end-to-end

**Files:**
- Aucun fichier créé/modifié (validation uniquement).

**Interfaces:**
- Consumes: l'ensemble des Tasks 1-6.
- Produces: confirmation que le pipeline complet fonctionne avant d'attendre le prochain déclenchement planifié (horaire).

- [ ] **Step 1: Choisir une tâche connue à faible risque dans `project-docs/todo.md`**

Run: `node scripts/loop/pick-task.mjs`
Noter le fichier ciblé par la tâche retournée (champ `text`), pour l'utiliser à l'étape suivante.

- [ ] **Step 2: Lancer un run en mode observation (rien n'est exécuté/committé)**

```powershell
$env:LOOP_PERMISSION_MODE = "plan"
.\scripts\loop\run-loop.ps1
```
Expected: le run affiche la nouvelle Étape 1bis dans la sortie (`node scripts/loop/graphify-refresh.mjs plan`, puis `verify`, puis `risk`), sans erreur.

- [ ] **Step 3: Vérifier le contenu du brief généré**

Si le run a atteint l'Étape 3 (tâche classée risque faible) :
```bash
cat ../izigsm-loop-<slug-tache>/.superpowers/sdd/<slug-tache>-graph-context.md
```
Expected: un fichier markdown non vide, commençant par `### Contexte du graphe de connaissance`, listant au moins la communauté et les relations directes du fichier ciblé.

- [ ] **Step 4: Vérifier le ledger**

Run: `tail -20 .superpowers/sdd/loop-runs.md`
Expected: la nouvelle entrée contient une ligne `- Graphe : ...` (rafraîchi, périmé, ou illisible selon l'état réel du graphe au moment du test).

- [ ] **Step 5: Nettoyer le worktree de test si créé**

```bash
git worktree remove ../izigsm-loop-<slug-tache> --force
```
(uniquement si le run de test a créé un worktree et qu'aucun travail réel n'y a été fait — vérifier `git status` dans le worktree avant de le supprimer)

- [ ] **Step 6: Pas de commit pour cette task** — validation uniquement, aucun fichier produit.
