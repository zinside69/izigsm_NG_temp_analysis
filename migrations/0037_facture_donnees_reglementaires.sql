-- Migration 0037 — Socle de données de la facture électronique (réforme française 2026)
-- Voir docs/superpowers/specs/2026-07-30-factures-creation-manuelle-design.md
--     § Amendement 2026-07-30.
--
-- Les identités vendeur/acheteur sont figées à l'émission : une facture verrouillée
-- (locked=1, CGI art. 289) ne doit plus dépendre des fiches clients/boutiques vivantes,
-- sinon modifier une adresse client réécrit rétroactivement un document déjà émis.

ALTER TABLE factures ADD COLUMN date_execution    TEXT;  -- date de livraison ou d'exécution (socle du 01/09/2026)
ALTER TABLE factures ADD COLUMN vendeur_snapshot  TEXT;  -- JSON figé par emettreFacture()
ALTER TABLE factures ADD COLUMN acheteur_snapshot TEXT;  -- JSON figé par emettreFacture()
