# ADR — Architecture Decision Records

Une décision difficile à inverser = un fichier. Nommage : `NNNN-titre-en-kebab-case.md`
(`0001-`, `0002-`, … jamais réutilisé, jamais renuméroté).

Ce dossier n'est pas un journal de modifications — pour ça, voir
`docs/JOURNAL_MODIFICATIONS.md` et `project-docs/decisions.md`. Un ADR se justifie
quand revenir en arrière coûterait cher : choix de driver, format de numérotation
légale, frontière d'isolation tenant, contrat d'un port.

## Gabarit

```markdown
# NNNN — Titre à l'impératif

- **Statut** : proposé | accepté | remplacé par [NNNN](NNNN-....md)
- **Date** : AAAA-MM-JJ

## Contexte
Ce qui est vrai au moment de décider, et pourquoi la question se pose maintenant.

## Décision
Ce qui est décidé, formulé sans conditionnel.

## Conséquences
Ce que ça ferme, ce que ça coûte, ce qui devient plus difficile.
```

## Convention d'historique

Un ADR ne s'écrase pas. Une décision revue → **nouvel** ADR qui remplace le précédent ;
l'ancien passe en `Statut: remplacé par [NNNN]` et reste en place.
