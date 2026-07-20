# run-loop.ps1 - lance une iteration de la loop-engineering iziGSM en local (Windows).
#
# Traite UNE tache du backlog (project-docs/todo.md / docs/TODO.md) de bout en bout
# via .claude/skills/loop-engineering/SKILL.md, dans un worktree isole, gouverne par
# project-docs/loop-policy.md (autonomie L2). Convention alignee sur sync.ps1 du
# workspace (~/claude-test) - un script qu'on lance a la demande, pas un daemon.
#
# Usage :
#   .\scripts\loop\run-loop.ps1
#   $env:LOOP_PERMISSION_MODE = "plan"; .\scripts\loop\run-loop.ps1   # dry-run supervise
#
# Prerequis : Claude Code CLI installe (claude), authentifie, sur ce poste.
#
# Note encodage : ce fichier doit rester en ASCII pur (pas de tiret cadratin, pas
# d'accent) - Windows PowerShell 5.1 (powershell.exe, pas pwsh) lit les .ps1 sans BOM
# UTF-8 avec l'encodage ANSI du systeme par defaut, ce qui corrompt les caracteres
# multi-octets et casse le parsing (guillemets/accolades mal comptes plus loin dans
# le fichier). Bug reel rencontre le 2026-07-19, voir project-docs/bugs.md.

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Resolve-Path (Join-Path $ScriptDir "..\..")
Set-Location $RepoRoot

# Mode de permission Claude Code pour cette session non-interactive.
# acceptEdits (defaut) : edite/execute sans prompt interactif (necessaire pour tourner
#   sans surveillance) - les gardes-fous reels restent ceux de loop-policy.md, pas ceux
#   de ce flag. Utiliser "plan" pour observer sans rien laisser executer/committer.
$PermissionMode = if ($env:LOOP_PERMISSION_MODE) { $env:LOOP_PERMISSION_MODE } else { "acceptEdits" }

# Notification Telegram (2026-07-20, voir project-docs/loop-runbook.md § Notifications).
# NotifyScript echoue toujours en silencieux (exit 0) - jamais bloquant pour la loop.
$NotifyScript = Join-Path $ScriptDir "notify-telegram.mjs"
$LockPath     = Join-Path $ScriptDir ".loop-lock"
function Notify($Msg) {
    node $NotifyScript $Msg | Out-Null
}

Write-Host "[run-loop] Repo   : $RepoRoot"
Write-Host "[run-loop] Mode   : $PermissionMode"
Write-Host "[run-loop] Depart : $((Get-Date).ToUniversalTime().ToString("o"))"

$status = git status --porcelain
if ($status) {
    $Branch = git branch --show-current
    Write-Error "[run-loop] ERREUR : working tree non propre sur $Branch. La loop ne demarre jamais sur un etat sale - commit/stash d'abord."
    Notify "iziGSM Loop : ABANDON - working tree non propre sur $Branch. Rien execute. Commit/stash requis avant le prochain run."
    exit 1
}

# Gate quota (avant tout le reste - voir SKILL.md etape 0bis). Note : recommande
# d'installer claude-hud (jarrodwatts/claude-hud) sur ce poste pour une visibilite
# live du contexte/usage pendant ce run (statusline terminal, purement local - ne
# remplace pas ce gate programmatique, complementaire).
$QuotaJson = node scripts/loop/check-quota.mjs
$QuotaExit = $LASTEXITCODE
Write-Host "[run-loop] Quota : $QuotaJson"
if ($QuotaExit -eq 1) {
    Write-Error "[run-loop] ARRET : quota du plan >= seuil. Pas de run. Reessayer plus tard (pas de retry auto)."
    Notify "iziGSM Loop : ABANDON - quota du plan >= seuil ($QuotaJson). Pas de run aujourd'hui, reessai automatique demain."
    exit 1
}

git checkout main
git pull origin main

$Prompt = "Utilise la skill loop-engineering (.claude/skills/loop-engineering/SKILL.md) pour traiter exactement UNE tache du backlog, de bout en bout, en respectant strictement project-docs/loop-policy.md. Termine ta reponse par le rapport de ledger (commit/escalade/backlog vide), meme en cas d'echec."

# Lock pour le watchdog (scripts/loop/watchdog.ps1, tache planifiee separee toutes les
# 30 min) - horodatage UTC round-trippable, supprime des la fin de claude -p ci-dessous.
(Get-Date).ToUniversalTime().ToString("o") | Set-Content $LockPath

claude -p $Prompt --permission-mode $PermissionMode --output-format text
$ClaudeExit = $LASTEXITCODE

Remove-Item $LockPath -ErrorAction SilentlyContinue

# Auto-commit du ledger seul (jamais le reste) : le run peut escalader sans rien
# committer via claude -p, ce qui laisse .superpowers/sdd/loop-runs.md non suivi/modifie
# - sinon le PROCHAIN run refuse de demarrer (etape 0, working tree non propre),
# obligeant une intervention manuelle a chaque fois. Ne touche a AUCUN autre fichier :
# si claude -p a laisse un autre changement en suspens (ex. session interrompue en
# cours d'implementation), le prochain run continuera de refuser de demarrer sur cet
# etat sale - comportement volontaire, ne pas l'auto-committer aveuglement.
$LedgerPath = ".superpowers/sdd/loop-runs.md"
if (Test-Path $LedgerPath) {
    $LedgerStatus = git status --porcelain -- $LedgerPath
    if ($LedgerStatus) {
        Write-Host "[run-loop] Ledger modifie - auto-commit ($LedgerPath uniquement)."
        git add -- $LedgerPath
        git commit -m "chore: ledger loop-engineering (run automatique)" | Out-Null
        git push origin main
    }
}

if ($ClaudeExit -ne 0) {
    Write-Host "[run-loop] ECHEC : claude a quitte avec le code $ClaudeExit (voir la sortie ci-dessus pour la cause - ex. credit insuffisant, erreur reseau, etc.)."
    Notify "iziGSM Loop : ECHEC - claude a quitte avec le code $ClaudeExit. Voir la sortie du run / .superpowers/sdd/loop-runs.md."
} else {
    Write-Host "[run-loop] Fin : $((Get-Date).ToUniversalTime().ToString("o"))"
    Write-Host "[run-loop] Voir .superpowers/sdd/loop-runs.md pour le detail de ce run."
    Notify "iziGSM Loop : run termine (code 0). Voir .superpowers/sdd/loop-runs.md pour le detail (commit/escalade/backlog vide)."
}

exit $ClaudeExit
