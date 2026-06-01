-- ============================================================
-- Migration 0006 : Devis, Factures & Paiements
-- ============================================================

CREATE TABLE IF NOT EXISTS devis (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id   INTEGER NOT NULL,
  numero        TEXT    NOT NULL UNIQUE,        -- DEV-2026-00001
  client_id     INTEGER NOT NULL,
  ticket_id     INTEGER,                        -- si lié à un ticket
  -- Montants calculés
  total_ht      REAL    NOT NULL DEFAULT 0,
  total_tva     REAL    NOT NULL DEFAULT 0,
  total_ttc     REAL    NOT NULL DEFAULT 0,
  -- Statut
  statut        TEXT    NOT NULL DEFAULT 'brouillon', -- brouillon | envoye | accepte | refuse | expire
  -- Validité
  date_emission  DATETIME DEFAULT CURRENT_TIMESTAMP,
  date_validite  DATETIME,                      -- date d'expiration du devis
  -- Conversion
  facture_id    INTEGER,                        -- NULL tant que non converti
  -- Divers
  notes         TEXT,
  conditions    TEXT,                           -- conditions générales / notes bas de page
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (boutique_id) REFERENCES boutiques(id),
  FOREIGN KEY (client_id)   REFERENCES clients(id),
  FOREIGN KEY (ticket_id)   REFERENCES tickets(id)
);

CREATE TABLE IF NOT EXISTS factures (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id   INTEGER NOT NULL,
  numero        TEXT    NOT NULL UNIQUE,        -- FAC-2026-00001
  client_id     INTEGER NOT NULL,
  ticket_id     INTEGER,
  devis_id      INTEGER,
  -- Montants
  total_ht      REAL    NOT NULL DEFAULT 0,
  total_tva     REAL    NOT NULL DEFAULT 0,
  total_ttc     REAL    NOT NULL DEFAULT 0,
  montant_paye  REAL    NOT NULL DEFAULT 0,
  -- Statut
  statut        TEXT    NOT NULL DEFAULT 'emise', -- emise | partiellement_payee | payee | annulee | avoir
  -- Dates
  date_emission  DATETIME DEFAULT CURRENT_TIMESTAMP,
  date_echeance  DATETIME,
  date_paiement  DATETIME,
  -- NF525
  hash_nf525    TEXT,                           -- hash SHA-256 de cette facture
  -- Divers
  notes         TEXT,
  conditions    TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (boutique_id) REFERENCES boutiques(id),
  FOREIGN KEY (client_id)   REFERENCES clients(id),
  FOREIGN KEY (ticket_id)   REFERENCES tickets(id),
  FOREIGN KEY (devis_id)    REFERENCES devis(id)
);

-- Lignes de devis ET factures (via type)
CREATE TABLE IF NOT EXISTS lignes_document (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  document_type  TEXT    NOT NULL,              -- 'devis' | 'facture'
  document_id    INTEGER NOT NULL,
  ordre          INTEGER NOT NULL DEFAULT 1,    -- ordre d'affichage
  description    TEXT    NOT NULL,
  quantite       REAL    NOT NULL DEFAULT 1,
  prix_unitaire_ht REAL  NOT NULL DEFAULT 0,
  tva_taux       REAL    NOT NULL DEFAULT 20.0,
  -- Calculés (stockés pour NF525 inaltérabilité)
  total_ht       REAL    NOT NULL DEFAULT 0,
  total_tva      REAL    NOT NULL DEFAULT 0,
  total_ttc      REAL    NOT NULL DEFAULT 0,
  -- Référence produit (optionnel)
  produit_id     INTEGER,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Paiements (une facture peut avoir plusieurs paiements partiels)
CREATE TABLE IF NOT EXISTS paiements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  facture_id    INTEGER NOT NULL,
  boutique_id   INTEGER NOT NULL,
  montant       REAL    NOT NULL,
  mode_paiement TEXT    NOT NULL,               -- 'especes' | 'cb' | 'cheque' | 'virement' | 'stripe'
  reference     TEXT,                           -- numéro chèque, transaction Stripe, etc.
  date_paiement DATETIME DEFAULT CURRENT_TIMESTAMP,
  user_id       INTEGER NOT NULL,               -- qui a encaissé
  notes         TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (facture_id)  REFERENCES factures(id),
  FOREIGN KEY (boutique_id) REFERENCES boutiques(id),
  FOREIGN KEY (user_id)     REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_devis_boutique    ON devis(boutique_id);
CREATE INDEX IF NOT EXISTS idx_devis_client      ON devis(client_id);
CREATE INDEX IF NOT EXISTS idx_devis_numero      ON devis(numero);
CREATE INDEX IF NOT EXISTS idx_factures_boutique ON factures(boutique_id);
CREATE INDEX IF NOT EXISTS idx_factures_client   ON factures(client_id);
CREATE INDEX IF NOT EXISTS idx_factures_statut   ON factures(statut);
CREATE INDEX IF NOT EXISTS idx_factures_numero   ON factures(numero);
CREATE INDEX IF NOT EXISTS idx_lignes_document   ON lignes_document(document_type, document_id);
CREATE INDEX IF NOT EXISTS idx_paiements_facture ON paiements(facture_id);
