-- ============================================================
-- Migration 0043 — email_logs admet ticket_livre et relance_devis (P1 du 2026-09-11)
-- ============================================================
-- Le CHECK de email_logs.type (migration 0020) n'admettait que ticket_cree, ticket_termine,
-- sav_ouvert, relance et autre. Le code écrit aussi ticket_livre (sendTicketLivre) et
-- relance_devis (sendRelanceDevis). Conséquences, voir project-docs/bugs.md :
--   - ces emails partaient sans jamais laisser de ligne dans email_logs
--   - l'anti-doublon de processRelancesDevis cherche une ligne relance_devis qui ne pouvait
--     pas exister, donc chaque lancement relançait le même client
-- Seul le CHECK de type change. Le CHECK de statut est conservé tel quel (décision de
-- l'exploitant du 2026-09-11 : une notification désactivée reste notée simule avec motif).
--
-- Garde-fou : tests/email-types-check-conformite.test.ts échoue si un futur EmailType du code
-- n'est pas admis par le CHECK de la dernière migration qui crée email_logs. Test de la
-- migration elle-même contre un vrai SQLite : tests/email-logs-types-migration.test.ts.
--
-- SQLite ne permet pas de modifier un CHECK : la table est recréée, selon le patron de la
-- migration 0040 (mesuré le 2026-08-02) :
--   - PRAGMA foreign_keys=OFF est ignoré dans la transaction où D1 exécute ce fichier
--   - aucun ALTER TABLE RENAME, PRAGMA legacy_alter_table n'étant pas honoré par workerd
--   - détour par une table de transit, la table finale naît directement sous son nom
-- Aucune table ne référence email_logs, donc aucune table fille n'est concernée.
-- Prérequis vérifié le 2026-09-11 : pragma_foreign_key_check à 0 en production (8 lignes).
-- Colonnes reprises : toutes celles de 0020, aucune migration ne les a modifiées depuis.

PRAGMA defer_foreign_keys=ON;

-- Transit sans contrainte ni index, les données y sont à l'abri le temps de la recréation.
CREATE TABLE email_logs_transit AS SELECT * FROM email_logs;

DROP TABLE email_logs;

CREATE TABLE email_logs (
  id            INTEGER  PRIMARY KEY AUTOINCREMENT,
  boutique_id   INTEGER  NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  destinataire  TEXT     NOT NULL,
  sujet         TEXT     NOT NULL,
  type          TEXT     NOT NULL
                CHECK(type IN ('ticket_cree','ticket_termine','ticket_livre','sav_ouvert','relance','relance_devis','autre')),
  entite_type   TEXT,              -- ticket, sav ou devis
  entite_id     INTEGER,
  statut        TEXT     NOT NULL DEFAULT 'envoye'
                CHECK(statut IN ('envoye','erreur','simule')),
  erreur        TEXT,              -- message d'erreur, ou motif d'un envoi simulé
  provider_id   TEXT,              -- id retourné par le provider (ex. Resend)
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Liste de colonnes explicite, jamais SELECT * : les identifiants et les dates sont conservés.
INSERT INTO email_logs
  (id, boutique_id, destinataire, sujet, type, entite_type, entite_id, statut, erreur, provider_id, created_at)
SELECT
   id, boutique_id, destinataire, sujet, type, entite_type, entite_id, statut, erreur, provider_id, created_at
FROM email_logs_transit;

DROP TABLE email_logs_transit;

CREATE INDEX IF NOT EXISTS idx_email_logs_boutique  ON email_logs(boutique_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_entite    ON email_logs(entite_type, entite_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_type      ON email_logs(type);
