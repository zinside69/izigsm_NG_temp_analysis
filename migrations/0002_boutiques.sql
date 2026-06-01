-- ============================================================
-- Migration 0002 : Boutiques & Paramètres
-- ============================================================

CREATE TABLE IF NOT EXISTS boutiques (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nom          TEXT    NOT NULL,
  siret        TEXT,
  tva_numero   TEXT,
  adresse      TEXT,
  code_postal  TEXT,
  ville        TEXT,
  telephone    TEXT,
  email        TEXT,
  site_web     TEXT,
  logo_url     TEXT,
  actif        INTEGER NOT NULL DEFAULT 1,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS boutique_settings (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id         INTEGER NOT NULL UNIQUE,
  -- Facturation
  tva_taux_defaut     REAL    NOT NULL DEFAULT 20.0,  -- % TVA par défaut
  monnaie             TEXT    NOT NULL DEFAULT 'EUR',
  devise_symbole      TEXT    NOT NULL DEFAULT '€',
  -- Facturation NF525
  nf525_actif         INTEGER NOT NULL DEFAULT 1,
  -- Horaires (JSON : {"lun":"09:00-18:00", ...})
  horaires            TEXT,
  -- Notifications
  notif_email_actif   INTEGER NOT NULL DEFAULT 1,
  notif_sms_actif     INTEGER NOT NULL DEFAULT 0,
  -- Paiements
  paiement_especes    INTEGER NOT NULL DEFAULT 1,
  paiement_cb         INTEGER NOT NULL DEFAULT 1,
  paiement_cheque     INTEGER NOT NULL DEFAULT 1,
  paiement_virement   INTEGER NOT NULL DEFAULT 0,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (boutique_id) REFERENCES boutiques(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_boutiques_actif ON boutiques(actif);
