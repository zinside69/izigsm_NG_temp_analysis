-- ============================================================
-- Sprint 2.11 — Notifications email
-- ============================================================

-- Config email par boutique dans boutique_settings
ALTER TABLE boutique_settings ADD COLUMN email_provider    TEXT NOT NULL DEFAULT 'resend';
ALTER TABLE boutique_settings ADD COLUMN email_api_key     TEXT;           -- clé API chiffrée (ou via Worker secret)
ALTER TABLE boutique_settings ADD COLUMN email_from        TEXT;           -- ex: "iziGSM Paris <noreply@izigsm.fr>"
ALTER TABLE boutique_settings ADD COLUMN email_notif_ticket_cree    INTEGER NOT NULL DEFAULT 1;
ALTER TABLE boutique_settings ADD COLUMN email_notif_ticket_termine INTEGER NOT NULL DEFAULT 1;
ALTER TABLE boutique_settings ADD COLUMN email_notif_sav_ouvert     INTEGER NOT NULL DEFAULT 1;
ALTER TABLE boutique_settings ADD COLUMN email_notif_relance        INTEGER NOT NULL DEFAULT 1;

-- Journal des emails envoyés (audit + dédup)
CREATE TABLE IF NOT EXISTS email_logs (
  id            INTEGER  PRIMARY KEY AUTOINCREMENT,
  boutique_id   INTEGER  NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  destinataire  TEXT     NOT NULL,
  sujet         TEXT     NOT NULL,
  type          TEXT     NOT NULL  -- ticket_cree | ticket_termine | sav_ouvert | relance
                CHECK(type IN ('ticket_cree','ticket_termine','sav_ouvert','relance','autre')),
  entite_type   TEXT,              -- ticket | sav
  entite_id     INTEGER,
  statut        TEXT     NOT NULL DEFAULT 'envoye'
                CHECK(statut IN ('envoye','erreur','simule')),
  erreur        TEXT,              -- message d'erreur si statut=erreur
  provider_id   TEXT,              -- id retourné par le provider (ex: Resend)
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_logs_boutique  ON email_logs(boutique_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_entite    ON email_logs(entite_type, entite_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_type      ON email_logs(type);
