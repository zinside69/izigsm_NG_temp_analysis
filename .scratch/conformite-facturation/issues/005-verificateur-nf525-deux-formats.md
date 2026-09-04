---
id: 005
titre: Le vérificateur NF525 et l'écrivain des factures/avoirs ne parlent pas le même format
statut: ready-for-human
bloque-par: []
---

## Contexte

Trouvé le 2026-09-04 en validant le ticket 002. **Défaut pré-existant, sans lien avec le 002.**

Deux fonctions écrivent dans `journal_nf525`, avec **deux formats canoniques différents** :

| Écrivain | Fonction | Format hashé |
|---|---|---|
| A | `caisseService.createVente()` / `cloturerJournee()` | `type\|ref\|centimes\|date\|prev` |
| B | `lib/nf525.enregistrerTransaction()` — factures émises, avoirs, rachats | `boutique_id\|type\|ref\|ht\|tva\|ttc\|date\|prev` |

```
src/services/caisseService.ts  buildDonneesHash()    ← format A
src/lib/nf525.ts               buildCanonicalData()  ← format B
```

Le vérificateur `verifierIntegriteChaine()` (`caisseService.ts`) recalcule **toujours** avec
`buildDonneesHash()`, donc avec le format A. ∴ **toute entrée écrite par B est déclarée
frauduleuse, définitivement.**

Second écart, mineur mais réel : le hash de genèse vaut `'0'.repeat(64)` chez A et `''` chez B.

## Preuve, mesurée en base locale le 2026-09-04

```
entrées journal_nf525 boutique 1 ............ 171
  dont écrivain B (facture 117 + avoir 53) .. 170
  dont écrivain A (vente POS) ...............   1
anomalies signalées par /api/caisse/integrite  170
```

100 % des entrées B anomaliques, 0 % des entrées A. La première anomalie est l'entrée `id 5`,
`FAC-2026-00001` — le défaut existe depuis l'origine du journal.

## Impact

`GET /api/caisse/integrite` est le contrôle d'intégrité légal NF525. Il **ment** dès qu'une
facture est émise ou qu'un avoir est créé : il annonce une fraude là où il n'y en a pas. Un
contrôle fiscal qui s'appuierait dessus lirait un journal « frauduleux » sur toute la période.

Conséquence directe : le critère d'acceptation « `nf525/verify` reste intègre après émission de
l'avoir » du **ticket 002** est **insatisfiable** tant que ce défaut vit. Il n'a jamais été
satisfait par aucun avoir ni aucune facture émise.

## Ce qu'il faut trancher — décision humaine, pas un correctif de passage

1. **Quel format fait foi ?** B porte plus d'information (boutique, HT, TVA) et couvre
   117 factures + 53 avoirs contre 1 vente ; A est celui que lit le vérificateur.
2. **Sort des entrées déjà écrites.** Aligner le vérificateur sur B rend saines les entrées B et
   fausses les entrées A — le problème se déplace, il ne disparaît pas. Un vérificateur qui
   choisit son format selon `type_transaction` est la seule option qui ne réécrit rien.
3. **⊥ recalculer les hash existants.** Réécrire `hash_courant` sur des entrées émises, c'est
   exactement ce que NF525 interdit — et ça détruirait la preuve d'inaltérabilité qu'on cherche
   à produire. Cette option doit être écartée explicitement, pas oubliée.

## Critères d'acceptation

- [ ] Le format faisant foi pour chaque `type_transaction` est écrit dans `decisions.md`
- [ ] `verifierIntegriteChaine()` valide les entrées des deux écrivains sans réécrire aucune ligne
- [ ] Un test voit rouge sur une entrée écrite par B avant le correctif
- [ ] Les deux hash de genèse (`'0'×64` et `''`) sont unifiés ou explicitement documentés comme distincts
- [ ] Mesuré par un chiffre en base locale : anomalies = 0 sur un journal contenant les deux écrivains
- [ ] `GET /api/caisse/integrite` revérifié en **production** — l'affirmation « chaîne NF525 relue
      intègre » du checkpoint 78 a été établie par requête SQL directe, jamais par cet endpoint

## Notes

- ⊥ jamais toucher `journal_nf525` en direct, ⊥ réécrire un `hash_courant` émis.
- Le ticket 002 est livré sans ce critère, avec renvoi explicite vers ce ticket.
