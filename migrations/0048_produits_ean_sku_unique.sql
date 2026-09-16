-- Migration 0048 — un code-barres, un produit ; un SKU, un produit (décision de l'exploitant
-- du 2026-09-16, chantier « la vente lit le catalogue »)
--
-- Le scan au comptoir suppose qu'un EAN désigne **un seul** produit : la douchette ne pose pas
-- de question, elle ajoute une ligne. Cette règle était jusqu'ici une intention — `code_barre`
-- n'avait ni contrainte ni index, et `sku` portait le commentaire « Code article unique par
-- boutique » (`0005_stocks.sql:20`) sans rien pour le tenir (index `idx_produits_sku` non
-- unique). Deux grossistes référençant la même coque, ou une saisie manuelle doublant un
-- article importé, créaient deux fiches sans que rien ne le signale.
--
-- Partiels, sur le périmètre où la règle a un sens :
--   - `actif = 1` : un produit supprimé (soft delete) ne bloque pas une nouvelle fiche, même
--     patron que `0046` ;
--   - code non nul et non vide : 9 des 804 produits de production n'ont pas de code-barres —
--     sans ce filtre, ils entreraient en conflit **entre eux**, la valeur `NULL` n'étant pas
--     le problème mais la chaîne vide l'étant.
-- Clé préfixée par `boutique_id` : deux boutiques peuvent vendre le même article.
--
-- EAN et SKU restent deux notions distinctes (`CONTEXT.md` § Stock & achats), même si l'import
-- Mobilax renseigne aujourd'hui le SKU avec l'EAN de la pièce : d'où deux index, pas un.
--
-- Prérequis mesuré sur la base de PRODUCTION le 2026-09-16, avant écriture : 804 produits,
-- 795 porteurs d'un EAN, **0 groupe en doublon** sur l'EAN comme sur le SKU, tous états
-- confondus. La création des index passe donc sans échec ; en cas de doublon, elle échouerait
-- atomiquement, sans rien écrire.
--
-- ⚠ Conséquence applicative à traiter : une création de produit qui violerait l'un de ces
-- index remonte désormais une erreur SQL. Les appelants doivent la convertir en message
-- explicite — `importerProduitMobilax()` le fait déjà pour `0046` (`deja_importe`), la
-- création manuelle et l'import CSV ne le font pour aucun des deux.

CREATE UNIQUE INDEX IF NOT EXISTS idx_produits_code_barre_unique
  ON produits(boutique_id, code_barre)
  WHERE actif = 1 AND code_barre IS NOT NULL AND TRIM(code_barre) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_produits_sku_unique
  ON produits(boutique_id, sku)
  WHERE actif = 1 AND sku IS NOT NULL AND TRIM(sku) <> '';
