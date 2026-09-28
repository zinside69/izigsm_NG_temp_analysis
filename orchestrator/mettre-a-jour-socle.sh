#!/usr/bin/env bash
# mettre-a-jour-socle.sh — met a jour le socle installe dans un projet orchestre (un commit sur integration, jamais de push).
# Usage : orchestrator/mettre-a-jour-socle.sh <dossier-du-projet> [--appliquer]
#         orchestrator/mettre-a-jour-socle.sh --help
#
# (2026-09-28, decisions de l'utilisateur) Un projet porte une COPIE du socle,
# figee au jour de son installation : les trois projets orchestres etaient restes
# en v3.57, sans P17 ni cout juge. Ce script remplace la mise a jour a la main.
#
# Se lance depuis le depot du socle ; la version copiee est son commit HEAD
# (jamais des fichiers en cours de modification). Le projet est lu sur sa branche
# d'integration, jamais dans son dossier de travail.
#   - sans --appliquer : apercu, rien n'est ecrit ;
#   - avec --appliquer : un seul commit sur la branche d'integration, fait dans un
#     worktree temporaire. Aucun push ; le dossier du projet et sa branche courante
#     ne sont jamais touches : les commandes suivantes sont affichees.
#
# Regles :
#   - version installee : orchestrator/.version-socle (ecrit par ce script), sinon
#     le commit du socle dont TOUS les scripts .sh sont ceux du projet (a egalite :
#     le plus de fichiers identiques, puis le plus recent) ; introuvable => refus ;
#   - refus si une tache est RUNNING, VERIFIED ou REVIEWED, ou une escalade ouverte ;
#   - refus si le socle a change un fichier de .claude/ ou .githooks/ : ce sont les
#     droits de l'agent, a mettre a jour a la main (liste donnee) ;
#   - script (ou tout fichier non JSON) modifie par le projet => refus ;
#     answer-book.md enrichi par le projet => garde tel quel ;
#   - reglage JSON : version du socle + chaque valeur changee par le projet ; une
#     meme valeur changee des deux cotes => refus ;
#   - fichiers propres au projet (gates.json, preparer-worktree.sh...) : jamais lus.
# Codes : 0 = apercu, deja a jour ou mise a jour faite ; 1 = erreur ; 2 = refus.
set -Eeuo pipefail
export LC_NUMERIC=C

die()   { printf '[ERREUR] %s\n' "$*" >&2; exit 1; }
refus() { printf '[REFUS] %s\n' "$*" >&2; exit 2; }

APPLIQUER=0
PROJ=""
for arg in "$@"; do
  case "$arg" in
    --appliquer) APPLIQUER=1 ;;
    -h|--help)   sed -n '2,/^set -E/p' "$0" | sed '$d' | sed -E 's/^# ?//'; exit 0 ;;
    -*)          die "option inconnue : $arg" ;;
    *)           [[ -z "$PROJ" ]] || die "un seul dossier de projet"; PROJ="$arg" ;;
  esac
done
[[ -n "$PROJ" ]] || die "usage : $0 <dossier-du-projet> [--appliquer]"
command -v jq >/dev/null 2>&1 || die "dependance manquante : jq"

SOCLE="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)" || die "depot du socle introuvable"
PROJ="$(git -C "$PROJ" rev-parse --show-toplevel 2>/dev/null)" || die "pas un depot git : $PROJ"
[[ "$(cd "$SOCLE" && pwd -P)" != "$(cd "$PROJ" && pwd -P)" ]] || die "le projet designe est le depot du socle lui-meme"
BRANCHE="${INTEGRATION_BRANCH:-integration}"
git -C "$PROJ" show-ref --verify --quiet "refs/heads/$BRANCHE" || die "branche $BRANCHE absente du projet $PROJ"
NOUVEAU="$(git -C "$SOCLE" rev-parse HEAD)"

TMP="$(mktemp -d)"
WT=""
nettoyer() {
  [[ -z "$WT" ]] || git -C "$PROJ" worktree remove --force "$WT" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap nettoyer EXIT

# --- 1. Rien ne tourne dans le projet ------------------------------------------
ETAT="$PROJ/.orchestrator/etat"
en_vol=""
for f in "$ETAT"/taches/*.env; do
  [[ -f "$f" ]] || continue
  e="$(sed -n 's/^etat=//p' "$f" | head -1)"
  case "$e" in RUNNING|VERIFIED|REVIEWED) en_vol+=" $(basename "$f" .env)=$e" ;; esac
done
[[ -z "$en_vol" ]] || refus "tache(s) en cours :$en_vol — attendre leur fin"
if [[ -f "$ETAT/escalades/escalades.jsonl" ]]; then
  ouvertes="$(jq -r 'select(.statut == "ouverte") | .tache' "$ETAT/escalades/escalades.jsonl" | sort -u | tr '\n' ' ')"
  [[ -z "$ouvertes" ]] || refus "escalade(s) ouverte(s) : ${ouvertes% } — les clore d'abord"
fi

# --- 2. Version installee -------------------------------------------------------
declare -A PROJ_BLOB=()
while read -r _mode _type blob chemin; do
  PROJ_BLOB[$chemin]="$blob"
done < <(git -C "$PROJ" ls-tree -r "$BRANCHE" -- orchestrator)

BASE=""
if [[ -n "${PROJ_BLOB[orchestrator/.version-socle]:-}" ]]; then
  BASE="$(git -C "$PROJ" show "$BRANCHE:orchestrator/.version-socle" | sed -n 's/^commit=//p' | head -1)"
  git -C "$SOCLE" cat-file -e "${BASE}^{commit}" 2>/dev/null \
    || refus "version inscrite dans orchestrator/.version-socle inconnue du socle : '$BASE'"
else
  # Score d'un commit : fichiers identiques moins scripts absents du projet. Un
  # script present mais different l'exclut ; il faut au moins un script identique
  # (sinon un projet sans socle correspondrait a tout). A score egal, le plus
  # recent gagne (rev-list rend le plus recent d'abord).
  meilleur=""
  while read -r c; do
    compatible=1
    score=0
    sh_identiques=0
    while read -r _mode _type blob chemin; do
      if [[ "${PROJ_BLOB[$chemin]:-}" == "$blob" ]]; then
        score=$((score + 1))
        [[ "$chemin" != *.sh ]] || sh_identiques=$((sh_identiques + 1))
      elif [[ "$chemin" == *.sh && -z "${PROJ_BLOB[$chemin]:-}" ]]; then
        score=$((score - 1))
      elif [[ "$chemin" == *.sh ]]; then
        compatible=0
        break
      fi
    done < <(git -C "$SOCLE" ls-tree -r "$c" -- orchestrator)
    (( compatible == 1 && sh_identiques > 0 )) || continue
    if [[ -z "$meilleur" ]] || (( score > meilleur )); then
      meilleur=$score
      BASE="$c"
    fi
  done < <(git -C "$SOCLE" rev-list HEAD -- orchestrator)
  [[ -n "$BASE" ]] || refus "version installee introuvable : aucun commit du socle n'a exactement les scripts .sh du projet (script modifie par le projet ?)"
fi

version_de() { git -C "$SOCLE" log -1 --format=%s "$1" | grep -oE 'v[0-9]+\.[0-9]+' | tail -1 || true; }
V_BASE="$(version_de "$BASE")"
V_NOUVEAU="$(version_de "$NOUVEAU")"
printf 'Socle installe : %s %s\nSocle a copier : %s %s\n' "${BASE:0:7}" "$V_BASE" "${NOUVEAU:0:7}" "$V_NOUVEAU"

# --- 3. Droits de l'agent : jamais touches par ce script -----------------------
droits="$(git -C "$SOCLE" diff --name-only "$BASE" "$NOUVEAU" -- .claude .githooks)"
[[ -z "$droits" ]] || refus "le socle a change les droits de l'agent depuis ${BASE:0:7} ; a mettre a jour a la main dans le projet, puis relancer :
$droits"

# --- 4. Tri des fichiers --------------------------------------------------------
blob_socle() { git -C "$SOCLE" rev-parse -q --verify "$1:$2" 2>/dev/null || true; }

# fusionner_json <base> <projet> <nouveau> : rend {res, perso, conflits}.
# Une feuille = une valeur qui n'est pas un objet (un tableau compte pour une valeur).
fusionner_json() {
  jq -n --slurpfile b "$1" --slurpfile p "$2" --slurpfile n "$3" '
    def feuilles($c): if type == "object" and length > 0
      then to_entries[] as $e | ($e.value | feuilles($c + [$e.key])) else $c end;
    def dans($l; $c): any($l[]; . == $c);
    def val($x; $l; $c): if dans($l; $c) then {v: ($x | getpath($c))} else null end;
    $b[0] as $B | $p[0] as $P | $n[0] as $N
    | [$B | feuilles([])] as $fb | [$P | feuilles([])] as $fp | [$N | feuilles([])] as $fn
    | reduce ($fp[] | select(val($P; $fp; .) != val($B; $fb; .))) as $c
        ({res: $N, perso: [], conflits: []};
         val($N; $fn; $c) as $vn | val($B; $fb; $c) as $vb | val($P; $fp; $c) as $vp
         | if $vn != $vb and $vn != $vp
           then .conflits += [{chemin: ($c | join(".")), projet: $vp.v, socle: $vn.v}]
           else .res |= setpath($c; $vp.v) | .perso += [{chemin: ($c | join(".")), valeur: $vp.v}] end)
    | reduce ($fb[] | select(dans($fp; .) | not)) as $c (.;
        val($N; $fn; $c) as $vn | val($B; $fb; $c) as $vb
        | if $vn == null then .
          elif $vn == $vb then .res |= delpaths([$c]) | .perso += [{chemin: ($c | join(".")), valeur: "(retire par le projet)"}]
          else .conflits += [{chemin: ($c | join(".")), projet: "(retire)", socle: $vn.v}] end)'
}

declare -a ACTIONS=() CONFLITS=() PERSO=()
mapfile -t FICHIERS < <({ git -C "$SOCLE" ls-tree -r --name-only "$BASE" -- orchestrator
                          git -C "$SOCLE" ls-tree -r --name-only "$NOUVEAU" -- orchestrator; } | sort -u)
for f in "${FICHIERS[@]}"; do
  b="$(blob_socle "$BASE" "$f")"
  n="$(blob_socle "$NOUVEAU" "$f")"
  p="${PROJ_BLOB[$f]:-}"
  [[ "$b" != "$n" ]] || continue
  if [[ -z "$n" ]]; then
    if [[ -z "$p" ]]; then continue
    elif [[ "$p" == "$b" ]]; then ACTIONS+=("retire $f")
    else CONFLITS+=("$f : retire du socle, mais modifie par le projet"); fi
  elif [[ -z "$p" ]]; then
    ACTIONS+=("ajoute $f")
  elif [[ "$p" == "$n" ]]; then
    continue
  elif [[ -z "$b" ]]; then
    CONFLITS+=("$f : nouveau dans le socle, mais deja present et different dans le projet")
  elif [[ "$p" == "$b" ]]; then
    ACTIONS+=("remplace $f")
  elif [[ "$f" == orchestrator/answer-book.md ]]; then
    ACTIONS+=("garde $f")
  elif [[ "$f" == *.json ]]; then
    cle="${f//\//_}"
    git -C "$SOCLE" show "$BASE:$f" >"$TMP/$cle.base"
    git -C "$PROJ" show "$BRANCHE:$f" >"$TMP/$cle.projet"
    git -C "$SOCLE" show "$NOUVEAU:$f" >"$TMP/$cle.nouveau"
    fusionner_json "$TMP/$cle.base" "$TMP/$cle.projet" "$TMP/$cle.nouveau" >"$TMP/$cle.fusion" \
      || die "fusion impossible (JSON illisible ?) : $f"
    if jq -e '.conflits | length > 0' "$TMP/$cle.fusion" >/dev/null; then
      while IFS= read -r ligne; do CONFLITS+=("$f : $ligne"); done \
        < <(jq -r '.conflits[] | "\(.chemin) change des deux cotes (projet : \(.projet | tojson), socle : \(.socle | tojson))"' "$TMP/$cle.fusion")
    elif jq -e '.perso | length == 0' "$TMP/$cle.fusion" >/dev/null; then
      ACTIONS+=("remplace $f")
    else
      jq '.res' "$TMP/$cle.fusion" >"$TMP/$cle.resultat"
      ACTIONS+=("fusionne $f")
      while IFS= read -r ligne; do PERSO+=("$f : $ligne"); done \
        < <(jq -r '.perso[] | "\(.chemin) = \(.valeur | tojson)"' "$TMP/$cle.fusion")
    fi
  else
    CONFLITS+=("$f : modifie par le projet (copie du socle retouchee)")
  fi
done

# --- 5. Apercu --------------------------------------------------------------------
if (( ${#ACTIONS[@]} == 0 && ${#CONFLITS[@]} == 0 )); then
  printf 'Deja a jour : rien a copier.\n'
  exit 0
fi
printf '\nFichiers :\n'
for a in "${ACTIONS[@]}"; do printf '  %-9s %s\n' "${a%% *}" "${a#* }"; done
if (( ${#PERSO[@]} > 0 )); then
  printf '\nReglages du projet conserves :\n'
  printf '  %s\n' "${PERSO[@]}"
  for a in "${ACTIONS[@]}"; do
    [[ "${a%% *}" == fusionne ]] || continue
    f="${a#* }"; cle="${f//\//_}"
    printf '\nDiff de %s (projet -> resultat) :\n' "$f"
    diff -u --label "projet/$f" --label "resultat/$f" "$TMP/$cle.projet" "$TMP/$cle.resultat" || true
  done
fi
if (( ${#CONFLITS[@]} > 0 )); then
  printf '\nConflits :\n' >&2
  printf '  %s\n' "${CONFLITS[@]}" >&2
  refus "${#CONFLITS[@]} conflit(s) : rien n'est ecrit ; trancher a la main, puis relancer"
fi
if (( APPLIQUER == 0 )); then
  printf "\nApercu seulement : rien n'est ecrit. Relancer avec --appliquer pour commiter sur %s.\n" "$BRANCHE"
  exit 0
fi

# --- 6. Application : un commit sur la branche d'integration -----------------------
WT="$TMP/wt"
git -C "$PROJ" worktree add -q "$WT" "$BRANCHE" 2>"$TMP/worktree.err" \
  || die "worktree de $BRANCHE impossible (branche extraite ailleurs ?) : $(cat "$TMP/worktree.err")"
for a in "${ACTIONS[@]}"; do
  action="${a%% *}"; f="${a#* }"; cle="${f//\//_}"
  case "$action" in
    remplace|ajoute)
      mkdir -p "$WT/$(dirname "$f")"
      git -C "$SOCLE" show "$NOUVEAU:$f" >"$WT/$f"
      git -C "$WT" add -- "$f"
      if [[ "$(git -C "$SOCLE" ls-tree "$NOUVEAU" -- "$f" | awk '{print $1}')" == 100755 ]]; then
        chmod +x "$WT/$f"
        git -C "$WT" update-index --chmod=+x -- "$f"
      fi ;;
    fusionne) cp "$TMP/$cle.resultat" "$WT/$f"; git -C "$WT" add -- "$f" ;;
    retire)   git -C "$WT" rm -q -- "$f" ;;
    garde)    ;;
  esac
done
printf '# Version du socle installee — ecrit par orchestrator/mettre-a-jour-socle.sh, ne pas modifier a la main.\ncommit=%s\n' \
  "$NOUVEAU" >"$WT/orchestrator/.version-socle"
git -C "$WT" add -- orchestrator/.version-socle

{
  printf 'chore(socle): mise a jour %s -> %s\n\n' "${V_BASE:-${BASE:0:7}}" "${V_NOUVEAU:-${NOUVEAU:0:7}}"
  printf 'Socle repris du commit %s (installe : %s), par orchestrator/mettre-a-jour-socle.sh.\n' "${NOUVEAU:0:7}" "${BASE:0:7}"
  for a in "${ACTIONS[@]}"; do printf -- '- %s %s\n' "${a%% *}" "${a#* }"; done
  if (( ${#PERSO[@]} > 0 )); then
    printf '\nReglages du projet conserves :\n'
    printf -- '- %s\n' "${PERSO[@]}"
  fi
} >"$TMP/message"
git -C "$WT" commit -q -F "$TMP/message" || die "commit impossible dans le worktree de $BRANCHE"
COMMIT="$(git -C "$WT" rev-parse --short HEAD)"

printf '\nMise a jour commitee sur %s : %s (aucun push).\n' "$BRANCHE" "$COMMIT"
printf 'Suite, a lancer toi-meme apres relecture :\n'
printf '  git -C %s show --stat %s\n' "$PROJ" "$COMMIT"
printf '  git -C %s merge --ff-only %s\n' "$PROJ" "$BRANCHE"
printf '  (cd %s && ./orchestrator/graphe.sh && ./orchestrator/scheduler.sh --dry-run)\n' "$PROJ"
printf '  git -C %s push origin %s\n' "$PROJ" "$BRANCHE"
