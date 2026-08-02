-- Migration 0040 — le numéro de facture n'est attribué qu'à l'émission
--
-- Ticket 001 du chantier `.scratch/conformite-facturation/`.
--
-- Root cause : `nextNumero()` était appelé AVANT l'`INSERT` des trois chemins de
-- création (manuelle, conversion de devis, acompte). Tout échec entre les deux
-- consommait un numéro sans laisser de document — deux trous réels en production
-- sur la boutique 1 (`FAC-2026-00001` et `FAC-2026-00002` n'existent nulle part).
-- Une série à trous n'est pas conforme à l'art. 289 du CGI.
--
-- Décision (project-docs/decisions.md, 2026-08-02) : un brouillon n'est pas une
-- facture, il vit donc SANS numéro. Seule `emettreFacture()` consomme la séquence.
-- Cette migration lève la contrainte `NOT NULL` sur `factures.numero` — c'est la
-- seule modification de schéma du ticket.
--
-- `UNIQUE(boutique_id, numero)` est CONSERVÉE et tolère déjà plusieurs brouillons :
-- en SQLite, deux NULL ne sont jamais considérés comme égaux dans un index unique.
--
-- SQLite ne permet pas `ALTER TABLE ... ALTER COLUMN` : la table doit être recréée,
-- données copiées avec liste de colonnes explicite (jamais `SELECT *`), index
-- recréés à l'identique.
--
-- ⚠ L'ordre employé par la migration 0034 (créer `factures_new`, copier, `DROP TABLE
--   factures`, renommer) NE PASSE PLUS sur une base contenant des paiements : voir
--   la note sur les pragmas ci-dessous. Aucun `ALTER TABLE ... RENAME` ici — la
--   nouvelle table naît directement sous le nom `factures`, après un détour par une
--   table de transit sans contrainte.
--
-- ⚠ Colonnes reprises : celles de 0034 + `type_facture` (0036) + `date_execution`,
--   `vendeur_snapshot`, `acheteur_snapshot` (0037). Toute colonne ajoutée à
--   `factures` après 0037 devrait figurer ici — vérifier avant d'appliquer.
--
-- ⚠ Aucun numéro existant n'est réécrit et aucun trou n'est rebouché : ce serait
--   fabriquer des documents qui n'ont jamais existé (ticket 004, note traçable).

-- ⚠ Deux pragmas, deux raisons — mesurées le 2026-08-02, ne pas les retirer :
--
-- `PRAGMA foreign_keys=OFF` (employé par 0034) NE FONCTIONNE PAS ici : D1 exécute le
-- fichier dans une transaction, et SQLite ignore silencieusement ce pragma dès qu'une
-- transaction est ouverte. `DROP TABLE factures` échouait donc en
-- `SQLITE_CONSTRAINT_FOREIGNKEY` — `paiements`, `avoirs`, `commissions` et
-- `bons_achat` la référencent, et un DROP déclenche un DELETE implicite.
--
-- `defer_foreign_keys=ON` repousse ces contrôles au COMMIT — c'est le seul pragma qui
-- fonctionne dans une transaction. Mais il ne dispense pas de RÉSOUDRE les violations
-- avant la fin : le compteur de SQLite ne redescend que lorsque les lignes parentes
-- sont réinsérées **dans une table portant le nom référencé**. Copier vers une table
-- `factures_new` puis la renommer ne l'a donc pas fait redescendre (COMMIT refusé,
-- mesuré). D'où le détour par une table de transit : les données sont mises à l'abri,
-- `factures` est supprimée puis recréée sous son nom, et la réinsertion solde le
-- compteur.
--
-- ⚠ Aucun `ALTER TABLE ... RENAME` n'est possible ici : `PRAGMA legacy_alter_table`
--   n'est PAS honoré par workerd (vérifié sur deux tables jetables le 2026-08-02), si
--   bien qu'un renommage réécrit les clauses `REFERENCES factures` des tables filles
--   pour les faire pointer sur l'ancienne table — exactement l'inverse du but.
PRAGMA defer_foreign_keys=ON;

-- Transit sans contrainte ni index : `CREATE TABLE ... AS SELECT` ne reprend ni les
-- clés étrangères ni les valeurs par défaut, ce qui est précisément ce qu'on veut.
CREATE TABLE factures_transit AS SELECT * FROM factures;

DROP TABLE factures;

CREATE TABLE factures (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  boutique_id   INTEGER NOT NULL,
  numero        TEXT,                             -- NULL tant que la facture est un brouillon
  client_id     INTEGER NOT NULL,
  ticket_id     INTEGER,
  devis_id      INTEGER,

  total_ht      REAL    NOT NULL DEFAULT 0,
  total_tva     REAL    NOT NULL DEFAULT 0,
  total_ttc     REAL    NOT NULL DEFAULT 0,
  montant_paye  REAL    NOT NULL DEFAULT 0,

  statut        TEXT    NOT NULL DEFAULT 'emise',

  date_emission  DATETIME DEFAULT CURRENT_TIMESTAMP,
  date_echeance  DATETIME,
  date_paiement  DATETIME,

  hash_nf525    TEXT,

  notes         TEXT,
  conditions    TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  locked        INTEGER NOT NULL DEFAULT 0,
  issued_at     DATETIME,
  tracking_token TEXT,
  type_facture  TEXT    NOT NULL DEFAULT 'normale',
  date_execution    TEXT,
  vendeur_snapshot  TEXT,
  acheteur_snapshot TEXT,
  FOREIGN KEY (boutique_id) REFERENCES boutiques(id),
  FOREIGN KEY (client_id)   REFERENCES clients(id),
  FOREIGN KEY (ticket_id)   REFERENCES tickets(id),
  FOREIGN KEY (devis_id)    REFERENCES devis(id),
  UNIQUE(boutique_id, numero)
);

INSERT INTO factures (
  id, boutique_id, numero, client_id, ticket_id, devis_id, total_ht, total_tva,
  total_ttc, montant_paye, statut, date_emission, date_echeance, date_paiement,
  hash_nf525, notes, conditions, created_at, updated_at, locked, issued_at,
  tracking_token, type_facture, date_execution, vendeur_snapshot, acheteur_snapshot
)
SELECT
  id, boutique_id, numero, client_id, ticket_id, devis_id, total_ht, total_tva,
  total_ttc, montant_paye, statut, date_emission, date_echeance, date_paiement,
  hash_nf525, notes, conditions, created_at, updated_at, locked, issued_at,
  tracking_token, type_facture, date_execution, vendeur_snapshot, acheteur_snapshot
FROM factures_transit;

-- Aucune table fille ne référence le transit : ce DROP ne déclenche aucun contrôle.
DROP TABLE factures_transit;

CREATE INDEX idx_factures_boutique     ON factures(boutique_id);
CREATE INDEX idx_factures_client       ON factures(client_id);
CREATE INDEX idx_factures_statut       ON factures(statut);
CREATE INDEX idx_factures_numero       ON factures(numero);
CREATE INDEX idx_factures_locked       ON factures(locked);
CREATE INDEX idx_factures_type_facture ON factures(type_facture);
CREATE UNIQUE INDEX idx_factures_token ON factures(tracking_token) WHERE tracking_token IS NOT NULL;
