---
id: 002
titre: Une vente de caisse est verrouillée, et annulable par un avoir
statut: ready-for-agent
bloque-par: [001]
---

## Contexte

Absorbe `.scratch/avoir-vente-caisse/issues/001` (même défaut, cadre plus large).

La caisse crée sa facture en `statut = 'payee'` mais ne pose **jamais** `locked` :

```
caisseService.ts  INSERT INTO factures (…, statut, notes) VALUES (…, 'payee', ?)
factureService.ts if (!facture.locked) throw 'Impossible d'émettre un avoir sur une facture non émise.'
```

∴ **aucune vente encaissée n'est annulable**, pour aucun rôle, depuis toujours. Or NF525 impose
la correction par document rectificatif, jamais par suppression — et supprimer la ligne romprait
la chaîne de hash.

Une vente POS **est** une facture émise : numérotée, payée, chaînée.

## Critères d'acceptation

- [ ] Une vente de caisse crée une facture `locked = 1`
- [ ] Aucun chemin d'encaissement ne casse : `ajouterPaiement()` refuse une facture verrouillée — vérifier vente, encaissement, acompte
- [ ] Le bouton d'avoir apparaît sur une vente de caisse, et l'avoir s'émet de bout en bout à l'écran
- [ ] `nf525/verify` reste **intègre** après émission de l'avoir
- [ ] L'avoir reste lié à sa facture, et la facture expose ses avoirs (lien lisible dans les deux sens)
- [ ] Sort des factures existantes à `locked = 0` : tranché et écrit, même si la réponse est « on les laisse »
- [ ] ∀ test vu rouge avant correctif
- [ ] `npx vitest run` 893 verts · `npx tsc --noEmit` ≤ 32 · `npx playwright test` vert

## Notes

- Facture témoin en production : `FAC-2026-00003`, id 4, boutique 1, `payee`, `locked = 0`, 60 €.
- `avoirs.facture_id NOT NULL` existe déjà (migration `0010`, conservé par `0034`).
- ⊥ jamais toucher `journal_nf525` en direct.
