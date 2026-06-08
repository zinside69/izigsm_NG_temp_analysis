-- ============================================================
-- Sprint 2.10 — SAV & Garanties
-- ============================================================

-- Table garanties : créée automatiquement quand un ticket passe en "termine"
CREATE TABLE IF NOT EXISTS garanties (
  id              INTEGER  PRIMARY KEY AUTOINCREMENT,
  boutique_id     INTEGER  NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  ticket_id       INTEGER  NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  client_id       INTEGER  REFERENCES clients(id) ON DELETE SET NULL,
  appareil_marque TEXT,
  appareil_modele TEXT,
  description_reparation TEXT,   -- copie du diagnostic / description du travail
  date_debut      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_fin        DATETIME NOT NULL,                -- date_debut + garantie_jours
  garantie_jours  INTEGER  NOT NULL DEFAULT 90,
  statut          TEXT     NOT NULL DEFAULT 'active'
                  CHECK(statut IN ('active','expiree','consommee')),
  actif           INTEGER  NOT NULL DEFAULT 1,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_garanties_boutique  ON garanties(boutique_id);
CREATE INDEX IF NOT EXISTS idx_garanties_ticket    ON garanties(ticket_id);
CREATE INDEX IF NOT EXISTS idx_garanties_client    ON garanties(client_id);
CREATE INDEX IF NOT EXISTS idx_garanties_statut    ON garanties(statut);
CREATE INDEX IF NOT EXISTS idx_garanties_date_fin  ON garanties(date_fin);
-- Index unique : un ticket = une garantie active max
CREATE UNIQUE INDEX IF NOT EXISTS idx_garanties_ticket_unique ON garanties(ticket_id) WHERE actif = 1;

-- Table SAV : dossier retour sous garantie
CREATE TABLE IF NOT EXISTS sav_dossiers (
  id              INTEGER  PRIMARY KEY AUTOINCREMENT,
  boutique_id     INTEGER  NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  garantie_id     INTEGER  REFERENCES garanties(id) ON DELETE SET NULL,
  ticket_origine_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  ticket_sav_id   INTEGER  REFERENCES tickets(id) ON DELETE SET NULL,  -- nouveau ticket créé pour le SAV
  client_id       INTEGER  REFERENCES clients(id) ON DELETE SET NULL,
  numero          TEXT     NOT NULL,   -- SAV-2026-00001
  motif           TEXT     NOT NULL,
  description     TEXT,
  statut          TEXT     NOT NULL DEFAULT 'ouvert'
                  CHECK(statut IN ('ouvert','en_traitement','resolu','refuse','clos')),
  resolution      TEXT,                -- description de la résolution
  date_ouverture  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_cloture    DATETIME,
  actif           INTEGER  NOT NULL DEFAULT 1,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sav_boutique        ON sav_dossiers(boutique_id);
CREATE INDEX IF NOT EXISTS idx_sav_garantie        ON sav_dossiers(garantie_id);
CREATE INDEX IF NOT EXISTS idx_sav_client          ON sav_dossiers(client_id);
CREATE INDEX IF NOT EXISTS idx_sav_statut          ON sav_dossiers(statut);
CREATE INDEX IF NOT EXISTS idx_sav_ticket_origine  ON sav_dossiers(ticket_origine_id);

-- Séquence SAV dans la table sequences (type 'sav')
-- (pas besoin de DDL — insertée automatiquement par nextNumero)

-- Correction : ticket_id doit être nullable (garanties manuelles sans ticket)
-- SQLite ne supporte pas ALTER COLUMN, on recrée la table
CREATE TABLE IF NOT EXISTS garanties_new (
  id              INTEGER  PRIMARY KEY AUTOINCREMENT,
  boutique_id     INTEGER  NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  ticket_id       INTEGER  REFERENCES tickets(id) ON DELETE CASCADE,
  client_id       INTEGER  REFERENCES clients(id) ON DELETE SET NULL,
  appareil_marque TEXT,
  appareil_modele TEXT,
  description_reparation TEXT,
  date_debut      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_fin        DATETIME NOT NULL,
  garantie_jours  INTEGER  NOT NULL DEFAULT 90,
  statut          TEXT     NOT NULL DEFAULT 'active'
                  CHECK(statut IN ('active','expiree','consommee')),
  actif           INTEGER  NOT NULL DEFAULT 1,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO garanties_new SELECT * FROM garanties;
DROP TABLE garanties;
ALTER TABLE garanties_new RENAME TO garanties;
CREATE INDEX IF NOT EXISTS idx_garanties_boutique  ON garanties(boutique_id);
CREATE INDEX IF NOT EXISTS idx_garanties_ticket    ON garanties(ticket_id);
CREATE INDEX IF NOT EXISTS idx_garanties_client    ON garanties(client_id);
CREATE INDEX IF NOT EXISTS idx_garanties_statut    ON garanties(statut);
CREATE INDEX IF NOT EXISTS idx_garanties_date_fin  ON garanties(date_fin);
CREATE UNIQUE INDEX IF NOT EXISTS idx_garanties_ticket_unique ON garanties(ticket_id) WHERE actif = 1 AND ticket_id IS NOT NULL;
