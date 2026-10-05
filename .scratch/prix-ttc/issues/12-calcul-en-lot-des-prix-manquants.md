---
id: 12
titre: Calcul en lot du prix de vente des fiches sans prix
statut: ready-for-agent
bloque-par: [06]
migration: aucune
---

## Contexte
Mesuré en production le 2026-10-05 (requête du ticket 01) : dans la boutique 2, **795 fiches actives sur
796 n'ont aucun prix de vente** (0 €) — les pièces importées de Mobilax sans taux de marge réglé
(règle voulue : aucune marge imposée). Le ticket 06 calcule le prix des **nouveaux** imports ; les fiches
existantes resteraient à 0 €. **Décision de l'exploitant (2026-10-05, option b)** : un geste du manager
calcule en lot le prix de vente TTC de ces fiches, par la même règle que l'import (prix d'achat HT ×
(1 + marge de la famille) × (1 + TVA), arrondi selon le réglage de la boutique).

## Critères d'acceptation
- [ ] Geste du **manager** (et de l'admin de boutique), refusé au technicien et à l'admin plateforme, depuis la page Stock : « Calculer les prix manquants »
- [ ] **Aperçu avant tout calcul** : nombre de fiches qui recevront un prix, nombre de fiches ignorées et pourquoi (pas de prix d'achat, aucune marge réglée pour leur famille), quelques exemples (pièce, prix d'achat HT, prix TTC calculé)
- [ ] Rien n'est écrit sans confirmation de l'aperçu
- [ ] **Seules les fiches actives à 0 € de prix de vente** sont touchées : ⊥ jamais un prix déjà saisi, même faible
- [ ] Une fiche sans prix d'achat (0 €) ou sans marge résolue (`resoudreTauxMarge()` → `null`) est **ignorée**, jamais mise à un prix inventé
- [ ] Prix calculé = fonction du ticket 06 (marge de la famille, TVA de la fiche, arrondi de la boutique) ; HT déduit au centime (`src/lib/prixVente.ts`)
- [ ] Écriture en **une transaction** (`batch()` du port `Database`) : tout ou rien
- [ ] Une ligne au journal d'audit (nombre de fiches calculées, règle d'arrondi employée)
- [ ] Bilan affiché : fiches calculées, ignorées (par motif)
- [ ] vitest vert, tsc ≤ 32, E2E stock verts

## Coutures à tester
- Service de calcul en lot sur vrai SQLite (`d1Sqlite`) : fiches à 0 € calculées ; prix déjà saisi intact ;
  fiche sans prix d'achat ignorée ; famille sans marge ignorée ; tout ou rien sur échec simulé
- Route : manager accepté, technicien et admin plateforme refusés, autre boutique jamais touchée
- E2E page Stock : aperçu (nombres), confirmation, bilan, prix relus dans la liste

## Notes
- Isolation multi-tenant : la boutique vient du jeton, ⊥ un `boutique_id` du corps.
- À rejouer sur la production avant le déploiement : le nombre de fiches calculables (prix d'achat > 0 et
  marge réglée) — sans taux de marge réglé dans l'onglet Marges, le geste ne calcule rien, et l'écran doit
  le dire en renvoyant vers les Réglages.
- Hors périmètre : les prix déjà saisis (aucun recalcul), les services (ticket 04).
