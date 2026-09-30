# Issue tracker — iziGSM

_Config lue par les skills `triage`, `to-spec`, `to-tickets`, `implement`._

## Tracker retenu

**Markdown local** — aucun tracker externe. Les tickets sont des fichiers versionnés
dans le repo, pas des issues GitHub.

> Le remote `zinside69/izigsm_NG_temp_analysis` est un miroir d'analyse temporaire :
> ses issues ne sont pas utilisées. Ne pas appeler `gh issue`.

## Emplacement

```
.scratch/<feature>/issues/NNN-titre-en-kebab-case.md
```

- `<feature>` = nom court du chantier (ex. `isolation-boutique-id`, `facture-electronique`)
- `NNN` = numéro à 3 chiffres, ordre de création, unique **au sein du chantier**

`.scratch/` est **versionné** (absent de `.gitignore`) : le travail se poursuit
indifféremment sur Windows et Mac, les tickets doivent suivre le repo.

## Format d'un ticket

```markdown
---
id: 003
titre: Isoler les 5 endpoints facture/avoir par boutique_id
statut: ready-for-agent
bloque-par: [001, 002]
---

## Contexte
Pourquoi ce ticket existe.

## Critères d'acceptation
- [ ] Vérifiable, pas d'ambiguïté
- [ ] `npx vitest run` vert

## Coutures à tester
Les points où les tests observent le comportement (route, fonction publique, écran),
convenus avant le code. Au moins une ligne.

## Notes
Fichiers concernés, pièges connus.
```

**« Coutures à tester »** : obligatoire pour tout ticket confié au socle d'orchestration
(ADR 0004 du socle) : sans cette section, la tâche est refusée avant l'agent (P18).

## Arêtes bloquantes

`bloque-par` liste les `id` du même chantier qui doivent être terminés avant.
Un ticket est **prenable** quand tous ses bloqueurs sont à `statut: done`.
Travailler bloqueurs d'abord — il n'y a pas de résolution automatique des liens,
c'est une lecture manuelle du dossier `issues/`.

## Statuts

Valeurs autorisées dans le frontmatter `statut:` — voir `triage-labels.md`.

## Règle de contexte

Un ticket = **une fenêtre de contexte neuve**. Vider le contexte entre chaque
`/implement`. Ne pas enchaîner deux tickets dans la même session.
