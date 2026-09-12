# 02 — Stock initial valorisé au coût moyen (création manuelle)

**What to build:** quand l'opérateur crée un produit à la main avec des pièces déjà en rayon, ces
pièces entrent par un mouvement « Stock initial » (déjà le cas) **et valent leur prix d'achat**
dans la valeur du stock au coût moyen — au lieu de 0 € jusqu'à la première réception d'un bon de
commande. Défaut antérieur, corrigé indépendamment de tout réglage. Spec : stories 16, 25, 26, 28.

**Blocked by:** None — can start immediately.

**Status:** done (2026-09-12)

- [x] Création d'un produit avec une quantité > 0 : coût moyen posé au prix d'achat HT saisi
- [x] Quantité 0 : coût moyen laissé tel quel, aucun mouvement
- [x] Le mouvement « Stock initial » reste présent dans l'historique du produit
- [x] Les produits existants ne sont pas réécrits (aucune migration de rattrapage)
- [x] E2E sur D1 locale (boutique neuve) : produit créé avec 2 pièces à 10 € → valeur du stock au
      coût moyen = 20 €, historique « Stock initial » — vu rouge avant le correctif
- [x] `npx vitest run` vert (baseline), tsc ≤ 32

**Réalisation** : `prix_achat_cump` ajouté **en fin** de l'`INSERT` de `createProduit()` (prix
d'achat HT si quantité > 0, sinon 0 = `DEFAULT` de la colonne) — le produit naît avec son coût,
sans second `UPDATE`. Import Mobilax inchangé (stock 0). E2E `stock-initial-valorise.spec.ts` vu
rouge (0 au lieu de 20) puis vert ; E2E stock/réglages/Mobilax réel/balayage du menu 26/26 ;
vitest 1049/1051 (baseline), tsc 32.

**Revue à deux axes** : aucun défaut bloquant. Corrigés avant commit : commentaire qui invoquait
le `DEFAULT` de la colonne alors que le code écrit 0, JSDoc muet sur le coût moyen. Relevés, non
traités (hors ticket) : `POST /produits` ne valide ni prix ni quantité — un prix d'achat négatif
avec stock > 0 donne désormais un coût moyen négatif ; l'`INSERT` produit est figé mot pour mot
dans 4 tests unitaires (constante partagée à envisager).
