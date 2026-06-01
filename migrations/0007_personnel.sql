-- ============================================================
-- Migration 0007 : Personnel & Pointage
-- ============================================================

CREATE TABLE IF NOT EXISTS employes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id      INTEGER NOT NULL,
  user_id          INTEGER,                     -- lié à un compte utilisateur (optionnel)
  prenom           TEXT    NOT NULL,
  nom              TEXT    NOT NULL,
  email            TEXT,
  telephone        TEXT,
  poste            TEXT    NOT NULL DEFAULT 'technicien', -- 'technicien' | 'accueil' | 'manager' | 'autre'
  -- Rémunération
  taux_horaire     REAL,
  commission_pct   REAL    NOT NULL DEFAULT 0,  -- % commission sur réparations
  -- Statut pointage actuel (mis à jour à chaque pointage)
  statut_pointage  TEXT    NOT NULL DEFAULT 'absent', -- absent | en_poste | pause | termine
  -- Divers
  actif            INTEGER NOT NULL DEFAULT 1,
  date_embauche    TEXT,
  notes            TEXT,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (boutique_id) REFERENCES boutiques(id),
  FOREIGN KEY (user_id)     REFERENCES users(id)
);

-- Chaque pointage = une ligne (entrée ou sortie)
CREATE TABLE IF NOT EXISTS pointages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  employe_id       INTEGER NOT NULL,
  boutique_id      INTEGER NOT NULL,
  -- Transition de statut
  statut_avant     TEXT    NOT NULL,            -- absent | en_poste | pause | termine
  statut_apres     TEXT    NOT NULL,            -- absent | en_poste | pause | termine
  -- Horodatage précis
  horodatage       DATETIME DEFAULT CURRENT_TIMESTAMP,
  -- Localisation (optionnel)
  latitude         REAL,
  longitude        REAL,
  -- Qui a validé (si pointage manuel par manager)
  valide_par       INTEGER,                     -- user_id du manager, NULL = auto-pointage
  notes            TEXT,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employe_id)  REFERENCES employes(id) ON DELETE CASCADE,
  FOREIGN KEY (boutique_id) REFERENCES boutiques(id),
  FOREIGN KEY (valide_par)  REFERENCES users(id)
);

-- Vue agrégée journalière (calculée à la demande, pas de table matérialisée en SQLite)
-- Utiliser la requête SQL suivante pour calculer les heures :
-- SELECT employe_id, DATE(horodatage) as jour,
--        SUM(CASE WHEN statut_apres = 'en_poste' THEN 0 ELSE
--            (julianday(horodatage) - julianday(LAG(horodatage))) * 24 END) as heures
-- FROM pointages WHERE statut_avant = 'en_poste' GROUP BY employe_id, jour

-- Commissions calculées par réparation
CREATE TABLE IF NOT EXISTS commissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employe_id    INTEGER NOT NULL,
  ticket_id     INTEGER NOT NULL,
  facture_id    INTEGER,
  montant_base  REAL    NOT NULL,               -- montant HT de la réparation
  taux_pct      REAL    NOT NULL,               -- % au moment du calcul
  montant_commission REAL NOT NULL,             -- = montant_base * taux_pct / 100
  statut        TEXT    NOT NULL DEFAULT 'en_attente', -- en_attente | validee | payee
  date_calcul   DATETIME DEFAULT CURRENT_TIMESTAMP,
  date_paiement DATETIME,
  FOREIGN KEY (employe_id) REFERENCES employes(id),
  FOREIGN KEY (ticket_id)  REFERENCES tickets(id),
  FOREIGN KEY (facture_id) REFERENCES factures(id)
);

CREATE INDEX IF NOT EXISTS idx_employes_boutique        ON employes(boutique_id);
CREATE INDEX IF NOT EXISTS idx_employes_statut_pointage ON employes(statut_pointage);
CREATE INDEX IF NOT EXISTS idx_pointages_employe        ON pointages(employe_id);
CREATE INDEX IF NOT EXISTS idx_pointages_date           ON pointages(horodatage);
CREATE INDEX IF NOT EXISTS idx_pointages_boutique       ON pointages(boutique_id);
CREATE INDEX IF NOT EXISTS idx_commissions_employe      ON commissions(employe_id);
