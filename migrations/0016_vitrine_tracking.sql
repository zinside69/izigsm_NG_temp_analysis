-- ============================================================
-- Migration 0016 — Vitrine publique + Tracking token tickets
-- Sprint 2.7 — MOD-14 + MOD-01 tracking
-- ============================================================

-- Tracking token sur tickets (pour suivi public client)
ALTER TABLE tickets ADD COLUMN tracking_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_tracking_token
  ON tickets(tracking_token) WHERE tracking_token IS NOT NULL;

-- Slug sur boutiques (URL vitrine : /pro/:slug)
ALTER TABLE boutiques ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_boutiques_slug
  ON boutiques(slug) WHERE slug IS NOT NULL;

-- Description / présentation boutique pour vitrine
ALTER TABLE boutiques ADD COLUMN description TEXT;
ALTER TABLE boutiques ADD COLUMN horaires TEXT;           -- JSON "{lun:"9h-19h", ...}"
ALTER TABLE boutiques ADD COLUMN facebook_url TEXT;
ALTER TABLE boutiques ADD COLUMN instagram_url TEXT;
ALTER TABLE boutiques ADD COLUMN google_maps_url TEXT;

-- Peupler les slugs existants (boutique_id=1 → izigsm-paris-11)
UPDATE boutiques SET slug = lower(replace(replace(replace(nom,' ','-'),'''','-'),'é','e')) WHERE slug IS NULL;

-- Générer un tracking_token pour les tickets existants sans token
-- (fait côté applicatif au prochain GET, ou via trigger)
