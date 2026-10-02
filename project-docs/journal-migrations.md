# Journal des migrations — base de production iziGSM

> Créé le 2026-10-02 (demande de l'exploitant : pouvoir faire marche arrière). **Source des dates :
> `d1_migrations` distant, relu — jamais recopié d'un checkpoint.** Heures en **UTC** (heure de Paris
> = UTC + 2 en été, + 1 en hiver). Base : `DB` (`1e5c6e26-6b55-4b00-bf83-72ba26b6b112`).
>
> **Tenue** : `modop-deploiement.md` étape 5 — à chaque application à distance, ajouter une ligne
> par migration (date relue), son SQL inverse, et relever le point de restauration Time Travel
> **d'avant** l'application. Historique **cumulatif** : on ajoute en bas, on ne réécrit jamais.

## Comment revenir en arrière — deux moyens, à choisir selon le cas

### A. Inverse ciblé (SQL) — défaire une migration, garder les données écrites depuis

À préférer. Exécuter les instructions de la colonne « Inverse » **de la plus récente vers la plus
ancienne**, puis supprimer la ligne correspondante de `d1_migrations`
(`DELETE FROM d1_migrations WHERE name = '…'`), sinon wrangler la croira toujours appliquée.

- **Le code déployé doit d'abord être revenu à une version qui n'utilise plus la colonne** : un
  Worker qui lit une colonne supprimée tombe en `no such column` (règle inverse de « migrations
  avant le code »). Donc : code d'abord, schéma ensuite.
- SQLite refuse `DROP COLUMN` sur une colonne indexée : supprimer **l'index d'abord** (l'ordre de
  la colonne « Inverse » le respecte).
- `DROP COLUMN` / `DROP TABLE` **détruit les données** de cette colonne ou table depuis
  l'application (ex. IMEI saisis, clés d'ajout au stock). À faire en connaissance de cause.

### B. Time Travel — remettre TOUTE la base à un instant (30 jours de profondeur)

```
npx wrangler d1 time-travel restore DB --bookmark=<point de restauration>
```

⚠ **Efface tout ce qui a été écrit après ce point** : ventes, factures (et donc écritures
`journal_nf525`), tickets, clients. Sur une base de caisse NF525, une restauration qui ferait
disparaître des transactions émises est un **incident de conformité** : ne s'envisage que si la
base est inutilisable, et juste après la migration fautive. Relever d'abord le point courant
(`npx wrangler d1 time-travel info DB`) pour pouvoir annuler la restauration elle-même.

## Points de restauration relevés

| Relevé le (UTC) | Instant visé | Bookmark | Ce que la restauration défait |
|---|---|---|---|
| 2026-10-02 | 2026-10-02 07:35:00 (juste **avant** 0048) | `000001c4-00000002-000050f8-25602a57763efcd3b4ef21a870d170dd` | les 5 migrations du 2026-10-02 **et** toute écriture postérieure |
| 2026-10-02 | courant, juste **après** 0054 (code v3.11 encore en production) | `000001c5-0000000c-000050f8-45d15518bccc04d9680ec454ba21eca7` | toute écriture postérieure à la migration (garde le nouveau schéma) |

## Migrations appliquées — chronologie

`R` = migration qui **recrée** une table (patron de transit) : son inverse SQL n'est pas trivial,
seul Time Travel (s'il est dans les 30 jours) ou une migration inverse écrite et testée la défait.

| # | Migration | Appliquée (UTC) | Effet | R | Inverse |
|---|---|---|---|---|---|
| 1–31 | `0001` → `0031` (schéma initial et sprints 2.x) | 2026-07-08 15:52 | tables fondatrices : utilisateurs, boutiques, clients, tickets, stock, facturation, NF525, personnel, services, fournisseurs, agenda, SAV, emails, référentiel marques/modèles | 0019, 0031 | hors délai Time Travel ; non réversible sans perte |
| 32 | `0032_backfill_slug_soteli_desk1` | 2026-07-11 15:37 | données : slugs manquants | | — (données) |
| 33 | `0033_ticket_prise_en_charge` | 2026-07-11 16:16 | colonnes de prise en charge sur `tickets` | | hors délai |
| 34 | `0034_numero_unique_par_boutique` | 2026-07-12 14:22 | unicité des numéros par boutique | R | hors délai |
| 35 | `0035_clients_type_societe` | 2026-07-15 21:43 | clients société | | hors délai |
| 36 | `0036_acompte_structure` | 2026-07-17 14:56 | acompte structuré | | hors délai |
| 37 | `0037_facture_donnees_reglementaires` | 2026-07-31 07:23 | `date_execution`, instantanés vendeur / acheteur | | hors délai |
| 38 | `0038_service_modeles_fk_reconstruction` | 2026-07-31 15:06 | réparation de la FK de `0031` | R | hors délai |
| 39 | `0039_journal_actions_plateforme` | 2026-08-01 14:42 | journal des actions de plateforme (ADR 0001) | | hors délai |
| 40 | `0040_facture_numero_nullable` | 2026-08-02 16:39 | numéro de facture nullable (brouillons) | R | hors délai |
| 41 | `0041_fournisseurs_api_key_chiffree` | 2026-09-11 08:09 | clé API fournisseur chiffrée | | hors délai |
| 42 | `0042_boutique_settings_taux_marge` | 2026-09-11 08:09 | taux de marge par famille | | hors délai |
| 43 | `0043_email_logs_types_livre_relance_devis` | 2026-09-11 13:36 | CHECK de `email_logs.type` élargi | R | hors délai |
| 44 | `0044_bon_commande_date_paiement` | 2026-09-11 15:45 | `bons_commande.date_paiement` | | hors délai |
| 45 | `0045_fournisseur_api_plateforme` | 2026-09-11 18:12 | `fournisseurs.api_plateforme` | | hors délai |
| 46 | `0046_produits_source_fournisseur_unique` | 2026-09-12 12:33 | index unique pièce fournisseur | | hors délai |
| 47 | `0047_boutique_settings_defauts_stock` | 2026-09-12 17:39 | seuil / stock initial par défaut | | hors délai |
| 48 | `0048_produits_ean_sku_unique` | **2026-10-02 07:35:24** | index uniques code-barres et SKU par boutique (0 doublon vérifié avant) | | `DROP INDEX idx_produits_sku_unique;` `DROP INDEX idx_produits_code_barre_unique;` |
| 49 | `0049_lignes_document_service_id` | **2026-10-02 07:35:24** | `lignes_document.service_id` + index | | `DROP INDEX idx_lignes_document_service;` `ALTER TABLE lignes_document DROP COLUMN service_id;` |
| 50 | `0050_produits_mobilax_id` | **2026-10-02 07:35:25** | `produits.mobilax_id` + index unique | | `DROP INDEX idx_produits_mobilax_id;` `ALTER TABLE produits DROP COLUMN mobilax_id;` |
| 51 | `0051_ajouts_stock_import` | **2026-10-02 07:35:25** | table `ajouts_stock_import` (idempotence « Ajouter N au stock ») | | `DROP TABLE ajouts_stock_import;` |
| 52 | `0054_produits_imei_factures_appareils` | **2026-10-02 07:35:25** | `produits.imei` + index unique ; `factures.appareils_snapshot` | | `DROP INDEX idx_produits_imei_unique;` `ALTER TABLE produits DROP COLUMN imei;` `ALTER TABLE factures DROP COLUMN appareils_snapshot;` ⚠ voir ci-dessous |

⚠ **`factures.appareils_snapshot` est écrit au figeage NF525** (vente POS émise) : une facture émise
est inaltérable, la supprimer revient à effacer une partie d'un document légal. **Ne jamais défaire
cette colonne** une fois qu'une vente portant un appareil a été émise — vérifier d'abord :
`SELECT COUNT(*) FROM factures WHERE appareils_snapshot IS NOT NULL`.

Numéros **réservés, pas encore écrits** (le trou 0052–0053 est voulu) : `0052` ticket 05, `0053`
ticket 06, `0055` 08b, `0056` 09, `0057` 11, `0058` 14 (sans objet), `0059` 16.

## Vérification d'état (lecture seule, à rejouer à tout moment)

```
npx wrangler d1 execute DB --remote --command "SELECT id, name, applied_at FROM d1_migrations ORDER BY id DESC LIMIT 5"
```
Lancer sans `CLOUDFLARE_API_TOKEN` dans le shell (erreur `7403` sinon).
