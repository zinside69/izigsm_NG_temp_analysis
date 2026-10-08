---
id: 02
titre: Clôture de caisse — ventes et avoirs émis séparés
statut: done
bloque-par: [01]
migration: aucune (colonnes posées par 0068, ticket 01)
qui-code: exploitant (NF525) — jamais au socle
---

## Contexte
Spec stories 45-49. La clôture du jour additionne toutes les écritures du journal NF525, avoirs compris, **en
positif** : un jour où un avoir est émis, le total clôturé est faux. Décisions Q9, Q14.

## Critères d'acceptation
- [x] Le total de la clôture (`total_ht`, `total_tva`, `total_ttc`) ne cumule plus que les écritures de vente
      du jour ; les écritures de type `avoir` alimentent `avoirs_ht`, `avoirs_tva`, `avoirs_ttc`
- [x] L'empreinte de clôture **garde son format** (toutes les écritures du jour enchaînées, avoirs compris) ;
      seul le total qu'elle intègre devient « ventes seules »
- [x] Écriture toujours en une transaction (port `batch()`), « tout ou rien » inchangé
- [x] Écran de clôture (caisse) : ventes, ligne « Avoirs émis » (HT, TVA, TTC), net = ventes − avoirs
- [x] Clôtures passées non recalculées
- [x] vitest vert, tsc ≤ 32 ; E2E clôture vu rouge puis vert

## Coutures à tester
- **Service sur vrai SQLite** : jour avec une vente et un avoir → total des ventes sans l'avoir, colonnes
  « avoirs » renseignées, chaîne NF525 intègre ; jour sans avoir → résultat identique à avant
- **E2E** : clôture affichant les trois lignes

## Notes
- Précédent : `cloture-atomique-sqlite`. Vérifier qu'aucun autre code ne relit l'empreinte de clôture en
  supposant que son total inclut les avoirs (chercher les lecteurs de `hash_cloture` avant de coder).
- `nf525.clotureJournaliere` (route boutiques) filtre déjà sur les factures : hors périmètre, à ne pas aligner
  par symétrie sans décision.

## Réalisation (2026-10-08)
- `cloturerJournee()` : `totauxDesVentes` (types nommés `TYPES_COMPTES_COMME_VENTES` : vente, encaissement, facture)
  et `totauxDesAvoirs` → `avoirs_ht/tva/ttc` ; empreinte au même format (total = ventes) ; net rendu par
  `netDuJour()` (clôture et liste des clôtures). Même périmètre pour le CA du jour / du mois (`getKpisCaisse()`) et
  les totaux du journal (`getCaisseJournal()`, avoirs rendus dans `totaux_avoirs`) — revue : sinon la page caisse
  affichait deux chiffres contradictoires.
- Écran : historique Ventes / Avoirs émis (TTC négatif + HT et TVA visibles) / Net ; bandeau « Avoirs émis du jour
  (hors ventes) » ; message de fin de clôture « ventes − avoirs = net ». `CACHE_VERSION` v3.37.
- Hors ticket, noté 🔴 P1 au `todo.md` : une facture émise puis encaissée compte deux fois (facture + encaissement).
- Tests : `cloture-avoirs-sqlite` (5, dont CA du jour vérifié par mutation), E2E `cloture-avoirs` (2), copies SQL
  figées mises à jour. Vitest 1 547 + 2 permanents, tsc 31. E2E complets : 407 verts ; `cloture-avoirs` rejoué seul
  vert (délai de chargement sous charge) ; 8 Mobilax rouges = préproduction Mobilax qui bloque les appels
  authentifiés (502 après 60 s), sans lien avec ce ticket.
