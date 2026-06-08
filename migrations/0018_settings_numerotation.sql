-- ============================================================
-- Sprint 2.9 — Settings tenant : numérotation configurable
-- ============================================================

-- Préfixes personnalisables par boutique
ALTER TABLE boutique_settings ADD COLUMN prefix_ticket  TEXT NOT NULL DEFAULT 'TKT';
ALTER TABLE boutique_settings ADD COLUMN prefix_facture TEXT NOT NULL DEFAULT 'FAC';
ALTER TABLE boutique_settings ADD COLUMN prefix_devis   TEXT NOT NULL DEFAULT 'DEV';
ALTER TABLE boutique_settings ADD COLUMN prefix_avoir   TEXT NOT NULL DEFAULT 'AV';
ALTER TABLE boutique_settings ADD COLUMN prefix_rachat  TEXT NOT NULL DEFAULT 'LP';

-- Format numéro : 'PREFIXE-ANNEE-SEQUENCE' (défaut) ou 'PREFIXE-SEQUENCE' (sans année)
ALTER TABLE boutique_settings ADD COLUMN format_numero  TEXT NOT NULL DEFAULT 'annee';

-- Longueur du padding séquence (défaut 5 → 00001)
ALTER TABLE boutique_settings ADD COLUMN padding_numero INTEGER NOT NULL DEFAULT 5;

-- Paramètres métier additionnels
ALTER TABLE boutique_settings ADD COLUMN garantie_defaut_jours INTEGER NOT NULL DEFAULT 90;
ALTER TABLE boutique_settings ADD COLUMN delai_relance_jours    INTEGER NOT NULL DEFAULT 3;
ALTER TABLE boutique_settings ADD COLUMN mention_facture        TEXT;
ALTER TABLE boutique_settings ADD COLUMN pied_de_page           TEXT;
