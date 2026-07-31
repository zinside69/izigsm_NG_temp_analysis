-- ============================================================
-- Migration 0038 — Reconstruction de service_modeles (clé étrangère pendante)
-- ============================================================
-- PROBLÈME
--
-- La migration 0031 (Sprint 2.39, référentiel marques/modèles global) a fait :
--   ALTER TABLE modeles_appareils RENAME TO modeles_appareils_old;
--   ... création de la nouvelle table, migration des données ...
--   DROP TABLE IF EXISTS modeles_appareils_old;
--
-- SQLite propage un RENAME dans les clés étrangères qui pointent vers la table
-- renommée. `service_modeles.modele_id` est donc devenu :
--   REFERENCES "modeles_appareils_old"(id) ON DELETE CASCADE
-- puis la table cible a été supprimée dans le même fichier.
--
-- CONSÉQUENCE, constatée le 2026-07-31 : tout INSERT dans `service_modeles`
-- échoue, donc `POST /api/services/modeles/:id/services` (associer un service à
-- un modèle d'appareil) renvoie 500 pour TOUT appelant, admin plateforme compris,
-- vraisemblablement depuis le Sprint 2.39. La lecture, elle, fonctionnait.
--
-- SQLite ne permet pas de modifier une clé étrangère : il faut recréer la table.
-- Même procédé que les migrations 0031 et 0034.
-- ============================================================

PRAGMA foreign_keys=OFF;

-- ── 1. Nouvelle table, clé étrangère corrigée ────────────────────────────────
CREATE TABLE service_modeles_new (
  service_id         INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  modele_id          INTEGER NOT NULL REFERENCES modeles_appareils(id) ON DELETE CASCADE,
  prix_ht_specifique REAL,
  actif              INTEGER NOT NULL DEFAULT 1,
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (service_id, modele_id)
);

-- ── 2. Reprise des données ───────────────────────────────────────────────────
-- Le JOIN écarte volontairement les liaisons dont le modèle n'existe plus : la
-- clé étrangère étant pendante depuis 0031, rien ne garantissait l'intégrité
-- référentielle jusqu'ici, et ces lignes seraient de toute façon rejetées par la
-- nouvelle contrainte. Même logique côté services.
INSERT INTO service_modeles_new (service_id, modele_id, prix_ht_specifique, actif, created_at)
SELECT sm.service_id, sm.modele_id, sm.prix_ht_specifique, sm.actif, sm.created_at
FROM   service_modeles sm
JOIN   modeles_appareils m ON m.id = sm.modele_id
JOIN   services         s ON s.id = sm.service_id;

-- ── 3. Bascule ───────────────────────────────────────────────────────────────
DROP TABLE service_modeles;
ALTER TABLE service_modeles_new RENAME TO service_modeles;

-- ── 4. Index (perdus avec l'ancienne table) ──────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_service_modeles_modele  ON service_modeles(modele_id, actif);
CREATE INDEX IF NOT EXISTS idx_service_modeles_service ON service_modeles(service_id, actif);

PRAGMA foreign_keys=ON;
