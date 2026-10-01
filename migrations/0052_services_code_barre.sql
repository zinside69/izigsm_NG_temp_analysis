-- Migration 0052 — code-barres des services (ticket 05 `vente-lit-catalogue`, « Codes maison »)
--
-- Un service peut recevoir un code maison (planche de codes du comptoir, scan en caisse) au même
-- titre qu'un produit : même patron que `0048` (unique partiel par boutique, services actifs,
-- valeur non nulle et non vide après TRIM). Numéro réservé le 2026-09-30 pour ce ticket
-- (`migrations/0054_produits_imei_factures_appareils.sql`).
--
-- Uniquement un ADD COLUMN et un CREATE INDEX : aucune table recréée, aucune ligne touchée.

ALTER TABLE services ADD COLUMN code_barre TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_services_code_barre_unique
  ON services(boutique_id, code_barre)
  WHERE actif = 1 AND code_barre IS NOT NULL AND TRIM(code_barre) <> '';
