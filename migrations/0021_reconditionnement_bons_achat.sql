-- ============================================================================
-- Migration 0021 — Reconditionnement + Bons d'achat
-- Sprint 2.16 — MOD-05 Reconditionnement + MOD-11 Bons d'achat
--
-- Deux modules liés :
--   1. ordres_reconditionnement : workflow rachat → reconditionnement → stock occasion
--   2. bons_achat               : geste commercial + bon lié à un client
-- ============================================================================

-- ─── Ordres de reconditionnement ─────────────────────────────────────────────
-- Un ordre transforme un rachat (livre de police) en produit d'occasion stockable.
-- Workflow : brouillon → en_cours → termine → abandonne
-- Le coût de revient = prix_rachat + coût main d'œuvre + coût pièces
CREATE TABLE IF NOT EXISTS ordres_reconditionnement (
  id                  INTEGER  PRIMARY KEY AUTOINCREMENT,
  boutique_id         INTEGER  NOT NULL REFERENCES boutiques(id)     ON DELETE CASCADE,
  rachat_id           INTEGER  REFERENCES rachats(id)                ON DELETE SET NULL,
  produit_id          INTEGER  REFERENCES produits(id)               ON DELETE SET NULL,
  -- Numéro séquentiel : RC-AAAA-XXXXX
  numero              TEXT     NOT NULL UNIQUE,
  -- Statuts du workflow
  statut              TEXT     NOT NULL DEFAULT 'brouillon'
                      CHECK(statut IN ('brouillon','en_cours','termine','abandonne')),
  -- Description de l'appareil reconditionné (copie depuis rachat ou saisie libre)
  appareil_marque     TEXT,
  appareil_modele     TEXT,
  imei                TEXT,
  couleur             TEXT,
  capacite            TEXT,
  -- Coût de revient (calculé automatiquement à la clôture)
  prix_rachat         REAL     NOT NULL DEFAULT 0,   -- copié depuis rachats.prix_rachat
  cout_main_oeuvre    REAL     NOT NULL DEFAULT 0,   -- saisie manuelle (heures × taux)
  cout_pieces         REAL     NOT NULL DEFAULT 0,   -- pièces consommées (non lié stock ici)
  cout_revient        REAL     GENERATED ALWAYS AS (prix_rachat + cout_main_oeuvre + cout_pieces) STORED,
  -- Prix de revente suggéré (saisie manuelle, alimente prix_vente_ht du produit)
  prix_revente_ht     REAL,
  -- Description des travaux réalisés
  description_travaux TEXT,
  -- Grade qualité (A = comme neuf, B = bon état, C = correct, D = fonctionnel avec traces)
  grade               TEXT     CHECK(grade IN ('A','B','C','D')),
  -- Traçabilité temporelle
  date_debut          DATETIME,
  date_fin            DATETIME,
  actif               INTEGER  NOT NULL DEFAULT 1,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_recon_boutique  ON ordres_reconditionnement(boutique_id);
CREATE INDEX IF NOT EXISTS idx_recon_rachat    ON ordres_reconditionnement(rachat_id);
CREATE INDEX IF NOT EXISTS idx_recon_produit   ON ordres_reconditionnement(produit_id);
CREATE INDEX IF NOT EXISTS idx_recon_statut    ON ordres_reconditionnement(statut);

-- ─── Bons d'achat ─────────────────────────────────────────────────────────────
-- Geste commercial émis au bénéfice d'un client.
-- Peut être lié à un ticket (geste SAV), une facture, ou émis manuellement.
-- Utilisation : lors d'une facturation, le caissier saisit le code et déduit le montant.
CREATE TABLE IF NOT EXISTS bons_achat (
  id                  INTEGER  PRIMARY KEY AUTOINCREMENT,
  boutique_id         INTEGER  NOT NULL REFERENCES boutiques(id)     ON DELETE CASCADE,
  client_id           INTEGER  REFERENCES clients(id)                ON DELETE SET NULL,
  -- Entité source (optionnel — traçabilité de l'origine du bon)
  source_type         TEXT     CHECK(source_type IN ('manuel','ticket','facture','sav')),
  source_id           INTEGER, -- id du ticket / facture / sav d'origine
  -- Code unique alphanumérique (saisi par le caissier)
  code                TEXT     NOT NULL UNIQUE COLLATE NOCASE,
  -- Montant et utilisation
  montant             REAL     NOT NULL CHECK(montant > 0),
  montant_utilise     REAL     NOT NULL DEFAULT 0,
  -- Statut
  statut              TEXT     NOT NULL DEFAULT 'actif'
                      CHECK(statut IN ('actif','utilise','expire','annule')),
  -- Expiration (NULL = pas d'expiration)
  date_expiration     DATE,
  -- Contexte d'utilisation (renseigné à l'encaissement)
  utilise_le          DATETIME,
  utilise_facture_id  INTEGER  REFERENCES factures(id) ON DELETE SET NULL,
  -- Note interne
  motif               TEXT,
  actif               INTEGER  NOT NULL DEFAULT 1,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bons_achat_boutique  ON bons_achat(boutique_id);
CREATE INDEX IF NOT EXISTS idx_bons_achat_client    ON bons_achat(client_id);
CREATE INDEX IF NOT EXISTS idx_bons_achat_code      ON bons_achat(code);
CREATE INDEX IF NOT EXISTS idx_bons_achat_statut    ON bons_achat(statut);
