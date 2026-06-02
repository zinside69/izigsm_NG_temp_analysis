-- ============================================================
-- Migration 0010 : Verrouillage factures (CGI) + Avoirs (NF525)
-- ============================================================
-- Conformité légale France :
--   - CGI art. 289 : facture inaltérable après émission
--   - NF525 : avoirs numérotés séquentiellement, chaîne SHA-256
-- ============================================================

-- 1. Ajouter les colonnes de verrouillage sur la table factures
ALTER TABLE factures ADD COLUMN locked       INTEGER NOT NULL DEFAULT 0;  -- 0=false, 1=true
ALTER TABLE factures ADD COLUMN issued_at    DATETIME;                    -- date d'émission officielle
ALTER TABLE factures ADD COLUMN tracking_token TEXT;                      -- UUID suivi public client (Sprint 2.7)

-- 2. Table avoirs (annulations / gestes commerciaux)
CREATE TABLE IF NOT EXISTS avoirs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id   INTEGER NOT NULL,
  numero        TEXT    NOT NULL UNIQUE,        -- AV-2026-00001
  facture_id    INTEGER NOT NULL,               -- facture d'origine (obligatoire)
  client_id     INTEGER NOT NULL,
  -- Type
  type          TEXT    NOT NULL DEFAULT 'remboursement', -- remboursement | bon_achat | echange
  motif         TEXT    NOT NULL,               -- raison de l'avoir (obligatoire)
  -- Montants
  total_ht      REAL    NOT NULL DEFAULT 0,
  total_tva     REAL    NOT NULL DEFAULT 0,
  total_ttc     REAL    NOT NULL DEFAULT 0,
  -- Statut
  statut        TEXT    NOT NULL DEFAULT 'emis', -- emis | utilise | annule
  -- NF525 : avoir dans la chaîne de hachage
  hash_nf525    TEXT,
  -- Dates
  date_emission DATETIME DEFAULT CURRENT_TIMESTAMP,
  notes         TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (boutique_id) REFERENCES boutiques(id),
  FOREIGN KEY (facture_id)  REFERENCES factures(id),
  FOREIGN KEY (client_id)   REFERENCES clients(id)
);

-- 3. Lignes d'avoir (même structure que lignes_document)
CREATE TABLE IF NOT EXISTS lignes_avoir (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  avoir_id         INTEGER NOT NULL,
  ordre            INTEGER NOT NULL DEFAULT 1,
  description      TEXT    NOT NULL,
  quantite         REAL    NOT NULL DEFAULT 1,
  prix_unitaire_ht REAL    NOT NULL DEFAULT 0,
  tva_taux         REAL    NOT NULL DEFAULT 20.0,
  total_ht         REAL    NOT NULL DEFAULT 0,
  total_tva        REAL    NOT NULL DEFAULT 0,
  total_ttc        REAL    NOT NULL DEFAULT 0,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (avoir_id) REFERENCES avoirs(id)
);

-- 4. Index
CREATE INDEX IF NOT EXISTS idx_avoirs_boutique  ON avoirs(boutique_id);
CREATE INDEX IF NOT EXISTS idx_avoirs_facture   ON avoirs(facture_id);
CREATE INDEX IF NOT EXISTS idx_avoirs_client    ON avoirs(client_id);
CREATE INDEX IF NOT EXISTS idx_avoirs_numero    ON avoirs(numero);
CREATE INDEX IF NOT EXISTS idx_factures_locked  ON factures(locked);
CREATE UNIQUE INDEX IF NOT EXISTS idx_factures_token ON factures(tracking_token) WHERE tracking_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lignes_avoir     ON lignes_avoir(avoir_id);
