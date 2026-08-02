---
id: 001
titre: Le numéro de facture n'est attribué qu'à l'émission
statut: done
bloque-par: []
---

## Contexte

`nextNumero()` est appelé **avant** l'`INSERT` : tout échec entre les deux brûle un numéro sans
laisser de document. Et un brouillon porte un numéro définitif alors qu'il n'est pas une facture.

Constaté en production : boutique 1 — `FAC-2026-00001` et `FAC-2026-00002` n'existent nulle part,
sa première facture réelle est `FAC-2026-00003`. Deux trous dans la série, ⊥ conforme à
l'art. 289 CGI qui impose une numérotation continue.

Décision de l'exploitant (2026-08-02) : **numéroter à l'émission**, pas à la création.

## Critères d'acceptation

- [x] Un brouillon est créé avec `numero = NULL` — les 3 chemins (manuelle, conversion de devis, acompte)
- [x] `nextNumero()` n'est appelé que dans `emettreFacture()`, point de passage unique
      (seule exception assumée : `caisseService.createVente()`, dont la vente est émise d'emblée)
- [x] Un échec d'émission laisse le compteur **inchangé** : la tentative suivante obtient le même numéro
- [x] L'unicité `(boutique_id, numero)` tolère plusieurs brouillons à `NULL` — migration `0040`, prouvé en E2E
- [x] Écran, recherche et tri gèrent un brouillon sans numéro (⊥ « undefined », ⊥ ligne vide)
- [x] La caisse continue d'obtenir son numéro (sa vente est émise d'emblée — voir ticket 002)
- [x] ∀ test vu rouge avant correctif (6 unitaires + 2 E2E)
- [x] `npx vitest run` 899 verts · `npx tsc --noEmit` 32 · `npx playwright test` 188/188

## Notes

- `sequences(boutique_id, type, annee)` est déjà par tenant — ⊥ y toucher.
- Invariant existant : « toute validation précède `nextNumero()` ». Ce ticket le renforce.
- ⊥ rattraper les trous existants : voir ticket 004.

## Livré le 2026-08-02

- Migration `0040_facture_numero_nullable.sql` — `factures.numero` devient nullable.
- `emettreFacture()` numérote et **persiste le numéro avant** le chaînage NF525 : un
  échec du chaînage ne brûle pas un second numéro, la reprise réutilise le même.
- `createFacture()`, `createFactureAcompte()`, `convertirDevis()` n'appellent plus
  `nextNumero()` ; `facture_numero` vaut `null` tant que la facture est brouillon.
- **Hors périmètre initial, tranché avec l'exploitant** : `PUT /devis/:id/convertir`
  écrivait une ligne `journal_nf525` sur un brouillon, puis `emettreFacture()` en
  écrivait une seconde pour le même document. Écriture retirée de la route — le
  journal légal n'enregistre que des documents émis.

### Trois pièges D1/SQLite mesurés sur cette migration

Une table ne se recrée pas ici comme dans la migration `0034`. Vérifié le 2026-08-02 :

1. `PRAGMA foreign_keys=OFF` est **ignoré** — D1 exécute le fichier dans une transaction.
2. `defer_foreign_keys=ON` repousse les contrôles mais ne les **résout** pas : le compteur
   ne redescend que si les lignes parentes sont réinsérées dans une table portant le nom
   référencé. Copier vers `factures_new` puis renommer ne suffit pas.
3. `PRAGMA legacy_alter_table` n'est **pas honoré** : tout `ALTER TABLE ... RENAME` réécrit
   les clauses `REFERENCES` des tables filles.

D'où le patron retenu : table de transit (`CREATE TABLE ... AS SELECT`, sans contrainte),
`DROP`, recréation **sous le nom final**, réinsertion, suppression du transit.
