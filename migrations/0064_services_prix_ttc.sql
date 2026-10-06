-- Migration 0064 — Services et prix par modèle en TTC (ticket 04 du chantier prix TTC, 2026-10-06)
--
-- Décision de l'exploitant (Q1) : le prix de vente d'un service, et le prix spécifique d'un service
-- pour un modèle, sont des TTC de référence, stockés, qui font foi ; le HT s'en déduit. Les colonnes
-- HT restent en place : lectures existantes et marche arrière.
--
-- Reprise (Q8) : TTC = HT × (1 + taux / 100), arrondi au centime, par les centimes (HT × (100 + taux),
-- arrondi à l'unité, puis ÷ 100). Un prix par modèle n'a pas de taux propre : celui du service.
-- La colonne `prix_ttc` des services porte le nom que l'API exposait déjà (calculé à la lecture
-- jusqu'ici) : la forme des réponses ne change pas.
--
-- Avant de l'appliquer en production : jouer scripts/sql/prix-ttc-non-ronds-services.sql (lecture
-- seule) et remettre la liste des TTC « non ronds » à l'exploitant.
--
-- Marche arrière :
--   ALTER TABLE service_modeles DROP COLUMN prix_ttc_specifique;
--   ALTER TABLE services DROP COLUMN prix_ttc;

ALTER TABLE services ADD COLUMN prix_ttc REAL NOT NULL DEFAULT 0;

UPDATE services
SET prix_ttc = ROUND(prix_ht * (100 + tva_taux)) / 100.0;

-- NULL = pas de prix spécifique (le prix du service s'applique) : laissé NULL
ALTER TABLE service_modeles ADD COLUMN prix_ttc_specifique REAL;

UPDATE service_modeles
SET prix_ttc_specifique = (
  SELECT ROUND(service_modeles.prix_ht_specifique * (100 + services.tva_taux)) / 100.0
  FROM services
  WHERE services.id = service_modeles.service_id
)
WHERE prix_ht_specifique IS NOT NULL;
