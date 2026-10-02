-- Migration 0060 : une clôture journalière par boutique ET par jour (trouvé le 2026-10-02, bugs.md).
--
-- La migration 0008 déclarait `date_cloture TEXT NOT NULL UNIQUE` : unicité sur TOUTE la plateforme.
-- La première boutique qui clôturait un jour bloquait toutes les autres (erreur SQL brute), et
-- `cloturerJournee()` ayant déjà marqué le journal (`est_cloture = 1`) avant l'INSERT, les ventes de
-- la boutique refusée restaient « clôturées » sans clôture. Latent tant que seul l'admin plateforme
-- pouvait clôturer ; exposé par le déploiement du 2026-10-02 (rôle `gerant` remplacé par `manager`).
--
-- SQLite ne sait pas retirer une contrainte UNIQUE de colonne : la table est recréée, selon le patron
-- de la migration 0040 (table de transit, DROP, recréation sous le nom final, réinsertion). Aucune
-- table ne référence `clotures_journalieres` (vérifié : aucune clé étrangère vers elle). Production au
-- 2026-10-02 : 0 ligne. Prérequis : `SELECT COUNT(*) FROM pragma_foreign_key_check` = 0 (relu à 0).
--
-- La table reste APPEND-ONLY (règle de 0008) : cette migration ne réécrit aucune ligne, elle les
-- recopie à l'identique, identifiants compris.

PRAGMA defer_foreign_keys=ON;

CREATE TABLE clotures_journalieres_transit AS SELECT * FROM clotures_journalieres;

DROP TABLE clotures_journalieres;

CREATE TABLE clotures_journalieres (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id     INTEGER NOT NULL,
  date_cloture    TEXT    NOT NULL,              -- 'YYYY-MM-DD' — unique PAR BOUTIQUE (voir l'index)
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

INSERT INTO clotures_journalieres
  (id, boutique_id, date_cloture, nb_transactions, total_ht, total_tva, total_ttc,
   hash_cloture, hash_precedent, user_id, created_at)
SELECT id, boutique_id, date_cloture, nb_transactions, total_ht, total_tva, total_ttc,
       hash_cloture, hash_precedent, user_id, created_at
FROM   clotures_journalieres_transit;

DROP TABLE clotures_journalieres_transit;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clotures_boutique_date ON clotures_journalieres(boutique_id, date_cloture);
CREATE INDEX        IF NOT EXISTS idx_clotures_boutique      ON clotures_journalieres(boutique_id);
CREATE INDEX        IF NOT EXISTS idx_clotures_date          ON clotures_journalieres(date_cloture);
