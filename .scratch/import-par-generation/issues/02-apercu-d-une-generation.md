# 02 — Aperçu chiffré d'une génération

**What to build:** une fois les séries proposées, l'opérateur voit avant de confirmer : le nombre
d'articles fournisseur par série, combien sont déjà dans son stock, combien restent à importer et
la durée estimée. Décocher une série recalcule l'aperçu ; au-delà de 200 articles, une
confirmation renforcée (« environ N min, gardez cet onglet ouvert »). Spec : stories 8-12.

**Blocked by:** 01 — Mode « Par génération » : proposer les séries d'une génération

**Status:** done (2026-09-14)

- [x] Aperçu : articles de chaque série lus par la recherche par série (100 par page, toutes les
      pages — liste sous `data.products`), dédoublonnés entre séries
- [x] « Déjà dans le stock » = référence portée par un produit actif de la boutique pour cette
      fiche fournisseur (même clé que l'anti-doublon de l'import), **sans appel de fiche**
- [x] Durée estimée = articles à importer × 3 s, arrondie à la minute ; aucun plafond
- [x] Route de lecture : mêmes gardes que le ticket 01 ; liste de séries invalide → 400 sans appel
- [x] Quota atteint / fournisseur indisponible pendant l'aperçu : message clair, délai affiché
- [x] Tests du service (pagination multi-pages, dédoublonnage, déjà-en-stock) et de la route —
      vus rouges
- [x] E2E écran (API d'iziGSM simulée) : décochage qui recalcule, confirmation > 200
- [x] **E2E réel en préproduction, aperçu seulement** (« iPhone 17 » → séries puis aperçu chiffré,
      aucun import) ; sauté sans clé, jamais faussement vert
- [x] `npx vitest run` vert (baseline), tsc ≤ 32

**Livré (2026-09-14)** — `apercuGeneration()` (`mobilaxService.ts`), `referencesImportees()`
(`stockService.ts`, une requête pour tout l'aperçu), `GET /api/mobilax/apercu?series=`, aperçu
chiffré dans la fenêtre Mobilax (nombre par série, total, déjà en stock, à importer, durée),
recalculé au décochage **sans rappeler Mobilax**, confirmation renforcée au-delà de 200 (« … gardez
cet onglet ouvert »). Contrat de réponse **amendé dans la spec** : tous les articles dédoublonnés,
chacun avec `series[]` et `deja_en_stock` — seul moyen de recalculer au décochage (story 12). Tests :
12 service + 6 route (vus rouges) ; 4 E2E simulés + aperçu réel « iPhone 17 » ajouté à l'E2E
préproduction (vus rouges sur le build du ticket 01).

**Pour le ticket 03** : le bouton « Importer » et la confirmation existent ; `lancerImportGeneration()`
(`stock.js`) n'affiche qu'un message « pas encore disponible » — c'est lui que la boucle remplace.
Articles à importer = `selectionApercu().aImporter`. **Ce message ne doit jamais partir en
production** : chantier déployé en un bloc après 04.

Relevés en revue, non traités : sous 10 articles, la durée s'affiche « moins d'une minute »
(arrondi à 0, écart assumé) ; l'aperçu lit la référence dans la recherche par série, l'import dans
`/:id/full` — cohérents selon la mesure du 2026-09-12 (17/17), aucun test ne protège cette
hypothèse ; aucun aperçu partiel — une génération de plus de ~30 pages (> 3 000 articles)
atteindrait le quota à chaque tentative, sans explication pour l'opérateur.
