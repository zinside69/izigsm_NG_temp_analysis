# Isolation multi-tenant des routes par ID — Design

_2026-07-31 — fait suite à `project-docs/audit-isolation-2026-07-31.md` et à la correction
des 5 endpoints facture/avoir (`project-docs/bugs.md`)._

## Problème

Treize routes chargent une ressource par son identifiant sans jamais vérifier qu'elle
appartient à la boutique de l'appelant. Toutes sont ouvertes aux rôles `admin` **et**
`manager` : n'importe quel compte client peut donc les exploiter contre une autre boutique.
Trois vérifiées à la main pendant l'audit, dix confirmées en seconde passe.

Ce n'est pas le premier épisode. Trois campagnes de correction ont déjà eu lieu — tickets
(2026-07-19), devis (2026-07-30), facture/avoir (2026-07-31) — et chacune a traité les
routes connues au moment de la découverte en laissant les voisines. `POST /tickets/:id/archiver`
en est la preuve : elle est restée ouverte dans un fichier pourtant audité en juillet.

**Le problème à résoudre n'est donc pas « ces treize routes », c'est « rien n'empêche la
quatorzième ».**

## Périmètre

### A. Garde d'appartenance (13 routes)

| Route | Fichier | Table |
|---|---|---|
| `GET /fournisseurs/:id` | `fournisseurs.ts:88` | `fournisseurs` |
| `PUT /fournisseurs/:id` | `fournisseurs.ts:97` | `fournisseurs` |
| `DELETE /fournisseurs/:id` | `fournisseurs.ts:111` | `fournisseurs` |
| `PATCH /bons-commande/:id/statut` | `fournisseurs.ts:162` | `bons_commande` |
| `GET /employes/:id` | `personnel.ts:49` | `employes` |
| `PUT /employes/:id` | `personnel.ts:80` | `employes` |
| `GET /pointage/:employeId/aujourd-hui` | `personnel.ts:126` | `pointages` |
| `PUT /services/categories/:id` | `services.ts:176` | `categories_services` |
| `DELETE /services/categories/:id` | `services.ts:199` | `categories_services` |
| `GET /produits/:id` | `stocks.ts:98` | `produits` |
| `PUT /produits/:id` | `stocks.ts:173` | `produits` |
| `DELETE /produits/:id` | `stocks.ts:193` | `produits` |
| `POST /tickets/:id/archiver` | `tickets.ts:135` | `tickets` |

### B. Changement de rôle (3 routes)

`PUT /services/marques/:id`, `PUT /services/modeles/:id`, `DELETE /services/modeles/:id`
passent de `requireRole('admin','manager')` à `requireRole('admin')`.

Justification : la migration `0031_marques_modeles_global.sql` (Sprint 2.39) a délibérément
rendu ces tables **globales**, sans `boutique_id`. Ce n'est donc pas un problème d'isolation
mais de gouvernance : aujourd'hui, un manager peut renommer ou désactiver une entrée du
référentiel partagé par toutes les boutiques. Le référentiel est alimenté par API
(`brand_slug`, `source: 'api'`) — c'est un catalogue de référence, pas une donnée client.

### C. Exemptions, avec motif écrit

| Route | Motif |
|---|---|
| `DELETE /employes/:id` (`personnel.ts:92`) | `requireRole('admin')` seul — l'admin plateforme traverse par conception |
| `GET /services/modeles/:id/services` (`services.ts:518`) | lecture d'un référentiel volontairement global |

### Hors périmètre

Migration de l'isolation vers le SQL des services · colonne `boutique_id` nullable pour des
modèles custom par boutique · refonte du seed · **console d'administration superadmin**
(chantier produit distinct, voir § Accès superadmin).

## Solution

### Patron de correction

Identique aux 7 routes déjà traitées le 2026-07-31 :

```ts
const data = await getRessource(c.get('db'), id)
const deny = assertBoutiqueOwnership(c.get('user'), data, 'Libellé')
if (deny) return c.json({ success: false, error: deny.error }, deny.status)
```

Quand le service ne renvoie pas `boutique_id`, la route fait une lecture ciblée
(`SELECT boutique_id FROM <table> WHERE id = ?`), comme sur `POST /factures/:id/paiement`.

`assertBoutiqueOwnership()` (`src/lib/middleware.ts`) renvoie `404` si la ressource est
absente, `403` si elle appartient à une autre boutique, et laisse passer le rôle `admin`.

### Garde-fou — test de conformité

C'est la partie qui distingue ce chantier des trois précédents.

Un test exécuté par `vitest` parse `src/routes/*.ts`, recense les handlers dont le chemin
porte un paramètre d'identifiant, et **échoue** si l'un d'eux n'a ni garde d'isolation ni
inscription sur une liste d'exemptions. Chaque exemption porte un motif (`'admin-only'`,
`'referentiel-global'`, `'public'`).

Contrainte de conception tirée de l'audit : le détecteur doit reconnaître les ressources
qui s'identifient par `id` et non par `boutique_id` — c'est le cas de `boutiques.ts`, que
le script d'audit initial n'a pas su voir (ses 8 routes sont en réalité correctement
protégées, mais rien ne l'aurait signalé si elles ne l'avaient pas été).

Effet recherché : une nouvelle route `/:id` sans garde casse la suite avant d'atteindre la
production, au lieu d'attendre le prochain audit.

### Accès superadmin

Chaque domaine corrigé reçoit un test vérifiant que **le rôle `admin` accède bien aux
ressources de n'importe quelle boutique**. La capacité de dépannage existe déjà (elle
découle de `user.role !== 'admin'` dans le helper) ; ces tests la transforment en garantie,
pour qu'une correction future ne la supprime pas silencieusement.

La console d'administration (page listant boutiques, comptes et activité) fait l'objet
d'une spec distincte. L'API nécessaire existe déjà — `GET /api/boutiques`, `GET /api/users`,
`GET /api/boutiques/:id/stats` — seule l'interface manque.

### Nommage de la clé primaire de `boutiques`

Question soulevée en revue : `boutiques.id` ne devrait-il pas s'appeler `boutique_id`, par
cohérence avec les 6 585 clés étrangères du même nom et pour lever l'ambiguïté au dépannage ?

Décision : **garder `id`**. La convention PK = `id` / FK = `<table>_id` s'applique à 46 des
55 tables ; renommer cette seule table créerait une exception que le lecteur devrait retenir,
et imposerait de recréer une table de production référencée par des clés étrangères. Le
bénéfice de lisibilité est obtenu autrement, par un invariant : **toute requête exposant
cette clé primaire l'aliase** (`SELECT b.id AS boutique_id`). Les 38 emplacements concernés
sont dans 10 services et leurs 10 fichiers de tests.

## Tests

Nouveau fichier `tests/e2e/isolation-routes.spec.ts`, RED avant toute correction.

Pour chaque domaine, trois cas :
1. un `manager` d'une autre boutique est refusé (`403` ou `404`) ;
2. le propriétaire légitime accède normalement (`200`) ;
3. l'`admin` plateforme accède normalement (`200`).

Le cas 2 n'est pas optionnel : cinq tests de refus resteraient tous verts avec une garde
trop stricte qui renverrait `403` aux ayants droit — situation rencontrée et évitée de
justesse lors de la correction des factures le même jour.

**Fixtures.** `seed.sql` fournit `employes` (3 lignes) et `produits` (9 lignes) sur la
boutique 1 ; ces domaines s'appuient dessus. `fournisseurs`, `bons_commande` et
`categories_services` n'ont aucune donnée de départ : leurs fixtures créent la ressource
côté boutique 1 via l'API avec le compte seed, sur le modèle de `createBoutique1Devis()`.

## Critères de succès

- Les 13 routes renvoient `403` à un `manager` étranger et `200` à leur propriétaire
- Les 3 routes du référentiel renvoient `403` à un `manager`, `200` à un `admin`
- Le test de conformité échoue si l'on retire une garde au hasard (vérifié explicitement)
- `npx vitest run` : 855/857 (baseline des 2 échecs de fuseau d'`agendaService`)
- `npx tsc --noEmit` : 32 erreurs (baseline inchangée)
- Playwright : suite complète verte, 18 cas existants inclus

## Risques

**Sur-restriction.** Une garde trop stricte casse un usage légitime sans qu'aucun test de
refus ne le signale. Couvert par les cas 2 et 3 de chaque domaine.

**Faux sentiment de couverture.** Le test de conformité ne prouve que la *présence* d'une
garde, jamais sa justesse — une garde présente mais fausse le satisfait. Il complète les
tests de comportement, il ne les remplace pas.

**Régression sur `bons_commande`.** La table porte `boutique_id`, mais `PATCH
/bons-commande/:id/statut` délègue à `updateStatutBonCommande()` qui applique déjà des
règles de transition d'état. La garde doit précéder l'appel au service, sans modifier ces
règles.
