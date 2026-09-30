---
id: 04
titre: Douchette en caisse
statut: ready-for-human
bloque-par: [02]
---

# 04 — Douchette en caisse

## Contexte

Le vendeur scanne un article avec la douchette sans avoir à cliquer dans un champ : un code-barres
connu ajoute aussitôt sa ligne, un second scan du même article augmente la quantité, et l'étiquette
d'un lot fournisseur (« ×10 ») ajoute une seule unité. Un code inconnu est signalé, avec la
proposition de créer la fiche produit, code déjà rempli ; un code qui désignerait malgré tout
plusieurs produits fait apparaître la liste. Un scan pendant la saisie d'un champ n'est jamais
détourné vers la vente.
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 8 à 15 ; décision « Recherche et scan »).

Bloqué par 02 (sélecteur de produits en caisse) — **done** le 2026-09-17 : prenable.

**Touche la caisse** (`caisse.js`, `caisse.html`) → **codé par Claude avec l'exploitant, pas confié
au socle** (règle de l'exploitant du 2026-09-30). **Ne touche pas le NF525** : `createVente()` et
`journal_nf525` ne sont pas modifiés, le scan ne fait que remplir des lignes de vente.

_Mis au format du modèle le 2026-09-30 (`docs/agents/issue-tracker.md`). Ancien en-tête :
`**Status:** ready-for-agent`, `**Blocked by:** 02`. Statut passé à `ready-for-human` : ticket de
caisse, codé à deux._

### Décisions de l'exploitant du 2026-09-30

1. **Un scan de 13 chiffres cherche par égalité stricte sur le code-barres OU le SKU**, produits
   actifs de la boutique. Le SKU compte parce que la fiche produit n'a pas de champ code-barres :
   l'exploitant y tape l'EAN. ⊥ le `LIKE %…%` de la recherche texte : un SKU qui *contient* les
   chiffres ne doit pas remonter.
2. **Un scan écran de caisse au repos ouvre « Nouvelle vente » et y ajoute l'article** : aucun clic
   à faire (story 8).
3. **Code inconnu → lien « Créer la fiche »** vers `/stock?nouveau=1&code=<code>`, **dans un nouvel
   onglet** (la vente en cours reste intacte) ; la fiche s'ouvre en création, **SKU prérempli**.

### Décisions techniques (relecture de conception du 2026-09-30)

- **Le routage d'un scan vit côté serveur** : fonction pure `routerScan()` dans `src/lib/scan.ts`,
  testée par vitest. Le dépôt n'a aucun précédent de test unitaire d'une fonction du navigateur
  (seuls des scans statiques lisent `public/`). Le navigateur envoie la saisie brute, le serveur
  route. La prise en charge et la recherche générale (story 15, ticket 08) réutiliseront la même
  fonction et la même route.
- **Étiquette de lot « ×10 »** : rien ne la distingue d'un article à l'unité si elle porte l'EAN de
  l'unité. Un scan ajoute **toujours une unité**, jamais la quantité imprimée. Aucun code de
  multiplication à écrire ; un test le fixe.
- **IMEI (15 chiffres)** : aucune colonne IMEI sur `produits` avant le ticket 07. Le scan est routé
  `imei`, la recherche rend une liste vide, l'écran dit « Aucun produit pour cet IMEI ». Le ticket 07
  branchera la suite ; la clé de Luhn relève du ticket 08.
- **« Plusieurs produits »** : impossible par code-barres seul depuis `0048` (index unique par
  boutique), mais possible par l'égalité **code-barres OU SKU** : l'EAN d'un produit peut être le
  SKU d'un autre. La liste reste donc nécessaire.

## Critères d'acceptation

Serveur :

- [ ] `routerScan(saisie)` (`src/lib/scan.ts`, pure) : espaces de bord retirés ; exactement 13 chiffres → `{ type: 'code_barre', valeur }` ; exactement 15 chiffres → `{ type: 'imei', valeur }` ; tout le reste → `{ type: 'texte', valeur }`. 12 et 14 chiffres → `texte`
- [ ] `GET /api/catalogue/recherche?scan=<saisie>` : applique `routerScan()` et rend `{ type_scan, resultats }`
  - `code_barre` → produits actifs de la boutique où `code_barre = ?` **ou** `sku = ?`, égalité stricte, plafond de la recherche (20)
  - `imei` → `resultats: []` (branché au ticket 07)
  - `texte` → même résultat que `?q=` aujourd'hui
- [ ] `?q=` inchangé (sélecteur du ticket 02) ; `?scan=` et `?q=` ensemble → 400 ; `?scan=` vide → 400 sans requête SQL
- [ ] Boutique résolue comme `?q=` (`getBoutiqueId()`), isolation vérifiée : un code d'une autre boutique ne remonte pas

Écran de caisse :

- [ ] **La capture vit dans un module partagé `public/static/js/douchette.js`** (ajouté le 2026-09-30 : la page Tickets la réutilise au ticket 08b), point d'entrée unique du type `ecouterDouchette(surScan)` ; aucune logique de caisse dans le module. `caisse.html` le charge après `app.js`
- [ ] Capture globale sur l'écran de caisse : caractères tapés **hors** champ de saisie (`input`, `textarea`, `select`, `contenteditable`) accumulés, **Entrée** → envoi du scan. Tampon vidé si plus de 300 ms séparent deux caractères, et après chaque envoi
- [ ] Focus dans un champ (désignation, recherche, client, note, montant) → **rien n'est capté** : la frappe reste dans le champ, aucune ligne ajoutée
- [ ] Fenêtre « Nouvelle vente » fermée → un scan l'ouvre, **puis** traite le code
- [ ] 1 résultat → ligne ajoutée par `ajouterLigneCatalogue()` (même chemin que le sélecteur : `produit_id` envoyé, prix et TVA du catalogue)
- [ ] **Résultat de type `service`** → ligne service (`service_id`), comme le sélecteur ; même service rescanné → quantité + 1. Ajouté le 2026-09-30 (découpe du ticket 05 : c'est ici que la caisse apprend à ajouter un service scanné, pour que le 05 ne touche pas `caisse.js`). Aucun service n'a de code-barres avant le 05 : testé en E2E par une réponse de route simulée (`page.route()`)
- [ ] Même produit rescanné → **quantité + 1 sur la ligne existante**, pas de seconde ligne. Ligne existante = même `produit_id`, que la ligne vienne d'un scan ou du sélecteur
- [ ] 0 résultat sur un code-barres → message « Code inconnu : <code> » + lien « Créer la fiche » (`target="_blank"`, `rel="noopener"`) vers `/stock?nouveau=1&code=<code>` ; aucune ligne ajoutée
- [ ] Plusieurs résultats → liste affichée dans la zone de résultats du sélecteur, **aucun ajout automatique** ; un clic ajoute comme le sélecteur
- [ ] 0 résultat sur un IMEI → « Aucun produit pour cet IMEI », aucune erreur
- [ ] Rejet de `fetch` (réseau coupé) → message d'erreur, tampon vidé, rien d'ajouté
- [ ] Appels déballés `(await apiGet(…)).data` ; données rendues échappées (`esc()` de `caisse.js`)

Écran Stock :

- [ ] `/stock?nouveau=1&code=<code>` ouvre la fiche en création (`openNewStock()`) avec le SKU prérempli ; `code` absent ou vide → fiche vide ; sans `nouveau=1`, rien ne s'ouvre. Le code est posé en `value`, jamais interprété en HTML
- [ ] Un SKU déjà porté par un autre produit → message 409 existant (`ErreurCodeEnDoublon`), inchangé

Commun :

- [ ] `CACHE_VERSION` (`public/sw.js`) incrémenté
- [ ] ∀ test vu rouge avant correctif
- [ ] `npx vitest run` sans nouvel échec par rapport à la baseline mesurée avant le ticket
- [ ] Erreurs tsc ≤ baseline mesurée avant le ticket (`npx tsc --noEmit --pretty false | grep -cE "error TS[0-9]+"`)
- [ ] ⊥ migration ; ⊥ modification de `createVente()` ni de `journal_nf525`

## Coutures à tester

- **`routerScan()`** (`src/lib/scan.ts`) — vitest direct : 13, 15, 12, 14 chiffres, lettres, espaces de bord, chaîne vide.
- **Service** `rechercherCatalogue()` en mode code (`catalogueService.ts`) — contre un **vrai SQLite** (`node:sqlite`, comme `tests/rafraichissement-mobilax-sqlite.test.ts`), car la règle est portée par le SQL : égalité sur `code_barre` **ou** `sku`, pas de correspondance partielle, produit inactif exclu, autre boutique exclue, deux produits (EAN de l'un = SKU de l'autre) → deux résultats.
- **Route** `GET /api/catalogue/recherche?scan=` — vitest par `app.request()` (`tests/catalogueService.test.ts` ou fichier voisin) : `type_scan` rendu, 400 sur `scan` vide ou `scan` + `q`, `?q=` inchangé.
- **Écran de caisse** — E2E Playwright `tests/e2e/caisse-douchette.spec.ts`, sur la **vraie D1 locale** (produits créés par les routes, comme `caisse-catalogue-ecran.spec.ts`). Scan simulé par `page.keyboard.type(code)` puis `Enter`, focus hors champ :
  - écran au repos → vente ouverte, ligne ajoutée ;
  - double scan → une ligne, quantité 2 ;
  - article déjà ajouté par le sélecteur puis scanné → quantité 2 ;
  - code inconnu → message et lien `/stock?nouveau=1&code=…` ;
  - deux produits (EAN = SKU d'un autre) → liste, aucune ligne ;
  - frappe pendant la saisie d'une désignation → aucune ligne, le texte reste dans le champ ;
  - IMEI de 15 chiffres → « Aucun produit pour cet IMEI » ;
  - résultat de type `service` (route simulée par `page.route()`, aucun service n'a de code avant le ticket 05) → ligne service, rescanné → quantité 2.
- **Écran Stock** — E2E : `/stock?nouveau=1&code=3760000000017` → fiche en création, SKU = ce code.

## Notes

- Périmètre : `src/lib/scan.ts` (nouveau), `public/static/js/douchette.js` (nouveau), `src/services/catalogueService.ts`, `src/routes/catalogue.ts`, `public/static/js/caisse.js`, `public/caisse.html` (si un conteneur de message est nécessaire), `public/static/js/stock.js`, `public/sw.js`, tests correspondants.
- Prior art : `rechercherCatalogue()` et son échappement des jokers LIKE ; `ajouterLigneCatalogue()` et `renderResultatCatalogue()` (`caisse.js`) ; `openNewStock()` (`stock.js`) ; lecture d'un paramètre d'URL : `fournisseurFiltre` (`stock.js`).
- Un produit sans prix (0 €) scanné est ajouté comme par le sélecteur ; le blocage `prixManquant()` à la validation s'applique inchangé.
- Piège E2E connu : `serviceWorkers: 'block'` est déjà posé ; une frappe Playwright est plus rapide que 300 ms entre deux touches, un humain qui tape hors champ déclenche aussi un scan — sans risque, un code inconnu ne fait que le signaler.

## Critères d'origine (avant le 2026-09-30, repris ci-dessus)

- ~~Fonction pure de routage d'un scan : 13 chiffres → code-barres, 15 chiffres → IMEI, autre
      saisie → texte ; tests unitaires vus rouges~~
- ~~Capture globale sur l'écran de caisse (la douchette tape comme un clavier puis Entrée),
      **neutralisée** quand le focus est dans un champ de saisie~~
- ~~Code-barres connu → ligne ajoutée immédiatement ; même code rescanné → quantité + 1, pas de
      seconde ligne~~
- ~~Un code de lot fournisseur ajoute une unité~~
- ~~Code inconnu → message et proposition de créer la fiche produit, code-barres prérempli~~
- ~~Code rendant plusieurs produits → liste proposée, aucun choix automatique~~
- ~~Un 15 chiffres est routé vers la recherche par IMEI sans erreur, même tant que le ticket 07
      n'a pas branché la suite (message « aucun produit »)~~
- ~~E2E : scan simulé par une frappe clavier rapide terminée par Entrée — ajout, double scan,
      code inconnu, scan pendant la saisie d'une désignation ; vus rouges d'abord~~
- ~~`npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées~~
