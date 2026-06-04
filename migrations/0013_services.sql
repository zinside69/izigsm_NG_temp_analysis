-- ============================================================
-- Migration 0013 — Catalogue services hiérarchique (Sprint 2.4)
-- ============================================================
-- categories_services : arbre parent/enfant (2 niveaux max)
-- services            : prestations tarifées rattachées à une catégorie

-- ── Catégories de services ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories_services (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id INTEGER NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  parent_id   INTEGER REFERENCES categories_services(id) ON DELETE SET NULL,
  nom         TEXT    NOT NULL,
  description TEXT,
  couleur     TEXT    DEFAULT '#6366f1',  -- couleur d'affichage hex
  ordre       INTEGER DEFAULT 0,          -- tri manuel
  actif       INTEGER NOT NULL DEFAULT 1,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cat_services_boutique  ON categories_services(boutique_id);
CREATE INDEX IF NOT EXISTS idx_cat_services_parent    ON categories_services(parent_id);
CREATE INDEX IF NOT EXISTS idx_cat_services_actif     ON categories_services(boutique_id, actif);

-- ── Services (prestations) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS services (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id     INTEGER NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  categorie_id    INTEGER REFERENCES categories_services(id) ON DELETE SET NULL,
  nom             TEXT    NOT NULL,
  description     TEXT,
  prix_ht         REAL    NOT NULL DEFAULT 0,
  tva_taux        REAL    NOT NULL DEFAULT 20,
  duree_minutes   INTEGER,               -- durée estimée (pour l'agenda Sprint 2.6)
  reference       TEXT,                  -- code interne / SKU service
  garantie_jours  INTEGER DEFAULT 0,     -- garantie en jours (0 = sans garantie)
  actif           INTEGER NOT NULL DEFAULT 1,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_services_boutique   ON services(boutique_id);
CREATE INDEX IF NOT EXISTS idx_services_categorie  ON services(categorie_id);
CREATE INDEX IF NOT EXISTS idx_services_actif      ON services(boutique_id, actif);
CREATE INDEX IF NOT EXISTS idx_services_nom        ON services(boutique_id, nom);
