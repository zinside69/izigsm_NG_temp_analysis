-- ============================================================
-- Migration 0012 : PIN technicien + Permissions granulaires
-- ============================================================

-- 1. PIN haché sur users (PBKDF2, même format que password)
ALTER TABLE users ADD COLUMN pin_hash TEXT;          -- NULL = pas de PIN
ALTER TABLE users ADD COLUMN pin_actif INTEGER NOT NULL DEFAULT 0; -- 0|1

-- 2. Table permissions granulaires (par user)
CREATE TABLE IF NOT EXISTS permissions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  boutique_id INTEGER NOT NULL,
  action     TEXT    NOT NULL,  -- ex: 'discount', 'delete_ticket', 'refund', 'voir_prix_achat'
  autorise   INTEGER NOT NULL DEFAULT 1,  -- 1=oui, 0=non
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, boutique_id, action),
  FOREIGN KEY (user_id)    REFERENCES users(id),
  FOREIGN KEY (boutique_id) REFERENCES boutiques(id)
);

CREATE INDEX IF NOT EXISTS idx_permissions_user     ON permissions(user_id, boutique_id);
CREATE INDEX IF NOT EXISTS idx_permissions_action   ON permissions(action);
