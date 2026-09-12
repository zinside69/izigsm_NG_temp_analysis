# 03 — Importer la génération : boucle, progression, bilan

**What to build:** après confirmation de l'aperçu, iziGSM importe les articles un par un par la
route d'import existante, au plus 20 par minute, avec une barre de progression et un journal ligne
par ligne. Un article en échec n'arrête pas les suivants ; un article déjà dans le stock est
compté, pas en échec. À la fin, un bilan : importés, déjà en stock, échecs nommés, répartition
des importés par famille, lien vers le stock de ce fournisseur. Spec : stories 13, 14, 18, 20-29.

**Blocked by:** 02 — Aperçu chiffré d'une génération

**Status:** ready-for-agent

- [ ] Boucle pilotée par le navigateur (précédent : synchronisation du catalogue de services),
      un import à la fois, départs espacés d'au moins 3 s
- [ ] Chaque article : import unitaire existant, **sans quantité en rayon** (→ stock initial par
      défaut et seuil par défaut de la boutique) ; règles de l'import inchangées
- [ ] `deja_importe` compté « déjà en stock » ; tout autre échec consigné avec article et motif,
      la boucle continue
- [ ] Bilan avec répartition par famille (lue dans la réponse de chaque import) et lien vers le
      stock filtré sur ce fournisseur
- [ ] Avertissement du navigateur si l'onglet est fermé pendant l'import
- [ ] Aucune route d'import nouvelle, aucune migration
- [ ] E2E écran avec l'API d'iziGSM simulée (`page.route()`) et l'horloge simulée (`page.clock`) :
      rythme, progression, échec isolé, déjà-en-stock, bilan — vus rouges
- [ ] `npx vitest run` vert (baseline), tsc ≤ 32, balayage du menu vert

⚠ Dépendance de **déploiement** : le ticket 05 du chantier `reglages-stock-boutique` (stock
initial par défaut appliqué à l'import sans quantité) doit partir avant ou avec ce chantier —
sinon les produits naissent à stock 0 et seuil 0 codés en dur.
