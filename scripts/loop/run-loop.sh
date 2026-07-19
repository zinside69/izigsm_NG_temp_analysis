#!/usr/bin/env bash
# run-loop.sh — lance une itération de la loop-engineering iziGSM en local (Mac/Linux).
#
# Traite UNE tâche du backlog (project-docs/todo.md / docs/TODO.md) de bout en bout
# via .claude/skills/loop-engineering/SKILL.md, dans un worktree isolé, gouverné par
# project-docs/loop-policy.md (autonomie L2). Convention alignée sur sync.ps1/sync du
# workspace (~/claude-test) — un script qu'on lance à la demande, pas un daemon.
#
# Usage :
#   ./scripts/loop/run-loop.sh
#   LOOP_PERMISSION_MODE=plan ./scripts/loop/run-loop.sh   # dry-run supervisé (aucune
#                                                            # édition/commande auto-acceptée)
#
# Prérequis : Claude Code CLI installé (`claude`), authentifié, sur ce poste.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# Mode de permission Claude Code pour cette session non-interactive.
# acceptEdits (défaut) : édite/exécute sans prompt interactif (nécessaire pour tourner
#   sans surveillance) — les gardes-fous réels restent ceux de loop-policy.md, pas ceux
#   de ce flag. Utiliser `plan` pour observer sans rien laisser exécuter/committer.
PERMISSION_MODE="${LOOP_PERMISSION_MODE:-acceptEdits}"

echo "[run-loop] Repo   : $REPO_ROOT"
echo "[run-loop] Mode   : $PERMISSION_MODE"
echo "[run-loop] Départ : $(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "[run-loop] ERREUR : working tree non propre sur $(git branch --show-current)." >&2
  echo "[run-loop] La loop ne démarre jamais sur un état sale — commit/stash d'abord." >&2
  exit 1
fi

# Gate quota (avant tout le reste — voir SKILL.md étape 0bis). Note : recommandé
# d'installer claude-hud (jarrodwatts/claude-hud) sur ce poste pour une visibilité
# live du contexte/usage pendant ce run (statusline terminal, purement local — ne
# remplace pas ce gate programmatique, complémentaire).
QUOTA_JSON="$(node scripts/loop/check-quota.mjs)"
QUOTA_EXIT=$?
echo "[run-loop] Quota : $QUOTA_JSON"
if [[ $QUOTA_EXIT -eq 1 ]]; then
  echo "[run-loop] ARRÊT : quota du plan ≥ seuil. Pas de run. Réessayer plus tard (pas de retry auto)." >&2
  exit 1
fi

git checkout main
git pull origin main

PROMPT='Utilise la skill loop-engineering (.claude/skills/loop-engineering/SKILL.md) pour traiter exactement UNE tâche du backlog, de bout en bout, en respectant strictement project-docs/loop-policy.md. Termine ta réponse par le rapport de ledger (commit/escalade/backlog vide), même en cas d'\''échec.'

# set +e temporaire : on veut capturer l'échec de claude sans que `set -e` ne coupe le
# script avant l'auto-commit du ledger ci-dessous.
set +e
claude -p "$PROMPT" \
  --permission-mode "$PERMISSION_MODE" \
  --output-format text
CLAUDE_EXIT=$?
set -e

# Auto-commit du ledger seul (jamais le reste) : le run peut escalader sans rien
# committer via claude -p, ce qui laisse .superpowers/sdd/loop-runs.md non suivi/modifié
# — sinon le PROCHAIN run refuse de démarrer (étape 0, working tree non propre),
# obligeant une intervention manuelle à chaque fois. Ne touche à AUCUN autre fichier :
# si claude -p a laissé un autre changement en suspens (ex. session interrompue en
# cours d'implémentation), le prochain run continuera de refuser de démarrer sur cet
# état sale — comportement volontaire, ne pas l'auto-committer aveuglément.
LEDGER_PATH=".superpowers/sdd/loop-runs.md"
if [[ -f "$LEDGER_PATH" ]] && [[ -n "$(git status --porcelain -- "$LEDGER_PATH")" ]]; then
  echo "[run-loop] Ledger modifié — auto-commit ($LEDGER_PATH uniquement)."
  git add -- "$LEDGER_PATH"
  git commit -m "chore: ledger loop-engineering (run automatique)" >/dev/null
  git push origin main
fi

if [[ $CLAUDE_EXIT -ne 0 ]]; then
  echo "[run-loop] ÉCHEC : claude a quitté avec le code $CLAUDE_EXIT (voir la sortie ci-dessus pour la cause)." >&2
else
  echo "[run-loop] Fin : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[run-loop] Voir .superpowers/sdd/loop-runs.md pour le détail de ce run."
fi

exit $CLAUDE_EXIT
