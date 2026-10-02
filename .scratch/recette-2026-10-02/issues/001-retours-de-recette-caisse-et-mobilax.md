---
id: 001
titre: Retours de recette du 2026-10-02 — scan dans la recherche, quantité entière, fenêtre Mobilax
statut: ready-for-human
bloque-par: []
---

# 001 — Retours de recette du 2026-10-02 (production v3.20, manager `telnet@bbox.fr`)

**Codé dans `izigsm/webapp` avec l'exploitant** (A et B touchent la caisse ; C est petit et demandé
« maintenant, ici » par l'exploitant). Trois parties indépendantes, chacune vue rouge d'abord.

## A — Un scan dans « Chercher un produit… » doit ajouter le produit (caisse)

**Constat (capture de l'exploitant)** : à l'ouverture d'une vente, le curseur est dans
`#vente-produit-search`. `douchette.js` se **neutralise dans tout champ de saisie** (règle voulue,
`CLAUDE.md` § Douchette), et ce champ n'a **aucune action sur Entrée** (seulement
`oninput → debouncedSearchProduit()` et une liste à cliquer). Un scan de `3000000388952` (EAN = SKU du
produit #804) n'a donc rien mis au panier ; l'exploitant a fini par une **ligne libre à 0 €**
désignée « 3000000388952 ». **Hypothèse à reproduire en E2E avant tout correctif.**

**Correctif attendu** : dans ce champ, **Entrée** sur une saisie qui a la forme d'un code
(`routerScan()` : 13 chiffres → code-barres, 15 → IMEI) appelle **`traiterScan(code)`** — le même
chemin que la douchette hors champ (`?scan=`, égalité stricte, quantité + 1 au rescan, « Créer la
fiche » si inconnu) — puis vide le champ. Toute autre saisie + Entrée : rien de nouveau (la liste
reste). ⊥ une seconde implémentation du routage.

**E2E** : vraie D1 locale, produit à EAN connu ; focus dans le champ, `type()` du code puis Entrée
(comme une douchette) → la ligne du produit s'ajoute, à son prix ; deux fois → quantité 2 ; vu rouge.

## B — Quantité entière ≥ 1 partout (décision de l'exploitant du 2026-10-02)

**Constat** : la caisse accepte `0,98` (capture). Décision : **entier ≥ 1, partout** — caisse, devis,
factures, lignes libres comprises.

**Correctif attendu** : champs quantité `type="number" min="1" step="1"` (caisse.js, devis.js,
factures.js) ; **serveur** : `createVente()` / routes de devis et de facture refusent une quantité non
entière ou < 1 (**400**, message clair) **avant toute écriture** (NF525 : aucun numéro consommé, rien
au journal). Chercher tous les points d'entrée (`lignes[].quantite`) : caisse, `POST /api/devis`,
`PUT /api/devis/:id`, `POST /api/factures`, conversion. Vitest des validations + E2E caisse (saisie
`0,98` refusée à l'écran).

## C — Fenêtre « Chercher une pièce chez Mobilax » plus large, journal sur une ligne

**Constat (capture)** : pendant un import de 200 pièces, chaque entrée du journal (« = Ecran Tactile …
— déjà dans votre stock ») passe sur **deux lignes** ; la fenêtre est trop étroite pour lire les noms
de pièces.

**Correctif attendu** (`stock.html` / `stock.js`) : fenêtre élargie (~1100 px, pleine largeur sur un
petit écran) ; **une entrée de journal par ligne** — nom tronqué « … » (`text-overflow: ellipsis`,
`white-space: nowrap`), nom complet au survol (`title`) ; tableau de résultats plus lisible (colonne
Pièce plus large). E2E : mesure de hauteur d'une entrée de journal = une ligne (`boundingBox()`), pas
de défilement horizontal. `CACHE_VERSION` +1.

## Recette encore ouverte (pas de code)

- Produit #804 après « Ajouter 1 au stock » : relire `stock_actuel` = 1, un seul mouvement « Import
  fournisseur — déjà en stock », `mobilax_id` posé (lecture distante en `7403` intermittent le
  2026-10-02 après-midi — réessayer).
- Douchette en caisse (après A) et **clôture du soir** par le manager.
