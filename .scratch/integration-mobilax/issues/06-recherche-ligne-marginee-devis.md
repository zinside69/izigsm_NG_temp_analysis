# 06 — Recherche Mobilax + ligne marginée dans un devis

**What to build:** un opérateur créant un devis cherche une pièce Mobilax et l'insère comme
ligne, prix calculé automatiquement via la marge résolue (famille, sinon défaut boutique) sur le
prix Mobilax — modifiable avant validation. **Ce ticket construit le module de recherche frontend
partagé**, sans logique propre à l'écran devis, que les tickets 07, 08 et 09 rechargent tel quel
sur leurs écrans respectifs.

**Blocked by:** 03 — Recherche Mobilax dans Stock (sans import), 02 — Taux de marge configurables

**Status:** ready-for-agent

- [ ] Le module de recherche Mobilax (construit ici, partagé) est chargé sur l'écran devis
- [ ] Sélectionner un résultat insère une ligne pré-remplie — description Mobilax, prix calculé
      = prix Mobilax × marge résolue (famille du produit, sinon taux par défaut de la boutique)
- [ ] L'opérateur peut modifier le prix inséré avant d'enregistrer le devis — jamais un montant
      figé
- [ ] Le module ne porte aucune logique spécifique à l'écran devis — sa surface d'appel doit
      permettre aux tickets 07-09 de le recharger sans le modifier
- [ ] Test Playwright : recherche → ligne insérée avec le prix marginé attendu → modification
      manuelle du prix possible avant validation
- [ ] Test vu rouge avant le correctif
