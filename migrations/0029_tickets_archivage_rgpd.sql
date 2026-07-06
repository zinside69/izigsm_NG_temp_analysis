-- Sprint 2.37 — RGPD + Archivage tickets
-- archived_at : NULL = actif, NOT NULL = archivé (tickets livre/annule depuis > 90j)
-- La colonne actif reste inchangée : soft delete conservé indépendamment de l'archivage.

ALTER TABLE tickets ADD COLUMN archived_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_tickets_archived_at
  ON tickets(boutique_id, archived_at)
  WHERE archived_at IS NOT NULL;

-- Index partiel pour le batch auto-archivage : tickets livrés/annulés non encore archivés
CREATE INDEX IF NOT EXISTS idx_tickets_autoarchive
  ON tickets(boutique_id, statut, updated_at)
  WHERE archived_at IS NULL AND actif = 1 AND statut IN ('livre', 'annule');
