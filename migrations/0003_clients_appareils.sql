-- ============================================================
-- Migration 0003 : Clients & Appareils
-- ============================================================

CREATE TABLE IF NOT EXISTS clients (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id     INTEGER NOT NULL,
  prenom          TEXT    NOT NULL,
  nom             TEXT    NOT NULL,
  email           TEXT,
  telephone       TEXT,
  -- Adresse de facturation
  adresse         TEXT,
  code_postal     TEXT,
  ville           TEXT,
  pays            TEXT    NOT NULL DEFAULT 'France',
  -- CRM
  notes           TEXT,
  actif           INTEGER NOT NULL DEFAULT 1,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (boutique_id) REFERENCES boutiques(id)
);

CREATE TABLE IF NOT EXISTS appareils (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id       INTEGER NOT NULL,
  marque          TEXT    NOT NULL,           -- Apple, Samsung, Xiaomi…
  modele          TEXT    NOT NULL,           -- iPhone 14, Galaxy S23…
  type            TEXT    NOT NULL DEFAULT 'smartphone',  -- smartphone | tablette | ordinateur | autre
  imei            TEXT,                        -- 15 chiffres
  numero_serie    TEXT,
  couleur         TEXT,
  mot_de_passe    TEXT,                        -- code de déverrouillage (stocké chiffré)
  notes           TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_clients_boutique  ON clients(boutique_id);
CREATE INDEX IF NOT EXISTS idx_clients_email     ON clients(email);
CREATE INDEX IF NOT EXISTS idx_clients_telephone ON clients(telephone);
CREATE INDEX IF NOT EXISTS idx_clients_nom       ON clients(nom, prenom);
CREATE INDEX IF NOT EXISTS idx_appareils_client  ON appareils(client_id);
CREATE INDEX IF NOT EXISTS idx_appareils_imei    ON appareils(imei);
