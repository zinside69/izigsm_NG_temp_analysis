-- Migration 0033 — Champs prise en charge (état des lieux, sécurité, signature)
-- Gaps identifiés dans docs/ANALYSE_COMPARATIVE_MONATELIER.md (§1.1, 1.2, 1.3) :
-- pas de checklist d'état à l'entrée, pas de stockage des codes de déverrouillage,
-- signature client capturée dans l'UI (tickets.js) mais jamais persistée (hasSignature
-- booléen seulement). Les colonnes sensibles (codes, signature) ne sont sélectionnées
-- que par getTicketById() — jamais par listTickets()/getKanban() (SELECT explicite).

ALTER TABLE tickets ADD COLUMN etat_appareil TEXT;        -- JSON, ex: '{"items":["rayures","ecran_fissure"],"autre":"..."}'
ALTER TABLE tickets ADD COLUMN code_deverrouillage TEXT;  -- PIN ou schéma de déverrouillage
ALTER TABLE tickets ADD COLUMN code_sim TEXT;
ALTER TABLE tickets ADD COLUMN signature_client TEXT;     -- data URL PNG (canvas.toDataURL)
ALTER TABLE tickets ADD COLUMN signature_date TEXT;       -- ISO datetime de la signature
