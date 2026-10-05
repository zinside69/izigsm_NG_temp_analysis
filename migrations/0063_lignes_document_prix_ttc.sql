-- Migration 0063 — Lignes de document calculées depuis le TTC (ticket 02 du chantier prix TTC, 2026-10-05)
--
-- Décision de l'exploitant (Q2) : une ligne de vente se calcule à partir du prix unitaire TTC — le
-- client paie exactement prix affiché × quantité. La ligne garde le prix TTC saisi et dit comment elle
-- a été calculée, pour qu'un document réimprimé ou relu plus tard sache d'où viennent ses totaux.
--
-- - prix_unitaire_ttc : prix unitaire TTC avant remise, NULL pour une ligne calculée en HT
-- - mode_calcul       : 'ttc' ou 'ht' ; toutes les lignes existantes ont été calculées en HT
--
-- Colonnes de totaux (total_ht, total_tva, total_ttc) inchangées. Aucune ligne existante modifiée.
--
-- Marche arrière :
--   ALTER TABLE lignes_document DROP COLUMN mode_calcul;
--   ALTER TABLE lignes_document DROP COLUMN prix_unitaire_ttc;

ALTER TABLE lignes_document ADD COLUMN prix_unitaire_ttc REAL;

ALTER TABLE lignes_document ADD COLUMN mode_calcul TEXT NOT NULL DEFAULT 'ht'
  CHECK (mode_calcul IN ('ttc', 'ht'));
