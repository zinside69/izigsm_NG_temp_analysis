-- Migration 0068 — Avoirs : lignes en TTC, avoirs de la clôture, factures couvertes annulées
-- (ticket 01 du chantier avoirs, 2026-10-08 ; décisions Q5, Q9, Q10, Q14, Q15 de l'exploitant du 2026-10-06)
--
-- 1. Une ligne d'avoir garde son prix unitaire TTC et dit comment elle a été calculée, comme une ligne de
--    facture (migration 0063) — pour imprimer un avoir avec les prix que le client a vus.
--    Toutes les lignes existantes ont été calculées en HT.
-- 2. La clôture du jour sépare les avoirs émis des ventes : trois colonnes, à 0 pour les clôtures passées
--    (seule la n° 1 du 03/10 existe en production, sans avoir). Écrites par le ticket 02.
-- 3. Reprise : une facture entièrement couverte par ses avoirs passe à l'état « annulee ». Seule la
--    colonne d'état change ; contenu, numéro, identités figées et chaînage NF525 de la facture restent
--    intacts. En production : FAC-2026-00009 (couverte par AV-2026-00001). Comparaison en centimes.
--    Une facture partiellement couverte n'est pas touchée.
--
-- Marche arrière :
--   UPDATE factures SET statut = 'en_attente' WHERE numero = 'FAC-2026-00009';  -- état d'avant, relu le 2026-10-06
--   ALTER TABLE clotures_journalieres DROP COLUMN avoirs_ttc;
--   ALTER TABLE clotures_journalieres DROP COLUMN avoirs_tva;
--   ALTER TABLE clotures_journalieres DROP COLUMN avoirs_ht;
--   ALTER TABLE lignes_avoir DROP COLUMN mode_calcul;
--   ALTER TABLE lignes_avoir DROP COLUMN prix_unitaire_ttc;

ALTER TABLE lignes_avoir ADD COLUMN prix_unitaire_ttc REAL;

ALTER TABLE lignes_avoir ADD COLUMN mode_calcul TEXT NOT NULL DEFAULT 'ht'
  CHECK (mode_calcul IN ('ttc', 'ht'));

ALTER TABLE clotures_journalieres ADD COLUMN avoirs_ht  REAL NOT NULL DEFAULT 0;
ALTER TABLE clotures_journalieres ADD COLUMN avoirs_tva REAL NOT NULL DEFAULT 0;
ALTER TABLE clotures_journalieres ADD COLUMN avoirs_ttc REAL NOT NULL DEFAULT 0;

UPDATE factures
SET    statut = 'annulee'
WHERE  factures.id IN (
  SELECT facture_couverte.id
  FROM   factures AS facture_couverte
  JOIN   avoirs   AS avoir_de_la_facture ON avoir_de_la_facture.facture_id = facture_couverte.id
  -- Seulement les factures émises, pas déjà annulées
  WHERE  facture_couverte.locked = 1
    AND  facture_couverte.statut <> 'annulee'
  GROUP BY facture_couverte.id
  -- Somme des avoirs (en centimes) ≥ total TTC de la facture (en centimes)
  HAVING SUM(ROUND(avoir_de_la_facture.total_ttc * 100)) >= ROUND(facture_couverte.total_ttc * 100)
);
