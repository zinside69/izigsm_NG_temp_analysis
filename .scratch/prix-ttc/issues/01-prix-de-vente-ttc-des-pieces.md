---
id: 01
titre: Prix de vente TTC des pièces — fiche, liste du stock, reprise
statut: ready-for-agent
bloque-par: []
migration: 0062
---

## Contexte
Spec `.scratch/prix-ttc/spec.md`, stories 1-3, 6-9, 44-47. Le **prix de vente** d'une pièce devient un
TTC stocké qui fait foi (décision Q1 du 2026-10-04) ; le prix d'achat reste HT (Q4). Ticket d'ouverture :
il ajoute la colonne TTC **à côté** de la colonne HT (qui reste), sans rien casser des lectures existantes.

## Critères d'acceptation
- [ ] Migration `0062` : colonne de prix de vente TTC sur les produits ; reprise TTC = arrondi(HT × (1 + taux)) au centime ; colonne HT intacte
- [ ] Requête de comptage des TTC « non ronds » (centimes ≠ 0 et ≠ 90), prête à jouer en `--remote` avant la migration
- [ ] Fiche produit : prix de vente saisi en TTC, HT et TVA déduits affichés dessous ; prix d'achat toujours « HT »
- [ ] Liste du stock : colonne « Prix vente TTC » ; marge calculée sur le HT déduit
- [ ] API de création / modification d'un produit : accepte le TTC ; un HT seul est converti (transition) ; TTC prioritaire si les deux ; réponses portant TTC et HT
- [ ] Changement du taux de TVA d'une fiche : HT déduit gardé, TTC recalculé au centime (Q20)
- [ ] Toute création de produit (manuelle, CSV, Mobilax) écrit le TTC — en attendant 06/07, TTC = HT × (1 + taux) au centime
- [ ] `npx vitest run` vert (baseline : 2 échecs permanents), tsc ≤ 32, E2E stock verts

## Coutures à tester
- Migration de reprise sur vrai SQLite au schéma réel (`d1Sqlite`) : TTC repris, HT intact, comptage des non-ronds
- Route de création / modification de produit : TTC écrit, HT converti, taux changé → HT gardé
- E2E fiche produit et liste du stock : saisie 9,90 € → relu 9,90 € partout

## Notes
Colonnes figées par des mocks (`INSERT` produits dans 5 fichiers de test) : ajouter la colonne **en fin**
de liste et mettre la copie à jour (CLAUDE.md § Douchette). `createProduit()` reste le seul chemin de
création. Caisse et factures lisent encore le HT : c'est le ticket 02.
