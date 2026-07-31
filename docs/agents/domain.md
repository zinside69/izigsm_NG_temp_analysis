# Docs de domaine — iziGSM

_Config lue par les skills `grill-with-docs`, `domain-modeling`, `to-spec`._

## Structure

**Single-context** — un seul domaine métier, un seul glossaire. Pas de découpage
multi-contextes malgré la présence de `src/ports` / `src/adapters` : ces dossiers
relèvent de l'architecture (Ports & Adapters), pas de frontières de domaine.

| Fichier | Rôle |
|---|---|
| `CONTEXT.md` (racine webapp) | Glossaire du domaine. Une entrée = un terme + sa définition faisant autorité. |
| `docs/adr/NNNN-titre.md` | Décisions difficiles à inverser, une par fichier. |

## Règles d'écriture

- `CONTEXT.md` est un **glossaire**, pas une doc d'architecture. Un terme qui n'a pas
  de définition tranchée n'y entre pas — il part en question pour `/grill-with-docs`.
- Un mot surchargé (le même terme désignant deux choses) est un défaut à résoudre,
  pas à documenter en l'état. Voir la section « Termes à trancher » de `CONTEXT.md`.
- Une décision qui coûterait cher à défaire → ADR, pas une ligne de glossaire.

## Docs existantes — statut

Ces documents restent la référence **produit**, ils ne sont pas remplacés :

- `docs/CDC_izigsm.docx` / `docs/GAP_ANALYSIS_ENRICHI.md` — cahier des charges
- `docs/ARCHITECTURAL_PRINCIPLES.md` / `docs/ARCHITECTURE_MODULES.md` — architecture
- `project-docs/` — mémoire de session (current-state, todo, bugs, decisions)

Voir `CLAUDE.md` § « Docs obsolètes » pour celles à ne pas suivre techniquement.
