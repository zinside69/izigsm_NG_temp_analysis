#!/usr/bin/env bash
# e2e-gate.sh (iziGSM, bac a sable) — controle « e2e » declare dans gates.json.
# (2026-09-25, O28) Les controles typecheck et test (vitest) ne jouaient aucun
# E2E : sur le ticket 18 (T-002), des E2E ecrits par l'agent et jamais joues
# portaient deux defauts, trouves plus tard a la main. Ce controle les joue.
#
# Lance par gate.sh DANS le worktree de l'agent ; lu dans $ROOT, jamais dans le
# worktree : l'agent ne peut pas le modifier. Deroulement :
#   1. base D1 locale NEUVE (migrations + seed) : aucune accumulation de tenants ;
#   2. build, puis `wrangler pages dev` sur un port libre, arrete dans tous les cas ;
#   3. Playwright : les specs E2E ajoutees ou modifiees par le diff de la tache,
#      puis les gardes du projet (balayage du menu de gauche, XSS des gabarits).
# Decision de l'operateur du 2026-09-25 : specs de la tache + gardes.
# .dev.vars : celui, FACTICE, du bac a sable ($ROOT/.dev.vars), lie ici au moment
# du controle seulement — l'agent n'en dispose pas pendant son travail. Sans cle
# Mobilax, les E2E qui appellent la preproduction sont sautes (visible), jamais verts.
set -euo pipefail

# Meme garde que typecheck et test : sans profil, npx serait celui de Windows.
if ! command -v node >/dev/null || [[ "$(command -v npx)" == /mnt/* || -z "$(command -v npx)" ]]; then
  echo "node/npx Linux introuvables (profil non charge ?) : $(command -v npx)"; exit 1
fi

BASE="${ORCH_E2E_BASE:-integration}"
GARDE_MENU="tests/e2e/resolveur-boutique-pages.spec.ts"
GARDE_XSS="tests/e2e/xss-gabarits.spec.ts"
export WRANGLER_SEND_METRICS=false

[[ -e .dev.vars ]] || ln -s "$ROOT/.dev.vars" .dev.vars

# Specs de la tache : ajoutees ou modifiees depuis la base d'integration.
mapfile -t SPECS < <(git diff --name-only --diff-filter=AM "$(git merge-base "$BASE" HEAD)" HEAD -- 'tests/e2e/*.spec.ts')
echo "specs de la tache : ${#SPECS[@]} ${SPECS[*]:-}"

# 1. Base D1 locale neuve.
rm -rf .wrangler/state
npx wrangler d1 migrations apply DB --local >/dev/null
npx wrangler d1 execute DB --local --file=seed.sql >/dev/null
echo "base locale : migrations et seed appliques"

# 2. Build et serveur sur un port libre, dans son propre groupe de processus
#    (wrangler lance workerd) : le trap arrete tout le groupe.
npm run build >/dev/null
PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')"
JOURNAL_SERVEUR="$(mktemp)"
setsid npx wrangler pages dev dist --local --port "$PORT" >"$JOURNAL_SERVEUR" 2>&1 &
SERVEUR=$!
# shellcheck disable=SC2329  # appelee par le trap
arreter() { kill -- "-$SERVEUR" 2>/dev/null || true; wait "$SERVEUR" 2>/dev/null || true; }
trap arreter EXIT
for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 \
  || { echo "serveur local injoignable apres 60 s :"; tail -20 "$JOURNAL_SERVEUR"; exit 1; }
echo "serveur local pret sur le port $PORT"

# 3. Playwright. Un echec de n'importe quel lot rend le controle rouge.
export PW_PORT="$PORT"
rc=0
if (( ${#SPECS[@]} > 0 )); then
  npx playwright test "${SPECS[@]}" || rc=1
else
  echo "aucune spec E2E dans le diff : seules les gardes sont jouees"
fi
npx playwright test "$GARDE_MENU" -g "menu de gauche" || rc=1
npx playwright test "$GARDE_XSS" || rc=1
echo "e2e : $([[ $rc -eq 0 ]] && echo vert || echo rouge)"
exit "$rc"
