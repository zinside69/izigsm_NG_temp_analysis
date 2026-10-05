-- Migration 0062 — Prix de vente TTC des pièces (ticket 01 du chantier prix TTC, 2026-10-04)
--
-- Décision de l'exploitant (Q1) : le prix de vente d'une pièce est un TTC de référence, stocké, qui
-- fait foi ; le HT s'en déduit. La colonne HT reste en place : les lectures existantes (caisse,
-- factures) l'emploient encore jusqu'au ticket 02, et elle permet la marche arrière.
--
-- Reprise (Q8) : TTC = HT × (1 + taux / 100), arrondi au centime. Le calcul passe par les centimes
-- (HT × (100 + taux), arrondi à l'unité, puis ÷ 100) pour éviter les écarts de la virgule flottante.
--
-- Avant de l'appliquer en production : jouer scripts/sql/prix-ttc-non-ronds.sql (lecture seule)
-- et remettre la liste des TTC « non ronds » à l'exploitant.
--
-- Marche arrière : ALTER TABLE produits DROP COLUMN prix_vente_ttc;

ALTER TABLE produits ADD COLUMN prix_vente_ttc REAL NOT NULL DEFAULT 0;

UPDATE produits
SET prix_vente_ttc = ROUND(prix_vente_ht * (100 + tva_taux)) / 100.0;
