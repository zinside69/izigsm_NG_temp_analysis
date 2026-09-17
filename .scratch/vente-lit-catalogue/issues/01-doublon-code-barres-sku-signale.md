# 01 — Doublon de code-barres ou de SKU signalé clairement

**What to build:** un responsable de boutique qui crée un produit — à la main ou par import CSV —
avec un code-barres ou un SKU déjà porté par un autre produit actif de sa boutique reçoit un message
qui **nomme le produit existant**, au lieu d'une erreur de base de données. La règle « un
code-barres, un produit » devient vraie en base : la migration d'unicité déjà écrite (index uniques
partiels sur le code-barres et le SKU, produits actifs, code non vide) part avec ce ticket.
Préalable au scan : la douchette suppose qu'un code désigne un seul produit.
Spec : `.scratch/vente-lit-catalogue/spec.md` (story 36, décision « Unicité des codes ») ;
vocabulaire `CONTEXT.md` (Code-barres, SKU).

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] La migration d'unicité du code-barres et du SKU est testée contre un vrai SQLite : un doublon
      actif est refusé ; deux produits sans code, un produit inactif et deux boutiques différentes
      ne le sont pas
- [ ] Création manuelle d'un produit dont le code-barres est déjà pris : refus explicite nommant le
      produit existant (pas d'erreur SQL brute), vu rouge d'abord
- [ ] Même chose pour un SKU déjà pris
- [ ] Import CSV : la ligne en doublon est rapportée dans le bilan de l'import avec le produit
      existant, les autres lignes passent
- [ ] L'import fournisseur garde son comportement actuel (`deja_importe`) — ses tests restent verts
- [ ] Toute autre erreur SQL reste relevée telle quelle (seule la violation d'unicité est convertie)
- [ ] À l'écran (fiche produit, import CSV) : le message est affiché, prouvé par E2E sur la vraie
      base locale
- [ ] `npx vitest run` vert (hors les 2 échecs permanents), erreurs tsc inchangées
- [ ] Rappel de déploiement : la migration est appliquée à distance **avant** le code, et
      `d1_migrations` distant est relu entre les deux commandes
