---
chantier: vente-lit-catalogue
statut: ready-for-agent
date: 2026-09-17
---

# Spec — La vente lit le catalogue

Cadré les 2026-09-16 et 2026-09-17 par `/grill-with-docs` — matière, mesures et décisions :
`.scratch/vente-lit-catalogue/matiere-grilling.md` ; décisions : `project-docs/decisions.md`
§ 2026-09-16 ; vocabulaire : `CONTEXT.md` (Code-barres, SKU, Code maison, File d'étiquettes,
Appareil, Ligne de ticket, Pose, Garantie, Nouvelle panne hors garantie). Chantier prioritaire
(🔴 P1) ; le chantier **tarification par boutique** attend derrière lui et trouvera dans les
lignes de ticket le support de ses trois méthodes de calcul.

## Problem Statement

Au comptoir, le vendeur retape tout : pour vendre une coque, il saisit à la main sa désignation,
son prix et son taux de TVA, alors que le produit existe dans le stock avec tout cela. La douchette
posée sur le comptoir ne sert à rien — la caisse ne sait pas lire un code-barres. Le catalogue des
services, lui aussi, est ignoré.

Conséquences vécues, toutes mesurées :

- **le stock ne bouge pas quand on vend** : aucune ligne de caisse ne dit quel produit est parti ;
- les désignations dépendent de qui tape, et aucune statistique n'est possible ni par produit ni
  par service ;
- un prix calculé dans le catalogue n'atteint jamais le client.

Côté atelier, c'est pire : **un ticket de réparation ne porte aucune ligne**. Le travail réalisé
tient dans des champs de texte et deux prix saisis à la main. L'écran de prise en charge propose
bien les réparations du modèle avec leur prix, en cases à cocher — mais **cocher ne fait rien** :
rien n'est enregistré, rien n'arrive sur la facture. Facturer un ticket, c'est tout recopier. La
pièce posée ne sort pas du stock, et le coût d'une réparation sous garantie est invisible.

Enfin, les garanties ne suivent pas la politique de l'exploitant (écran 6 mois, autres réparations
3 mois, hors casse et oxydation) : la base n'admet **qu'une durée par boutique** et **qu'une garantie
par ticket**. Et un appareil ne peut être retrouvé par son IMEI que s'il a été fiché — ce qui n'est
pas toujours possible quand il est hors d'usage.

## Solution

**La caisse va chercher dans le catalogue.** Une seule recherche trouve les produits, les services
et les dossiers SAV. La douchette ajoute directement l'article scanné, sans viser de champ : un code
de 13 chiffres est un code-barres, un code de 15 chiffres un IMEI. Choisir un produit remplit la
ligne — qui reste entièrement modifiable — et vendre le sort du stock. Ce qui n'a pas de code
fournisseur reçoit un **code maison**, et une **file d'étiquettes** permet d'imprimer ces codes par
lots sur le rouleau du comptoir.

**Scanner un IMEI ouvre le bon dossier.** Un appareil encore à l'atelier ouvre son ticket. Un
appareil sous garantie affiche ce qui est couvert et jusqu'à quand : le vendeur dit s'il s'agit de
la même panne (dossier SAV) ou non, motif à l'appui (nouveau ticket). Un appareil inconnu voit son
IMEI vérifié, son modèle éventuellement résolu, et une prise en charge proposée — créée complète au
comptoir, validée ensuite par un technicien, sans faire attendre le client.

**Le ticket porte enfin des lignes** : services du catalogue, pièces du stock, lignes libres. Les
réparations cochées à la prise en charge en deviennent. La pièce sort du stock quand un technicien
la **pose**, une pièce manquante part « à commander » avec le numéro du ticket, et le prix du
ticket est la somme de ses lignes. Ces lignes forment le **devis**, accepté au comptoir ou en ligne,
qui devient la **facture** sans ressaisie — l'identité de l'appareil y étant **figée**. Chaque
réparation de service ouvre **sa propre garantie**, à la durée que la boutique a fixée pour ce
service. Un dossier SAV porte lui aussi des lignes, facturées 0 € mais dont le coût est tracé.

Livraison en **deux lots ordonnés** : la caisse d'abord, les tickets ensuite, avec le même
sélecteur.

## User Stories

### Lot 1 — La caisse

**Recherche et ajout**

1. En tant que vendeur, je veux une seule recherche au comptoir, afin de trouver ce que je vends
   sans savoir d'avance s'il s'agit d'un produit ou d'un service.
2. En tant que vendeur, je veux trouver un produit par son nom, son SKU ou son code-barres, afin de
   retrouver un article quel que soit le moyen que j'ai sous la main.
3. En tant que vendeur, je veux que chaque résultat indique sa nature (produit, service, dossier
   SAV), afin de ne pas confondre une coque et une pose de film portant le même mot.
4. En tant que vendeur, je veux que choisir un produit ou un service ajoute une ligne remplie avec sa
   désignation, son prix et son taux de TVA, afin de ne plus rien retaper.
5. En tant que vendeur, je veux pouvoir modifier la désignation, la quantité et le prix d'une ligne
   venue du catalogue, afin d'adapter la vente au client en face de moi.
6. En tant que vendeur, je veux pouvoir toujours saisir une ligne entièrement à la main, afin de
   vendre ce qui n'existe pas au catalogue.
7. En tant que vendeur, je veux que la recherche trouve aussi les dossiers SAV, et que choisir un
   dossier l'ouvre sans rien ajouter au panier, afin de répondre à un client venu pour un retour.

**Douchette**

8. En tant que vendeur, je veux scanner un code-barres sans avoir à cliquer dans un champ, afin de
   ne pas perdre un geste à chaque article.
9. En tant que vendeur, je veux qu'un scan pendant que je tape dans un champ de saisie ne soit pas
   détourné vers la vente, afin de ne pas ajouter un article en écrivant une désignation.
10. En tant que vendeur, je veux qu'un code-barres connu ajoute immédiatement sa ligne, afin
    d'enchaîner les articles.
11. En tant que vendeur, je veux que scanner deux fois le même article augmente la quantité de sa
    ligne, afin qu'un ticket client ne porte pas deux lignes identiques.
12. En tant que vendeur, je veux que scanner l'étiquette d'un lot fournisseur (« ×10 ») ajoute une
    seule unité, afin de vendre à l'unité ce que j'achète par dix.
13. En tant que vendeur, je veux qu'un code-barres inconnu me le dise et me propose de créer la fiche
    produit avec ce code déjà rempli, afin d'enregistrer l'article pendant que je l'ai en main.
14. En tant que vendeur, je veux que, si un code-barres désignait malgré tout deux produits, les
    deux me soient proposés, afin de ne jamais vendre un coloris tiré au hasard.
15. En tant que vendeur, je veux que le scan fonctionne aussi à la prise en charge et dans la
    recherche générale, afin de ne pas avoir à choisir l'écran avant de scanner.

**Stock et prix à la vente**

16. En tant que responsable de boutique, je veux que vendre un produit le sorte du stock avec un
    mouvement tracé, afin que mon stock reflète ce qui est réellement parti.
17. En tant que vendeur, je veux pouvoir vendre un article dont le stock affiché est à zéro, avec un
    avertissement, afin de ne jamais refuser une vente parce que l'inventaire est faux.
18. En tant que responsable de boutique, je veux que le stock ne passe jamais sous zéro, afin que
    mes compteurs et ma liste « à commander » restent lisibles.
19. En tant que vendeur, je veux qu'un produit dont le prix de vente est de 0 € me soit signalé et
    que la vente ne puisse pas être validée tant que je n'ai pas saisi un prix, afin de ne rien
    donner par erreur.
20. En tant que responsable de boutique, je veux que chaque service vendu reste relié au catalogue,
    afin de savoir combien de poses de film j'ai vendues, même après avoir renommé le service.

**Occasion**

21. En tant que vendeur, je veux retrouver un téléphone d'occasion en scannant son IMEI, afin de le
    vendre sans lui coller un second code.
22. En tant que client, je veux que le ticket de caisse d'un téléphone d'occasion porte son IMEI,
    afin de pouvoir faire jouer la garantie légale sur cet appareil précis.
23. En tant que responsable de boutique, je veux que l'IMEI d'un appareil en vente soit porté par sa
    fiche produit, afin de le retrouver même s'il n'est jamais passé par un reconditionnement.

**Codes maison et étiquettes**

24. En tant que responsable de boutique, je veux que tout produit que je crée hors import
    fournisseur reçoive automatiquement un code maison, afin que tout ce que je vends soit
    scannable.
25. En tant que responsable de boutique, je veux pouvoir générer un code maison depuis la fiche d'un
    produit qui n'en a pas, afin de rattraper un article existant.
26. En tant que responsable de boutique, je veux qu'un article portant déjà l'EAN de son fournisseur
    ne reçoive jamais de code maison, afin qu'un même article n'ait jamais deux codes.
27. En tant que responsable de boutique, je veux que mes services puissent recevoir un code maison,
    afin de les imprimer sur une planche de codes posée au comptoir.
28. En tant que vendeur, je veux scanner un service sur la planche du comptoir, afin de l'ajouter
    plus vite qu'en le cherchant.
29. En tant que responsable de boutique, je veux que le code maison soit visible et cherchable dans
    la fiche, afin de le retrouver et de le corriger comme n'importe quel code.
30. En tant qu'opérateur du stock, je veux ajouter un article à la file d'étiquettes avec une
    quantité (1 par défaut), afin de préparer les étiquettes au fil du déballage.
31. En tant qu'opérateur du stock, je veux que la file soit partagée par toute la boutique, afin que
    le collègue du comptoir imprime ce que j'ai préparé en réserve.
32. En tant que vendeur, je veux imprimer la file en une fois depuis le navigateur, afin de ne pas
    déclencher une impression par étiquette.
33. En tant que vendeur, je veux que l'impression se fasse par paires, en arrondissant si besoin, afin
    de ne pas gâcher d'étiquettes sur mon rouleau à deux pistes.
34. En tant que vendeur, je veux un libellé d'étiquette court, prérempli et modifiable, afin qu'il
    reste lisible sur une étiquette de 35 × 25 mm.
35. En tant que vendeur, je veux choisir à l'impression d'afficher ou non le prix, afin d'étiqueter
    différemment la vitrine et la réserve.
36. En tant que responsable de boutique, je veux que créer un produit avec un code-barres ou un SKU
    déjà utilisé me dise quel produit le porte, afin de corriger le doublon au lieu de subir une
    erreur incompréhensible.

### Lot 1 — Le parcours IMEI

37. En tant que vendeur, je veux que scanner ou saisir l'IMEI d'un appareil encore à l'atelier ouvre
    son ticket, afin de répondre au client sans chercher.
38. En tant que vendeur, je veux qu'un IMEI mal saisi soit refusé immédiatement grâce à sa clé de
    contrôle, afin de ne pas lancer de recherche sur un numéro faux.
39. En tant que vendeur, je veux, pour un appareil sous garantie, voir les réparations encore
    couvertes et leur date de fin, afin de juger si la nouvelle panne est couverte.
40. En tant que vendeur, je veux répondre « même panne » pour ouvrir un dossier SAV, afin que le
    client ne paie pas ce qui est garanti.
41. En tant que vendeur, je veux répondre « autre panne » en choisissant un motif (autre panne,
    casse, oxydation, garantie expirée), afin d'ouvrir un nouveau ticket payant avec une raison
    opposable au client.
42. En tant que technicien, je veux pouvoir requalifier cette décision après examen, afin de corriger
    un jugement du comptoir sans que le client ait attendu.
43. En tant que vendeur, je veux, pour un appareil inconnu, voir son modèle résolu à partir de
    l'IMEI quand ma boutique a configuré ce service, afin de préremplir la prise en charge.
44. En tant que vendeur d'une boutique sans ce service, je veux saisir le modèle à la main, afin de
    ne pas dépendre d'un abonnement.
45. En tant que responsable de boutique, je veux configurer la clé de mon service de base d'IMEI,
    conservée chiffrée, afin d'activer la résolution du modèle.
46. En tant que vendeur, je veux créer une prise en charge complète au comptoir, le client repartant
    avec son document, afin de ne pas le faire attendre qu'un technicien se libère.
47. En tant que technicien, je veux valider ensuite une prise en charge créée au comptoir, afin
    qu'aucune réparation ne démarre sans que je l'aie vue.

### Lot 2 — Les lignes de ticket

48. En tant que technicien, je veux ajouter à un ticket une réparation du catalogue, avec le prix
    prévu pour ce modèle, afin de chiffrer mon travail.
49. En tant que technicien, je veux ajouter une pièce du stock à un ticket, afin de savoir ce que la
    réparation consomme.
50. En tant que technicien, je veux ajouter une ligne libre, afin de noter une intervention que le
    catalogue ne prévoit pas.
51. En tant que vendeur, je veux que les réparations cochées à la prise en charge deviennent des
    lignes du ticket, afin que ce choix serve enfin à quelque chose.
52. En tant que vendeur, je veux utiliser le même sélecteur qu'en caisse pour ajouter des lignes à un
    ticket, afin de ne pas apprendre deux façons de faire.
53. En tant que responsable de boutique, je veux que le prix d'un ticket soit la somme de ses lignes,
    afin que le ticket et la facture ne divergent jamais.
54. En tant que responsable de boutique, je veux que les anciens tickets gardent le prix saisi à la
    main, afin que rien ne change sur ce qui existe déjà.
55. En tant que technicien, je veux marquer une pièce comme posée, afin qu'elle sorte du stock au
    moment réel où elle est montée.
56. En tant que technicien, je veux pouvoir marquer la pose d'un ticket qui n'est pas le mien, afin de
    terminer la réparation d'un collègue.
57. En tant que responsable de boutique, je veux savoir qui a posé chaque pièce, afin de pouvoir
    remonter une erreur.
58. En tant que responsable de boutique, je veux qu'une pièce ne sorte jamais deux fois du stock,
    afin qu'aucune conversion ni aucune reprise ne fausse l'inventaire.
59. En tant que technicien, je veux qu'une pièce absente du stock ajoutée à un ticket passe « à
    commander » avec le numéro du ticket, afin de savoir pour quel client je commande.
60. En tant que vendeur, je veux voir qu'un ticket attend une pièce, afin de renseigner le client.
61. En tant que vendeur, je veux qu'un devis refusé ne fasse rien bouger dans le stock, afin de ne
    pas avoir à corriger l'inventaire.

### Lot 2 — Identité de l'appareil, devis et facture

62. En tant que vendeur, je veux créer un ticket sans IMEI ni numéro de série, afin de prendre en
    charge un appareil hors d'usage dont je ne peux rien lire.
63. En tant que responsable de boutique, je veux qu'aucun devis ni aucune facture ne puisse être
    produit tant que l'appareil n'a ni IMEI ni numéro de série, afin que le document identifie
    l'appareil réparé.
64. En tant que technicien, je veux pouvoir saisir l'IMEI ou le numéro de série au moment de la
    réparation, afin de lever ce blocage quand l'appareil redevient lisible.
65. En tant que responsable de boutique, je veux que l'un des deux identifiants suffise, afin de
    réparer aussi les tablettes, ordinateurs et consoles qui n'ont pas d'IMEI.
66. En tant que vendeur, je veux générer le devis d'un ticket à partir de ses lignes, sans ressaisie,
    afin de chiffrer la réparation en un geste.
67. En tant que client, je veux accepter le devis en signant au comptoir, afin de lancer la
    réparation sur place.
68. En tant que client, je veux accepter le devis en ligne par le lien reçu, afin de répondre sans me
    déplacer quand le prix n'est connu qu'après diagnostic.
69. En tant que vendeur, je veux convertir un devis accepté en facture en gardant les lignes, afin de
    facturer sans rien retaper.
70. En tant que client, je veux que ma facture porte la marque, le modèle et l'IMEI ou le numéro de
    série de mon appareil, afin de faire valoir la garantie.
71. En tant que responsable de boutique, je veux que ces informations soient figées à l'émission,
    afin qu'une correction ultérieure de la fiche appareil ne modifie jamais une facture émise.
72. En tant que vendeur, je veux clore un ticket en « devis refusé », afin de rendre l'appareil.
73. En tant que vendeur, je veux décider au cas par cas de facturer un forfait de diagnostic sur un
    devis refusé, afin de tenir compte de chaque situation.

### Lot 2 — Garanties et SAV

74. En tant que responsable de boutique, je veux fixer la durée de garantie de chaque service de mon
    catalogue, afin d'appliquer ma politique (écran 6 mois, autres réparations 3 mois).
75. En tant que client, je veux que chaque réparation de mon ticket soit garantie selon sa propre
    durée, afin que mon écran reste couvert 6 mois même si ma batterie ne l'est que 3.
76. En tant que responsable de boutique, je veux que les garanties déjà émises restent valables telles
    quelles, afin de ne rien retirer à mes clients actuels.
77. En tant que vendeur, je veux que les exclusions de garantie (casse, oxydation) soient connues de
    l'écran, afin de motifier un refus de prise en charge.
78. En tant que technicien, je veux ajouter des lignes à un dossier SAV, facturées 0 €, afin de tracer
    ce que la reprise a consommé.
79. En tant que responsable de boutique, je veux qu'une pièce posée sous garantie sorte du stock et
    que son coût soit conservé, afin de savoir combien me coûtent mes garanties.

## Implementation Decisions

**Découpage**

- Deux lots, livrés et déployés dans cet ordre : **lot 1 — caisse** (recherche unifiée, scan, codes
  maison, file d'étiquettes, IMEI du produit, parcours IMEI) ; **lot 2 — tickets** (lignes de
  ticket, pose, devis et facture depuis le ticket, identité de l'appareil figée, garanties par
  ligne, lignes de SAV). Le lot 2 réutilise le sélecteur du lot 1.

**Recherche et scan**

- **Une recherche catalogue unifiée**, exposée par une route de lecture propre à la boutique
  consultée, qui rend des résultats typés — produit, service, dossier SAV, ticket — avec un plafond
  de résultats. Elle couvre : produits par nom, SKU, **code-barres** et **IMEI** ; services par nom,
  référence et code-barres ; tickets et dossiers SAV par IMEI ou numéro de série de l'appareil. La
  recherche produits actuelle ne couvre pas le code-barres : c'est un manque à combler.
- **Routage d'un scan par sa longueur**, fonction pure partagée : 13 chiffres → code-barres (produit
  ou service), 15 chiffres → IMEI. Toute autre saisie → recherche texte.
- **Clé de Luhn**, fonction pure : un IMEI dont le 15ᵉ chiffre est faux est refusé **avant** tout
  appel, local ou distant.
- La capture de la douchette est **globale** sur les écrans concernés (la douchette tape comme un
  clavier, puis un retour chariot) et **neutralisée** quand le focus est dans un champ de saisie.
- Scan d'un code déjà présent dans le panier → la quantité de sa ligne augmente. Un lot fournisseur
  scanné vaut **une unité**.
- Code-barres correspondant à plusieurs produits → la liste est proposée ; code inconnu → message
  et proposition de créer la fiche produit, code prérempli.

**Codes maison**

- Format : **`2` + type (1 = produit, 2 = service) + identifiant sur 10 chiffres + clé EAN13**. La
  construction et le calcul de la clé sont une **fonction pure côté serveur** ; le rendu graphique
  reste côté navigateur (JsBarcode, déjà chargé par l'étiquette technicien — sa convention
  zéro-padée ne s'applique pas ici).
- Le code est **stocké** : dans le code-barres du produit, et dans une nouvelle colonne code-barres
  des services (avec son index unique partiel par boutique).
- **Génération automatique à la création de tout produit hors import fournisseur**, par le passage
  obligé de création de produit — jamais par un chemin qui réécrirait la règle. Plus une action de
  génération à la demande, refusée si le produit porte déjà un code.
- Un produit portant un code fournisseur n'en reçoit jamais. Un appareil d'occasion se désigne par
  son IMEI, pas par un code maison.

**IMEI du produit**

- Nouvelle colonne **IMEI sur les produits**, avec un index unique partiel par boutique sur les
  produits actifs. Elle est portée par le produit, pas par l'ordre de reconditionnement : un
  appareil racheté puis revendu sans reconditionnement doit être trouvable.

**File d'étiquettes**

- Nouvelle table par boutique : article visé (produit **ou** service), quantité (1 par défaut),
  libellé d'étiquette, prix affiché ou non, auteur, date. Vidée à l'impression.
- Impression depuis le navigateur par le moteur d'impression existant, page aux dimensions du
  rouleau (deux cellules de 35 × 25 mm), **nombre d'étiquettes arrondi au pair**. Code réduit
  d'environ 94 % et barres tronquées à ~15 mm pour loger le libellé — acceptable pour des codes à
  circulation restreinte lus par la seule douchette du comptoir.

**Vente en caisse**

- **La vente reçoit l'identifiant du produit ou du service** de chaque ligne venue du catalogue.
- **Nouvelle colonne `service_id` sur les lignes de document** (ajout de colonne, sans recréation de
  table). La vente la renseigne ; la route de caisse l'acceptait déjà sans l'écrire.
- Stock : **écrêtage à 0** conservé, mais la réponse de la vente **signale** chaque ligne dont le
  stock était insuffisant, et l'écran l'affiche. Le stock négatif n'est pas introduit.
- Une ligne à 0 € venue du catalogue est mise en évidence et bloque la validation **à l'écran**. Le
  serveur conserve sa règle actuelle (prix ≥ 0), une ligne gratuite restant légitime ailleurs.
- **Identité de l'appareil figée** sur la vente d'un produit qui porte un IMEI, au site de figeage
  existant de la vente — après l'écriture au journal NF525, comme les autres marques.

**Parcours IMEI**

- Ordre de résolution : ticket non rendu pour cet appareil → l'ouvrir ; sinon garantie active →
  écran de décision ; sinon → prise en charge proposée.
- **Écran de décision** : réparations encore garanties et dates de fin ; « même panne » ouvre un
  dossier SAV ; « autre panne » exige un motif parmi **autre panne, casse, oxydation, garantie
  expirée**, conservé sur le ticket créé. Le technicien peut requalifier (SAV ↔ ticket payant),
  la requalification étant tracée.
- **Service de base d'IMEI en option par boutique**, sur le patron du fournisseur connecté :
  plateforme déclarée, clé **chiffrée au repos**, jamais renvoyée par une route. Le prestataire est
  choisi à l'implémentation. Sans configuration, le modèle se saisit à la main.
- **Prise en charge créée complète au comptoir**, puis **validée par un technicien** : un état de
  validation technique sur le ticket, qui ne bloque ni la remise du document au client ni la suite
  du parcours au comptoir.

**Lignes de ticket (lot 2)**

- Nouvelle table de lignes rattachée **à un ticket ou à un dossier SAV** : nature (service, pièce,
  libre), produit ou service visé, désignation, quantité, prix unitaire HT, taux de TVA, **coût
  unitaire** (conservé pour tracer le coût des garanties), état de la pièce (disponible, à
  commander), **date et auteur de la pose**.
- Le **prix d'un ticket** est calculé depuis ses lignes. Les prix saisis à la main restent lus pour
  les tickets qui n'ont aucune ligne.
- **Pose** : action sur une ligne de pièce, ouverte à tout technicien de la boutique ; elle écrit
  **un** mouvement de stock (sortie, motif lié au ticket) et refuse une seconde pose. Écrêtage à 0
  comme en caisse.
- Pièce absente du stock ajoutée → la ligne est « à commander » et apparaît dans la liste « à
  commander » **avec le ticket** qui l'attend ; le ticket l'affiche.
- Les réparations cochées à la prise en charge sont envoyées et deviennent des lignes de service.

**Devis et facture depuis le ticket (lot 2)**

- **Génération du devis côté serveur** à partir des lignes du ticket, identifiants de produit et de
  service recopiés — le passage actuel par le stockage du navigateur, qui ne reprenait qu'une ligne,
  est remplacé.
- **Garde d'identifiant** à la génération d'un devis et à la création d'une facture liée à un
  ticket : refus explicite tant que l'appareil n'a **ni IMEI ni numéro de série**. Aucune garde à la
  création du ticket.
- La **conversion devis → facture ne décrémente jamais le stock** : la sortie a eu lieu à la pose.
- **Identité de l'appareil figée à l'émission** (marque, modèle, IMEI ou numéro de série), sur le
  modèle des instantanés vendeur et acheteur, au site de figeage existant de l'émission. Aucun
  troisième site de figeage.
- Acceptation du devis : la **page publique** existante (lien) et une **signature au comptoir**. La
  signature reste « simulée » au sens où l'entend le schéma : elle ne doit pas être présentée comme
  une signature électronique qualifiée.
- Devis refusé → le ticket se clôt dans un état « devis refusé » ; un forfait de diagnostic, pris au
  catalogue de services, peut être facturé au cas par cas.

**Garanties (lot 2)**

- **Une garantie par ligne de service** : l'index unique « une garantie active par ticket » est
  retiré et remplacé par une unicité par ligne. La durée vient du **service** (colonne déjà
  présente, jamais lue jusqu'ici), avec repli sur la durée par défaut de la boutique. Les lignes de
  pièce et les lignes libres n'ouvrent pas de garantie propre.
- Les garanties existantes, créées par ticket, restent valables et lisibles.
- Dossier SAV : ses lignes sont facturées 0 €, la pose sort la pièce du stock, le coût unitaire est
  conservé.

**Unicité des codes**

- La migration d'unicité du code-barres et du SKU, déjà écrite et appliquée en local, part **avec
  ce chantier**. La création manuelle et l'import CSV convertissent sa violation en message nommant
  le produit existant, comme l'import fournisseur le fait déjà pour sa propre contrainte.

**Invariants à respecter**

- Toute nouvelle route par identifiant vérifie l'appartenance à la boutique et passe le garde-fou
  statique d'isolation.
- Les écrans déballent l'enveloppe de réponse au point d'appel ; toute donnée rendue en HTML est
  échappée (un nom de produit est une saisie utilisateur).
- Toute migration sur laquelle s'appuie le code est appliquée à distance **avant** le déploiement.
- Le numéro de version du cache est incrémenté sur la dernière tâche d'écran de chaque lot.

## Testing Decisions

**Ce qu'est un bon test ici** : il observe un comportement visible de l'extérieur — un écran rendu,
une réponse d'API, une ligne en base, un mouvement de stock — jamais un appel interne. Chaque test
est vu **rouge** avant son correctif. Une règle portée par une requête SQL se prouve contre la
**vraie base locale**, jamais contre les bases simulées du dépôt, qui renvoient ce qu'on leur a
configuré quelle que soit la requête.

**Quatre niveaux, validés avec l'exploitant**, du plus haut au plus bas :

1. **Écran** — Playwright sur le vrai serveur local et la vraie base. C'est le niveau principal :
   vendre au scan et voir le stock baisser, scanner un code inconnu, remplir et imprimer la file
   d'étiquettes, scanner un IMEI qui ouvre un ticket ou un SAV, poser une pièce et voir le stock
   bouger une seule fois, générer un devis puis la facture et y lire l'IMEI figé, refuser la
   facturation d'un appareil sans identifiant. Précédents : les E2E de stock initial valorisé, de
   numérotation des factures, et le cas « la caisse enregistre une vente » du balayage du menu. La
   capture de la douchette se simule par une frappe clavier rapide terminée par Entrée.
2. **API** — requêtes directes à l'application : recherche unifiée (types, plafond, boutique du
   jeton, refus sans jeton), garde d'identifiant avant devis, pose refusée une seconde fois, clé du
   service IMEI jamais renvoyée. Précédents : les tests de route des statistiques de notifications
   et de la recherche fournisseur.
3. **Fonctions pures** — clé de Luhn, construction et clé d'un code maison, routage d'un scan par
   longueur, résolution de la durée de garantie d'une ligne (service, puis défaut de la boutique),
   liste des motifs de refus. Précédents : la résolution du taux de marge, le chiffrement.
4. **Migrations** — contre un vrai SQLite : colonne `service_id` sur les lignes de document, IMEI et
   son index sur les produits, code-barres des services, file d'étiquettes, lignes de ticket, levée
   de l'unicité des garanties par ticket. Précédent : le test de la migration des types d'email.

**Gates de chaque ticket** : suite unitaire complète verte (les deux échecs permanents
d'`agendaService` exceptés), compteur d'erreurs de types inchangé, balayage du menu de gauche vert,
serveur local relancé après chaque build et page **servie** contrôlée avant de conclure d'un vert.

## Out of Scope

- **La tarification par boutique** : grille de prix, coefficients, prix plancher et remise maximale,
  trois méthodes de calcul des réparations, nouvelles familles de produits — chantier distinct, en
  attente derrière celui-ci.
- **Le stock négatif** : écarté ; l'écrêtage à 0 reste la règle.
- **La remise de caisse**, aujourd'hui perdue à l'écriture : défaut connu, à traiter à part — il
  touche la chaîne légale.
- **Le sélecteur dans les écrans de devis et de facture saisis à la main** : ce chantier produit les
  devis et factures **depuis les tickets** ; les écrans de saisie manuelle gardent leur
  fonctionnement actuel.
- **Les permissions fines** (remise, modification de prix, prix d'achat), déclarées mais branchées
  nulle part.
- **Une signature électronique qualifiée** (eIDAS).
- **La commande réelle chez le fournisseur** d'une pièce « à commander ».
- **Le rattrapage en lot des tickets sans IMEI** : ils seront complétés au moment de leur
  facturation.
- **L'étiquette maison des articles portant un code fournisseur**, même emballage perdu : on scanne
  l'étiquette d'origine.

## Further Notes

- **Tout est mesuré en préproduction côté Mobilax** ; l'arbre des catégories de production n'a
  jamais été lu. Ce chantier n'en dépend pas, mais le chantier tarification si.
- **Les lignes de document alimentent la facturation NF525.** Y ajouter une colonne est sans
  risque ; ne jamais y recalculer ni y réécrire ce qui a été émis.
- **Deux sites de figeage, pas trois** : la vente et l'émission. L'identité de l'appareil s'y ajoute,
  après l'écriture au journal.
- **État du dépôt au démarrage** : production saine en `izigsm-v3.11`, migration d'unicité des codes
  appliquée en local seulement. Chaque lot se déploie avec ses migrations appliquées à distance
  d'abord, `d1_migrations` distant relu entre les deux commandes.
- **Piège de méthode vécu** : des processus du serveur local d'anciens runs peuvent survivre et
  répondre sur le port de test. Contrôler la page servie avant de conclure d'un E2E vert.
- La spec ne décide pas **le prestataire du service de base d'IMEI** : à choisir au ticket
  correspondant, sur des critères de coût, de couverture des modèles récents et de disponibilité.
