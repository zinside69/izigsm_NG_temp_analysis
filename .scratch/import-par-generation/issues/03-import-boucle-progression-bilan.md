# 03 — Importer la génération : boucle, progression, bilan

**What to build:** après confirmation de l'aperçu, iziGSM importe les articles un par un par la
route d'import existante, au plus 20 par minute, avec une barre de progression et un journal ligne
par ligne. Un article en échec n'arrête pas les suivants ; un article déjà dans le stock est
compté, pas en échec. À la fin, un bilan : importés, déjà en stock, échecs nommés, répartition
des importés par famille, lien vers le stock de ce fournisseur. Spec : stories 13, 14, 18, 20-29.

**Blocked by:** 02 — Aperçu chiffré d'une génération

**Status:** done (2026-09-14)

- [x] Boucle pilotée par le navigateur (précédent : synchronisation du catalogue de services),
      un import à la fois, départs espacés d'au moins 3 s
- [x] Chaque article : import unitaire existant, **sans quantité en rayon** (→ stock initial par
      défaut et seuil par défaut de la boutique) ; règles de l'import inchangées
- [x] `deja_importe` compté « déjà en stock » ; tout autre échec consigné avec article et motif,
      la boucle continue
- [x] Bilan avec répartition par famille (lue dans la réponse de chaque import) et lien vers le
      stock filtré sur ce fournisseur
- [x] Avertissement du navigateur si l'onglet est fermé pendant l'import
- [x] Aucune route d'import nouvelle, aucune migration
- [x] E2E écran avec l'API d'iziGSM simulée (`page.route()`) et l'horloge simulée (`page.clock`) :
      rythme, progression, échec isolé, déjà-en-stock, bilan — vus rouges
- [x] `npx vitest run` vert (baseline), tsc ≤ 32, balayage du menu vert

**Livré (2026-09-14)** — boucle `lancerImportGeneration()` (`stock.js`) : départs mesurés de départ à
départ (≥ 3 s), corps `{ mobilax_id }` seul, journal ligne par ligne (`textContent`), barre et
« n / total », bilan (importés · déjà en stock · échecs nommés · répartition par famille · lien
`/stock?fournisseur_id=`), `beforeunload` pendant l'import. « Déjà en stock » du bilan = déjà en
stock à l'aperçu + `deja_importe` pendant la boucle. Pendant l'import, la recherche **par article**
reste libre dans le même onglet (story 14) ; seules les séries et le bouton d'import sont figés, et
une nouvelle génération est refusée tant que l'import tourne.
Deux champs ajoutés, **aucune route nouvelle** : `famille` dans la réponse de l'import unitaire,
`fournisseur_id` dans l'aperçu (spec annotée). `GET /api/produits` accepte `fournisseur_id`
(`listProduits()`, filtre ajouté au filtre boutique) ; `/stock?fournisseur_id=` l'applique avec un
bandeau « Tout afficher ». Tests : 5 unitaires vus rouges ; E2E simulés — rythme/progression/échec
isolé/déjà en stock/bilan, fermeture d'onglet, filtre de la page Stock, recherche pendant l'import
(vus rouges).

**Pour le ticket 04** :
- quota (429) et panne pendant la boucle sont encore consignés comme **échecs ordinaires**, la
  boucle continue — c'est ce que le 04 remplace (pause + compte à rebours, arrêt) ;
- le bilan ne porte pas de « restants » : le 04 l'exige sur arrêt ;
- une coupure réseau **côté navigateur** (rejet de `fetch`) est rangée sous « Mobilax est
  injoignable » : le 04 doit la distinguer du code `indisponible` rendu par le serveur, seul à
  devoir arrêter l'import ;
- `CACHE_VERSION` à incrémenter au 04 (dernier ticket d'écran).

Relevés en revue, non traités : couleurs du journal codées en dur (`startSync()` utilise un autre
rouge) ; libellé de famille `FAMILLE_CONFIG[f]?.label || f` écrit deux fois dans `stock.js`.

⚠ Dépendance de **déploiement** : le ticket 05 du chantier `reglages-stock-boutique` (stock
initial par défaut appliqué à l'import sans quantité) doit partir avant ou avec ce chantier —
sinon les produits naissent à stock 0 et seuil 0 codés en dur.
