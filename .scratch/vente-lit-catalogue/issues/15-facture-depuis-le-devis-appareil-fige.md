---
id: 15
titre: Facture depuis le devis, identité de l'appareil figée
statut: ready-for-agent
bloque-par: [07, 12, 13, 14]
---

# 15 — Facture depuis le devis, identité de l'appareil figée

## Contexte

Le vendeur convertit le devis accepté d'un ticket en **facture**, lignes comprises, sans rien
retaper. La facture porte la marque, le modèle et l'IMEI ou le numéro de série de l'appareil,
**figés à l'émission** : corriger ensuite la fiche appareil ne change jamais une facture émise. La
conversion ne sort **aucune** pièce du stock une seconde fois — c'est la pose qui l'a fait.
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 58, 69, 70, 71 ; décision « Devis et facture
depuis le ticket »).

**Touche le NF525** (site de figeage de `emettreFacture()`) → **codé dans `izigsm/webapp` avec
l'exploitant, pas par le socle** (règle de l'exploitant du 2026-09-30). **Aucune migration.**

Bloqué par 07 (instantané `factures.appareils_snapshot`, fait), 12 (pose d'une pièce : la preuve
« stock décrémenté une seule fois » en a besoin), 13 (devis depuis le ticket, `service_id` recopié
— **y compris à la conversion**, critère du 13) et **14** (ajouté le 2026-10-01 : l'acceptation au
comptoir, seule voie d'un devis `accepte` dans l'E2E).

_Mis au format du modèle le 2026-10-01. Ancien en-tête : `**Status:** ready-for-agent`,
`**Blocked by:** 07 — IMEI du produit (colonne d'instantané de l'appareil) ; 12 — Pose d'une pièce ;
13 — Devis depuis le ticket.`_

### Constats du cadrage (2026-10-01)

- **Tous les chemins d'émission passent par `emettreFacture()`** (`factureService.ts`) : route
  `POST /factures/:id/emettre`, `emettre`/`emettre_encaisser` de `POST /api/factures` (y compris
  avec `devis_id`), `createFactureAcompte()`. Seule la vente POS (`createVente()`) émet ailleurs —
  c'est le **second** site de figeage, qui écrit déjà `appareils_snapshot` (ticket 07). Figer dans
  `emettreFacture()` couvre donc toute facture liée à un ticket, **acompte compris**, sans troisième
  site.
- `emettreFacture()` fige aujourd'hui `vendeur_snapshot` et `acheteur_snapshot` dans l'`UPDATE`
  de verrouillage, **après** `enregistrerTransaction()` ; elle n'écrit pas `appareils_snapshot`.
- **Identité de l'appareil d'un ticket** : marque et modèle sur le ticket (`tickets.appareil_marque`,
  `appareil_modele`, `NOT NULL`), IMEI et numéro de série sur la fiche appareil du client
  (`tickets.appareil_id` → `appareils.imei`, `numero_serie`, posée par le 08a). Même lecture que la
  fiche du devis (ticket 13, décision 3).
- Depuis le 08a (P15 « rattacher, jamais réécrire »), **modifier l'IMEI d'un ticket rattache le
  ticket à une autre fiche** : la jointure vivante change, l'ancienne fiche reste. C'est ce geste que
  l'E2E rejoue pour « modifier l'IMEI ».
- `convertirDevis()` (`devisService.ts`) accepte tout devis sauf `refuse` / `annule` / déjà
  converti — un brouillon ou un devis envoyé devient facture sans acceptation du client.
- `convertirDevis()` et `emettreFacture()` n'écrivent **rien** dans `mouvements_stock` ni sur
  `produits.stock_actuel` (relevé au cadrage) : la règle « aucun second décrément » est déjà vraie,
  ce ticket la **prouve** et la verrouille.
- Rendu A4 : `_buildFactureHTML()` (`factures.js`) affiche un bloc « Appareil vendu » par entrée de
  `appareils_snapshot`, IMEI seul (ticket 07). Une entrée sans `nature` = appareil vendu.
- Le texte de l'`UPDATE` de verrouillage est **figé dans un mock** :
  `tests/factureService.test.ts` (l. ~187, `acheteur_snapshot = ?`). Piège déjà vécu au ticket 07
  (`CLAUDE.md` § Douchette) : ajouter la colonne **en fin de liste** et mettre la copie à jour, sinon
  un test « l'UPDATE n'a pas eu lieu » passe par vacuité.

### Décisions de l'exploitant du 2026-10-01

1. **Colonne existante** : l'identité de l'appareil réparé est figée dans
   **`factures.appareils_snapshot`**, avec une entrée
   `{ nature: 'repare', appareil_id, marque, modele, imei, numero_serie }`. Les entrées de la vente
   POS restent telles quelles ; une entrée **sans** `nature` se lit « vendu ». Aucune migration.
2. **Devis lié à un ticket : seul un devis `accepte` se convertit** (sinon **409** « Le devis doit
   être accepté par le client avant d'être facturé »). Un devis **sans** ticket garde la règle
   actuelle.
3. **Garde d'identifiant à la création, sauf l'acompte** : la conversion d'un devis lié à un ticket
   et la création manuelle d'une facture avec `ticket_id` sont refusées (**422**, même message que le
   ticket 13 : « Saisissez l'IMEI ou le numéro de série de l'appareil dans le ticket ») tant que
   l'appareil n'a ni IMEI ni numéro de série. **L'acompte d'un ticket reste possible** dès la prise en
   charge : son émission fige ce qui est connu (marque, modèle, identifiants `null`).

### Relecture de conception (2026-10-01)

- **Un seul écrivain** : l'entrée `repare` est construite et écrite **dans l'`UPDATE` de
  verrouillage existant** d'`emettreFacture()`, après `enregistrerTransaction()`, relue **en base**
  (ticket → appareil), jamais depuis le corps de la requête. Facture sans `ticket_id` → colonne
  laissée telle quelle (`NULL`). ⊥ troisième site de figeage, ⊥ écriture dans `createFacture()` /
  `convertirDevis()`.
- **Hors des données hashées NF525** : `buildCanonicalData()` et le format B ne changent pas ; aucun
  `hash_courant` existant n'est touché.
- **Gardes avant toute écriture** : statut du devis et identifiant vérifiés **avant** l'`INSERT` de
  la facture — ni brouillon orphelin, ni numéro consommé (`emettre_encaisser` passe par ces gardes
  avant `ajouterPaiement()` / `emettreFacture()`).
- **Brouillon / émise** : `getFacture()` renvoie, pour une facture **non verrouillée** liée à un
  ticket, l'identité **vivante** (`appareil_ticket : { marque, modele, imei, numero_serie }`) ; une
  facture **verrouillée** ne renvoie que son instantané. Une facture émise **avant** ce ticket, sans
  entrée `repare`, n'affiche **aucun** bloc — ⊥ repli sur la donnée vivante pour une facture émise.
- **Garde d'identifiant à l'émission : non** (décision 3) — un identifiant ne peut pas disparaître
  d'un ticket (PUT `""` = inchangé, 08a), et l'acompte doit pouvoir émettre sans lui.

## Critères d'acceptation

Serveur :

- [ ] `convertirDevis()` : devis lié à un ticket et non `accepte` → **409** (message de la décision
      2), aucune facture créée ; devis sans ticket → règle actuelle inchangée (test de
      non-régression)
- [ ] Conversion d'un devis lié à un ticket et création manuelle (`createFacture()` avec
      `ticket_id`) : appareil sans IMEI ni numéro de série, ou ticket sans appareil → **422**
      (message de la décision 3), **aucune** ligne `factures` créée, compteur de numérotation
      inchangé
- [ ] `createFactureAcompte()` sur un ticket sans identifiant : **accepté** (décision 3)
- [ ] Conversion : lignes recopiées avec `produit_id` **et** `service_id` (critère du 13, vérifié
      ici sur le chemin ticket → devis → facture)
- [ ] `emettreFacture()` : facture liée à un ticket → `appareils_snapshot` =
      `[{ nature: 'repare', appareil_id, marque, modele, imei, numero_serie }]`, écrit dans
      **l'`UPDATE` de verrouillage existant**, colonne ajoutée **en fin de `SET`** ; facture sans
      ticket → colonne non touchée
- [ ] L'entrée vaut aussi pour l'acompte émis d'un ticket (identifiants `null` si inconnus)
- [ ] `getFacture()` : brouillon lié à un ticket → `appareil_ticket` vivant ; facture verrouillée →
      pas de `appareil_ticket`, instantané seul
- [ ] **Aucune** écriture dans `mouvements_stock` ni sur `produits.stock_actuel` à la conversion ni
      à l'émission
- [ ] Aucun appel nouveau à `nextNumero()` ou `enregistrerTransaction()` ; `buildCanonicalData()`
      inchangée
- [ ] Routes : codes 409 / 422 rendus tels quels par `PUT /devis/:id/convertir` et
      `POST /api/factures` (aujourd'hui tout échec de conversion sort en 422) ; SQL dans les
      services

Écrans :

- [ ] Facture A4 (`_buildFactureHTML()`) : entrée `repare` → bloc « Appareil réparé : marque modèle
      — IMEI … » ou « — N° de série … » (le premier non vide ; aucun des deux → marque et modèle
      seuls) ; entrée sans `nature` → « Appareil vendu » inchangé ; valeurs échappées
- [ ] Brouillon lié à un ticket : même bloc, lu sur `appareil_ticket` (vivant)
- [ ] Budget d'une page A4 tenu (mécanisme `_triggerPrint()` / `.print-compact`, ⊥ contournement)
- [ ] Page Devis : 409 / 422 de la conversion affichés en clair ; appels déballés
      `(await apiX(…)).data`
- [ ] `CACHE_VERSION` (`public/sw.js`) incrémenté

Commun :

- [ ] Tests NF525 et d'immuabilité verts (`nf525-*`, `factures-immuabilite-conformite`,
      `caisseService` figeage) ; numérotation inchangée
- [ ] ∀ test vu rouge avant correctif
- [ ] `npx vitest run` sans nouvel échec par rapport à la baseline mesurée avant le ticket
- [ ] Erreurs tsc ≤ baseline mesurée avant le ticket
      (`npx tsc --noEmit --pretty false | grep -cE "error TS[0-9]+"`)
- [ ] `CLAUDE.md` § Factures : `appareils_snapshot` écrit par les **deux** sites de figeage
      (natures `vendu` implicite / `repare`) — geste humain à la relecture

## Coutures à tester

- **Émission** — vitest contre un **vrai SQLite au schéma réel** (`tests/helpers/d1Sqlite.ts`) :
  ticket → devis accepté → conversion → émission ; `appareils_snapshot` porte l'entrée `repare`
  (IMEI seul, numéro de série seul) ; rattacher ensuite le ticket à une autre fiche (geste du 08a) →
  instantané inchangé ; facture sans ticket → colonne `NULL` ; acompte d'un ticket sans identifiant
  → entrée avec identifiants `null` ; `journal_nf525` : une ligne par émission, hash recalculé par
  `verifierIntegriteChaine()` sans anomalie.
- **Gardes** — vrai SQLite : devis `draft` / `envoye` / `expire` lié à un ticket → 409, aucune
  facture ; sans identifiant → 422, aucune facture, compteur inchangé ; devis sans ticket en
  `envoye` → converti (non-régression).
- **Stock** — vrai SQLite : une pièce posée (ticket 12), puis conversion et émission →
  `mouvements_stock` et `stock_actuel` inchangés par rapport à l'après-pose.
- **Lecture** — vrai SQLite : `getFacture()` brouillon suit l'appareil vivant ; facture émise ne le
  suit plus.
- **Mock figé** — `tests/factureService.test.ts` : copie du `SET` mise à jour, test vu rouge sur
  l'ancienne copie.
- **Écran** — E2E Playwright `tests/e2e/facture-depuis-devis-ticket.spec.ts`, vraie D1 locale :
  ticket avec IMEI → pose d'une pièce → devis → acceptation au comptoir → conversion → émission ;
  la facture A4 affiche « Appareil réparé … IMEI » ; modifier l'IMEI du ticket ; relire la facture
  inchangée ; stock de la pièce relu par l'API décrémenté **une seule** fois. Vus rouges d'abord.
  Joué ici (pas par le socle).

## Notes

- Périmètre : `src/services/factureService.ts` (`emettreFacture()`, `createFacture()`,
  `getFacture()`), `src/services/devisService.ts` (`convertirDevis()`), `src/routes/facturation.ts`,
  `public/static/js/factures.js`, `public/static/js/devis.js`, `public/sw.js`, tests correspondants.
- `CLAUDE.md` § Factures : deux sites de figeage seulement ; numéro attribué à l'émission ; toute
  validation précède l'émission ; aucune écriture `journal_nf525` hors d'`emettreFacture()`.
- `CLAUDE.md` § Journal NF525 : ⊥ toucher au format hashé, ⊥ recalculer un `hash_courant` émis.
- Pas de numéro de migration réservé : aucune migration (décision 1).

## Critères d'origine (avant le 2026-10-01, repris ci-dessus)

- ~~Conversion devis → facture : lignes recopiées avec produit et service ; **aucun** mouvement de
      stock — prouvé sur la vraie base locale avec une pièce déjà posée~~
- ~~Garde d'identifiant aussi à la création d'une facture liée à un ticket~~ — sauf l'acompte
      (décision 3)
- ~~L'identité de l'appareil est figée **à l'émission**, au site de figeage existant de
      l'émission, **après** l'écriture au journal NF525 ; aucun troisième site de figeage~~
- ~~Une facture en brouillon lit la fiche appareil vivante ; une facture émise lit son instantané~~
- ~~La facture imprimée affiche l'identité de l'appareil, dans le budget d'une page A4~~
- ~~Tests NF525 et d'immuabilité des factures verts ; numérotation inchangée~~
- ~~E2E : ticket → pose → devis → acceptation → facture émise ; modifier l'IMEI de l'appareil ;
      relire la facture inchangée et le stock décrémenté une seule fois ; vus rouges d'abord~~
- ~~`npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées~~
