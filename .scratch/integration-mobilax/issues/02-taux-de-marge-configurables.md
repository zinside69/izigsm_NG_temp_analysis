# 02 — Taux de marge configurables (défaut boutique + par famille)

**What to build:** l'exploitant fixe un taux de marge par défaut pour sa boutique, et
optionnellement un taux différent par `famille` de produit (pièce, accessoire, appareil,
consommable), depuis les réglages boutique. Une famille sans taux propre retombe sur le taux par
défaut. Indépendant de Mobilax — sert de base à l'application de la marge dans les tickets 06-09.

**Blocked by:** None — peut démarrer immédiatement, en parallèle du ticket 01.

**Status:** ready-for-agent

- [ ] L'exploitant peut fixer un taux de marge par défaut pour sa boutique dans les réglages
      existants (même niveau que le taux de TVA par défaut déjà présent)
- [ ] L'exploitant peut fixer, optionnellement, un taux différent pour chacune des quatre
      familles existantes (`piece`, `accessoire`, `appareil`, `consommable`)
- [ ] La résolution du taux applicable suit l'ordre : taux de la famille s'il est défini, sinon
      taux par défaut de la boutique
- [ ] Tests couvrant les trois cas : taux par défaut seul, famille surchargée, famille sans
      taux propre (repli sur le défaut)
- [ ] Isolation : le taux d'une boutique n'affecte jamais la résolution d'une autre boutique
- [ ] Test vu rouge avant le correctif
