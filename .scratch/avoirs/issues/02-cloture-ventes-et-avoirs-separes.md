---
id: 02
titre: Clôture de caisse — ventes et avoirs émis séparés
statut: ready-for-agent
bloque-par: [01]
migration: aucune (colonnes posées par 0068, ticket 01)
qui-code: exploitant (NF525) — jamais au socle
---

## Contexte
Spec stories 45-49. La clôture du jour additionne toutes les écritures du journal NF525, avoirs compris, **en
positif** : un jour où un avoir est émis, le total clôturé est faux. Décisions Q9, Q14.

## Critères d'acceptation
- [ ] Le total de la clôture (`total_ht`, `total_tva`, `total_ttc`) ne cumule plus que les écritures de vente
      du jour ; les écritures de type `avoir` alimentent `avoirs_ht`, `avoirs_tva`, `avoirs_ttc`
- [ ] L'empreinte de clôture **garde son format** (toutes les écritures du jour enchaînées, avoirs compris) ;
      seul le total qu'elle intègre devient « ventes seules »
- [ ] Écriture toujours en une transaction (port `batch()`), « tout ou rien » inchangé
- [ ] Écran de clôture (caisse) : ventes, ligne « Avoirs émis » (HT, TVA, TTC), net = ventes − avoirs
- [ ] Clôtures passées non recalculées
- [ ] vitest vert, tsc ≤ 32 ; E2E clôture vu rouge puis vert

## Coutures à tester
- **Service sur vrai SQLite** : jour avec une vente et un avoir → total des ventes sans l'avoir, colonnes
  « avoirs » renseignées, chaîne NF525 intègre ; jour sans avoir → résultat identique à avant
- **E2E** : clôture affichant les trois lignes

## Notes
- Précédent : `cloture-atomique-sqlite`. Vérifier qu'aucun autre code ne relit l'empreinte de clôture en
  supposant que son total inclut les avoirs (chercher les lecteurs de `hash_cloture` avant de coder).
- `nf525.clotureJournaliere` (route boutiques) filtre déjà sur les factures : hors périmètre, à ne pas aligner
  par symétrie sans décision.
