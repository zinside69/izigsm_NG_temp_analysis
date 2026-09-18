-- Migration 0049 — le lien d'une ligne de document vers le service du catalogue (ticket 03 du
-- chantier « la vente lit le catalogue », récit 20)
--
-- Une ligne de vente venue d'un service du catalogue ne gardait que sa désignation : renommer
-- « Pose de film » rendait impossible de compter les poses vendues. La route de caisse acceptait
-- déjà `service_id` sans l'écrire, faute de colonne.
--
-- Ajout de colonne, sans recréation de table (patron de 0040 inutile ici) : les lignes existantes
-- restent intactes, à NULL — on ne rattache pas après coup ce qui a été vendu à la main.
--
-- Aucune clé étrangère, comme `produit_id` sur la même table : une ligne de facture émise est
-- immuable et doit survivre à la suppression du service (le dépôt a déjà payé une FK pendante,
-- migrations 0031/0038). L'appartenance du service à la boutique est contrôlée par la vente.

ALTER TABLE lignes_document ADD COLUMN service_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_lignes_document_service
  ON lignes_document(service_id)
  WHERE service_id IS NOT NULL;
