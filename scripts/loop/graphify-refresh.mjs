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
