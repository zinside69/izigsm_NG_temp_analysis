-- ============================================================
-- Migration 0004 : Tickets de réparation & Interventions
-- ============================================================

-- Statuts possibles (machine à états)
-- recu → diagnostic → en_reparation → termine → livre | annule

CREATE TABLE IF NOT EXISTS tickets (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id       INTEGER NOT NULL,
  numero            TEXT    NOT NULL UNIQUE,   -- TKT-2026-00001 (auto-généré)
  client_id         INTEGER NOT NULL,
  appareil_id       INTEGER,                   -- NULL si appareil non enregistré
  -- Description
  appareil_marque   TEXT    NOT NULL,          -- copié depuis appareil ou saisi manuellement
  appareil_modele   TEXT    NOT NULL,
  description_panne TEXT    NOT NULL,
  -- Statut courant
  statut            TEXT    NOT NULL DEFAULT 'recu',
  -- Assignation
  technicien_id     INTEGER,                   -- user_id du technicien
  -- Diagnostic
  diagnostic        TEXT,
  -- Tarification
  prix_estime       REAL,
  prix_final        REAL,
  -- Devis / Facture liés
  devis_id          INTEGER,
  facture_id        INTEGER,
  -- Dates clés
  date_reception    DATETIME DEFAULT CURRENT_TIMESTAMP,
  date_promesse     DATETIME,                  -- date promise au client
  date_cloture      DATETIME,                  -- quand statut = termine
  date_livraison    DATETIME,                  -- quand statut = livre
  -- Divers
  notes_internes    TEXT,
  actif             INTEGER NOT NULL DEFAULT 1,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (boutique_id)   REFERENCES boutiques(id),
  FOREIGN KEY (client_id)     REFERENCES clients(id),
  FOREIGN KEY (appareil_id)   REFERENCES appareils(id),
  FOREIGN KEY (technicien_id) REFERENCES users(id)
);

-- Historique des changements de statut (trace complète)
CREATE TABLE IF NOT EXISTS tickets_statuts_historique (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id     INTEGER NOT NULL,
  statut_ancien TEXT    NOT NULL,
  statut_nouveau TEXT   NOT NULL,
  user_id       INTEGER NOT NULL,              -- qui a fait le changement
  commentaire   TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)   REFERENCES users(id)
);

-- Photos liées aux tickets (stockées dans R2, URL ici)
CREATE TABLE IF NOT EXISTS tickets_photos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER NOT NULL,
  url_r2      TEXT    NOT NULL,                -- URL Cloudflare R2
  type_photo  TEXT    NOT NULL DEFAULT 'avant', -- avant | apres | diagnostic
  description TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tickets_boutique    ON tickets(boutique_id);
CREATE INDEX IF NOT EXISTS idx_tickets_client      ON tickets(client_id);
CREATE INDEX IF NOT EXISTS idx_tickets_statut      ON tickets(statut);
CREATE INDEX IF NOT EXISTS idx_tickets_technicien  ON tickets(technicien_id);
CREATE INDEX IF NOT EXISTS idx_tickets_numero      ON tickets(numero);
CREATE INDEX IF NOT EXISTS idx_tickets_historique  ON tickets_statuts_historique(ticket_id);
