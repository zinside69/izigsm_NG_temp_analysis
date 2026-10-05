---
id: 01
titre: Prix de vente TTC des pièces — fiche, liste du stock, reprise
statut: done
bloque-par: []
migration: 0062
---

## Contexte
Spec `.scratch/prix-ttc/spec.md`, stories 1-3, 6-9, 44-47. Le **prix de vente** d'une pièce devient un
TTC stocké qui fait foi (décision Q1 du 2026-10-04) ; le prix d'achat reste HT (Q4). Ticket d'ouverture :
il ajoute la colonne TTC **à côté** de la colonne HT (qui reste), sans rien casser des lectures existantes.

## Critères d'acceptation
- [x] Migration `0062` : colonne de prix de vente TTC sur les produits ; reprise TTC = arrondi(HT × (1 + taux)) au centime ; colonne HT intacte
- [x] Requête de comptage des TTC « non ronds » (centimes ≠ 0 et ≠ 90), prête à jouer en `--remote` avant la migration
- [x] Fiche produit : prix de vente saisi en TTC, HT et TVA déduits affichés dessous ; prix d'achat toujours « HT »
- [x] Liste du stock : colonne « Prix vente TTC » ; marge calculée sur le HT déduit
- [x] API de création / modification d'un produit : accepte le TTC ; un HT seul est converti (transition) ; TTC prioritaire si les deux ; réponses portant TTC et HT
- [x] Changement du taux de TVA d'une fiche : HT déduit gardé, TTC recalculé au centime (Q20)
- [x] Toute création de produit (manuelle, CSV, Mobilax) écrit le TTC — en attendant 06/07, TTC = HT × (1 + taux) au centime
- [x] `npx vitest run` vert (baseline : 2 échecs permanents), tsc ≤ 32, E2E stock verts

## Coutures à tester
- Migration de reprise sur vrai SQLite au schéma réel (`d1Sqlite`) : TTC repris, HT intact, comptage des non-ronds
- Route de création / modification de produit : TTC écrit, HT converti, taux changé → HT gardé
- E2E fiche produit et liste du stock : saisie 9,90 € → relu 9,90 € partout

## Notes
Colonnes figées par des mocks (`INSERT` produits dans 5 fichiers de test) : ajouter la colonne **en fin**
de liste et mettre la copie à jour (CLAUDE.md § Douchette). `createProduit()` reste le seul chemin de
création. Caisse et factures lisent encore le HT : c'est le ticket 02.

## Réalisation (2026-10-05)
- `src/lib/prixVente.ts` : seul point des conversions (TTC prioritaire, HT seul converti, taux changé → HT gardé ; un taux renvoyé à l'identique n'est pas un changement — trouvé en revue : 9,99 € devenait 10,00 €). TTC négatif refusé (422).
- La colonne HT reste écrite (déduite du TTC) : caisse et factures la lisent jusqu'au ticket 02.
- Écritures : `createProduit()` (manuelle, Mobilax), import CSV (création et mise à jour), clôture d'un reconditionnement (TTC = HT × 1,2 en attendant le ticket 10).
- Réponses : création → `prix_vente_ttc`, `prix_vente_ht` ; modification → fiche relue (`data`).
- Requête des non-ronds : `scripts/sql/prix-ttc-non-ronds.sql`, **fiches actives seulement** (liste de corrections à faire à la main ; la migration reprend toutes les fiches). Liste des lignes = le compte.
- Écran : fiche « Prix de vente TTC » + HT et TVA déduits dessous ; liste « Prix vente TTC » et « Valeur HT ». Le détail suppose 20 % pour une fiche neuve : franchise = ticket 09.
- Tests : migration et non-ronds, routes (10 cas), CSV et reconditionnement sur vrai SQLite ; E2E `stock-prix-ttc`.
