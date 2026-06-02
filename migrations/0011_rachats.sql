-- ============================================================
-- Migration 0011 : Rachats & Livre de police (Code pénal art. 321-7)
-- ============================================================
-- Conformité légale France :
--   - Code pénal art. 321-7 : obligation de tenir un registre des achats
--     d'occasion (livre de police) pour tout achat de bien d'occasion
--   - Décret n°2007-1137 du 26 juil. 2007 : identification vendeur obligatoire
--   - Signalement PHAROS si suspicion de recel
-- Format numéro : LP-AAAA-XXXXX (Livre Police)
-- ============================================================

-- 1. Table rachats (enregistrement des achats de téléphones d'occasion)
CREATE TABLE IF NOT EXISTS rachats (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id     INTEGER NOT NULL,
  numero          TEXT    NOT NULL UNIQUE,         -- LP-2026-00001
  -- Vendeur (identification obligatoire art. 321-7)
  vendeur_nom     TEXT    NOT NULL,
  vendeur_prenom  TEXT    NOT NULL,
  vendeur_naissance DATE,                          -- date de naissance
  vendeur_adresse TEXT,
  vendeur_cp      TEXT,
  vendeur_ville   TEXT,
  vendeur_piece   TEXT    NOT NULL,                -- type pièce identité : CNI | PASSEPORT | SEJOUR | PERMIS
  vendeur_piece_num TEXT  NOT NULL,                -- numéro de la pièce
  vendeur_telephone TEXT,
  -- Appareil racheté
  marque          TEXT    NOT NULL,
  modele          TEXT    NOT NULL,
  imei            TEXT,                            -- IMEI (recommandé, parfois inconnu)
  imei2           TEXT,                            -- 2e IMEI pour dual-SIM
  couleur         TEXT,
  capacite        TEXT,                            -- 64 Go, 128 Go…
  etat            TEXT    NOT NULL DEFAULT 'bon',  -- neuf | bon | correct | mauvais | hs
  accessoires     TEXT,                            -- chargeur, boîte, coque…
  observations    TEXT,                            -- notes techniques
  -- Prix
  prix_rachat     REAL    NOT NULL DEFAULT 0,      -- montant versé au vendeur
  mode_paiement   TEXT    NOT NULL DEFAULT 'especes', -- especes | virement | cheque
  reference_paiement TEXT,                         -- n° chèque, référence virement
  -- Statut dans le stock
  statut          TEXT    NOT NULL DEFAULT 'en_stock', -- en_stock | vendu | retourne | litige
  -- Lien éventuel vers produit stock
  produit_id      INTEGER,                         -- si converti en fiche produit
  -- Opérateur
  user_id         INTEGER NOT NULL,
  -- NF525 / audit
  hash_nf525      TEXT,
  -- Timestamps
  date_rachat     DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (boutique_id) REFERENCES boutiques(id),
  FOREIGN KEY (produit_id)  REFERENCES produits(id),
  FOREIGN KEY (user_id)     REFERENCES users(id)
);

-- 2. Index
CREATE INDEX IF NOT EXISTS idx_rachats_boutique  ON rachats(boutique_id);
CREATE INDEX IF NOT EXISTS idx_rachats_numero    ON rachats(numero);
CREATE INDEX IF NOT EXISTS idx_rachats_imei      ON rachats(imei);
CREATE INDEX IF NOT EXISTS idx_rachats_statut    ON rachats(statut);
CREATE INDEX IF NOT EXISTS idx_rachats_date      ON rachats(date_rachat);
CREATE INDEX IF NOT EXISTS idx_rachats_vendeur   ON rachats(vendeur_nom, vendeur_prenom);
