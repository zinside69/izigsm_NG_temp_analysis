#!/usr/bin/env node
/**
 * pick-task.mjs — sélection déterministe de la prochaine tâche du backlog.
 *
 * Lit project-docs/todo.md (priorité) puis docs/TODO.md, extrait les lignes
 * `- [ ]` (non cochées), les associe au dernier titre `##`/`###` rencontré,
 * et retourne la première tâche éligible en JSON sur stdout.
 *
 * Usage : node scripts/loop/pick-task.mjs [--all] [--skip <id1,id2,...>]
 *   --all         liste toutes les tâches candidates au lieu d'une seule
 *   --skip <ids>  ignore les ids déjà escaladés/traités dans ce run
 *
 * N'écrit rien sur disque — la décision de traiter/escalader/cocher revient
 * au skill loop-engineering, pas à ce script. Volontairement sans dépendance
 * npm (exécutable même avant `npm install`).
 */

import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'

const RISK_KEYWORDS = [
  'auth', 'authentification', 'jwt', 'oauth', 'google auth',
  'boutique_id', 'isolation', 'multi-tenant', 'multi-boutique',
  'nf525', 'journal', 'facture', 'facturation', 'comptab',
  'rgpd', 'purge',
  'stripe', 'paiement', 'acompte', 'avoir',
  'migration', '.sql',
  'xss', 'injection', 'sécurité', 'securite', 'faille',
]

const PRIORITY_MARKERS = ['🔴', 'PRIORITÉ', 'PRIORITE', 'CRITIQUE', 'URGENT']

const SOURCES = [
  { file: 'project-docs/todo.md', weight: 0 }, // priorité : lu en premier
  { file: 'docs/TODO.md', weight: 1 },
]

function parseFile(relPath, weight) {
  if (!existsSync(relPath)) return []
  const lines = readFileSync(relPath, 'utf8').split('\n')
  const tasks = []
  let currentHeading = ''
  let headingIsPriority = false

  lines.forEach((line, idx) => {
    const headingMatch = line.match(/^(#{2,4})\s+(.*)$/)
    if (headingMatch) {
      currentHeading = headingMatch[2].trim()
      headingIsPriority = PRIORITY_MARKERS.some(m => currentHeading.toUpperCase().includes(m.toUpperCase()))
      return
    }
    const taskMatch = line.match(/^(\s*)-\s*\[ \]\s+(.*)$/)
    if (!taskMatch) return

    const text = taskMatch[2].trim()
    if (!text) return

    const isPriority = headingIsPriority || PRIORITY_MARKERS.some(m => text.toUpperCase().includes(m.toUpperCase()))
    const isLoopSafe = /\[loop-safe\]/i.test(text)
    const riskHintHit = RISK_KEYWORDS.filter(k => text.toLowerCase().includes(k))

    const id = createHash('sha1').update(`${relPath}:${idx}:${text}`).digest('hex').slice(0, 10)

    tasks.push({
      id,
      file: relPath,
      line: idx + 1,
      heading: currentHeading,
      text,
      priority: isPriority,
      loopSafe: isLoopSafe,
      riskHint: riskHintHit.length > 0 ? riskHintHit : null,
      sourceWeight: weight,
    })
  })

  return tasks
}

function main() {
  const args = process.argv.slice(2)
  const showAll = args.includes('--all')
  const skipIdx = args.indexOf('--skip')
  const skipIds = skipIdx >= 0 ? (args[skipIdx + 1] || '').split(',').filter(Boolean) : []

  let all = []
  for (const { file, weight } of SOURCES) {
    all = all.concat(parseFile(file, weight))
  }

  all = all.filter(t => !skipIds.includes(t.id))

  // Tri : priorité d'abord, puis loop-safe, puis ordre des sources/fichiers.
  all.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority ? -1 : 1
    if (a.loopSafe !== b.loopSafe) return a.loopSafe ? -1 : 1
    if (a.sourceWeight !== b.sourceWeight) return a.sourceWeight - b.sourceWeight
    return a.line - b.line
  })

  if (showAll) {
    console.log(JSON.stringify(all, null, 2))
    return
  }

  if (all.length === 0) {
    console.log(JSON.stringify({ empty: true, reason: 'Aucune tâche non cochée trouvée dans project-docs/todo.md ni docs/TODO.md.' }))
    return
  }

  console.log(JSON.stringify(all[0], null, 2))
}

main()
