-- Migration 0026 — Sprint 2.34 : MOD-04 familles produits
-- Ajoute la colonne famille sur la table produits.
-- Valeurs : 'piece' | 'accessoire' | 'appareil' | 'consommable'
-- Défaut : 'piece' (rétrocompatibilité totale, aucune valeur NULL introduite)

ALTER TABLE produits ADD COLUMN famille TEXT NOT NULL DEFAULT 'piece'
  CHECK (famille IN ('piece', 'accessoire', 'appareil', 'consommable'));

CREATE INDEX IF NOT EXISTS idx_produits_famille ON produits(boutique_id, famille);
