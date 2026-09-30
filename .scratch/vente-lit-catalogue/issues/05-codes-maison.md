---
id: 05
titre: Codes maison (produits créés hors import, services)
statut: ready-for-agent
bloque-par: [01, 03, 04]
---

# 05 — Codes maison

## Contexte

Tout produit créé hors import fournisseur reçoit automatiquement un **code maison**, visible et
cherchable dans sa fiche ; un bouton permet d'en générer un pour un produit qui n'en a pas. Les
services peuvent en recevoir un aussi, pour la planche de codes du comptoir, et un service scanné
s'ajoute à la vente. Un article qui porte déjà l'EAN de son fournisseur n'en reçoit jamais.
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 24 à 29 ; décision « Codes maison ») ;
vocabulaire `CONTEXT.md` (Code maison).

Bloqué par 01 et 03 (**done**) et par **04** (douchette en caisse), ajouté le 2026-09-30 : c'est le 04
qui fait qu'un **service scanné** ajoute sa ligne en caisse (décision de découpe ci-dessous) et qui
fournit la route de scan que ce ticket étend aux services.

**Ne touche ni la caisse ni le NF525** (règle de l'exploitant du 2026-09-30) : aucune ligne de
`caisse.js` ni de `caisse.html`, aucune écriture de vente ni de `journal_nf525`. → **confié au socle.**
Il ajoute une **migration** (`0052`), qui rejoint le lot 1 en attente de déploiement.

_Mis au format du modèle le 2026-09-30. Ancien en-tête : `**Status:** ready-for-agent`,
`**Blocked by:** 01, 03`._

### Décisions de l'exploitant du 2026-09-30

1. **Un SKU qui est un EAN-13 valide dispense du code maison.** L'exploitant tape l'EAN du
   fournisseur dans le SKU, faute de champ code-barres ; le scan le trouve déjà par ce SKU (égalité
   stricte du ticket 04). Poser un code maison en plus donnerait deux codes au même article
   (story 26). « EAN-13 valide » = exactement 13 chiffres **et** clé juste. SKU libre
   (`ECR-IP12`), SKU à clé fausse, ou SKU absent → code maison posé.
2. **Découpe** : l'ajout en caisse d'un service scanné est porté par le **ticket 04** (le scan y
   traite un résultat `service` comme le sélecteur). Ce ticket-ci ne touche donc pas `caisse.js` et
   part au socle ; son E2E de caisse tourne dans le contrôle `e2e` du socle.

### Relecture de conception du 2026-09-30

- **Deux chemins de création, pas un.** L'import CSV a son propre `INSERT` (`importCatalogueCsv()`,
  `stockService.ts`), distinct de `createProduit()`. La pose du code passe par **une fonction
  commune** appelée par les deux — ⊥ une seconde copie de la règle.
- **L'identifiant n'existe qu'après l'`INSERT`** : le code est posé par une écriture qui suit. Non
  atomique, assumé : un échec laisse un produit **sans** code, jamais un produit au code faux, et
  l'action « Générer » le rattrape. ⊥ calculer l'identifiant à l'avance.
- **Aucun rattrapage des produits existants** : la spec prévoit la génération à la création et à la
  demande, pas une migration de données.
- **La fiche produit n'a pas de champ code-barres** (constaté au ticket 04) : ce ticket l'ajoute,
  puisque le code doit être « visible et modifiable ».

## Critères d'acceptation

Fonctions pures (`src/lib/codeMaison.ts`, nouveau) :

- [ ] `cleEan13(douzeChiffres)` → le chiffre de contrôle EAN-13
- [ ] `estEan13Valide(texte)` → exactement 13 chiffres et clé juste
- [ ] `codeMaison(type, id)` → `'2'` + type (`1` produit, `2` service) + `id` sur 10 chiffres + clé ; 13 chiffres, EAN-13 valide ; `id` non entier, ≤ 0 ou > 10 chiffres → erreur

Base :

- [ ] Migration `0052` : colonne `services.code_barre` (TEXT, nullable) et index unique partiel `(boutique_id, code_barre)` **sur le patron de `0048`** (`actif = 1`, non nul, non vide après `TRIM`)
- [ ] Test de la migration contre un **vrai SQLite** (`node:sqlite`, patron de `tests/produits-unicite-codes-migration.test.ts`) : doublon refusé dans une boutique, admis entre deux boutiques, admis sur un service inactif

Produits :

- [ ] Fonction commune (`stockService.ts`) : pose `codeMaison(1, id)` dans `code_barre` **si** le produit n'a ni code-barres ni SKU EAN-13 valide ; ne réécrit jamais un code existant
- [ ] Appelée par `createProduit()` **et** par l'`INSERT` de l'import CSV ; **pas** par l'import fournisseur (Mobilax) : `importerProduitMobilax()` ne pose jamais de code maison, même sans EAN
- [ ] Création manuelle sans code ni SKU EAN → le produit créé porte un code maison ; avec un code-barres saisi, ou un SKU EAN-13 valide → aucun code maison
- [ ] Violation d'unicité à la pose → `ErreurCodeEnDoublon` (409 nommant le produit porteur), jamais une erreur SQL brute
- [ ] `POST /api/produits/:id/code-maison` (`requireRole('admin', 'manager')`, `assertBoutiqueOwnership()`) : pose le code ; **409** si le produit a déjà un code-barres ou un SKU EAN-13 valide ; 404 autre boutique

Services :

- [ ] `POST /api/services/:id/code-maison` (`requireRole('admin', 'manager')`, garde d'isolation) : pose `codeMaison(2, id)` ; 409 si le service a déjà un code-barres
- [ ] `createService()` / `updateService()` acceptent `code_barre` (modifiable) ; violation d'unicité → 409 explicite, jamais une erreur SQL brute
- [ ] **Aucun code maison automatique à la création d'un service** : la spec dit « peuvent recevoir », la génération est à la demande

Recherche :

- [ ] `?scan=` (route du ticket 04), type `code_barre` : trouve aussi les **services** actifs de la boutique par `services.code_barre = ?`, résultat typé `service`
- [ ] `?q=` : trouve un service par son code-barres (en plus du nom et de la référence) et un produit par son code-barres (déjà le cas)

Écrans (`stock.js`/`stock.html`, `services.js`/`services.html`) :

- [ ] Fiche produit : champ « Code-barres » (création et modification), code maison affiché ; bouton « Générer un code maison » visible seulement si le produit n'a ni code-barres ni SKU EAN-13 valide
- [ ] Fiche service : champ « Code-barres » et bouton « Générer un code maison » visible seulement si le service n'en a pas
- [ ] Erreur 409 affichée en clair (le produit ou service porteur est nommé) ; appels déballés `(await apiX(…)).data` ; valeurs posées en `value` / `textContent`
- [ ] `CACHE_VERSION` (`public/sw.js`) incrémenté

Commun :

- [ ] ∀ test vu rouge avant correctif
- [ ] `npx vitest run` sans nouvel échec par rapport à la baseline mesurée avant le ticket
- [ ] Erreurs tsc ≤ baseline mesurée avant le ticket (`npx tsc --noEmit --pretty false | grep -cE "error TS[0-9]+"`)
- [ ] `tests/routes-isolation-conformite.test.ts` vert : les deux nouvelles routes par ID sont gardées
- [ ] ⊥ ligne de `caisse.js` / `caisse.html` ; ⊥ modification de `createVente()` ni de `journal_nf525`

## Coutures à tester

- **Fonctions pures** `cleEan13()`, `estEan13Valide()`, `codeMaison()` — vitest direct : clés connues (EAN réels), longueur 13, préfixe `21` / `22`, bornes de l'identifiant.
- **Migration `0052`** — vitest contre un vrai SQLite (`node:sqlite`).
- **Création de produit** — vitest contre un **vrai SQLite** (la règle vit dans le SQL et l'enchaînement `INSERT` puis pose) : manuelle sans code → code maison ; avec code-barres → inchangé ; SKU EAN-13 valide → aucun ; SKU à clé fausse → code maison ; CSV sans code → code maison ; import Mobilax → aucun.
- **Routes** `POST /api/produits/:id/code-maison` et `POST /api/services/:id/code-maison` — vitest par `app.request()` : 200, 409 déjà codé, 404 autre boutique, 403 technicien.
- **Recherche** `?scan=` et `?q=` sur un code de service — vitest contre un vrai SQLite.
- **Écrans** — E2E Playwright `tests/e2e/codes-maison.spec.ts`, vraie D1 locale : créer un produit à la main → son code maison s'affiche dans la fiche → le scanner en caisse ajoute sa ligne ; générer le code d'un service → le scanner en caisse ajoute une ligne service. L'E2E est joué par le socle dans le bac à sable (contrôle e2e de gates.json, à déclarer dans la tâche d'écran) ; un E2E hors de sa portée (préproduction, production) se demande dans le compte rendu (P16).

## Notes

- Périmètre : `src/lib/codeMaison.ts` (nouveau), `migrations/0052_services_code_barre.sql` (nouveau), `src/services/stockService.ts`, `src/services/servicesService.ts`, `src/services/catalogueService.ts`, `src/routes/stocks.ts`, `src/routes/services.ts`, `public/static/js/stock.js`, `public/stock.html`, `public/static/js/services.js`, `public/services.html`, `public/sw.js`, tests correspondants.
- Prior art : `ErreurCodeEnDoublon` et `champEnDoublon()` (`stockService.ts`, index `0048`) ; `rattacherProduitMobilax()` pour une écriture qui ne réécrit jamais une colonne déjà remplie.
- Le code maison d'un produit est dans `produits.code_barre` : le scan du ticket 04 le trouve sans autre changement.
- `CLAUDE.md` § Stock : « ⊥ un nouveau chemin d'écriture de code sans cette conversion » — vaut pour la pose automatique, la génération à la demande et le champ de la fiche.
- Ordre de déploiement : `0052` à distance **avant** le code, avec le reste du lot 1 (`modop-deploiement.md`).

## Critères d'origine (avant le 2026-09-30, repris ci-dessus)

- ~~Fonction pure : `2` + type (1 produit, 2 service) + identifiant sur 10 chiffres + clé EAN13
      calculée ; tests unitaires (clé juste, longueur 13, types) vus rouges~~
- ~~Nouvelle colonne code-barres sur les services, avec index unique partiel par boutique —
      migration testée contre un vrai SQLite~~
- ~~Création d'un produit hors import fournisseur (manuelle, CSV sans code) → code maison écrit,
      par le passage obligé de création de produit ; l'import fournisseur n'en pose jamais~~
- ~~Action « générer » dans la fiche produit et dans la fiche service, refusée si un code existe
      déjà~~
- ~~La recherche unifiée trouve un service par son code-barres ; le scan d'un code de service
      ajoute sa ligne en caisse~~ — l'ajout en caisse passe au ticket 04 (découpe du 2026-09-30)
- ~~Le code maison est affiché dans la fiche et modifiable comme tout code-barres~~
- ~~E2E : créer un produit à la main, lire son code, le scanner en caisse ; générer le code d'un
      service et le scanner ; vus rouges d'abord~~
- ~~`npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées~~
