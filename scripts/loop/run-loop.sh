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

git checkout main
git pull origin main

PROMPT='Utilise la skill loop-engineering (.claude/skills/loop-engineering/SKILL.md) pour traiter exactement UNE tâche du backlog, de bout en bout, en respectant strictement project-docs/loop-policy.md. Termine ta réponse par le rapport de ledger (commit/escalade/backlog vide), même en cas d'\''échec.'

claude -p "$PROMPT" \
  --permission-mode "$PERMISSION_MODE" \
  --output-format text

echo "[run-loop] Fin : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[run-loop] Voir .superpowers/sdd/loop-runs.md pour le détail de ce run."
