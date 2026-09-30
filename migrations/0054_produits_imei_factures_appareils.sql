-- Migration 0054 — IMEI du produit et instantané des appareils vendus
-- Chantier `vente-lit-catalogue`, ticket 07 (stories 21 à 23).
--
-- 1. `produits.imei` : un téléphone d'occasion en vente porte son IMEI dans sa fiche, pour être
--    retrouvé au scan en caisse. Porté par le PRODUIT, pas par l'ordre de reconditionnement : un
--    appareil racheté puis revendu sans reconditionnement doit être trouvable (spec, « IMEI du
--    produit »). Un appareil = une fiche : même patron d'index que 0048 (unique par boutique, sur
--    les produits actifs, valeur non nulle et non vide).
--
-- 2. `factures.appareils_snapshot` : identité figée des appareils vendus (JSON, liste — une vente
--    peut porter deux téléphones), écrite par l'UPDATE post-journal de `createVente()`, jamais
--    relue depuis la fiche produit. NULL sur toute facture sans appareil, existantes comprises.
--
-- Uniquement des ADD COLUMN et un CREATE INDEX : aucune table recréée, aucune ligne touchée.
-- Numéro réservé le 2026-09-30 (`decisions.md`) : 0052 et 0053 sont pris par les tickets 05 et 06.

ALTER TABLE produits ADD COLUMN imei TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_produits_imei_unique
  ON produits(boutique_id, imei)
  WHERE actif = 1 AND imei IS NOT NULL AND TRIM(imei) <> '';

ALTER TABLE factures ADD COLUMN appareils_snapshot TEXT;
