---
id: 004
titre: Trous existants documentés, et vente de plateforme dans le registre du client
statut: ready-for-human
bloque-par: [001, 002]
---

## Contexte

Deux questions que le code ne peut pas trancher seul.

### A — Les trous déjà présents

Boutique 1 : `FAC-2026-00001` et `FAC-2026-00002` n'existent nulle part. Les tickets 001 et 002
empêchent que cela se reproduise, mais ne réparent pas l'existant.

Position retenue au cadrage : **⊥ réécrire, ⊥ fabriquer de factures rétroactives**. Créer des
documents qui n'ont jamais existé est juridiquement plus discutable qu'un trou expliqué, et
toucher aux numéros émis casserait le chaînage.

Reste à produire : une **note traçable** — quels numéros, quelle boutique, quelle cause, quelle
date de correction — conservée avec les pièces comptables, opposable en cas de contrôle.

### B — Le caissier tiers

Une vente passée par la plateforme chez un client inscrit le compte de supervision comme caissier
dans la **chaîne NF525 du client** :

```
FAC-2026-00003 | user_id 1 = support@soteli.fr (boutique_id NULL = admin plateforme)
               | ligne NF525 boutique_id = 1
```

Un tiers apparaît donc dans le registre légal d'une boutique. La traçabilité est assurée par
ailleurs (`journal_actions_plateforme`), mais le registre lui-même ne le signale pas.

Trois voies, à trancher :
1. La plateforme **ne vend pas** — le chemin d'encaissement lui est fermé, elle supervise.
2. Elle vend, et la ligne **désigne explicitement** l'intervention extérieure.
3. Statu quo, assumé et écrit.

## Critères d'acceptation

- [ ] A : note traçable rédigée (numéros, boutique, cause, date), rangée avec les pièces comptables
- [ ] A : aucune facture rétroactive créée, aucun numéro réécrit
- [ ] B : voie 1 | 2 | 3 tranchée et consignée dans `decisions.md` avec sa justification
- [ ] B : si voie 1 ou 2, le comportement est couvert par un test

## Notes

- Ce ticket exige un jugement (comptable, produit) — d'où `ready-for-human`.
- ⊥ toucher `journal_nf525` en direct, sous aucun prétexte.
