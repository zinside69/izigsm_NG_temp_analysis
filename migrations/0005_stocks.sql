-- ============================================================
-- Migration 0005 : Catégories, Produits & Mouvements de stock
-- ============================================================

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id INTEGER NOT NULL,
  nom         TEXT    NOT NULL,
  parent_id   INTEGER,                         -- NULL = catégorie racine
  actif       INTEGER NOT NULL DEFAULT 1,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (boutique_id) REFERENCES boutiques(id),
  FOREIGN KEY (parent_id)   REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS produits (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id      INTEGER NOT NULL,
  categorie_id     INTEGER,
  sku              TEXT,                        -- Code article unique par boutique
  nom              TEXT    NOT NULL,
  description      TEXT,
  marque           TEXT,
  -- Prix
  prix_achat_ht    REAL    NOT NULL DEFAULT 0,
  prix_vente_ht    REAL    NOT NULL DEFAULT 0,
  tva_taux         REAL    NOT NULL DEFAULT 20.0,
  -- Stock
  stock_actuel     INTEGER NOT NULL DEFAULT 0,
  stock_minimum    INTEGER NOT NULL DEFAULT 5,  -- seuil alerte stock bas
  stock_maximum    INTEGER,
  -- Identification
  code_barre       TEXT,
  -- Fournisseur
  fournisseur      TEXT,
  reference_fournisseur TEXT,
  -- Divers
  actif            INTEGER NOT NULL DEFAULT 1,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (boutique_id) REFERENCES boutiques(id),
  FOREIGN KEY (categorie_id) REFERENCES categories(id)
);

-- Trace de chaque entrée/sortie de stock
CREATE TABLE IF NOT EXISTS mouvements_stock (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  produit_id    INTEGER NOT NULL,
  boutique_id   INTEGER NOT NULL,
  type_mouvement TEXT   NOT NULL,               -- 'entree' | 'sortie' | 'ajustement' | 'inventaire'
  quantite      INTEGER NOT NULL,               -- positif (entrée) ou négatif (sortie)
  stock_avant   INTEGER NOT NULL,               -- stock avant le mouvement
  stock_apres   INTEGER NOT NULL,               -- stock après le mouvement
  -- Référence source
  ticket_id     INTEGER,                        -- si lié à une réparation
  user_id       INTEGER NOT NULL,
  motif         TEXT,                           -- 'achat fournisseur', 'réparation #123', etc.
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (produit_id) REFERENCES produits(id),
  FOREIGN KEY (boutique_id) REFERENCES boutiques(id),
  FOREIGN KEY (ticket_id)  REFERENCES tickets(id),
  FOREIGN KEY (user_id)    REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_produits_boutique   ON produits(boutique_id);
CREATE INDEX IF NOT EXISTS idx_produits_sku        ON produits(sku);
CREATE INDEX IF NOT EXISTS idx_produits_categorie  ON produits(categorie_id);
CREATE INDEX IF NOT EXISTS idx_produits_stock_bas  ON produits(stock_actuel, stock_minimum);
CREATE INDEX IF NOT EXISTS idx_mouvements_produit  ON mouvements_stock(produit_id);
CREATE INDEX IF NOT EXISTS idx_mouvements_date     ON mouvements_stock(created_at);
