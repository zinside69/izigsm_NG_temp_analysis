# 05 — Import depuis un fournisseur connecté : « Qté en rayon » et seuil par défaut

**What to build:** dans la recherche fournisseur de la page Stock, chaque article fournisseur
porte un champ « Qté en rayon » à côté du bouton d'import, pré-rempli par le stock initial par
défaut de la boutique. Importer crée le produit importé avec cette quantité (0 = sans stock, un
clic comme aujourd'hui) et le seuil d'alerte par défaut de la boutique (au lieu de 0 codé en dur).
Une quantité > 0 entre par un mouvement « Stock initial », valorisée au prix d'achat relu chez le
fournisseur. Spec : stories 21-24, 27.

**Blocked by:** 01 — Onglet Réglages › Stock ; 02 — Stock initial valorisé au coût moyen

**Status:** done (2026-09-12)

- [x] La requête d'import accepte une quantité en rayon facultative (entier ≥ 0) ; absente →
      stock initial par défaut ; invalide → 400 **sans appel au fournisseur**
- [x] Produit importé : seuil = seuil par défaut de la boutique
- [x] Quantité > 0 : mouvement « Stock initial » + coût moyen = prix d'achat du fournisseur
- [x] Autres règles de l'import inchangées (fiche relue, doublon `deja_importe`, marge, famille)
- [x] Champ « Qté en rayon » pré-rempli sur chaque ligne de résultat, transmis à l'import
- [x] Tests du service d'import (fournisseur simulé à sa frontière HTTP) : quantité absente,
      fournie, invalide ; seuil par défaut — vus rouges avant le correctif
- [x] E2E écran : champ présent et pré-rempli (sans brûler de quota au-delà de l'import réel
      existant)
- [x] `CACHE_VERSION` incrémenté (dernière tâche d'écran du chantier) — `izigsm-v3.02`
- [x] `npx vitest run` vert (baseline), tsc ≤ 32, balayage du menu vert

**Réalisation** : `POST /api/mobilax/import { mobilax_id, quantite_en_rayon? }`. Le service valide
la quantité **en premier** (nombre JSON, entier ≥ 0 — `estEntierPositifOuNul()`, règle partagée
avec `createProduit()`) : `quantite_invalide` en 400, aucun appel au fournisseur. Réglages lus
une fois pour la marge et les valeurs par défaut (`resoudreDefautsStock()`) ; mouvement « Stock
initial » et coût moyen posés par `createProduit()`. Écran : colonne « Qté en rayon », pré-remplie
par le stock initial par défaut ; vide = non envoyée (le serveur applique le réglage).

**Preuves** : 5 tests unitaires (fournisseur simulé) vus rouges puis verts ; E2E simulées vues
rouges (champ absent ; messages) puis vertes ; import **réel** en préproduction avec 2 pièces
(stock 2, coût moyen = prix d'achat, historique « Stock initial ») — sans appel Mobilax en plus ;
E2E Mobilax, stock, réglages, balayage du menu 38/38 ; vitest baseline, tsc 32.

**Revue à deux axes** — corrigés avant commit : message d'import qui renvoyait à « Ajuster le
stock » après une quantité saisie ; pièce déjà importée avec une quantité > 0 — la saisie
disparaissait sans rien dire, l'écran le dit désormais ; en-tête « Stock Mobilax » →
« Dispo. fournisseur » (glossaire) ; test unitaire qui lisait le texte d'une requête SQL ;
règle « entier ≥ 0 » recopiée. Relevés, non traités :
- 400 ici contre 422 dans `POST /produits` pour la même règle (le ticket demande 400) ;
- la page recopie le repli « jamais réglé → 0 » (`stockInitialDefaut`, précédent du ticket 03) ;
- un article fournisseur à 0 € importé avec des pièces : coût moyen 0 (conforme à la lettre) ;
- `CLAUDE.md` § Service Mobilax décrit l'import sans `quantite_en_rayon` — au checkpoint.
