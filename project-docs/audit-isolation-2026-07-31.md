# Audit d'isolation multi-tenant — toutes les routes par ID (2026-07-31)

Déclenché par la correction des 5 endpoints facture/avoir (`bugs.md`), sur la question
« est-ce que le reste de l'application est isolé ? ». **Audit statique, lecture seule,
aucun code modifié.**

## Méthode

1. Extraction de tous les handlers `src/routes/*.ts` dont le chemin contient un paramètre
   d'ID (`:id`, `:employeId`, `:photoId`…) → **84 routes**.
2. Élimination de celles portant un signal d'isolation dans le handler
   (`boutique_id !==`, `assertBoutiqueOwnership`, `getBoutiqueId`, `boutique_id = ?`)
   → **47 suspectes**.
3. Croisement avec le schéma (`migrations/*.sql`) pour ne garder que les routes touchant
   une table réellement multi-tenant (39 tables portent `boutique_id`), **et** dont la
   fonction de service appelée ne filtre pas non plus par boutique en interne
   → **18 candidates**.

Limite assumée : analyse syntaxique, pas d'exécution. Le taux de confirmation par lecture
directe est de **3/3** (voir ci-dessous), mais les 15 autres n'ont pas été vérifiées une
par une.

## Vérifiées manuellement — faille confirmée

| Route | Fichier | Appel de service | Effet |
|---|---|---|---|
| `GET /produits/:id` | `stocks.ts:98` | `getProduitById(dbPort, id)` | lecture prix d'achat, CUMP, marge, fournisseur d'une autre boutique |
| `PUT /employes/:id` | `personnel.ts:80` | `updateEmploye(db, id, body)` | modification de la fiche d'un employé d'une autre boutique (données RH) |
| `POST /tickets/:id/archiver` | `tickets.ts:135` | `archiveTicket(db, id, user.sub)` | archivage du ticket d'une autre boutique — **route oubliée par la campagne de correction du 2026-07-19** sur ce même fichier |

## Vérification complète (2026-07-31, seconde passe)

**Les 18 candidates ont été relues une par une. 17 sont des failles exploitables.**

Seule exception : `DELETE /employes/:id` (`personnel.ts:92`) est en `requireRole('admin')`
**seul** — donc réservé à l'admin plateforme, qui traverse les boutiques par conception.
Ce n'est pas une faille. Les 17 autres sont ouvertes à `admin` **et** `manager` : n'importe
quel compte client peut donc les exploiter contre une autre boutique.

Répartition par domaine : fournisseurs (3), bons de commande (1), personnel/RH (2),
catalogue services (6), stock (3), tickets (1), plus les 2 produits déjà listés.

Note de couverture de test : `seed.sql` ne fournit de données que pour `employes` (3) et
`produits` (9). Les domaines fournisseurs / catégories / marques / modèles / bons de commande
n'ont aucune donnée de départ — un test RED sur ces routes impose de créer chaque ressource
via l'API au préalable.

## Détail des candidates (les 15 de la première passe)

| Route | Fichier | Tables concernées |
|---|---|---|
| `GET /fournisseurs/:id` | `fournisseurs.ts:88` | `fournisseurs` |
| `PUT /fournisseurs/:id` | `fournisseurs.ts:97` | `fournisseurs` |
| `DELETE /fournisseurs/:id` | `fournisseurs.ts:111` | `fournisseurs` |
| `PATCH /bons-commande/:id/statut` | `fournisseurs.ts:162` | `bons_commande` |
| `GET /employes/:id` | `personnel.ts:49` | `employes`, `pointages` |
| `DELETE /employes/:id` | `personnel.ts:92` | `employes` |
| `GET /pointage/:employeId/aujourd-hui` | `personnel.ts:126` | `pointages` |
| `PUT /services/categories/:id` | `services.ts:176` | `categories_services` |
| `DELETE /services/categories/:id` | `services.ts:199` | `services`, `categories_services` |
| `PUT /services/marques/:id` | `services.ts:454` | `marques_appareils` |
| `PUT /services/modeles/:id` | `services.ts:494` | `modeles_appareils` |
| `DELETE /services/modeles/:id` | `services.ts:504` | `modeles_appareils` |
| `GET /services/modeles/:id/services` | `services.ts:518` | `modeles_appareils` |
| `PUT /produits/:id` | `stocks.ts:173` | `produits` |
| `DELETE /produits/:id` | `stocks.ts:193` | `produits` |

## Lecture d'ensemble

Le problème n'est pas une route en particulier, c'est **structurel** : rien dans
l'architecture n'oblige une route `/:id` à vérifier l'appartenance. Chaque campagne de
correction (tickets le 2026-07-19, devis le 2026-07-30, facture/avoir le 2026-07-31) a
traité les routes connues au moment de la découverte, et laissé les voisines — `POST
/tickets/:id/archiver` en est la démonstration : corrigée nulle part, dans un fichier
pourtant audité.

Deux pistes de fond, à trancher par l'utilisateur (aucune n'est engagée) :
- **Helper systématique** : généraliser `assertBoutiqueOwnership()` (`src/lib/middleware.ts`)
  à toutes les routes par ID. Simple, mais repose toujours sur la vigilance du développeur.
- **Garde par défaut** : un middleware qui refuse par construction toute route `/:id` non
  explicitement déclarée comme non-tenant. Inverse la charge de la preuve — coûteux à
  mettre en place, mais ferme la classe entière.

## Statut

Rien n'est corrigé. Aucune de ces 18 routes n'a été modifiée par cet audit.
