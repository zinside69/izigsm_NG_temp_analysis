-- ============================================================
-- Migration 0035 : Clients — type particulier/professionnel + champs société
-- ============================================================

ALTER TABLE clients ADD COLUMN type_client    TEXT NOT NULL DEFAULT 'particulier';  -- 'particulier' | 'professionnel'
ALTER TABLE clients ADD COLUMN raison_sociale TEXT;
ALTER TABLE clients ADD COLUMN siret          TEXT;
ALTER TABLE clients ADD COLUMN tva_intracom   TEXT;

CREATE INDEX IF NOT EXISTS idx_clients_type ON clients(type_client);
