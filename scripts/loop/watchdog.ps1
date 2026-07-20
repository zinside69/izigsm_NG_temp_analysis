# watchdog.ps1 - verifie qu'un run de la loop-engineering iziGSM n'est pas bloque.
#
# Lance toutes les 30 min par une tache planifiee separee ("iziGSM Loop Watchdog"),
# independante de "iziGSM Loop Engineering" (le run quotidien lui-meme, 09:30).
#
# Comportement :
#   - Pas de fichier .loop-lock -> aucun run en cours, sortie silencieuse (pas de
#     notification "tout va bien" a chaque passage, uniquement des alertes reelles).
#   - .loop-lock present depuis plus de $ThresholdMin -> notif Telegram, le run est
#     probablement bloque (aucune action automatique - le watchdog n'arrete jamais
#     un processus, ne touche jamais au code/git, alerte uniquement).
#
# Note encodage : fichier ASCII pur (voir run-loop.ps1 pour le pourquoi - PowerShell
# 5.1 sans BOM UTF-8 corrompt les caracteres multi-octets).

$ScriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$LockPath     = Join-Path $ScriptDir ".loop-lock"
$NotifyScript = Join-Path $ScriptDir "notify-telegram.mjs"
$ThresholdMin = if ($env:LOOP_WATCHDOG_THRESHOLD_MIN) { [int]$env:LOOP_WATCHDOG_THRESHOLD_MIN } else { 60 }

if (-not (Test-Path $LockPath)) {
    exit 0
}

try {
    $LockTimeRaw = (Get-Content $LockPath -Raw).Trim()
    $LockTime = [datetime]::Parse($LockTimeRaw, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind)
} catch {
    # Lock illisible/corrompu - signale mais ne bloque rien.
    node $NotifyScript "iziGSM Loop WATCHDOG : .loop-lock illisible ($LockPath) - a verifier manuellement."
    exit 0
}

$ElapsedMin = ((Get-Date).ToUniversalTime() - $LockTime).TotalMinutes

if ($ElapsedMin -gt $ThresholdMin) {
    $Msg = "iziGSM Loop WATCHDOG : run en cours depuis $([math]::Round($ElapsedMin)) min (seuil $ThresholdMin min) - possiblement bloque. Verifier Get-Process claude / Get-ScheduledTaskInfo 'iziGSM Loop Engineering'."
    node $NotifyScript $Msg
}
