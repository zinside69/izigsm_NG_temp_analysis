# telegram-listener.ps1 - poll les commandes Telegram du bot iziGSM Loop (toutes les
# 5 min via tache planifiee separee "iziGSM Loop Telegram Listener", 2026-07-20).
#
# Wrapper mince (convention alignee sur watchdog.ps1) - toute la logique est dans
# telegram-listener.mjs. Voir project-docs/loop-runbook.md SS11.
#
# Note encodage : fichier ASCII pur (voir run-loop.ps1 pour le pourquoi).

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Resolve-Path (Join-Path $ScriptDir "..\..")
Set-Location $RepoRoot

node (Join-Path $ScriptDir "telegram-listener.mjs")
exit $LASTEXITCODE
