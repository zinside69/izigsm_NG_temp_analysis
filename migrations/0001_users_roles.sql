-- ============================================================
-- Migration 0001 : Utilisateurs & Rôles (RBAC)
-- ============================================================

CREATE TABLE IF NOT EXISTS roles (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nom       TEXT    NOT NULL UNIQUE,           -- 'admin' | 'manager' | 'technicien' | 'client'
  libelle   TEXT    NOT NULL,                  -- 'Administrateur', etc.
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  prenom        TEXT    NOT NULL,
  nom           TEXT    NOT NULL,
  telephone     TEXT,
  role_id       INTEGER NOT NULL DEFAULT 2,    -- 2 = manager par défaut
  boutique_id   INTEGER,                       -- NULL = accès toutes boutiques (admin)
  actif         INTEGER NOT NULL DEFAULT 0,    -- 0 = en attente vérification email
  email_verifie INTEGER NOT NULL DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(id)
);

-- Index de recherche rapide
CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role     ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_boutique ON users(boutique_id);

-- ── Données initiales ─────────────────────────────────────
INSERT OR IGNORE INTO roles (id, nom, libelle) VALUES
  (1, 'admin',      'Administrateur'),
  (2, 'manager',    'Responsable boutique'),
  (3, 'technicien', 'Technicien'),
  (4, 'client',     'Client');
