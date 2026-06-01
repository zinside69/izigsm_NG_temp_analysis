-- ============================================================
-- Migration 0008 : Journal NF525 (conformité loi anti-fraude TVA)
-- ============================================================
-- Loi française : art. 88 LFR 2015, obligatoire depuis le 01/01/2018
-- Principe : chaque transaction est hachée (SHA-256) avec le hash
--            de la transaction précédente → chaîne inaltérable.
-- Amende en cas de non-conformité : 7 500 € par logiciel.
-- ============================================================

CREATE TABLE IF NOT EXISTS journal_nf525 (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id       INTEGER NOT NULL,
  -- Référence à la transaction source
  type_transaction  TEXT    NOT NULL,           -- 'facture' | 'avoir' | 'cloture_journee'
  reference_id      INTEGER NOT NULL,           -- facture_id, avoir_id, etc.
  reference_numero  TEXT    NOT NULL,           -- FAC-2026-00001
  -- Données financières (snapshot immuable)
  client_id         INTEGER,
  montant_ht        REAL    NOT NULL,
  montant_tva       REAL    NOT NULL,
  montant_ttc       REAL    NOT NULL,
  date_transaction  DATETIME NOT NULL,
  -- Chaîne de hachage NF525
  hash_precedent    TEXT    NOT NULL DEFAULT '', -- hash de l'entrée précédente ('' pour la 1ère)
  donnees_hash      TEXT    NOT NULL,           -- JSON des données hashées (pour vérification)
  hash_courant      TEXT    NOT NULL,           -- SHA-256(donnees_hash + hash_precedent)
  -- Clôture périodique
  est_cloture       INTEGER NOT NULL DEFAULT 0, -- 1 = entrée de clôture journalière
  periode_cloture   TEXT,                       -- 'YYYY-MM-DD' pour les clôtures
  -- Métadonnées
  user_id           INTEGER NOT NULL,           -- qui a créé la transaction
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (boutique_id) REFERENCES boutiques(id),
  FOREIGN KEY (user_id)     REFERENCES users(id)
);

-- Table de clôtures journalières (récapitulatif légal)
CREATE TABLE IF NOT EXISTS clotures_journalieres (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id     INTEGER NOT NULL,
  date_cloture    TEXT    NOT NULL UNIQUE,       -- 'YYYY-MM-DD'
  -- Totaux du jour
  nb_transactions INTEGER NOT NULL DEFAULT 0,
  total_ht        REAL    NOT NULL DEFAULT 0,
  total_tva       REAL    NOT NULL DEFAULT 0,
  total_ttc       REAL    NOT NULL DEFAULT 0,
  -- Hash de clôture (hash de toutes les transactions du jour)
  hash_cloture    TEXT    NOT NULL,
  hash_precedent  TEXT    NOT NULL DEFAULT '',
  -- Qui a effectué la clôture
  user_id         INTEGER NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (boutique_id) REFERENCES boutiques(id),
  FOREIGN KEY (user_id)     REFERENCES users(id)
);

-- Ces tables sont APPEND-ONLY : aucun UPDATE ni DELETE n'est autorisé
-- La vérification se fait en recalculant tous les hashes depuis le début

CREATE INDEX IF NOT EXISTS idx_nf525_boutique    ON journal_nf525(boutique_id);
CREATE INDEX IF NOT EXISTS idx_nf525_reference   ON journal_nf525(type_transaction, reference_id);
CREATE INDEX IF NOT EXISTS idx_nf525_date        ON journal_nf525(date_transaction);
CREATE INDEX IF NOT EXISTS idx_clotures_boutique ON clotures_journalieres(boutique_id);
CREATE INDEX IF NOT EXISTS idx_clotures_date     ON clotures_journalieres(date_cloture);
