---
id: 003
titre: L'immuabilité d'une facture devient explicite, pas accidentelle
statut: ready-for-agent
bloque-par: []
---

## Contexte

Une facture n'est aujourd'hui ni modifiable ni supprimable — mais **par absence de routes**, pas
par intention : ni `PUT /factures/:id` ni `DELETE /factures/:id` n'existent dans
`src/routes/facturation.ts`.

Deux conséquences :

- L'écran propose un bouton 🗑 (`btnDelete`, conditionné à `!locked`) qui appelle
  `apiDelete('/api/factures/' + id)` — **route morte**. L'exploitant se voit offrir une action
  interdite, qui échoue sans expliquer pourquoi.
- Rien n'empêche un futur chantier de rouvrir cette porte sans savoir qu'elle doit rester close.

Invariant posé par l'exploitant : une facture créée est persistante, non modifiable, non
supprimable. La seule annulation est un avoir.

## Critères d'acceptation

- [ ] Le bouton de suppression disparaît de l'écran des factures
- [ ] Une tentative de modification ou de suppression répond un **refus motivé** (⊥ 404 muet) qui nomme l'avoir comme seule voie
- [ ] Un test statique fait rouge la suite si `PUT`/`DELETE /factures/:id` réapparaît — modèle `tests/routes-isolation-conformite.test.ts`
- [ ] Le refus est écrit dans `CLAUDE.md` § Factures comme invariant, avec son motif légal
- [ ] ∀ test vu rouge avant correctif
- [ ] `npx vitest run` 893 verts · `npx tsc --noEmit` ≤ 32

## Notes

- Un brouillon **sans numéro** (ticket 001) peut, lui, être abandonné sans conséquence sur la
  série : trancher explicitement s'il reste supprimable, et le dire dans l'invariant.
- Le devis, lui, reste modifiable — ⊥ étendre la règle par symétrie sans y penser.
