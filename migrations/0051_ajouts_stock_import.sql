-- Migration 0051 — ajouts_stock_import : « Ajouter N au stock » idempotent côté serveur
-- (ticket 18 du chantier `vente-lit-catalogue`, point 1 de la relecture du 2026-09-24)
--
-- Le second clic n'était empêché que par l'écran. Réponse perdue (réseau), bouton rendu,
-- opérateur qui reclique : le serveur ajoutait une seconde fois (4 → 9 → 14). L'écran tire
-- désormais une clé aléatoire par offre ; `ajouterStockPieceImportee()` la RÉSERVE ici avant
-- d'écrire le mouvement, et la même clé rejouée rend le premier résultat sans rien rajouter.
--
-- Clé primaire `(boutique_id, cle)` : la réservation se fait par `INSERT OR IGNORE` — deux
-- requêtes simultanées portant la même clé, une seule passe. Préfixée par la boutique : une clé
-- n'a de sens que chez celle qui l'a tirée.
--
-- `stock_avant` / `stock_apres` NULL = ajout réservé mais pas (ou pas entièrement) écrit. Une
-- telle clé n'est jamais libérée : le mouvement n'est pas atomique (stock écrit avant le
-- journal), la rejouer pourrait doubler un stock déjà bougé. Elle répond « vérifiez le stock ».
--
-- Aucune clé étrangère (ni produit, ni utilisateur) : la trace d'un ajout doit survivre à un
-- produit supprimé ou à un compte retiré — même choix que le journal de plateforme (0039).
-- Table neuve, aucune reprise.

CREATE TABLE IF NOT EXISTS ajouts_stock_import (
  boutique_id  INTEGER  NOT NULL,
  cle          TEXT     NOT NULL,
  produit_id   INTEGER  NOT NULL,
  quantite     INTEGER  NOT NULL,
  user_id      INTEGER  NOT NULL,
  stock_avant  INTEGER,
  stock_apres  INTEGER,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (boutique_id, cle)
);
