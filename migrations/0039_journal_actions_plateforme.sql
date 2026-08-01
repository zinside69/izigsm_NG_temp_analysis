-- ============================================================
-- Migration 0039 — Journal des actions de plateforme
-- ============================================================
-- Décision structurante : docs/adr/0001-journal-separe-actions-plateforme.md (accepted).
--
-- Les actions de l'admin plateforme (rôle `admin`, `boutique_id` NULL) sur une boutique
-- cliente sont enregistrées dans ce registre DÉDIÉ, distinct de l'`audit_logs` de la
-- boutique visée. Motif : le client doit pouvoir savoir ce qui a été fait sur ses données,
-- en particulier sur une facture en cas de litige.
--
-- Alimenté par un middleware Hono (`journalPlateformeMiddleware`), jamais par les routes :
-- les 77 appels dispersés à `auditLog()` ne passent par aucun point unique et laisseraient
-- des trous — leçon des trois campagnes successives de correction d'isolation.
--
-- COLONNES ÉCARTÉES VOLONTAIREMENT : `entite_type`, `entite_id`, `donnees_avant`,
-- `donnees_apres`. Un middleware ne connaît ni l'entité métier ni son état avant mutation ;
-- les déduire du chemin appelé produirait un registre faux.
--
-- AUCUNE CLÉ ÉTRANGÈRE, ni vers `boutiques` ni vers `users` : un registre de supervision
-- doit survivre à la désactivation d'une boutique et à la suppression d'un compte. Le dépôt
-- a déjà payé le prix d'une FK laissée pendante (migration 0031, réparée par 0038).
-- ============================================================

CREATE TABLE IF NOT EXISTS journal_actions_plateforme (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,               -- auteur : l'admin plateforme (pas de FK, cf. ci-dessus)
  boutique_id  INTEGER,                        -- boutique visée, NULL si non résolue (jamais de ligne tue)
  methode      TEXT    NOT NULL,               -- 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  chemin       TEXT    NOT NULL,               -- ex. '/api/factures/9'
  statut_http  INTEGER NOT NULL,               -- statut de la réponse renvoyée (500 si le handler a levé)
  corps_expurge TEXT,                          -- corps de requête tronqué et expurgé, NULL si absent/non JSON
  ip_address   TEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- La consultation (chantier 2) lira par boutique et par date, ou par auteur.
CREATE INDEX IF NOT EXISTS idx_journal_plateforme_boutique ON journal_actions_plateforme(boutique_id, created_at);
CREATE INDEX IF NOT EXISTS idx_journal_plateforme_user     ON journal_actions_plateforme(user_id);
