-- ============================================================
-- Migration 0015 — Agenda / Rendez-vous
-- Sprint 2.6 — MOD-08 (MOYENNE)
-- ============================================================

-- Table principale des rendez-vous
CREATE TABLE IF NOT EXISTS rendez_vous (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id     INTEGER NOT NULL REFERENCES boutiques(id),
  client_id       INTEGER REFERENCES clients(id),
  ticket_id       INTEGER REFERENCES tickets(id),
  user_id         INTEGER REFERENCES users(id),         -- technicien assigné
  titre           TEXT    NOT NULL,
  description     TEXT,
  debut           DATETIME NOT NULL,                    -- ISO 8601 UTC
  fin             DATETIME NOT NULL,                    -- ISO 8601 UTC
  duree_minutes   INTEGER NOT NULL DEFAULT 30,
  statut          TEXT    NOT NULL DEFAULT 'PENDING'
                    CHECK(statut IN (
                      'PENDING',        -- en attente de confirmation
                      'SCHEDULED',      -- confirmé
                      'DONE',           -- effectué
                      'NO_SHOW',        -- client absent
                      'CANCELLED',      -- annulé
                      'CONVERTED'       -- converti en ticket
                    )),
  type_rdv        TEXT    NOT NULL DEFAULT 'reparation'
                    CHECK(type_rdv IN (
                      'reparation',     -- dépose appareil
                      'restitution',    -- récupération appareil
                      'devis',          -- estimation sur place
                      'diagnostic',     -- diagnostic
                      'autre'
                    )),
  -- Infos client direct (si pas encore client en DB)
  nom_client      TEXT,
  telephone_client TEXT,
  -- Rappels
  rappel_envoye   INTEGER NOT NULL DEFAULT 0,
  rappel_minutes  INTEGER NOT NULL DEFAULT 60,          -- rappel X min avant
  -- Token iCal public (pour export)
  ical_token      TEXT    UNIQUE,
  -- Couleur personnalisée (UI)
  couleur         TEXT    DEFAULT '#3B82F6',
  -- Notes internes
  notes           TEXT,
  actif           INTEGER NOT NULL DEFAULT 1,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index performances
CREATE INDEX IF NOT EXISTS idx_rdv_boutique_debut    ON rendez_vous(boutique_id, debut);
CREATE INDEX IF NOT EXISTS idx_rdv_client            ON rendez_vous(client_id);
CREATE INDEX IF NOT EXISTS idx_rdv_ticket            ON rendez_vous(ticket_id);
CREATE INDEX IF NOT EXISTS idx_rdv_user              ON rendez_vous(user_id);
CREATE INDEX IF NOT EXISTS idx_rdv_statut            ON rendez_vous(statut);
CREATE INDEX IF NOT EXISTS idx_rdv_ical_token        ON rendez_vous(ical_token);

-- Token d'export iCal par boutique (stable, régénérable)
CREATE TABLE IF NOT EXISTS boutique_ical_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id INTEGER NOT NULL UNIQUE REFERENCES boutiques(id),
  token       TEXT    NOT NULL UNIQUE,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ical_tokens_boutique ON boutique_ical_tokens(boutique_id);
CREATE INDEX IF NOT EXISTS idx_ical_tokens_token    ON boutique_ical_tokens(token);
