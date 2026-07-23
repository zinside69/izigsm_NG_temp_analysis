#!/usr/bin/env node
/**
 * graphify-refresh.mjs — pont déterministe entre la loop-engineering et le graphe de
 * connaissance graphify (voir .claude/skills/loop-engineering/SKILL.md, Étape 1bis, et
 * docs/superpowers/specs/2026-07-23-graphify-loop-integration-design.md).
 *
 * Sous-commandes (voir project-docs/loop-policy.md) :
 *   verify                  → graphify-out/graph.json est-il lisible et bien formé ?
 *   plan                    → recommande skip/update/update_no_semantic
 *   record-result <status>  → compteur d'échecs consécutifs
 *   risk <file...>          → signal de proximité (lien direct) aux fichiers sensibles
 *   brief <file...>         → mini-contexte texte pour l'Étape 4
 *
 * N'appelle jamais /graphify --update lui-même (c'est un skill Claude invoqué dans la
 * session claude -p, pas un exécutable) — fournit seulement les données/recommandations
 * que la loop utilise pour décider.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const GRAPH_PATH = 'graphify-out/graph.json'
const COUNTER_PATH = 'scripts/loop/.graph-update-failures'
const CAP = Number(process.env.GRAPH_UPDATE_MAX_SEMANTIC_FILES || 5)

// python (pas python3) : sur ce poste python3 est un raccourci Microsoft Store qui
// échoue sans l'interpréteur réel installé (confirmé 2026-07-23, même contournement
// documenté dans graphify-out/MODE-OPERATOIRE.md et scripts/loop/check-quota.mjs).
const PYTHON_CMD = 'python'

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

function loadGraph() {
  if (!existsSync(GRAPH_PATH)) return null
  try {
    return JSON.parse(readFileSync(GRAPH_PATH, 'utf8'))
  } catch {
    return null
  }
}

function nodesForFile(graph, file) {
  return graph.nodes.filter(n => normPath(n.source_file) === file)
}

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
    console.log(JSON.stringify({ action: 'update_failed', reason: `detect_incremental en échec : ${err.message}` }))
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
  const [, , cmd, ...rest] = process.argv
  if (cmd === 'verify') return cmdVerify()
  if (cmd === 'plan') return cmdPlan()
  if (cmd === 'record-result') return cmdRecordResult(rest[0])
  if (cmd === 'risk') return cmdRisk(rest)
  if (cmd === 'brief') return cmdBrief(rest)
  console.error('Usage: node graphify-refresh.mjs <verify|plan|record-result|risk|brief> [args...]')
  process.exit(2)
}

main()
