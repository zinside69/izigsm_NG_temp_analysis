-- ============================================================
-- Migration 0047 — Valeurs par défaut de stock par boutique (ticket 01, chantier
-- reglages-stock-boutique, décisions du 2026-09-12)
-- ============================================================
-- Chaque boutique gère son stock comme elle l'entend : le seuil d'alerte et le stock initial
-- posés à la création d'un produit deviennent des réglages de boutique, au lieu des valeurs
-- codées en dur et différentes selon le chemin (formulaire 2, CSV 5, repli 5, import 0).
--
-- NULLABLES et SANS DEFAULT, volontairement :
--   - NULL = « jamais réglé », distinct d'un 0 enregistré : la page Stock affiche un rappel
--     tant que le seuil n'a jamais été enregistré (ticket 03) ;
--   - à l'application, NULL vaut 0 — aucune surveillance ni aucun stock imposé
--     (resoudreDefautsStock()).
-- Le seuil 0 garde un seul sens dans toutes les boutiques : produit non surveillé
-- (lib/stockSeuil.ts). Ces colonnes ne changent que la valeur posée à la création.
--
-- Écrites par updateDefautsStock() seule (route PUT /api/boutiques/:id/stock), jamais par
-- updateBoutiqueSettings() : chaque onglet des réglages envoie un corps partiel.
-- Ajout de colonnes nullables : aucune donnée réécrite.

ALTER TABLE boutique_settings ADD COLUMN stock_seuil_defaut   INTEGER;
ALTER TABLE boutique_settings ADD COLUMN stock_initial_defaut INTEGER;
