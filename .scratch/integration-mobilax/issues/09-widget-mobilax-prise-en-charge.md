# 09 — Widget de recherche Mobilax sur Prise en charge

**What to build:** le module de recherche construit au ticket 06 est rechargé sur le modal de
prise en charge. Sélectionner un résultat pré-remplit le champ `prix_estime` existant avec le
prix marginé (même résolution que devis/facture/caisse) — modifiable par l'opérateur.

**Blocked by:** 06 — Recherche Mobilax + ligne marginée dans un devis

**Status:** ready-for-agent

- [ ] Le module de recherche Mobilax (déjà construit) est chargé sur le modal de prise en charge
- [ ] Sélectionner un résultat pré-remplit `prix_estime` avec le prix Mobilax marginé — même
      résolution de marge que sur devis/facture/caisse (famille, sinon défaut boutique)
- [ ] Le champ reste librement modifiable par l'opérateur après pré-remplissage
- [ ] Aucun nouveau champ de schéma sur les tickets — le widget alimente le champ existant
- [ ] Test Playwright : recherche → `prix_estime` pré-rempli avec la valeur attendue →
      modification manuelle possible
- [ ] Test vu rouge avant le correctif
