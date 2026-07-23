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
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const GRAPH_PATH = 'graphify-out/graph.json'
const COUNTER_PATH = 'scripts/loop/.graph-update-failures'
const CAP = Number(process.env.GRAPH_UPDATE_MAX_SEMANTIC_FILES || 5)

// python (pas python3) : sur ce poste python3 est un raccourci Microsoft Store qui
// échoue sans l'interpréteur réel installé (confirmé 2026-07-23, même contournement
// documenté dans graphify-out/MODE-OPERATOIRE.md et scripts/loop/check-quota.mjs).
const PYTHON_CMD = 'python'

function loadGraph() {
  if (!existsSync(GRAPH_PATH)) return null
  try {
    return JSON.parse(readFileSync(GRAPH_PATH, 'utf8'))
  } catch {
    return null
  }
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
  console.error('Usage: node graphify-refresh.mjs <verify|plan|record-result|risk|brief> [args...]')
  process.exit(2)
}

main()
