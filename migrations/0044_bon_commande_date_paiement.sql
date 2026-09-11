-- Migration 0044 — date de règlement d'un bon de commande fournisseur
--
-- `statut_paiement` existait depuis 0014 mais aucun chemin ne le faisait passer à `paid` :
-- il restait `pending` à vie. `marquerBonCommandeRegle()` (fournisseursService.ts) le fait
-- désormais, et note ici le jour du règlement.
--
-- Simple ajout de colonne nullable : aucune recréation de table, aucune donnée réécrite.
-- Les bons existants gardent `date_paiement` NULL (jamais réglés par ce chemin).

ALTER TABLE bons_commande ADD COLUMN date_paiement DATETIME;
