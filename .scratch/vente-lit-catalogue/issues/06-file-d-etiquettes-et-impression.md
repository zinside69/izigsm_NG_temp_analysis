---
id: 06
titre: File d'étiquettes et impression
statut: ready-for-agent
bloque-par: [05]
---

# 06 — File d'étiquettes et impression

## Contexte

Depuis la fiche d'un produit ou d'un service, l'opérateur ajoute des étiquettes à la **file
d'étiquettes** de la boutique (quantité 1 par défaut, libellé court prérempli et modifiable, prix à
afficher ou non). Un collègue imprime ensuite toute la file en une fois depuis le navigateur, sur le
rouleau thermique du comptoir : étiquettes de 35 × 25 mm à deux pistes, donc imprimées **par
paires**.
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 30 à 35 ; décision « File d'étiquettes ») ;
vocabulaire `CONTEXT.md` (File d'étiquettes).

Bloqué par 05 (codes maison) : sans lui, services et produits créés à la main n'ont pas de code à
imprimer, et la fiche produit n'a pas de champ code-barres.

**Ne touche ni la caisse ni le NF525** (règle de l'exploitant du 2026-09-30) : pages Stock et
Services, nouvelle table, aucune écriture de vente. → **confié au socle.** Il ajoute une
**migration** (`0053`), qui rejoint le lot 1 en attente de déploiement.

_Mis au format du modèle le 2026-09-30. Ancien en-tête : `**Status:** ready-for-agent`,
`**Blocked by:** 05`._

### Décisions de l'exploitant du 2026-09-30

1. **Vidage sur confirmation, pas au déclenchement.** Le navigateur ne dit pas si l'impression a
   réussi (annulation, bourrage). Après la boîte d'impression, la fenêtre demande « Les étiquettes
   sont bien sorties ? » → « Oui, retirer de la file » / « Non, garder ». Seules les entrées
   **imprimées** sortent : un ajout fait entre-temps par un collègue reste dans la file.
2. **Nombre impair → une copie de plus de la dernière étiquette**, jamais une cellule vierge.
   Avertissement avant impression : « 3 demandées, 4 imprimées (la dernière en double) ».
3. **La file vit sur la page Stock** : bouton « File d'étiquettes (N) » qui ouvre une fenêtre
   (liste, modifier, retirer, imprimer). Ajout depuis la fiche produit **et** la fiche service.
   Aucune entrée de menu nouvelle.
4. **Prix imprimé = prix de vente TTC du moment**, lu à l'impression (HT × (1 + TVA / 100)), pas
   figé à l'ajout.

### Relecture de conception du 2026-09-30

- **Le moteur d'impression est taillé pour l'A4** : `_triggerPrint()` (`app.js`) passe en
  `.print-compact` dès que le contenu dépasse ~290 mm — ce qu'une file de quelques étiquettes
  dépasse. Il reçoit une **option** qui désactive ce garde-fou pour les étiquettes ; le chemin des
  documents A4 (tickets, factures, devis) reste strictement inchangé. ⊥ une seconde fonction
  d'impression.
- **JsBarcode n'est chargé que sur `tickets.html`** (CDN jsdelivr, empreinte d'intégrité) :
  `stock.html` le charge par la **même balise**, intégrité comprise.
- **Retrait concurrent** : si la quantité d'une entrée a changé entre l'impression et la
  confirmation (collègue qui en rajoute), on **retranche la quantité imprimée** au lieu de supprimer
  l'entrée. Aucune étiquette demandée ne disparaît sans avoir été imprimée.
- **Code imprimé** : `code_barre` de l'article, sinon son SKU s'il est un EAN-13 valide (règle du
  ticket 05). Rendu **EAN-13** si le code est un EAN-13 valide, **CODE128** sinon. Article sans l'un
  ni l'autre → refusé à l'ajout.

## Critères d'acceptation

Base :

- [ ] Migration `0053` : table `file_etiquettes` (`id`, `boutique_id`, `produit_id` **ou** `service_id` — `CHECK` exactement un des deux —, `quantite` entier ≥ 1, `libelle`, `afficher_prix` 0/1, `created_by`, `created_at`), index `(boutique_id)`
- [ ] Test de la migration contre un **vrai SQLite** (`node:sqlite`) : `CHECK` produit/service, quantité 0 refusée

Serveur (`src/services/etiquettesService.ts`, `src/routes/etiquettes.ts`, nouveaux) :

- [ ] `GET /api/etiquettes` : la file de la boutique du jeton ou consultée (`getBoutiqueId()`), avec pour chaque entrée le nom, le code à imprimer, son format (`EAN13` | `CODE128`) et le **prix TTC du moment** ; entrée dont l'article est inactif → marquée `article_inactif`, jamais imprimée
- [ ] `POST /api/etiquettes { produit_id | service_id, quantite?, libelle?, afficher_prix? }` : quantité 1 et libellé = nom tronqué à 30 caractères par défaut ; article d'une autre boutique → 404 ; article sans code imprimable → 400 `sans_code` avec message
- [ ] `PUT /api/etiquettes/:id` (quantité, libellé, afficher_prix) et `DELETE /api/etiquettes/:id` : `assertBoutiqueOwnership()` ; quantité entier ≥ 1, libellé non vide ≤ 30 caractères
- [ ] `POST /api/etiquettes/retirer-imprimees { entrees: [{ id, quantite }] }` : pour chaque entrée **de la boutique**, supprime si sa quantité actuelle ≤ la quantité imprimée, sinon retranche la quantité imprimée ; entrée d'une autre boutique ou disparue → ignorée, comptée dans la réponse
- [ ] Rôles : ajouter, modifier, retirer, imprimer ouverts à tous les rôles de la boutique (manager, admin de boutique, technicien) ; admin plateforme : lecture et écriture comme ailleurs (journalisé par le middleware)
- [ ] Fonction pure `pairesEtiquettes(entrees)` : développe les quantités, complète un nombre impair par une copie de la dernière, rend `{ etiquettes, demandees, imprimees }`

Impression (`app.js`, `print.css`) :

- [ ] `_triggerPrint(html, options)` : une option coupe la mesure A4 et la classe `.print-compact` ; appel sans option → comportement actuel inchangé (documents A4)
- [ ] Gabarit des étiquettes : page `@page` 70 × 25 mm sans marge, deux cellules de 35 × 25 mm par page ; libellé, code-barres (JsBarcode) et prix TTC seulement si coché ; feuille de style résolue par `_resolveStaticHref()`, ⊥ `/static/…` codé en dur dans un gabarit JS ; bandeau plateforme masqué à l'impression

Écrans :

- [ ] Fiche produit (`stock.js`) et fiche service (`services.js`) : bouton « Ajouter à la file d'étiquettes » (quantité, libellé prérempli, case « afficher le prix ») ; article sans code → message de refus du serveur affiché
- [ ] Page Stock : bouton « File d'étiquettes (N) » → fenêtre listant la file (libellé, quantité, prix affiché ou non, article inactif signalé), modification et retrait par entrée
- [ ] « Imprimer » : avertissement d'arrondi si impair, impression, puis « Les étiquettes sont bien sorties ? » → « Oui, retirer de la file » appelle `retirer-imprimees` avec les entrées **imprimées** ; « Non, garder » ne change rien
- [ ] `stock.html` charge JsBarcode par la balise de `tickets.html` (même URL, même `integrity`)
- [ ] Appels déballés `(await apiX(…)).data` ; libellés rendus en `textContent` ou `echapperHtml()` (le libellé est une saisie réimprimée)
- [ ] `CACHE_VERSION` (`public/sw.js`) incrémenté

Commun :

- [ ] `tests/routes-isolation-conformite.test.ts` vert : `PUT`/`DELETE /api/etiquettes/:id` gardées
- [ ] ∀ test vu rouge avant correctif
- [ ] `npx vitest run` sans nouvel échec par rapport à la baseline mesurée avant le ticket
- [ ] Erreurs tsc ≤ baseline mesurée avant le ticket (`npx tsc --noEmit --pretty false | grep -cE "error TS[0-9]+"`)
- [ ] ⊥ ligne de `caisse.js` / `caisse.html` ; ⊥ `createVente()` ni `journal_nf525`

## Coutures à tester

- **Fonction pure** `pairesEtiquettes()` — vitest direct : 0, 1, 2, 3 étiquettes ; quantités multiples ; la copie en plus est la dernière.
- **Migration `0053`** — vitest contre un vrai SQLite.
- **Service** `etiquettesService.ts` — vitest contre un **vrai SQLite** (règles portées par le SQL) : isolation par boutique sur lecture, ajout, modification et retrait ; code imprimé (`code_barre`, sinon SKU EAN-13 valide, sinon refus) ; prix TTC du moment ; retrait concurrent (quantité passée de 3 à 5 après impression de 3 → reste 2) ; entrée d'une autre boutique ignorée.
- **Routes** `/api/etiquettes*` — vitest par `app.request()` : 400 `sans_code`, 404 autre boutique, validation quantité et libellé.
- **Écran** — E2E Playwright `tests/e2e/file-etiquettes.spec.ts`, vraie D1 locale : ajouter trois étiquettes depuis une fiche produit → la file affiche 3 → « Imprimer » annonce 4 → `window.print` intercepté (`page.evaluate` qui le remplace avant le clic) → le gabarit injecté contient 4 cellules et 2 pages → « Oui, retirer » → file vide ; « Non, garder » → file inchangée. L'E2E est joué par le socle dans le bac à sable (contrôle e2e de gates.json, à déclarer dans la tâche d'écran) ; un E2E hors de sa portée (préproduction, production) se demande dans le compte rendu (P16).

## Notes

- Périmètre : `migrations/0053_file_etiquettes.sql` (nouveau), `src/services/etiquettesService.ts` (nouveau), `src/routes/etiquettes.ts` (nouveau), `src/index.tsx` (montage de la route), `public/static/js/app.js` (option de `_triggerPrint()` seulement), `public/static/css/print.css`, `public/static/js/stock.js`, `public/stock.html`, `public/static/js/services.js`, `public/services.html`, `public/sw.js`, tests correspondants.
- Prior art : étiquette technicien (`tickets.js`, rendu JsBarcode EAN-13) ; `_resolveStaticHref()` ; `estEan13Valide()` du ticket 05.
- `CLAUDE.md` § Documents imprimables : ⊥ contourner ni dupliquer le garde-fou A4 **pour les documents A4** — l'option ne concerne que les étiquettes, et la garantie A4 des tickets, factures et devis reste testée inchangée.
- Le bandeau plateforme est enfant direct de `body` : il doit rester masqué en `@media print` (`CLAUDE.md` § ticket 03).
- Ordre de déploiement : `0053` à distance **avant** le code, avec le reste du lot 1 (`modop-deploiement.md`).

## Critères d'origine (avant le 2026-09-30, repris ci-dessus)

- ~~Nouvelle table de la file, par boutique : produit **ou** service, quantité, libellé, prix
      affiché ou non, auteur, date — migration testée contre un vrai SQLite~~
- ~~Ajouter, modifier, retirer une entrée de la file ; routes par identifiant gardées par
      l'appartenance à la boutique (garde-fou statique d'isolation vert)~~
- ~~La file est partagée par toute la boutique et invisible des autres boutiques~~
- ~~Impression navigateur par le moteur d'impression existant : page de deux cellules de
      35 × 25 mm, nombre d'étiquettes **arrondi au pair** avec un avertissement~~
- ~~Chaque étiquette porte le libellé, le code-barres (rendu JsBarcode, sans référence
      `/static/...` codée en dur dans un gabarit JS) et le prix seulement s'il est coché~~
- ~~Un article sans code-barres ne peut pas être mis en file (message)~~
- ~~La file est vidée après impression~~ — vidage sur confirmation, entrées imprimées seulement (décision 1)
- ~~E2E : ajouter trois étiquettes, voir l'arrondi à quatre, déclencher l'impression, relire la
      file vide ; vus rouges d'abord~~
- ~~`npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées~~
