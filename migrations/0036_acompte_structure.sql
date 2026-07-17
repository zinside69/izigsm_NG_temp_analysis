-- ============================================================
-- Migration 0036 : Acompte structuré — facture d'acompte + expiration avoir
-- ============================================================

ALTER TABLE factures ADD COLUMN type_facture TEXT NOT NULL DEFAULT 'normale';  -- 'normale' | 'acompte'
ALTER TABLE avoirs    ADD COLUMN date_expiration DATETIME;                      -- NULL = pas d'expiration (comportement actuel)

CREATE INDEX IF NOT EXISTS idx_factures_type_facture ON factures(type_facture);
