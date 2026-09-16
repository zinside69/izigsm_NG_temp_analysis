# La vente lit le catalogue — matière de grilling

_Écrit le 2026-09-16. Chantier ouvert par une mesure faite pendant le grilling de la
tarification : le prix calculé dans le catalogue **n'atteint jamais une vente**. Décision de
l'exploitant : « la vente doit lire le catalogue, on commence par ça. » La tarification attend —
sa matière vit dans `.scratch/tarification-boutique/matiere-grilling.md`._

## 1. Le problème

Aujourd'hui, vendre une coque au comptoir, c'est **retaper à la main** sa désignation, son prix
et son taux de TVA. Le catalogue produits existe, le catalogue services existe, et aucun des deux
n'est consulté au moment de la vente.

Conséquences immédiates, toutes mesurées :

- le prix de vente du catalogue ne sert à rien en caisse — il n'est jamais lu ;
- le stock **ne bouge pas** lors d'une vente au comptoir, puisque la ligne ne porte aucun
  `produit_id` ;
- aucune statistique n'est possible par produit ni par prestation : les lignes ne portent que du
  texte libre ;
- la désignation dépend de qui tape : « coque iph 12 », « Coque iPhone12 », « coque silicone »…

## 2. Faits mesurés (2026-09-16)

### La caisse

| Fait | Emplacement |
|---|---|
| La ligne naît vide : `designation: ''`, `prix_unitaire_ht: 0`, tout est saisi à la main. **Aucun sélecteur de produit ni de service.** | `caisse.js:363-371`, rendu `:422-448` |
| L'API **accepte** `produit_id` et `service_id` sur une ligne… | `caisse.ts:199-207` |
| …mais **`service_id` est ignoré** : la colonne n'existe pas dans `lignes_document`. Le lien vente ↔ service catalogue est perdu **en silence**. | `0006_facturation.sql:64-80` |
| Si `produit_id` est fourni, le stock est décrémenté et un mouvement « Vente POS » est écrit. **Ce chemin n'a jamais servi**, l'écran n'envoyant jamais d'identifiant. | `caisseService.ts:375-403` |
| **Aucun contrôle de stock** : `stockApres = Math.max(0, stockAvant - quantite)` → le stock est **écrêté à 0**, jamais négatif, sans avertissement. | `caisseService.ts:385` |
| Produit inconnu de la boutique → **aucune erreur, aucun mouvement**, la vente passe quand même. | `caisseService.ts:381-382` |
| `remise_pct` est accepté mais **non validé**, et la ligne stockée est incohérente quand il est non nul (prix brut, totaux nets). | `caisse.ts:206`, `caisseService.ts:357-373` |

### Les devis et les factures

- Saisie **100 % libre** elle aussi : `devis.js:480-485` et `factures.js:513-518` n'envoient que
  `{description, quantite, prix_unitaire_ht, tva_taux}`.
- `upsertLignes()` **accepte** pourtant `produit_id` (`devisService.ts:20-25`) — l'écran ne
  l'envoie jamais.
- `POST /api/factures` **force `produit_id` à NULL** à l'insertion (`factureService.ts:556-566`).

### Les tickets de réparation

- **Aucune table de lignes.** Le travail réalisé vit dans `description_panne`, `diagnostic`,
  `notes_internes`, `prix_estime`, `prix_final` (`0004_tickets.sql`). Aucune table
  `ticket_lignes` / `interventions` / `pieces_utilisees` n'existe.
- `tickets.html:208-211` + `tickets.js:1967-1989` affichent **les services du modèle en cases à
  cocher, avec leur prix** — et **la sélection n'est jamais relue** : le formulaire n'envoie ni
  `services` ni `service_id`. Fonctionnalité morte.
- Facturer un ticket ne remonte **rien** : l'acompte insère une ligne « Acompte » codée en dur
  (`factureService.ts:406-411`) ; le seul pré-remplissage passe par **localStorage**, avec une
  seule ligne (`tickets.js:1127` → `devis.js:747-775`).

### Ce sur quoi s'appuyer

- **Précédent d'interaction** : le bon de commande fournisseur transforme déjà des produits
  cochés en lignes porteuses de `produit_id`, gardé dans un champ caché
  (`fournisseurs.js:625`, `:668-681`, `:373`, `:414`).
- **Précédent d'autocomplete** : `GET /api/services/modeles` est déjà consommé en recherche
  incrémentale par `tickets.js:1915` et `:2031`.
- **Endpoints existants** : `GET /api/produits` (`search` → nom, SKU, marque ; `limit` plafonné à
  100) et `GET /api/services` (`search` → nom, référence, description).
- ⚠ **La recherche produits ne couvre pas `code_barre`**, alors que la colonne existe
  (`0005_stocks.sql:33`). C'est un prérequis du scan.

## 3. Décisions prises

1. **La vente doit lire le catalogue** — décision de l'exploitant, ce chantier passe devant la
   tarification.
2. **Une douchette code-barres est utilisée au comptoir.** Le scan fait donc partie du chantier,
   et la recherche produits doit être étendue à `code_barre`.
3. La **saisie libre reste possible** : le sélecteur propose, il ne s'impose pas.

## 4. Frontière du grilling — premier état

_Complétée par les sections 6 à 8, écrites plus tard dans la même session._

### Tranché

- Q3 — douchette : **oui**, elle est utilisée ; le scan entre dans le périmètre.

### Ouvert

1. **Rupture de stock en caisse** : laisser le stock devenir négatif (honnête, mais contamine
   KPI, page Stock et « à commander »), garder l'écrêtage à 0 avec un avertissement, ou refuser
   la vente ? _Recommandation : écrêtage + avertissement ; le négatif mérite son propre cadrage._
2. **Ligne modifiable après sélection** : tout modifiable, prix verrouillé sauf manager, ou tout
   verrouillé ? _Recommandation : tout modifiable tant que le prix plancher n'existe pas._
3. **Une recherche ou deux** pour les produits et les services ? _Recommandation : une seule._
4. **Premier écran** : caisse, devis, ou les deux ? _Recommandation : la caisse._
5. **`service_id` sur `lignes_document`** : ajouter la colonne (`ALTER TABLE ADD COLUMN`) pour
   pouvoir compter les prestations vendues, ou se contenter de copier la désignation ?
   _Recommandation : ajouter._
6. **Les services suggérés du ticket** : hors périmètre (en traitant les cases mortes), ou
   intégrés — ce qui suppose de créer de vraies lignes de ticket ? _Recommandation : hors
   périmètre pour livrer la caisse, chantier suivant pour les lignes de ticket._

### Ouvert par la douchette (round suivant)

7. **EAN scanné correspondant à plusieurs produits** : proposer la liste, ou prendre le premier ?
8. **EAN inconnu du catalogue** : message seul, ou proposition de créer la fiche produit ?
9. **Scan d'un produit déjà dans le panier** : incrémenter la quantité, ou ajouter une ligne ?
10. **Le champ de scan** : toujours actif sur l'écran de caisse (la douchette tape comme un
    clavier), ou dans un champ dédié qu'il faut viser ?

## 5. Contraintes du dépôt à respecter

- `lignes_document` alimente la facturation **NF525** : ses totaux sont stockés « pour
  inaltérabilité » (`0006_facturation.sql:73`). Toute évolution de cette table se pense avec la
  chaîne légale en tête.
- `createVente()` pose les six marques d'immuabilité **après** l'écriture au journal NF525, jamais
  dans l'`INSERT` (`CLAUDE.md` § Factures).
- Le frontend est vanilla, un fichier JS par page, `apiGet`/`apiPost` partagés — et l'enveloppe se
  déballe au point d'appel (`CLAUDE.md` § Enveloppe des réponses API).
- Toute donnée d'API rendue en `innerHTML` passe par un échappeur : un nom de produit est une
  saisie utilisateur (`CLAUDE.md` § Gabarits et XSS stockée).
- `CACHE_VERSION` (`public/sw.js`) à incrémenter sur la dernière tâche frontend du chantier.

## 6. Étiquettes et codes-barres maison — décisions de l'exploitant (2026-09-16)

Besoin énoncé : **« offrir la possibilité de créer nous aussi des étiquettes avec codes-barres,
en dehors des fournisseurs, pour des produits et services internes »**. Ce n'est pas un
rattrapage des articles sans code, c'est une capacité permanente.

### Le code

| Décision | Détail |
|---|---|
| **Plage** | préfixe `2` — plage GS1 « circulation restreinte », interne à l'entreprise, jamais confondue avec un article référencé mondialement |
| **Format** | `2` + **type** (1 = produit, 2 = service) + identifiant sur 10 chiffres + clé calculée par JsBarcode |
| **Stocké, pas déduit** | dans `produits.code_barre` comme les EAN fournisseurs ; une colonne `code_barre` à créer sur `services`. Un code qu'on ne peut ni lire dans la fiche, ni chercher, ni corriger finit par ne pas exister pour ses utilisateurs |
| **Qui en reçoit un** | **tout produit créé hors import grossiste**, quelle que soit sa famille. Règle par **origine**, pas par famille : un appareil d'occasion est de famille `appareil` et doit être étiqueté |
| **Jamais** | pour un article qui porte déjà un EAN fournisseur — on scanne l'étiquette d'origine, on ne crée pas un second code pour un même article |
| **Quand** | à la demande (bouton dans la fiche) **et** automatiquement à la création |
| **Mention « code interne »** | non — « aucune valeur ajoutée » |

### L'occasion : par l'IMEI, pas par un code maison

- Un appareil reconditionné se scanne par son **IMEI** (15 chiffres, Code128). « C'est plus
  simple » : l'étiquette dit alors quelque chose de vrai sur l'appareil, et se recoupe avec la
  facture, la garantie et un éventuel litige.
- **Aucun format à distinguer au scan** : une douchette n'envoie que des chiffres, la longueur
  suffit — **13 = EAN, 15 = IMEI**.
- Dual-SIM : étiqueter le premier IMEI, **chercher sur les deux** (`rachats.imei2` existe).

### L'étiquette

| Décision | Détail |
|---|---|
| **Support** | rouleau thermique **deux pistes**, étiquettes 35 × 25 mm, mandrin 40, 4 000 par rouleau |
| **Impression** | **depuis le navigateur**, via `_triggerPrint()` — comme tout le reste du produit |
| **Deux pistes** | impression **par paires** : l'écran arrondit à l'étiquette supérieure |
| **Quantité** | **1 par défaut**, modifiable |
| **File d'étiquettes** | les étiquettes en attente s'accumulent et s'impriment **en lot**, pour économiser le rouleau. **En base, par boutique** : celui qui déballe en réserve n'est pas celui qui imprime au comptoir |
| **Texte** | un **libellé d'étiquette** saisissable, raccourci, reprenant le nom par défaut — ~20 caractères tiennent sur 35 mm |
| **Prix** | **coché à l'impression** : l'article en vitrine et l'article en réserve n'ont pas le même besoin |
| **Services** | étiquetés sur une **planche de codes** plastifiée au comptoir, scannée pour les prestations courantes |

### Contraintes physiques mesurées

EAN13 nominal : symbole 31,35 mm + zones de silence (3,63 à gauche, 2,31 à droite) = **37,29 mm**,
hauteur 25,93 mm. L'étiquette fait 35 × 25 : il faut donc **réduire à ~94 %** (GS1 tolère 80 à
200 %) et **tronquer la hauteur des barres** à ~15 mm pour loger le libellé. La troncature est
déconseillée par la norme, acceptable ici : ces codes sont **internes**, scannés par la seule
douchette du comptoir. Répartition tenable : libellé ~3,5 mm · barres 15 mm · chiffres 2,5 mm ·
marges 2 mm.

## 7. Faits mesurés — compléments (2026-09-16)

### Le catalogue de production

| Famille | Produits actifs | Sans code-barres |
|---|---|---|
| Pièce | 596 | **9** |
| Accessoire | 182 | 0 |
| Consommable | 26 | 0 |
| **Total** | **804** (2 boutiques, 0 inactif) | 9 |

**0 doublon** d'EAN comme de SKU, tous états confondus — mesuré sur la base **de production**
avant d'écrire la migration `0048`.

Les 9 produits sans code sont **tous des pièces**, famille que l'exploitant ne scanne jamais :
ce n'est donc pas ce qui motive la génération. **Conclusion d'abord tirée puis corrigée par
l'exploitant** — le besoin est la capacité d'étiqueter, pas le rattrapage de ces 9 lignes.

### Codes-barres : la brique existe déjà

- `_renderEan13DataUrl()` (`tickets.js:653`) génère **déjà** des EAN13 en image via **JsBarcode**
  (CDN sous contrôle d'intégrité, `tickets.html:451`), utilisé sur trois documents imprimés.
- ⚠ Sa convention — identifiant zéro-padé, donc code commençant par `0` — **ne convient pas à un
  produit** : c'est la forme d'un UPC-A converti, qui pourrait percuter un vrai code fournisseur.
  D'où le préfixe `2`.

### L'IMEI vit à quatre endroits, jamais sur le produit

| Table | Colonne | Index |
|---|---|---|
| `appareils` (appareil confié par un client) | `imei` | oui |
| `rachats` | `imei`, `imei2` | oui |
| `ordres_reconditionnement` | `imei` | **non** |
| `produits` | — | — |

`ordres_reconditionnement.produit_id` existe (`0021`) et son `prix_revente_ht` « alimente
`prix_vente_ht` du produit » : **un appareil reconditionné est déjà un produit du catalogue**,
avec `grade` (A à D), `couleur`, `capacite`. Pas besoin d'un troisième type dans le code.

⚠ Cas qui décide de la question ouverte n° 1 : un appareil **racheté puis revendu sans
reconditionnement** n'a aucun ordre — son IMEI serait introuvable par jointure.

### Migration écrite ce jour

`migrations/0048_produits_ean_sku_unique.sql` — deux index uniques **partiels**
(`actif = 1`, code non nul et non vide) sur `(boutique_id, code_barre)` et `(boutique_id, sku)`.
Appliquée **en local** uniquement. Prérequis vérifié sur la production : 0 doublon.
⚠ Conséquence non traitée : une création violant l'un de ces index remonte désormais une erreur
SQL brute — `importerProduitMobilax()` sait convertir celle de `0046` en `deja_importe`, la
création manuelle et l'import CSV ne convertissent rien.

## 8. Frontière au terme de la session du 2026-09-16

### Tranché — le parcours IMEI (2026-09-16, fin de session)

- **L'IMEI est porté par le produit** : colonne `imei` sur `produits` (+ index). « Un appareil
  d'occasion en vente **est** un produit ; son identifiant doit être sur lui, pas sur l'historique
  de son reconditionnement. » Migration à écrire.
- **Dual-SIM : sans objet.**
- **Scanner ou saisir un IMEI déclenche un parcours, pas un message** :
  1. **Un ticket de réparation existe** → on **ouvre le ticket en cours**.
  2. **Nouvelle panne hors garantie** → **nouveau ticket**, l'ancien étant **historisé** : un même
     IMEI porte donc plusieurs tickets dans le temps, c'est voulu.
  3. **Dans le cadre d'une garantie** → on ouvre un **dossier SAV** (`/sav`), pas un ticket de
     réparation ordinaire.
  4. **Aucun ticket connu** → interroger une **base d'IMEI** pour obtenir le modèle, puis proposer
     de **créer une prise en charge**, après **validation du technicien**.

⚠ Le point 1 se heurte à un fait mesuré : `tickets.appareil_id` est **nullable** (« NULL si
appareil non enregistré ») et l'IMEI vit sur `appareils`. **Un ticket dont l'appareil n'a pas été
fiché restera introuvable par IMEI.** Question qui en découle, non posée : faut-il rendre l'IMEI
obligatoire à la création d'un ticket ?

### Tranché — résolution du modèle et périmètre

- **Validation locale d'abord** : clé de Luhn sur le 15ᵉ chiffre de l'IMEI, coût nul, écarte un
  scan erroné **avant** tout appel réseau.
- **Puis une API de base d'IMEI, en option par boutique** — même patron que Mobilax
  (`fournisseurs.api_plateforme` + clé chiffrée au repos, `chiffrement.ts`). Une boutique sans
  clé saisit le modèle à la main. ⊥ base TAC embarquée : complétude et licence incertaines.
- **Le scan s'applique partout** (caisse, prise en charge, recherche globale), avec un **routage
  unique par la longueur** : 13 chiffres → produit, 15 → IMEI. Le vendeur ne choisit pas l'écran
  avant de scanner ; ce que le système trouve décide de la suite.

### Ouvert — le parcours IMEI

1. **« La validation doit aller jusqu'au bout »** — deux lectures possibles de la consigne de
   l'exploitant, à lever avant d'implémenter :
   - (A) la prise en charge est **créée complète au comptoir**, le client repart avec son
     document signé ; la validation technique se fait ensuite, sans bloquer personne ;
   - (B) le **technicien valide immédiatement**, le parcours n'étant jamais laissé en brouillon.
   La différence porte sur ce qui se passe quand **aucun technicien n'est disponible**.
2. **Tickets sans appareil fiché** : `tickets.appareil_id` est nullable, donc un ticket dont
   l'appareil n'a pas été enregistré est introuvable par IMEI. Rendre l'IMEI obligatoire à la
   création d'un ticket ?

### Ouvert — le sélecteur lui-même (round 2, jamais tranché)

4. **Rupture de stock en caisse** : négatif, écrêtage à 0 avec avertissement, ou refus ?
5. **Ligne modifiable** après sélection dans le catalogue ?
6. **Une recherche ou deux** pour les produits et les services ?
7. **Premier écran** : caisse, devis, ou les deux ?
8. **`service_id` sur `lignes_document`** : ajouter la colonne ?
9. **Services suggérés du ticket** : hors périmètre, ou lignes de ticket ?

### Rappel

Le chantier **tarification** (grille de prix, coefficients, planchers, 3 méthodes de calcul des
réparations) reste en attente derrière celui-ci :
`.scratch/tarification-boutique/matiere-grilling.md`, 8 décisions y sont ouvertes.
