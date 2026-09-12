# 04 — Import CSV : réglages appliqués et stock valorisé

**What to build:** quand l'opérateur importe un fichier CSV de produits, une ligne dont la colonne
seuil est vide prend le seuil d'alerte par défaut de la boutique (au lieu de 5 codé en dur), une
ligne dont la quantité est vide crée un produit à 0, et une quantité > 0 est valorisée au prix
d'achat de la ligne au coût moyen. Une colonne remplie l'emporte toujours sur le réglage.
Spec : stories 18-20, 26.

**Blocked by:** 01 — Onglet Réglages › Stock ; 03 — Seuil par défaut à la création manuelle +
rappel (le rappel doit exister avant ce second changement de comportement)

**Status:** done (2026-09-12)

- [x] Colonne seuil vide → seuil par défaut de la boutique ; remplie → sa valeur
- [x] Colonne quantité vide → 0, aucun mouvement
- [x] Quantité > 0 → mouvement d'entrée existant conservé + coût moyen = prix d'achat de la ligne
- [x] Mise à jour d'un produit existant par le CSV : comportement inchangé (hors périmètre)
- [x] E2E sur D1 locale : import d'un fichier mêlant seuil vide/rempli et quantité vide/remplie,
      relecture des produits et de la valeur du stock — vu rouge avant le correctif
- [x] `npx vitest run` vert (baseline), tsc ≤ 32

**Réalisation** : la colonne `stock_minimum`, annoncée par l'aide de l'écran d'import, **n'était
pas lue** — chaque produit créé prenait 5 en dur. Elle l'est désormais : vide → seuil par défaut
de la boutique (lu une fois par fichier), remplie → sa valeur, même 0. Coût moyen posé au prix
d'achat de la ligne quand la quantité est > 0. Un seul lecteur des réglages dans le service
(`lireDefautsStock()`, partagé avec `createProduit()`) et une seule règle de coût moyen initial
(`coutMoyenInitial()`, que le ticket 05 réutilisera).

**Ajoutés après revue** (vus rouges puis verts, unitaire et E2E) :
- quantité ou seuil remplis mais pas un entier ≥ 0 (`-3`, `2.5`, `abc`, `0x10`) → ligne ignorée
  avec un message — un `-3` insérait un stock négatif sans mouvement (story 20) ;
- virgule décimale lue (`12,50` valait 12) sur prix et TVA — le coût moyen du stock initial en
  héritait. Vaut aussi pour la mise à jour d'un SKU existant (lecture des prix, seul changement
  de ce chemin).

**Preuves** : E2E `stock-import-csv-reglages.spec.ts` (2 tests) vu rouge (seuil 5 au lieu de 3 ;
quantité −3 importée) puis vert ; 6 tests unitaires vus rouges puis verts ; E2E stock, réglages,
Mobilax réel, balayage du menu 33/33 ; vitest baseline, tsc 32.

**À trancher avant le ticket 05** : motif du mouvement de départ. `decisions.md` et la story 25
disent « Stock initial » sur tous les chemins ; le CSV écrit toujours « Import catalogue CSV »
(ce ticket : « mouvement d'entrée existant conservé »).

**Relevés, non traités** : prix d'achat vide avec quantité > 0 → pièces valorisées 0 € sans
avertissement (conforme : aucun prix connu) ; paramètres SQL positionnels (12) dans l'INSERT.
⚠ **Instabilité E2E observée** : le test d'écran de `stock-seuil-defaut-creation.spec.ts`
(ticket 03) a dépassé 30 s une fois, dans le lot complet (`waitForResponse` en attente) — non
reproduit (lot relancé 33/33, 4 passages isolés verts, journal wrangler sans erreur). Si ça
revient : faire échouer l'attente sur `requestfailed` au lieu d'attendre le délai global.
