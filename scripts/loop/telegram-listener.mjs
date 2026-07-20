#!/usr/bin/env node
// telegram-listener.mjs - poll les commandes Telegram du bot iziGSM Loop.
//
// Lance toutes les 5 min par une tache planifiee separee ("iziGSM Loop Telegram
// Listener"), independante des taches "iziGSM Loop Engineering" (horaire) et
// "iziGSM Loop Watchdog" (30 min). Voir project-docs/loop-runbook.md SS11.
//
// Securite : n'execute une commande QUE si elle vient du chat_id configure dans
// telegram.local.json (chatId) - tout autre expediteur est ignore et logge sur
// stderr, jamais execute. Commandes fixes uniquement (pas de prompt libre transmis
// a Claude Code - decision explicite de l'utilisateur, 2026-07-20).

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')
const configPath = join(__dirname, 'telegram.local.json')
const offsetPath = join(__dirname, '.telegram-offset')
const lockPath = join(__dirname, '.loop-lock')

let config
try {
  config = JSON.parse(readFileSync(configPath, 'utf8'))
} catch {
  console.error('[telegram-listener] telegram.local.json introuvable - rien a faire.')
  process.exit(0)
}

const AUTHORIZED_CHAT_ID = String(config.chatId)

const HELP_TEXT = `iziGSM Loop - commandes disponibles :
/status - etat des taches planifiees + volume backlog
/digest - liste des taches complexes (risque eleve) en attente de decision
/run - force un run immediat (ignore si un run est deja en cours)
/approve <id> - marque une tache [loop-safe] pour le prochain run (override la classification automatique - a utiliser seulement si verifie sur)
/help - cette aide`

async function send(text) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chatId, text }),
    })
    if (!res.ok) console.error(`[telegram-listener] envoi echoue (HTTP ${res.status}).`)
  } catch (err) {
    console.error(`[telegram-listener] erreur reseau envoi: ${err.message}`)
  }
}

function getOffset() {
  if (!existsSync(offsetPath)) return null // null = pas encore bootstrap
  try {
    return parseInt(readFileSync(offsetPath, 'utf8').trim(), 10) || 0
  } catch {
    return 0
  }
}
function setOffset(id) {
  writeFileSync(offsetPath, String(id))
}

function countOpen(relPath) {
  const p = join(repoRoot, relPath)
  if (!existsSync(p)) return 0
  const lines = readFileSync(p, 'utf8').split(/\r?\n/)
  return lines.filter(l => /^\s*-\s*\[ \]/.test(l)).length
}

function pickAll() {
  const out = execFileSync('node', ['scripts/loop/pick-task.mjs', '--all'], { cwd: repoRoot, encoding: 'utf8' })
  return JSON.parse(out)
}

// Preserve les fins de ligne d'origine (CRLF/LF) - ne fait JAMAIS un split/join('\n')
// qui reflow tout le fichier (churn CRLF massif deja rencontre sur ce repo, voir
// bugs.md). N'edite que le segment de la ligne ciblee.
function appendTagToLine(filePath, lineNumber, tag) {
  const raw = readFileSync(filePath, 'utf8')
  const parts = raw.split(/(\r\n|\r|\n)/)
  const targetIdx = (lineNumber - 1) * 2
  if (parts[targetIdx] === undefined) throw new Error(`ligne ${lineNumber} hors limites`)
  parts[targetIdx] = parts[targetIdx] + tag
  writeFileSync(filePath, parts.join(''))
}

async function cmdStatus() {
  const lockExists = existsSync(lockPath)
  let runningInfo = 'Aucun run en cours.'
  if (lockExists) {
    const lockTime = readFileSync(lockPath, 'utf8').trim()
    runningInfo = `Run en cours depuis ${lockTime} (UTC).`
  }

  let taskInfo = 'Info tache planifiee indisponible.'
  try {
    const psCmd =
      "$i = Get-ScheduledTaskInfo -TaskName 'iziGSM Loop Engineering'; " +
      "[PSCustomObject]@{ LastRunTime = $i.LastRunTime.ToString('yyyy-MM-dd HH:mm'); LastTaskResult = $i.LastTaskResult; NextRunTime = $i.NextRunTime.ToString('yyyy-MM-dd HH:mm') } | ConvertTo-Json"
    const out = execFileSync('powershell', ['-NoProfile', '-Command', psCmd], { cwd: repoRoot, encoding: 'utf8' })
    const info = JSON.parse(out)
    taskInfo = `Dernier run : ${info.LastRunTime} (code ${info.LastTaskResult})\nProchain run : ${info.NextRunTime}`
  } catch {
    // best-effort, pas bloquant
  }

  const openTodo = countOpen('project-docs/todo.md')
  const openLegacy = countOpen('docs/TODO.md')

  await send(
    `iziGSM Loop - STATUT\n\n${runningInfo}\n\n${taskInfo}\n\nBacklog ouvert : ${openTodo} taches (project-docs/todo.md) + ${openLegacy} taches (docs/TODO.md, legacy)`
  )
}

async function cmdDigest() {
  let all
  try {
    all = pickAll()
  } catch {
    await send('iziGSM Loop : digest indisponible (erreur pick-task.mjs).')
    return
  }

  const complex = all.filter(t => t.riskHint && !t.loopSafe)
  const simple = all.filter(t => !t.riskHint || t.loopSafe)

  if (complex.length === 0) {
    await send(
      `iziGSM Loop - DIGEST\n\nAucune tache complexe detectee actuellement (heuristique mots-cles).\n${simple.length} tache(s) simple(s) restante(s) dans le backlog.`
    )
    return
  }

  const top = complex
    .slice(0, 15)
    .map(t => `- [${t.id}] ${t.text.slice(0, 120)} (mots-cles: ${t.riskHint.join(', ')})`)
    .join('\n')
  const more = complex.length > 15 ? `\n... + ${complex.length - 15} autre(s) (voir project-docs/todo.md)` : ''

  await send(
    `iziGSM Loop - DIGEST\n\n${complex.length} tache(s) complexe(s) en attente de decision humaine :\n\n${top}${more}\n\n${simple.length} tache(s) simple(s) restante(s) (traitement automatique par la loop).\n\nPour autoriser une tache complexe au prochain run : /approve <id>\n(Heuristique mots-cles, pas la classification complete de la skill - verifie toujours toi-meme avant d'approuver.)`
  )
}

async function cmdRun() {
  if (existsSync(lockPath)) {
    await send('iziGSM Loop : un run est deja en cours, /run ignore.')
    return
  }
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' })
  if (status.trim()) {
    await send('iziGSM Loop : working tree non propre, /run refuse. Verifie git status sur la machine.')
    return
  }

  await send('iziGSM Loop : demarrage manuel via /run...')
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(__dirname, 'run-loop.ps1')],
    { cwd: repoRoot, detached: true, stdio: 'ignore' }
  )
  child.unref()
}

async function cmdApprove(id) {
  if (!id) {
    await send('Usage : /approve <id>  (id donne par /digest)')
    return
  }

  let all
  try {
    all = pickAll()
  } catch {
    await send('iziGSM Loop : /approve indisponible (erreur pick-task.mjs).')
    return
  }

  const task = all.find(t => t.id === id)
  if (!task) {
    await send(`Tache ${id} introuvable (deja traitee, ou id perime) - relance /digest pour la liste a jour.`)
    return
  }
  if (task.loopSafe) {
    await send(`Tache ${id} deja marquee [loop-safe].`)
    return
  }

  const filePath = join(repoRoot, task.file)
  try {
    appendTagToLine(filePath, task.line, ' [loop-safe]')
  } catch (err) {
    await send(`Tache ${id} : echec ecriture (${err.message}) - relance /digest.`)
    return
  }

  try {
    execFileSync('git', ['add', task.file], { cwd: repoRoot })
    execFileSync('git', ['commit', '-m', `chore: approuve tache ${id} [loop-safe] via Telegram`], { cwd: repoRoot })
    execFileSync('git', ['pull', '--rebase', 'origin', 'main'], { cwd: repoRoot })
    execFileSync('git', ['push', 'origin', 'main'], { cwd: repoRoot })
  } catch (err) {
    await send(`Tache ${id} taggee localement mais commit/push a echoue : ${err.message}. A verifier manuellement (git status).`)
    return
  }

  await send(
    `Tache ${id} approuvee [loop-safe] et poussee sur main - eligible au prochain run.\n\n"${task.text.slice(0, 150)}"`
  )
}

async function handleCommand(text) {
  const [cmd, ...rest] = text.trim().split(/\s+/)
  const arg = rest.join(' ')

  switch (cmd.toLowerCase()) {
    case '/status':
      return cmdStatus()
    case '/digest':
      return cmdDigest()
    case '/run':
      return cmdRun()
    case '/approve':
      return cmdApprove(arg)
    case '/help':
    case '/start':
      return send(HELP_TEXT)
    default:
      return send(`Commande inconnue : ${cmd}\n\n${HELP_TEXT}`)
  }
}

async function main() {
  const offset = getOffset()

  const url = `https://api.telegram.org/bot${config.botToken}/getUpdates?offset=${offset ?? 0}&timeout=0`
  const res = await fetch(url)
  if (!res.ok) {
    console.error(`[telegram-listener] getUpdates echoue (HTTP ${res.status}).`)
    return
  }
  const data = await res.json()
  if (!data.ok) {
    console.error('[telegram-listener] getUpdates : reponse Telegram non ok.')
    return
  }
  if (!data.result.length) return

  // Bootstrap (2026-07-20) : premier lancement, aucun offset connu. On ne traite
  // aucun message historique (evite de rejouer les vieux "Salut" de test comme des
  // commandes inconnues) - on se contente d'avancer l'offset a la fin du lot actuel.
  const isBootstrap = offset === null

  for (const update of data.result) {
    setOffset(update.update_id + 1)
    if (isBootstrap) continue

    const msg = update.message
    if (!msg || !msg.text) continue
    const fromChatId = String(msg.chat.id)
    if (fromChatId !== AUTHORIZED_CHAT_ID) {
      console.error(`[telegram-listener] message ignore - chat_id non autorise (${fromChatId}).`)
      continue
    }
    await handleCommand(msg.text)
  }
}

main().catch(err => {
  console.error(`[telegram-listener] erreur inattendue: ${err.message}`)
})
