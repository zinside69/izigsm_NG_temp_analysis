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

## Statut — clôture du chantier, 2026-07-31

**Cet audit avait un faux négatif systématique.** Sa méthode (étape 2) écartait toute route dont le
**fichier entier** portait un signal d'isolation quelque part (`boutique_id !==`, `assertBoutiqueOwnership`,
`getBoutiqueId`, `boutique_id = ?`), sans vérifier que ce signal apparaissait dans **le handler examiné**.
Résultat : dès qu'un fichier contenait *quelques* routes correctement gardées, ses routes non gardées
disparaissaient de la liste des 47 suspectes puis des 18 candidates — l'exemple le plus net est
`getDevis(db, id)` (`devisService.ts`) qui *mentionne* `boutique_id` dans son `SELECT` sans jamais filtrer
dessus : les 5 routes voisines du sous-système devis (`GET /devis/:id`, `PUT /devis/:id`,
`PUT /devis/:id/statut`, `POST /devis/:id/accord-manuel`, `POST /devis/:id/envoyer`) ont été écartées à
tort par cette méthode, alors que `PUT /devis/:id/convertir` — corrigée la veille, à 20 lignes de là —
portait pourtant un commentaire explicite référençant cette même faille de conversion.

Le tableau ci-dessous compte les occurrences des 4 signaux dans le **fichier entier** (pas par handler),
qui montre l'ampleur du masquage :

| Fichier | Occurrences des 4 signaux dans le fichier entier | Routes non gardées masquées |
|---|---|---|
| `facturation.ts` | 17 | 5 (devis) |
| `tickets.ts` | 14 | 2 (photos) |
| `fournisseurs.ts` | 11 | 2 (bons de commande) |
| `clients.ts` / `stocks.ts` | 10 | 1 + 1 |
| `personnel.ts` / `services.ts` | 8 | 1 + 5 |
| `rachats.ts` | 4 | 2 |
| `agenda.ts` | **0** | 4 (écarté par un mécanisme distinct, voir ci-dessous) |

`agenda.ts` n'a pas été masqué par ce mécanisme (0 occurrence) mais par un second angle mort de l'étape 3 :
son service filtre bien `WHERE id = ? AND boutique_id = ?` en SQL, ce qui l'a fait classer comme « la
fonction de service filtre par boutique en interne » — sans vérifier que la valeur de `boutique_id`
injectée dans ce filtre était fiable. Elle ne l'était pas : les 4 routes lisaient `boutique_id` brut depuis
la query/le body de l'appelant, jamais dérivé du JWT via `getBoutiqueId()`.

**C'est le test de conformité statique (`tests/routes-isolation-conformite.test.ts`, écrit après cet audit,
tâche 7 du chantier), pas cet audit, qui a permis de trouver le compte réel.** En analysant chaque handler
individuellement plutôt que le fichier dans son ensemble, et en n'acceptant que des patrons de dérivation
fiable de `boutique_id` (jamais la simple présence d'un filtre SQL en aval), il a révélé **23 routes
vulnérables supplémentaires** au-delà des 18 candidates de cet audit — dont les 17 confirmées ici (une
exemption légitime sur les 18 : `DELETE /employes/:id`, `admin`-only par conception).

**Bilan final : 36 routes gardées** (17 des 18 candidates de cet audit, plus les 23 trouvées ensuite par le
garde-fou de conformité — le détail exact route par route, tâche par tâche, est dans
`.superpowers/sdd/2026-07-31-isolation-routes-par-id/task-7-report.md` et `progress.md`), réparties en
produits (3), employés + pointage (4), archivage ticket (1), fournisseurs (3), bons de commande (3),
catégories de services (2), rachats (2), devis (5), agenda (4), catalogue services (3), liaisons
service↔modèle (2), photos de tickets (2), mouvement de stock (1), appareils client (1) — plus 4 routes du
référentiel global marques/modèles passées de `requireRole('admin','manager')` à `requireRole('admin')`
(gouvernance, pas isolation : ces tables n'ont plus de `boutique_id` depuis la migration 0031).

125 tests e2e (`tests/e2e/isolation-routes.spec.ts`, 3 cas par route). Le test de conformité est désormais
**vert**, `EXEMPTIONS` compte 7 entrées motivées (`admin-only`, `referentiel-global`, `public`). Une faille
d'objet imbriqué a aussi été fermée au passage : `GET /:id/photos/:photoId/view` vérifiait l'appartenance du
ticket à la boutique, mais pas celle de la photo demandée au ticket de l'URL.

Détail exhaustif : `project-docs/bugs.md` (entrée en tête de fichier),
`.superpowers/sdd/2026-07-31-isolation-routes-par-id/task-7-report.md` (classement des 28 routes remontées
au premier lancement du garde-fou) et `progress.md` (journal des 14 tâches). Dette non liée à l'isolation
découverte en route : `project-docs/todo.md`. **Non déployé.**
