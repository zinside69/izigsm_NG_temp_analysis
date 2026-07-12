-- Migration 0034 — numero unique PAR BOUTIQUE, pas globalement
--
-- Root cause (voir project-docs/bugs.md) : tickets/devis/factures/avoirs/rachats.numero
-- portaient une contrainte UNIQUE globale alors que les compteurs (table `sequences`)
-- sont calculés indépendamment par boutique_id. Deux boutiques partageant le même
-- préfixe par défaut ('TKT', etc.) produisent le même numero dès que leurs compteurs
-- se recoupent → collision UNIQUE constraint failed dès la 1re boutique secondaire
-- (constaté sur Desk1/boutique_id=3, latent pour SOTELI/boutique_id=2).
--
-- SQLite ne permet pas ALTER TABLE ... DROP CONSTRAINT : chaque table est recréée
-- avec numero sans UNIQUE colonne + UNIQUE(boutique_id, numero) au niveau table,
-- données copiées avec liste de colonnes explicite (jamais SELECT *), index recréés.
--
-- Ordre : tickets, devis, factures, avoirs, rachats (ordre de dépendance FK,
-- foreign_keys désactivé le temps de la migration par précaution).

PRAGMA foreign_keys=OFF;

-- ─── tickets ────────────────────────────────────────────────────────────────

CREATE TABLE tickets_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id       INTEGER NOT NULL,
  numero            TEXT    NOT NULL,
  client_id         INTEGER NOT NULL,
  appareil_id       INTEGER,

  appareil_marque   TEXT    NOT NULL,
  appareil_modele   TEXT    NOT NULL,
  description_panne TEXT    NOT NULL,

  statut            TEXT    NOT NULL DEFAULT 'recu',

  technicien_id     INTEGER,

  diagnostic        TEXT,

  prix_estime       REAL,
  prix_final        REAL,

  devis_id          INTEGER,
  facture_id        INTEGER,

  date_reception    DATETIME DEFAULT CURRENT_TIMESTAMP,
  date_promesse     DATETIME,
  date_cloture      DATETIME,
  date_livraison    DATETIME,

  notes_internes    TEXT,
  actif             INTEGER NOT NULL DEFAULT 1,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  tracking_token    TEXT,
  priorite          TEXT NOT NULL DEFAULT 'normale',
  date_commande_pieces  DATETIME,
  date_reception_pieces DATETIME,
  archived_at       DATETIME,
  etat_appareil     TEXT,
  code_deverrouillage TEXT,
  code_sim          TEXT,
  signature_client  TEXT,
  signature_date    TEXT,
  FOREIGN KEY (boutique_id)   REFERENCES boutiques(id),
  FOREIGN KEY (client_id)     REFERENCES clients(id),
  FOREIGN KEY (appareil_id)   REFERENCES appareils(id),
  FOREIGN KEY (technicien_id) REFERENCES users(id),
  UNIQUE(boutique_id, numero)
);

INSERT INTO tickets_new (
  id, boutique_id, numero, client_id, appareil_id, appareil_marque, appareil_modele,
  description_panne, statut, technicien_id, diagnostic, prix_estime, prix_final,
  devis_id, facture_id, date_reception, date_promesse, date_cloture, date_livraison,
  notes_internes, actif, created_at, updated_at, tracking_token, priorite,
  date_commande_pieces, date_reception_pieces, archived_at, etat_appareil,
  code_deverrouillage, code_sim, signature_client, signature_date
)
SELECT
  id, boutique_id, numero, client_id, appareil_id, appareil_marque, appareil_modele,
  description_panne, statut, technicien_id, diagnostic, prix_estime, prix_final,
  devis_id, facture_id, date_reception, date_promesse, date_cloture, date_livraison,
  notes_internes, actif, created_at, updated_at, tracking_token, priorite,
  date_commande_pieces, date_reception_pieces, archived_at, etat_appareil,
  code_deverrouillage, code_sim, signature_client, signature_date
FROM tickets;

DROP TABLE tickets;
ALTER TABLE tickets_new RENAME TO tickets;

CREATE INDEX idx_tickets_boutique    ON tickets(boutique_id);
CREATE INDEX idx_tickets_client      ON tickets(client_id);
CREATE INDEX idx_tickets_statut      ON tickets(statut);
CREATE INDEX idx_tickets_technicien  ON tickets(technicien_id);
CREATE INDEX idx_tickets_numero      ON tickets(numero);
CREATE UNIQUE INDEX idx_tickets_tracking_token ON tickets(tracking_token) WHERE tracking_token IS NOT NULL;
CREATE INDEX idx_tickets_priorite ON tickets(priorite);
CREATE INDEX idx_tickets_archived_at ON tickets(boutique_id, archived_at) WHERE archived_at IS NOT NULL;
CREATE INDEX idx_tickets_autoarchive ON tickets(boutique_id, statut, updated_at) WHERE archived_at IS NULL AND actif = 1 AND statut IN ('livre', 'annule');

-- ─── devis ──────────────────────────────────────────────────────────────────

CREATE TABLE devis_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id   INTEGER NOT NULL,
  numero        TEXT    NOT NULL,
  client_id     INTEGER NOT NULL,
  ticket_id     INTEGER,

  total_ht      REAL    NOT NULL DEFAULT 0,
  total_tva     REAL    NOT NULL DEFAULT 0,
  total_ttc     REAL    NOT NULL DEFAULT 0,

  statut        TEXT    NOT NULL DEFAULT 'brouillon',

  date_emission  DATETIME DEFAULT CURRENT_TIMESTAMP,
  date_validite  DATETIME,

  facture_id    INTEGER,

  notes         TEXT,
  conditions    TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  public_token  TEXT,
  envoye_le     DATETIME,
  repondu_le    DATETIME,
  signature_client TEXT,
  FOREIGN KEY (boutique_id) REFERENCES boutiques(id),
  FOREIGN KEY (client_id)   REFERENCES clients(id),
  FOREIGN KEY (ticket_id)   REFERENCES tickets(id),
  UNIQUE(boutique_id, numero)
);

INSERT INTO devis_new (
  id, boutique_id, numero, client_id, ticket_id, total_ht, total_tva, total_ttc,
  statut, date_emission, date_validite, facture_id, notes, conditions,
  created_at, updated_at, public_token, envoye_le, repondu_le, signature_client
)
SELECT
  id, boutique_id, numero, client_id, ticket_id, total_ht, total_tva, total_ttc,
  statut, date_emission, date_validite, facture_id, notes, conditions,
  created_at, updated_at, public_token, envoye_le, repondu_le, signature_client
FROM devis;

DROP TABLE devis;
ALTER TABLE devis_new RENAME TO devis;

CREATE INDEX idx_devis_boutique ON devis(boutique_id);
CREATE INDEX idx_devis_client   ON devis(client_id);
CREATE INDEX idx_devis_numero   ON devis(numero);
CREATE UNIQUE INDEX idx_devis_public_token ON devis(public_token) WHERE public_token IS NOT NULL;

-- ─── factures ───────────────────────────────────────────────────────────────

CREATE TABLE factures_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id   INTEGER NOT NULL,
  numero        TEXT    NOT NULL,
  client_id     INTEGER NOT NULL,
  ticket_id     INTEGER,
  devis_id      INTEGER,

  total_ht      REAL    NOT NULL DEFAULT 0,
  total_tva     REAL    NOT NULL DEFAULT 0,
  total_ttc     REAL    NOT NULL DEFAULT 0,
  montant_paye  REAL    NOT NULL DEFAULT 0,

  statut        TEXT    NOT NULL DEFAULT 'emise',

  date_emission  DATETIME DEFAULT CURRENT_TIMESTAMP,
  date_echeance  DATETIME,
  date_paiement  DATETIME,

  hash_nf525    TEXT,

  notes         TEXT,
  conditions    TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  locked        INTEGER NOT NULL DEFAULT 0,
  issued_at     DATETIME,
  tracking_token TEXT,
  FOREIGN KEY (boutique_id) REFERENCES boutiques(id),
  FOREIGN KEY (client_id)   REFERENCES clients(id),
  FOREIGN KEY (ticket_id)   REFERENCES tickets(id),
  FOREIGN KEY (devis_id)    REFERENCES devis(id),
  UNIQUE(boutique_id, numero)
);

INSERT INTO factures_new (
  id, boutique_id, numero, client_id, ticket_id, devis_id, total_ht, total_tva,
  total_ttc, montant_paye, statut, date_emission, date_echeance, date_paiement,
  hash_nf525, notes, conditions, created_at, updated_at, locked, issued_at, tracking_token
)
SELECT
  id, boutique_id, numero, client_id, ticket_id, devis_id, total_ht, total_tva,
  total_ttc, montant_paye, statut, date_emission, date_echeance, date_paiement,
  hash_nf525, notes, conditions, created_at, updated_at, locked, issued_at, tracking_token
FROM factures;

DROP TABLE factures;
ALTER TABLE factures_new RENAME TO factures;

CREATE INDEX idx_factures_boutique ON factures(boutique_id);
CREATE INDEX idx_factures_client   ON factures(client_id);
CREATE INDEX idx_factures_statut   ON factures(statut);
CREATE INDEX idx_factures_numero   ON factures(numero);
CREATE INDEX idx_factures_locked   ON factures(locked);
CREATE UNIQUE INDEX idx_factures_token ON factures(tracking_token) WHERE tracking_token IS NOT NULL;

-- ─── avoirs ─────────────────────────────────────────────────────────────────

CREATE TABLE avoirs_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id   INTEGER NOT NULL,
  numero        TEXT    NOT NULL,
  facture_id    INTEGER NOT NULL,
  client_id     INTEGER NOT NULL,

  type          TEXT    NOT NULL DEFAULT 'remboursement',
  motif         TEXT    NOT NULL,

  total_ht      REAL    NOT NULL DEFAULT 0,
  total_tva     REAL    NOT NULL DEFAULT 0,
  total_ttc     REAL    NOT NULL DEFAULT 0,

  statut        TEXT    NOT NULL DEFAULT 'emis',

  hash_nf525    TEXT,

  date_emission DATETIME DEFAULT CURRENT_TIMESTAMP,
  notes         TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (boutique_id) REFERENCES boutiques(id),
  FOREIGN KEY (facture_id)  REFERENCES factures(id),
  FOREIGN KEY (client_id)   REFERENCES clients(id),
  UNIQUE(boutique_id, numero)
);

INSERT INTO avoirs_new (
  id, boutique_id, numero, facture_id, client_id, type, motif, total_ht, total_tva,
  total_ttc, statut, hash_nf525, date_emission, notes, created_at, updated_at
)
SELECT
  id, boutique_id, numero, facture_id, client_id, type, motif, total_ht, total_tva,
  total_ttc, statut, hash_nf525, date_emission, notes, created_at, updated_at
FROM avoirs;

DROP TABLE avoirs;
ALTER TABLE avoirs_new RENAME TO avoirs;

CREATE INDEX idx_avoirs_boutique ON avoirs(boutique_id);
CREATE INDEX idx_avoirs_facture  ON avoirs(facture_id);
CREATE INDEX idx_avoirs_client   ON avoirs(client_id);
CREATE INDEX idx_avoirs_numero   ON avoirs(numero);

-- ─── rachats ────────────────────────────────────────────────────────────────

CREATE TABLE rachats_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id     INTEGER NOT NULL,
  numero          TEXT    NOT NULL,

  vendeur_nom     TEXT    NOT NULL,
  vendeur_prenom  TEXT    NOT NULL,
  vendeur_naissance DATE,
  vendeur_adresse TEXT,
  vendeur_cp      TEXT,
  vendeur_ville   TEXT,
  vendeur_piece   TEXT    NOT NULL,
  vendeur_piece_num TEXT  NOT NULL,
  vendeur_telephone TEXT,

  marque          TEXT    NOT NULL,
  modele          TEXT    NOT NULL,
  imei            TEXT,
  imei2           TEXT,
  couleur         TEXT,
  capacite        TEXT,
  etat            TEXT    NOT NULL DEFAULT 'bon',
  accessoires     TEXT,
  observations    TEXT,

  prix_rachat     REAL    NOT NULL DEFAULT 0,
  mode_paiement   TEXT    NOT NULL DEFAULT 'especes',
  reference_paiement TEXT,

  statut          TEXT    NOT NULL DEFAULT 'en_stock',

  produit_id      INTEGER,

  user_id         INTEGER NOT NULL,

  hash_nf525      TEXT,

  date_rachat     DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (boutique_id) REFERENCES boutiques(id),
  FOREIGN KEY (produit_id)  REFERENCES produits(id),
  FOREIGN KEY (user_id)     REFERENCES users(id),
  UNIQUE(boutique_id, numero)
);

INSERT INTO rachats_new (
  id, boutique_id, numero, vendeur_nom, vendeur_prenom, vendeur_naissance,
  vendeur_adresse, vendeur_cp, vendeur_ville, vendeur_piece, vendeur_piece_num,
  vendeur_telephone, marque, modele, imei, imei2, couleur, capacite, etat,
  accessoires, observations, prix_rachat, mode_paiement, reference_paiement,
  statut, produit_id, user_id, hash_nf525, date_rachat, created_at, updated_at
)
SELECT
  id, boutique_id, numero, vendeur_nom, vendeur_prenom, vendeur_naissance,
  vendeur_adresse, vendeur_cp, vendeur_ville, vendeur_piece, vendeur_piece_num,
  vendeur_telephone, marque, modele, imei, imei2, couleur, capacite, etat,
  accessoires, observations, prix_rachat, mode_paiement, reference_paiement,
  statut, produit_id, user_id, hash_nf525, date_rachat, created_at, updated_at
FROM rachats;

DROP TABLE rachats;
ALTER TABLE rachats_new RENAME TO rachats;

CREATE INDEX idx_rachats_boutique ON rachats(boutique_id);
CREATE INDEX idx_rachats_numero   ON rachats(numero);
CREATE INDEX idx_rachats_imei     ON rachats(imei);
CREATE INDEX idx_rachats_statut   ON rachats(statut);
CREATE INDEX idx_rachats_date     ON rachats(date_rachat);
CREATE INDEX idx_rachats_vendeur  ON rachats(vendeur_nom, vendeur_prenom);

PRAGMA foreign_keys=ON;
