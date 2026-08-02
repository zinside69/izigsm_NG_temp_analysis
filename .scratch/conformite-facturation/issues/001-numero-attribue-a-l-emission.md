---
id: 001
titre: Le numéro de facture n'est attribué qu'à l'émission
statut: ready-for-agent
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

- [ ] Un brouillon est créé avec `numero = NULL` — les 3 chemins (manuelle, conversion de devis, acompte)
- [ ] `nextNumero()` n'est appelé que dans `emettreFacture()`, point de passage unique
- [ ] Un échec d'émission laisse le compteur **inchangé** : la tentative suivante obtient le même numéro
- [ ] L'unicité `(boutique_id, numero)` tolère plusieurs brouillons à `NULL`
- [ ] Écran, recherche et tri gèrent un brouillon sans numéro (⊥ « undefined », ⊥ ligne vide)
- [ ] La caisse continue d'obtenir son numéro (sa vente est émise d'emblée — voir ticket 002)
- [ ] ∀ test vu rouge avant correctif
- [ ] `npx vitest run` 893 verts · `npx tsc --noEmit` ≤ 32 · `npx playwright test` vert

## Notes

- `sequences(boutique_id, type, annee)` est déjà par tenant — ⊥ y toucher.
- Invariant existant : « toute validation précède `nextNumero()` ». Ce ticket le renforce.
- ⊥ rattraper les trous existants : voir ticket 004.
