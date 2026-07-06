-- ============================================================
-- Migration 0030 — Référentiel marques/modèles d'appareils (Sprint 2.38)
-- ============================================================
-- marques_appareils : référentiel global de marques (Apple, Samsung, …)
-- modeles_appareils : modèles rattachés à une marque (iPhone 14, Galaxy S23, …)
-- service_modeles   : pivot M2M — services suggérés pour un modèle donné

-- ── Marques ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marques_appareils (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id INTEGER NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  nom         TEXT    NOT NULL,
  logo_url    TEXT,                          -- optionnel : URL logo
  ordre       INTEGER DEFAULT 0,
  actif       INTEGER NOT NULL DEFAULT 1,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (boutique_id, nom)
);

CREATE INDEX IF NOT EXISTS idx_marques_boutique ON marques_appareils(boutique_id, actif);

-- ── Modèles ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS modeles_appareils (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id INTEGER NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  marque_id   INTEGER NOT NULL REFERENCES marques_appareils(id) ON DELETE CASCADE,
  nom         TEXT    NOT NULL,              -- ex : "iPhone 14 Pro"
  type        TEXT    DEFAULT 'smartphone',  -- smartphone | tablette | pc | console | autre
  annee       INTEGER,                       -- année de sortie approximative
  actif       INTEGER NOT NULL DEFAULT 1,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (boutique_id, marque_id, nom)
);

CREATE INDEX IF NOT EXISTS idx_modeles_boutique ON modeles_appareils(boutique_id, actif);
CREATE INDEX IF NOT EXISTS idx_modeles_marque   ON modeles_appareils(marque_id);

-- ── Pivot service ↔ modèle ────────────────────────────────────────────────────
-- Permet de suggérer des services pré-configurés lors de la création d'un ticket
-- selon le modèle de l'appareil déposé.
CREATE TABLE IF NOT EXISTS service_modeles (
  service_id  INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  modele_id   INTEGER NOT NULL REFERENCES modeles_appareils(id) ON DELETE CASCADE,
  prix_ht_specifique REAL,                   -- prix override pour ce modèle (NULL = prix catalogue)
  actif       INTEGER NOT NULL DEFAULT 1,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (service_id, modele_id)
);

CREATE INDEX IF NOT EXISTS idx_service_modeles_modele  ON service_modeles(modele_id, actif);
CREATE INDEX IF NOT EXISTS idx_service_modeles_service ON service_modeles(service_id, actif);
