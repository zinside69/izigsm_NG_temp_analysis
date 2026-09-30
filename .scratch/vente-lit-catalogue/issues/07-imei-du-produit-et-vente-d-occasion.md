---
id: 07
titre: IMEI du produit et vente d'occasion
statut: ready-for-human
bloque-par: [04]
---

# 07 — IMEI du produit et vente d'occasion

## Contexte

Un téléphone d'occasion en vente porte son **IMEI** dans sa fiche produit. Le vendeur le retrouve en
scannant cet IMEI en caisse, et le document remis au client porte l'identité de l'appareil —
marque, modèle, IMEI — **figée** au moment de la vente, pour la garantie légale. Un appareil racheté
puis revendu sans passer par un reconditionnement est trouvable lui aussi.
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 21 à 23 ; décisions « IMEI du produit »,
« Vente en caisse ») ; vocabulaire `CONTEXT.md` (Appareil).

Bloqué par 04 (douchette en caisse) : c'est lui qui route un scan de 15 chiffres vers `imei`, avec
une liste vide que ce ticket remplit.

**Touche la caisse ET le NF525** : il écrit dans `createVente()` (`caisseService.ts`), au site de
figeage qui suit l'écriture au journal NF525. → **codé par Claude avec l'exploitant, pas confié au
socle** (règle de l'exploitant du 2026-09-30). Il ajoute la **migration `0054`**, qui rejoint le lot 1
en attente de déploiement.

_Mis au format du modèle le 2026-09-30. Ancien en-tête : `**Status:** ready-for-agent`,
`**Blocked by:** 04`. Statut passé à `ready-for-human` : caisse et NF525, codé à deux._

### Décisions de l'exploitant du 2026-09-30

1. **L'identité de l'appareil apparaît sur la facture A4.** Aucun ticket de caisse imprimable
   n'existe : une vente en caisse crée une facture, imprimée depuis la page Factures. Le document
   affiche un bloc « Appareil vendu : marque, modèle, IMEI » par appareil figé. Aucun nouveau
   document, garde-fou 1 page A4 inchangé.
2. **Modèle = nom du produit**, marque = champ `marque` de la fiche. Seul l'IMEI s'ajoute à la
   fiche, aucune colonne `modele`.
3. **Un appareil = une fiche.** Un téléphone vendu garde sa fiche (active, stock 0, IMEI). Racheté
   plus tard, recréer une fiche au même IMEI est refusé par le message qui **nomme la fiche
   existante** ; l'opérateur la rouvre et remet 1 en stock par « Ajuster le stock » (mouvement
   tracé). `createVente()` ne désactive rien.

### Relecture de conception du 2026-09-30

- **Une vente peut porter plusieurs appareils** : l'instantané est une **liste** sur la facture
  (`appareils_snapshot`, JSON), une entrée par ligne de vente dont le produit porte un IMEI —
  `{ produit_id, designation, marque, modele, imei }`.
- **Aucun troisième site de figeage** (`CLAUDE.md` § Factures) : l'instantané est écrit par
  **l'`UPDATE` post-journal déjà présent** dans `createVente()`, dans la même instruction que
  `locked`, `issued_at`, `hash_nf525`, `vendeur_snapshot`, `acheteur_snapshot`. ⊥ un `UPDATE` de
  plus, ⊥ l'écrire dans l'`INSERT` de la facture (une facture verrouillée avant le journal serait
  irréparable). Il n'entre **pas** dans les données hashées du journal (format A inchangé).
- **L'instantané se lit en base au moment de la vente**, jamais depuis le corps de la requête : le
  navigateur n'envoie que `produit_id`.
- **Clé de Luhn créée ici** (`src/lib/scan.ts`, à côté de `routerScan()`) pour valider l'IMEI saisi
  dans la fiche ; le ticket 08 la réutilise au scan. ⊥ une seconde implémentation.
- **Numéro de migration réservé : `0054`** (`0052` = ticket 05, `0053` = ticket 06, codés en
  parallèle par le socle).

## Critères d'acceptation

Base :

- [ ] Migration `0054` : colonne `produits.imei` (TEXT, nullable) + index unique partiel `(boutique_id, imei)` sur le patron de `0048` (`actif = 1`, non nul, non vide) ; colonne `factures.appareils_snapshot` (TEXT, nullable). `ALTER TABLE … ADD COLUMN` seulement, aucune recréation de table
- [ ] Test de la migration contre un **vrai SQLite** (`node:sqlite`) : doublon d'IMEI refusé dans une boutique, admis entre boutiques et sur un produit inactif ; factures existantes intactes

Fiche produit :

- [ ] `luhnValide(texte)` (`src/lib/scan.ts`, pure) : 15 chiffres et clé de Luhn juste
- [ ] `createProduit()` et `PUT /produits/:id` acceptent `imei` : vide → `NULL` ; sinon 15 chiffres **et** Luhn juste, sinon 400 explicite
- [ ] Doublon d'IMEI → conversion en `ErreurCodeEnDoublon` (champ `imei`, 409 nommant le produit porteur), jamais une erreur SQL brute ; `champEnDoublon()` reconnaît `produits.imei`
- [ ] Champ « IMEI » dans la fiche produit (`stock.js`/`stock.html`), en création et en modification

Scan en caisse :

- [ ] `?scan=` de type `imei` (route du ticket 04) : produits **actifs** de la boutique où `imei = ?` ; IMEI à clé de Luhn fausse → `resultats: []` et `imei_invalide: true`, **sans requête SQL**
- [ ] En caisse : IMEI connu → ligne ajoutée comme un code-barres (stock 0 : ajout permis avec l'avertissement existant, story 17) ; IMEI à clé fausse → « IMEI invalide (clé de contrôle) » ; inconnu → « Aucun produit pour cet IMEI »

Vente et figeage (`caisseService.createVente()`) :

- [ ] Pour chaque ligne portant un `produit_id` dont le produit a un IMEI : entrée de l'instantané relue **en base** (`marque`, `nom` → `modele`, `imei`)
- [ ] Instantané écrit par l'`UPDATE` post-journal existant, dans la même instruction que les six marques du figeage ; aucune ligne → colonne `NULL`
- [ ] Échec de l'écriture au journal NF525 → ni verrouillage ni instantané (comportement actuel inchangé)
- [ ] Modifier ensuite la fiche produit (nom, marque, IMEI) ne change pas l'instantané de la facture émise

Document (`factures.js`) :

- [ ] `_buildFactureHTML()` : bloc « Appareil vendu » (marque, modèle, IMEI) par entrée de `appareils_snapshot`, valeurs échappées ; facture sans instantané → aucun bloc
- [ ] La lecture de la facture renvoie `appareils_snapshot` (colonnes de la route de détail)

Commun :

- [ ] Tests NF525 existants verts : `nf525-ecrivains-conformite`, `factures-immuabilite-conformite`, `caisseService`, et la vérification d'intégrité de la chaîne
- [ ] `CACHE_VERSION` (`public/sw.js`) incrémenté
- [ ] ∀ test vu rouge avant correctif
- [ ] `npx vitest run` sans nouvel échec par rapport à la baseline mesurée avant le ticket
- [ ] Erreurs tsc ≤ baseline mesurée avant le ticket (`npx tsc --noEmit --pretty false | grep -cE "error TS[0-9]+"`)

## Coutures à tester

- **`luhnValide()`** — vitest direct : IMEI réels valides, clé fausse, 14 et 16 chiffres, lettres.
- **Migration `0054`** — vitest contre un vrai SQLite (`node:sqlite`).
- **Fiche produit** (`createProduit()`, `PUT /produits/:id`) — vitest contre un **vrai SQLite** : IMEI invalide refusé, doublon → 409 nommant le porteur, vide → `NULL`.
- **Recherche** `?scan=` type `imei` — vitest contre un vrai SQLite : trouvé, inactif exclu, autre boutique exclue, clé fausse sans requête.
- **`createVente()`** — vitest contre un **vrai SQLite** (la règle est portée par l'ordre des écritures) : instantané posé par l'`UPDATE` post-journal ; deux appareils → deux entrées ; aucune ligne IMEI → `NULL` ; journal en échec → ni `locked` ni instantané ; fiche modifiée après → instantané inchangé.
- **Écran** — E2E Playwright `tests/e2e/vente-occasion-imei.spec.ts`, vraie D1 locale : saisir un IMEI dans une fiche → le scanner en caisse → vendre → relire la facture (bloc « Appareil vendu ») → modifier nom et IMEI de la fiche → relire la facture : inchangée.

## Notes

- Périmètre : `migrations/0054_produits_imei_factures_appareils.sql` (nouveau), `src/lib/scan.ts`, `src/services/stockService.ts`, `src/routes/stocks.ts`, `src/services/catalogueService.ts`, `src/services/caisseService.ts`, `src/services/factureService.ts` (lecture de la colonne), `public/static/js/stock.js`, `public/stock.html`, `public/static/js/caisse.js`, `public/static/js/factures.js`, `public/sw.js`, tests correspondants.
- Prior art : figeage de `createVente()` (`caisseService.ts`, `UPDATE factures SET locked = 1 …` après `INSERT INTO journal_nf525`) ; `vendeur_snapshot`/`acheteur_snapshot` et `_parseSnapshot()` (`factures.js`) ; `ErreurCodeEnDoublon` (`0048`).
- `CLAUDE.md` § Journal NF525 : ⊥ toucher au format hashé ; ⊥ recalculer un `hash_courant` émis.
- `rachats.imei` existe déjà (module Rachats) mais aucun produit n'en naît : la fiche d'un appareil racheté se crée à la main, IMEI compris. Relier rachat et produit n'est pas demandé.
- Ordre de déploiement : `0054` à distance **avant** le code, avec le reste du lot 1 (`modop-deploiement.md`).

## Critères d'origine (avant le 2026-09-30, repris ci-dessus)

- ~~Nouvelle colonne IMEI sur les produits, index unique partiel par boutique sur les produits
      actifs — migration testée contre un vrai SQLite~~
- ~~L'IMEI se saisit dans la fiche produit ; un doublon est refusé avec un message nommant le
      produit existant~~
- ~~Un scan de 15 chiffres correspondant à un produit en vente ajoute sa ligne en caisse~~
- ~~Nouvelle colonne d'instantané de l'appareil sur les factures (JSON), migration testée~~
- ~~La vente d'un produit porteur d'un IMEI **fige** l'identité de l'appareil au site de figeage
      existant de la vente, **après** l'écriture au journal NF525 ; aucun troisième site de figeage~~
- ~~Le ticket de caisse imprimé affiche cette identité ; corriger ensuite la fiche produit ne
      change pas le document émis — prouvé sur la vraie base locale~~ — facture A4 (décision 1)
- ~~Tests NF525 existants (`nf525-*`, immuabilité des factures) verts~~
- ~~E2E : saisir un IMEI, le scanner, vendre, relire le ticket de caisse, modifier la fiche,
      relire à nouveau ; vus rouges d'abord~~
- ~~`npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées~~
