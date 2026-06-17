-- Migration 0023 — Champs supplémentaires table devis
-- Sprint 2.19 — MOD-03 : page d'acceptation publique + traçabilité envoi email

-- Token unique pour la page publique d'acceptation/refus (sans auth)
ALTER TABLE devis ADD COLUMN public_token TEXT;
-- Date d'envoi du devis au client
ALTER TABLE devis ADD COLUMN envoye_le   DATETIME;
-- Date de réponse client (acceptation ou refus)
ALTER TABLE devis ADD COLUMN repondu_le  DATETIME;
-- Signature client (timestamp acceptation — simulé, eIDAS non implémenté)
ALTER TABLE devis ADD COLUMN signature_client TEXT;

-- Index pour accès rapide par token (page publique)
CREATE UNIQUE INDEX IF NOT EXISTS idx_devis_public_token ON devis(public_token) WHERE public_token IS NOT NULL;
