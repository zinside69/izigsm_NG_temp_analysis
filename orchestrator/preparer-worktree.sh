#!/usr/bin/env bash
# preparer-worktree.sh (iziGSM) — lance par le socle DANS le worktree neuf de l agent.
# Un worktree n a rien de ce que git ignore : on y met les dependances et les types generes.
set -euo pipefail
[[ -e node_modules ]] || ln -s "$ROOT/node_modules" node_modules   # deja installees dans ROOT
npm run cf-typegen >/dev/null                                       # sinon 495 erreurs tsc au lieu de 32
