-- ============================================================
-- Migration 0009 : OTP temporaires & Logs d'audit
-- ============================================================

-- OTP pour vérification email (complément au KV Cloudflare)
-- Utilisé comme fallback ou pour traçabilité
CREATE TABLE IF NOT EXISTS otp_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT    NOT NULL,
  code        TEXT    NOT NULL,                 -- 6 chiffres hashés
  type        TEXT    NOT NULL DEFAULT 'email_verification', -- email_verification | reset_password
  expire_at   DATETIME NOT NULL,               -- TTL : 10 minutes
  utilise     INTEGER NOT NULL DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Séquences pour numérotation automatique (tickets, factures, devis)
CREATE TABLE IF NOT EXISTS sequences (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id  INTEGER NOT NULL,
  type         TEXT    NOT NULL,               -- 'ticket' | 'facture' | 'devis'
  annee        INTEGER NOT NULL,               -- 2026
  dernier_num  INTEGER NOT NULL DEFAULT 0,
  UNIQUE(boutique_id, type, annee),
  FOREIGN KEY (boutique_id) REFERENCES boutiques(id)
);

-- Logs d'audit (qui a fait quoi, quand)
CREATE TABLE IF NOT EXISTS audit_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id  INTEGER,
  user_id      INTEGER,
  action       TEXT    NOT NULL,               -- 'CREATE_CLIENT' | 'UPDATE_FACTURE' | 'LOGIN' etc.
  entite_type  TEXT,                           -- 'client' | 'facture' | 'ticket' etc.
  entite_id    INTEGER,
  donnees_avant TEXT,                          -- JSON avant modification
  donnees_apres TEXT,                          -- JSON après modification
  ip_address   TEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_otp_email      ON otp_tokens(email, type);
CREATE INDEX IF NOT EXISTS idx_otp_expire     ON otp_tokens(expire_at);
CREATE INDEX IF NOT EXISTS idx_sequences      ON sequences(boutique_id, type, annee);
CREATE INDEX IF NOT EXISTS idx_audit_user     ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entite   ON audit_logs(entite_type, entite_id);
CREATE INDEX IF NOT EXISTS idx_audit_date     ON audit_logs(created_at);
