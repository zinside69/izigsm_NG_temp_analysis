---
id: 005
titre: Le vérificateur NF525 et l'écrivain des factures/avoirs ne parlent pas le même format
statut: done-pending-prod-check
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

- [x] Le format faisant foi pour chaque `type_transaction` est écrit dans `decisions.md`
      (§ 2026-09-04 deux écrivains — table complète + 4 arbitrages)
- [x] `verifierIntegriteChaine()` valide les entrées des deux écrivains sans réécrire aucune ligne
      (`rebuildDonneesHash()` aiguille sur `type_transaction` ; zéro `UPDATE` sur `journal_nf525`)
- [x] Un test voit rouge sur une entrée écrite par B avant le correctif
      (3 tests rouges dans `tests/caisseService.test.ts` : facture, avoir, journal mixte)
- [x] Les deux hash de genèse (`'0'×64` et `''`) sont unifiés ou explicitement documentés comme distincts
      (documentés distincts — décision 4 ; unifier toucherait un chemin d'écriture NF525)
- [x] Mesuré par un chiffre en base locale : anomalies = 0 sur un journal contenant les deux écrivains
      (boutique 1 : 171 entrées — 117 `facture` + 53 `avoir` + 1 `vente` — **170 → 0** ; et
      **0 sur les 38 boutiques** du journal local, via l'endpoint réel, pas un script maison)
- [ ] `GET /api/caisse/integrite` revérifié en **production** — l'affirmation « chaîne NF525 relue
      intègre » du checkpoint 78 a été établie par requête SQL directe, jamais par cet endpoint
      → **SEUL CRITÈRE OUVERT.** Exige un déploiement, qui embarquerait aussi le ticket 002 (non
      déployé depuis le cp79). Décision laissée à l'exploitant le 2026-09-04.

## Livré le 2026-09-04

| Fichier | Changement |
|---|---|
| `src/lib/nf525.ts` | `buildCanonicalData()` **exportée** — une seule définition du format B |
| `src/services/caisseService.ts` | `TYPES_ECRIVAIN_B` + `rebuildDonneesHash()` ; en-têtes corrigés |
| `tests/caisseService.test.ts` | +5 tests (3 vus rouges, 2 interdisant d'affaiblir le contrôle) |
| `tests/nf525-ecrivains-conformite.test.ts` | garde-fou statique, vu rouge en retirant `'avoir'` |

Gates : vitest **914/916** (2 échecs permanents de fuseau `agendaService`), tsc **32**,
playwright **188/188**, build ✓ — baseline cp79 tenue.

**Le recalcul part des CHAMPS de la ligne, jamais de la colonne `donnees_hash`.** Relire cette
colonne aurait donné 0 anomalie immédiatement, sur les deux écrivains — et validé une ligne dont
le montant a été réécrit en base. Deux tests interdisent cette facilité.

## Deux erreurs de ce ticket, corrigées par la mesure

- `cloturerJournee()` **n'écrit pas** dans `journal_nf525` — il écrit dans
  `clotures_journalieres`. Ce n'est pas un écrivain de cette chaîne.
- **Aucun rachat** n'appelle `enregistrerTransaction()`. Seuls `emettreFacture()` et
  `creerAvoir()` le font.

## Trouvé en route, hors périmètre — non corrigé

`verifierIntegriteChaine()` **ne vérifie pas le chaînage** : il ne compare jamais
`hash_precedent` au `hash_courant` de la ligne précédente. Une **suppression** de ligne au milieu
du journal ne produit aucune anomalie. Documenté dans `bugs.md` et `todo.md` (🟠 P2) ; mérite son
propre ticket.

## Notes

- ⊥ jamais toucher `journal_nf525` en direct, ⊥ réécrire un `hash_courant` émis.
- Le ticket 002 est livré sans ce critère, avec renvoi explicite vers ce ticket.
