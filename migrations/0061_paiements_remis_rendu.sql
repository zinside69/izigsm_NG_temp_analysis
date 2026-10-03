-- Migration 0061 : montant remis et rendu monnaie conservés sur le paiement en espèces
-- (recette 002 C, décision de l'exploitant du 2026-10-03).
--
-- Jusqu'ici, la caisse calculait le rendu pour l'afficher au vendeur, puis l'oubliait : ni le montant
-- remis par le client ni la monnaie rendue n'étaient gardés. Ils le sont désormais sur la ligne
-- `paiements` de la part payée en espèces (une vente « mixte » écrit une ligne par part, recette 002 B).
--
-- Deux colonnes ajoutées en fin de table, NULL par défaut : les paiements existants et ceux qui ne
-- sont pas en espèces restent à NULL. Le montant enregistré du paiement (`montant`) ne change pas de
-- sens : c'est toujours la somme due pour cette part, jamais le montant remis.
--
-- Hors des données hashées NF525 (le journal d'une vente hashe type, numéro, montant total, date et
-- hash précédent) : aucune incidence sur la chaîne. Aucune recréation de table.

ALTER TABLE paiements ADD COLUMN montant_remis REAL;   -- espèces remises par le client (NULL sinon)
ALTER TABLE paiements ADD COLUMN rendu_monnaie REAL;   -- monnaie rendue = remis − part en espèces
