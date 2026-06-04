-- Migration 0014 — Fournisseurs + Bons de commande + CUMP
-- Sprint 2.5 — MOD-10 Achats/Approvisionnement + MAJ CUMP sur MOD-04 Stock

-- ── Table fournisseurs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fournisseurs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id   INTEGER NOT NULL,
  nom           TEXT    NOT NULL,
  contact       TEXT,
  email         TEXT,
  telephone     TEXT,
  adresse       TEXT,
  site_web      TEXT,
  notes         TEXT,
  actif         INTEGER NOT NULL DEFAULT 1,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (boutique_id) REFERENCES boutiques(id)
);

-- ── Table bons_commande ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bons_commande (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id     INTEGER NOT NULL,
  fournisseur_id  INTEGER NOT NULL,
  numero          TEXT    NOT NULL,          -- BC-AAAA-XXXXX (via nextNumero)
  statut          TEXT    NOT NULL DEFAULT 'draft',
  -- statuts : draft | awaiting_delivery | received | cancelled
  statut_paiement TEXT    NOT NULL DEFAULT 'pending',
  -- statuts paiement : pending | partial | paid
  date_commande   DATETIME,
  date_livraison_prevue DATETIME,
  date_reception  DATETIME,
  montant_ht      REAL    NOT NULL DEFAULT 0,
  montant_ttc     REAL    NOT NULL DEFAULT 0,
  notes           TEXT,
  ticket_id       INTEGER,                   -- lien ticket à l'origine de la commande
  user_id         INTEGER NOT NULL,          -- créateur
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (boutique_id)    REFERENCES boutiques(id),
  FOREIGN KEY (fournisseur_id) REFERENCES fournisseurs(id),
  FOREIGN KEY (ticket_id)      REFERENCES tickets(id)
);

-- ── Table lignes_bon_commande ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lignes_bon_commande (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  bon_commande_id INTEGER NOT NULL,
  produit_id      INTEGER,                   -- nullable : pièce non encore en stock
  designation     TEXT    NOT NULL,          -- nom libre si pas de produit_id
  reference       TEXT,
  quantite_commandee  INTEGER NOT NULL DEFAULT 1,
  quantite_recue      INTEGER NOT NULL DEFAULT 0,
  prix_achat_ht   REAL    NOT NULL DEFAULT 0,
  tva_taux        REAL    NOT NULL DEFAULT 20,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (bon_commande_id) REFERENCES bons_commande(id) ON DELETE CASCADE,
  FOREIGN KEY (produit_id)      REFERENCES produits(id)
);

-- ── Colonne CUMP sur produits ─────────────────────────────────────────────────
-- Ajout du prix_achat_cump (Coût Unitaire Moyen Pondéré)
-- distinct du prix_achat_ht (prix catalogue fournisseur)
ALTER TABLE produits ADD COLUMN prix_achat_cump REAL NOT NULL DEFAULT 0;

-- Colonne fournisseur_id sur produits (lien structuré)
ALTER TABLE produits ADD COLUMN fournisseur_id INTEGER REFERENCES fournisseurs(id);

-- ── Indexes performances ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fournisseurs_boutique    ON fournisseurs(boutique_id, actif);
CREATE INDEX IF NOT EXISTS idx_bons_commande_boutique   ON bons_commande(boutique_id, statut);
CREATE INDEX IF NOT EXISTS idx_bons_commande_fournisseur ON bons_commande(fournisseur_id);
CREATE INDEX IF NOT EXISTS idx_bons_commande_ticket     ON bons_commande(ticket_id);
CREATE INDEX IF NOT EXISTS idx_lignes_bc_bon            ON lignes_bon_commande(bon_commande_id);
CREATE INDEX IF NOT EXISTS idx_lignes_bc_produit        ON lignes_bon_commande(produit_id);
CREATE INDEX IF NOT EXISTS idx_produits_fournisseur     ON produits(fournisseur_id);
