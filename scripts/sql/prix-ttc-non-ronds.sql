-- Prix de vente TTC « non ronds » — à jouer AVANT la migration 0062, en lecture seule
-- (ticket 01 du chantier prix TTC, décision Q8 de l'exploitant du 2026-10-04).
--
-- Liste les pièces actives dont le TTC repris (HT × (1 + taux), arrondi au centime, même calcul que
-- la migration) n'aura ni 00 ni 90 centimes, pour que l'exploitant les corrige à la main.
--
-- En production :
--   npx wrangler d1 execute DB --remote --file=scripts/sql/prix-ttc-non-ronds.sql
SELECT
  produits.id            AS produit_id,
  produits.boutique_id   AS boutique_id,
  produits.nom           AS nom,
  produits.prix_vente_ht AS prix_vente_ht,
  produits.tva_taux      AS tva_taux,
  -- TTC repris, en euros
  ROUND(produits.prix_vente_ht * (100 + produits.tva_taux)) / 100.0 AS prix_vente_ttc_repris
FROM produits
-- Pièces encore en vente seulement
WHERE produits.actif = 1
  -- Centimes du TTC repris : ni 00 ni 90
  AND CAST(ROUND(produits.prix_vente_ht * (100 + produits.tva_taux)) AS INTEGER) % 100 NOT IN (0, 90)
ORDER BY produits.boutique_id, produits.id;
