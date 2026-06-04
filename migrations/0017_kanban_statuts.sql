-- ============================================================
-- Sprint 2.8 — Kanban : nouveaux statuts + priorité + dates pièces
-- ============================================================

-- 1. Ajouter colonne priorite sur tickets
ALTER TABLE tickets ADD COLUMN priorite TEXT NOT NULL DEFAULT 'normale';

-- 2. Ajouter date_commande_pieces (quand statut → 'a_commander' ou 'commande')
ALTER TABLE tickets ADD COLUMN date_commande_pieces DATETIME;

-- 3. Ajouter date_reception_pieces (quand statut → 'pieces_recues')
ALTER TABLE tickets ADD COLUMN date_reception_pieces DATETIME;

-- 4. Index sur priorite pour le Kanban
CREATE INDEX IF NOT EXISTS idx_tickets_priorite ON tickets(priorite);
