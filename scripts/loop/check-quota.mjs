#!/usr/bin/env node
/**
 * check-quota.mjs — vérifie le quota d'usage du plan Claude avant de lancer un run
 * de la loop-engineering (voir .claude/skills/loop-engineering/SKILL.md, étape 0bis).
 *
 * Utilise `ccusage` (https://github.com/ryoppippi/ccusage) qui lit les logs locaux
 * Claude Code de CET environnement uniquement — ne voit pas l'usage d'autres
 * machines/sessions du même compte. C'est une estimation locale, pas une lecture
 * exacte du quota réel du compte Anthropic.
 *
 * Limite de référence : LOOP_TOKEN_LIMIT (variable d'environnement), défaut "max"
 * (heuristique ccusage : plus haut bloc de 5h jamais observé localement). Si vous
 * connaissez votre limite réelle (ex. en comparant plusieurs blocs pleins), fixez-la
 * explicitement — plus fiable que "max" tant que l'historique local est court.
 *
 * Sortie JSON sur stdout : { percent, status, limit, totalTokens, blockEndTime }
 * Code retour :
 *   0 = sous le seuil (continuer)
 *   1 = au-dessus du seuil (arrêter, désactiver le Routine — voir SKILL.md)
 *   2 = données insuffisantes pour estimer (fail-open, continuer en signalant)
 */
import { execFileSync } from 'node:child_process'

const THRESHOLD_PERCENT = Number(process.env.LOOP_QUOTA_THRESHOLD || 80)
const TOKEN_LIMIT = process.env.LOOP_TOKEN_LIMIT || 'max'

// Sur Windows, npx est un script .cmd — execFileSync ne résout pas cette extension
// sans passer par un shell (ENOENT sinon, même quand npx fonctionne très bien en
// invite de commandes). Sans effet sur Mac/Linux (npx est un binaire direct).
const NPX_CMD = process.platform === 'win32' ? 'npx.cmd' : 'npx'

function main() {
  let raw
  try {
    raw = execFileSync(
      NPX_CMD,
      ['--yes', 'ccusage@latest', 'blocks', '--active', '--json', '--token-limit', TOKEN_LIMIT],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000, shell: process.platform === 'win32' }
    )
  } catch (err) {
    console.log(JSON.stringify({
      percent: null,
      status: 'unknown',
      reason: `ccusage indisponible ou en échec : ${err.message}`,
    }))
    process.exit(2)
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.log(JSON.stringify({ percent: null, status: 'unknown', reason: 'sortie ccusage non-JSON' }))
    process.exit(2)
  }

  const block = (parsed.blocks || []).find(b => b.isActive)
  if (!block) {
    console.log(JSON.stringify({ percent: null, status: 'unknown', reason: 'aucun bloc actif (pas de session en cours)' }))
    process.exit(2)
  }

  const limitStatus = block.tokenLimitStatus
  if (!limitStatus || typeof limitStatus.limit !== 'number' || limitStatus.limit <= 0) {
    console.log(JSON.stringify({
      percent: null,
      status: 'unknown',
      reason: 'historique local insuffisant pour calculer une limite fiable',
      totalTokens: block.totalTokens,
    }))
    process.exit(2)
  }

  // Usage réel actuel (pas la projection fin-de-bloc de ccusage — on veut "où on en
  // est maintenant", pas "où on sera si le rythme actuel continue").
  const percent = (block.totalTokens / limitStatus.limit) * 100

  const result = {
    percent: Math.round(percent * 10) / 10,
    threshold: THRESHOLD_PERCENT,
    status: percent >= THRESHOLD_PERCENT ? 'over_threshold' : 'ok',
    limit: limitStatus.limit,
    totalTokens: block.totalTokens,
    blockEndTime: block.endTime,
    costUSD: block.costUSD,
  }
  console.log(JSON.stringify(result, null, 2))

  process.exit(percent >= THRESHOLD_PERCENT ? 1 : 0)
}

main()
