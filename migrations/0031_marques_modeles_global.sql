-- ============================================================
-- Migration 0031 — Référentiel marques/modèles global (Sprint 2.39)
-- ============================================================
-- Remplace le schéma Sprint 2.38 (boutique_id par table) par un
-- référentiel GLOBAL partagé entre toutes les boutiques.
--
-- Stratégie SQLite (pas d'ALTER DROP) :
--   1. Renommer les anciennes tables en _old
--   2. Créer les nouvelles tables sans boutique_id
--   3. Migrer les données existantes (si présentes)
--   4. Supprimer les anciennes tables
--   5. Mettre à jour service_modeles (FK inchangée — service_id + modele_id)
--
-- Nouvelles colonnes clés :
--   marques_appareils : + brand_slug (UNIQUE, clé API), + source ('manual'|'api')
--   modeles_appareils : + phone_slug (UNIQUE, clé API), + source ('manual'|'api')
-- ============================================================

-- ── 1. Sauvegarder les anciennes tables ───────────────────────────────────────
ALTER TABLE marques_appareils  RENAME TO marques_appareils_old;
ALTER TABLE modeles_appareils  RENAME TO modeles_appareils_old;

-- ── 2. Nouvelles tables globales (sans boutique_id) ───────────────────────────

CREATE TABLE IF NOT EXISTS marques_appareils (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nom          TEXT    NOT NULL,
  brand_slug   TEXT    UNIQUE,               -- slug API ex: "apple-phones-48"
  logo_url     TEXT,
  device_count INTEGER DEFAULT 0,            -- nb appareils selon API
  source       TEXT    NOT NULL DEFAULT 'manual', -- 'manual' | 'api'
  ordre        INTEGER DEFAULT 0,
  actif        INTEGER NOT NULL DEFAULT 1,
  synced_at    DATETIME,                     -- dernière sync API
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_marques_actif      ON marques_appareils(actif);
CREATE INDEX IF NOT EXISTS idx_marques_brand_slug ON marques_appareils(brand_slug);
CREATE INDEX IF NOT EXISTS idx_marques_nom        ON marques_appareils(nom);

CREATE TABLE IF NOT EXISTS modeles_appareils (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  marque_id    INTEGER NOT NULL REFERENCES marques_appareils(id) ON DELETE CASCADE,
  nom          TEXT    NOT NULL,
  phone_slug   TEXT    UNIQUE,               -- slug API ex: "apple_iphone_14_pro-11860"
  type         TEXT    DEFAULT 'smartphone', -- smartphone | tablette | pc | console | montre | autre
  annee        INTEGER,
  image_url    TEXT,                         -- URL image GSMArena (depuis API)
  source       TEXT    NOT NULL DEFAULT 'manual',
  actif        INTEGER NOT NULL DEFAULT 1,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (marque_id, nom)
);

CREATE INDEX IF NOT EXISTS idx_modeles_marque     ON modeles_appareils(marque_id, actif);
CREATE INDEX IF NOT EXISTS idx_modeles_phone_slug ON modeles_appareils(phone_slug);
CREATE INDEX IF NOT EXISTS idx_modeles_nom        ON modeles_appareils(marque_id, nom);

-- ── 3. Migrer données existantes (conservation des entrées manuelles) ─────────
INSERT OR IGNORE INTO marques_appareils (id, nom, logo_url, ordre, actif, source, created_at, updated_at)
SELECT id, nom, logo_url, ordre, actif, 'manual', created_at, updated_at
FROM marques_appareils_old;

INSERT OR IGNORE INTO modeles_appareils (id, marque_id, nom, type, annee, actif, source, created_at, updated_at)
SELECT id, marque_id, nom, type, annee, actif, 'manual', created_at, updated_at
FROM modeles_appareils_old;

-- ── 4. Supprimer les anciennes tables ─────────────────────────────────────────
DROP TABLE IF EXISTS modeles_appareils_old;
DROP TABLE IF EXISTS marques_appareils_old;

-- ── 5. Table de log de synchronisation ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS phone_catalog_sync_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_slug   TEXT    NOT NULL,
  brand_nom    TEXT,
  status       TEXT    NOT NULL DEFAULT 'pending', -- pending | success | error
  modeles_added   INTEGER DEFAULT 0,
  modeles_total   INTEGER DEFAULT 0,
  error_msg    TEXT,
  started_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at  DATETIME
);

CREATE INDEX IF NOT EXISTS idx_sync_log_brand ON phone_catalog_sync_log(brand_slug, started_at);
