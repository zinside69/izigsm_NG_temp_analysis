-- ============================================================
-- Migration 0042 — Taux de marge par boutique et par famille (ticket 02, chantier Mobilax)
-- ============================================================
-- Taux en pourcentage du prix d'achat : prix de vente = prix d'achat × (1 + taux / 100).
-- Appliqué aux produits importés de Mobilax sur les devis, factures et ventes en caisse
-- (tickets 06-08) — jamais aux prestations de réparation (table `services`).
--
-- Toutes les colonnes sont NULLABLES et SANS DEFAULT, volontairement :
--   - une famille à NULL retombe sur `marge_taux_defaut` (resoudreTauxMarge()) ;
--   - un défaut à NULL ne donne AUCUNE marge — une boutique qui n'a rien saisi ne doit
--     pas se voir imposer un taux arbitraire (décision du 2026-09-10).
--
-- Les quatre familles sont celles du CHECK de `produits.famille` (migration 0026).
--
-- Écrites par updateTauxMarge() seule, jamais par updateBoutiqueSettings() : chaque
-- onglet des réglages envoie un corps partiel, et une assignation sans COALESCE dans la
-- requête commune écraserait ces taux à chaque enregistrement d'un autre onglet.

ALTER TABLE boutique_settings ADD COLUMN marge_taux_defaut      REAL;
ALTER TABLE boutique_settings ADD COLUMN marge_taux_piece       REAL;
ALTER TABLE boutique_settings ADD COLUMN marge_taux_accessoire  REAL;
ALTER TABLE boutique_settings ADD COLUMN marge_taux_appareil    REAL;
ALTER TABLE boutique_settings ADD COLUMN marge_taux_consommable REAL;
