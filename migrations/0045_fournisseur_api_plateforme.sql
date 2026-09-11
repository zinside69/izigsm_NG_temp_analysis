-- Migration 0045 — plateforme d'API d'un fournisseur (ticket 03, chantier integration-mobilax)
--
-- La clé API d'un fournisseur vit sur une ligne `fournisseurs` quelconque (ticket 01, aucun
-- traitement spécial Mobilax). Le service de recherche Mobilax doit pourtant savoir QUEL
-- fournisseur de la boutique est Mobilax : décision du 2026-09-11, une colonne explicite
-- plutôt qu'un nom deviné (« mobilax » dans `nom`, fragile au premier renommage).
--
-- Valeurs : 'mobilax' ou NULL. Liste blanche tenue par `validateFournisseur()` — aucun autre
-- grossiste n'est branché. Ajout de colonne nullable : aucune donnée réécrite.

ALTER TABLE fournisseurs ADD COLUMN api_plateforme TEXT;
