---
titre: Prix de vente en TTC de référence pour toute pièce et tout service
statut: ready-for-agent
cadrage: grilling du 2026-10-04 (Q1 à Q21, `project-docs/decisions.md` § 2026-10-04)
---

# Spec — Prix de vente en TTC de référence

## Problem Statement

Le technicien et le manager d'une boutique raisonnent **toujours en TTC** : c'est le prix affiché au
comptoir, celui que le client paie. Or iziGSM leur fait saisir et lire des prix **HT** partout — fiche
produit, catalogue de services, prix par modèle, ticket, devis, caisse, reconditionnement. Ils
divisent de tête par 1,2 pour saisir et multiplient pour annoncer un prix.

Et même saisi juste, un prix ne reste pas juste : le prix est stocké en HT, et la facture recalcule
le TTC ligne par ligne depuis ce HT arrondi. Une pièce affichée 19,99 € (16,66 € HT) ressort à
59,98 € pour trois exemplaires au lieu de 59,97 € : le client paie un autre prix que celui annoncé.

Enfin, les prix de vente calculés par la marge (import Mobilax) tombent au centime près
(23,49 €) là où une boutique affiche des prix en ,90.

## Solution

Le **prix de vente** de toute pièce, de tout service et de tout prix par modèle devient un **TTC de
référence**, stocké, qui fait foi : le HT et la TVA s'en déduisent. Toutes les saisies et tous les
affichages de prix de vente passent en TTC.

Une ligne de document (caisse, devis, facture, avoir) se calcule **à partir du TTC** : total de ligne
= prix TTC × quantité, le HT et la TVA en sont extraits. Le client paie exactement le prix affiché
multiplié par la quantité.

Un **client professionnel** peut être « servi en HT » (réglage de sa fiche, modifiable sur chaque
document) : ses lignes se calculent alors à partir du HT, selon l'usage entre professionnels.

Le **prix d'achat** reste en HT. Le prix de vente calculé par la marge suit une **règle d'arrondi
réglée par boutique** (au ,90 supérieur par défaut).

Les prix existants sont repris une fois pour toutes (TTC = HT × (1 + taux), au centime), l'ancien HT
conservé ; la liste des prix « non ronds » est remise à l'exploitant.

## User Stories

### Saisie et lecture des prix

1. En tant que manager, je veux saisir le prix de vente d'une pièce en TTC dans sa fiche, afin de ne plus diviser de tête.
2. En tant que manager, je veux voir le HT et la TVA déduits sous le prix TTC de la fiche, afin de contrôler ce que je collecte.
3. En tant que manager, je veux que le prix de vente TTC que je saisis (9,90 €) reste exactement 9,90 € partout, afin que l'étiquette, l'écran et la facture disent la même chose.
4. En tant que manager, je veux saisir le prix d'un service du catalogue en TTC, afin que la main d'œuvre s'annonce comme une pièce.
5. En tant que manager, je veux saisir le prix spécifique d'un service pour un modèle en TTC, afin d'annoncer « écran iPhone 12 : 129 € » tel quel.
6. En tant que technicien, je veux lire la liste du stock avec le prix de vente en TTC, afin de répondre au client sans calcul.
7. En tant que manager, je veux que le prix d'achat reste en HT dans la fiche, afin de le comparer à la facture de mon fournisseur.
8. En tant que manager, je veux voir la marge d'une pièce calculée à partir du HT déduit de mon prix TTC, afin de juger ma rentabilité réelle.
9. En tant que manager, quand je change le taux de TVA d'une fiche, je veux que son HT soit conservé et son TTC recalculé au centime, afin de préserver ma marge (décision Q20).
10. En tant que manager, je veux saisir le prix de revente d'un appareil reconditionné en TTC, afin de l'afficher en vitrine tel quel.

### Ticket et devis

11. En tant que technicien, je veux saisir le prix estimé d'une réparation en TTC à la prise en charge, afin d'annoncer au client le prix qu'il paiera.
12. En tant que technicien, je veux que le prix final d'un ticket soit un TTC, afin qu'il corresponde à l'encaissement.
13. En tant que technicien, je veux que les lignes d'un devis affichent et prennent des prix unitaires TTC, afin que le devis remis au client soit lisible.
14. En tant que client, je veux un devis dont le total TTC est exactement la somme des prix × quantités annoncés, afin de ne pas être surpris d'un centime.
15. En tant que manager, je veux que les devis et factures en brouillon existant au passage au TTC gardent leurs montants, afin qu'un devis déjà remis ne change pas en silence (Q19).
16. En tant que manager, je veux qu'une ligne ajoutée ensuite à un tel brouillon suive le calcul TTC, afin que tout nouveau prix soit juste.
17. En tant que client, je veux que le devis public (lien reçu) montre les prix TTC, afin de comprendre ce que je paierai.

### Caisse

18. En tant que vendeur, je veux que le prix unitaire proposé en caisse soit le TTC de la fiche, afin de l'annoncer au client sans calcul.
19. En tant que vendeur, je veux saisir le prix d'une ligne libre en TTC, afin de vendre un article hors catalogue au prix que je dis.
20. En tant que vendeur, je veux que le total de la vente soit exactement la somme des prix TTC × quantités, afin que le client paie ce qui est affiché.
21. En tant que vendeur, je veux qu'une remise en % s'applique au prix TTC unitaire, arrondie au centime puis multipliée par la quantité, afin que « −10 % » se voie sur le prix affiché (Q11).
22. En tant que vendeur, je veux que le « dernier prix vendu » proposé quand la fiche est à 0 soit lui aussi un TTC, afin de ne pas mélanger les deux.
23. En tant que vendeur, je veux que le total affiché à l'écran et le total facturé par le serveur soient identiques au centime, afin qu'un paiement mixte ne soit jamais refusé pour un écart.

### Factures, avoirs et conformité

24. En tant que manager, je veux que la facture imprimée montre le prix unitaire TTC, le HT et la TVA par taux, afin de rester conforme.
25. En tant que manager, je veux que les factures déjà émises ne changent jamais d'un centime, afin de respecter l'inaltérabilité NF525.
26. En tant que manager, je veux que le journal NF525 continue d'enregistrer HT, TVA et TTC dans le même format, afin que la vérification de la chaîne reste valide.
27. En tant que manager, je veux qu'un avoir sur une facture calculée en TTC rende exactement les montants de ses lignes, afin d'annuler sans écart.
28. En tant que manager, je veux que la clôture de caisse totalise les mêmes HT, TVA et TTC que les factures du jour, afin que mes comptes tombent juste.
29. En tant que manager en franchise de TVA, je veux une TVA nulle sur toute ligne quel que soit le taux de la fiche, afin de ne jamais facturer une TVA que je n'ai pas le droit de collecter (Q9).

### Client professionnel

30. En tant que manager, je veux marquer un client professionnel « servi en HT » sur sa fiche, afin que ses documents partent en HT par défaut.
31. En tant que vendeur, je veux basculer un document entre HT et TTC pour ce client, afin de servir un artisan qui achète comme un particulier (Q3, Q5).
32. En tant que client professionnel servi en HT, je veux un document dont le total HT est exactement la somme des prix HT × quantités, la TVA s'ajoutant sur ce total, afin que mon prix négocié soit tenu.
33. En tant que vendeur, je veux que le prix HT unitaire proposé à un client pro soit le TTC de la fiche ÷ (1 + taux), arrondi au centime, afin de partir du même prix de référence.
34. En tant que vendeur, je veux qu'un client particulier ne puisse pas être servi en HT par erreur, afin d'éviter un document incohérent.
35. En tant que manager, je veux que le mode (HT ou TTC) d'un document émis soit figé avec lui, afin qu'une réimpression le rende à l'identique.

### Prix calculé par la marge

36. En tant que manager, je veux choisir l'arrondi des prix calculés par la marge (au centime, au 0,10 € supérieur, au ,90 supérieur), afin d'afficher des prix à ma façon (Q7, Q18).
37. En tant que manager qui n'a rien réglé, je veux l'arrondi au ,90 supérieur par défaut, afin d'avoir des prix de vitrine sans rien faire.
38. En tant que manager, je veux que le prix de vente d'une pièce importée de Mobilax soit achat HT × (1 + marge) × (1 + TVA), arrondi selon mon réglage, afin de ne jamais vendre sous ma marge.
39. En tant que manager, je veux que mon arrondi ne s'applique jamais à un prix que je saisis à la main, afin de garder la main sur mes prix.
40. En tant que manager sans taux de marge, je veux qu'une pièce importée garde un prix de vente vide (à saisir), comme aujourd'hui, afin qu'aucune marge ne me soit imposée.

### Import CSV

41. En tant que manager, je veux importer le CSV de mon fournisseur avec ses prix d'achat HT, et que le prix de vente TTC soit calculé par la marge et mon arrondi, afin de remplir mon stock d'un coup (Q13).
42. En tant que manager, je veux qu'une colonne `prix_vente_ttc` présente dans mon CSV l'emporte sur le calcul, afin d'imposer un prix quand je le connais.
43. En tant que manager qui réutilise un ancien fichier avec `prix_vente_ht`, je veux qu'il soit encore accepté et converti en TTC, afin de ne pas refaire mes fichiers.

### Reprise des prix existants

44. En tant qu'exploitant, je veux que tous les prix de vente existants (pièces, services, prix par modèle, reconditionnement) passent en TTC = HT × (1 + taux), au centime, afin que rien ne change pour le client le jour de la bascule (Q8).
45. En tant qu'exploitant, je veux que l'ancien HT soit conservé, afin de pouvoir revenir en arrière.
46. En tant qu'exploitant, je veux la liste des fiches dont le TTC repris n'est pas rond (ex. 19,99 €, 23,49 €), afin de les corriger à la main.
47. En tant qu'exploitant, je veux mesurer cette liste sur la production avant d'appliquer la migration, afin de savoir l'ampleur du travail.

### Statistiques

48. En tant que manager, je veux voir mon chiffre d'affaires en HT et en TTC côte à côte, afin de lire à la fois mon activité comptable et l'argent encaissé (Q21).
49. En tant que manager, je veux que l'export comptable reste en HT, afin que mon expert-comptable ne voie aucun changement.

### Admin plateforme

50. En tant qu'admin plateforme consultant une boutique, je veux voir ses prix en TTC comme son manager, afin de parler du même prix lors d'un support.

## Implementation Decisions

- **Modèle de données (migrations à réserver au moment des tickets — dernières utilisées : `0061`,
  réservées au socle jusqu'à `0059`)** :
  - colonne de **prix de vente TTC** sur les produits, les services, les prix par modèle et le
    reconditionnement ; l'ancienne colonne HT **reste** (marche arrière, lectures existantes) ;
  - sur les **lignes de document**, le **prix unitaire TTC** et le **mode de calcul** de la ligne
    (`ttc` | `ht`) ; les totaux HT/TVA/TTC stockés restent les colonnes existantes (NF525) ;
  - sur la **fiche client**, « servi en HT » (pertinent pour un client professionnel seulement) ;
  - sur le **document** (devis, facture), son mode de calcul, figé à l'émission ;
  - sur les **réglages de boutique**, la règle d'arrondi des prix calculés par la marge (`centime` |
    `dixieme_superieur` | `quatre_vingt_dix_superieur`, défaut `quatre_vingt_dix_superieur`).
- **`calculLignes()` reste le point unique des totaux** de devis, factures et avoirs. Elle reçoit le
  mode :
  - **TTC** : total TTC de ligne = arrondi(prix TTC unitaire × quantité) ; HT de ligne = arrondi(TTC
    ÷ (1 + taux)) ; TVA = TTC − HT ; totaux du document = sommes des lignes.
  - **HT** (client pro) : comportement actuel — HT de ligne = arrondi(PU HT × quantité), TVA =
    arrondi(HT × taux), TTC = HT + TVA.
  - **Franchise** (taux par défaut de la boutique à 0) : taux effectif 0 sur toute ligne, TTC = HT.
- **Remise de caisse** : prix TTC unitaire remisé = arrondi(prix TTC × (1 − remise %)), puis calcul
  TTC normal.
- **Caisse** : son calcul à l'écran (`calculerTotauxCommeLeServeur()`) suit les mêmes règles que
  `calculLignes()` — un seul calcul dans le principe, deux implémentations qui doivent rendre les
  mêmes centimes, prouvées par les mêmes cas de test.
- **Fonction pure de prix calculé par la marge** : (prix d'achat HT, taux de marge, taux de TVA,
  règle d'arrondi) → prix de vente TTC, ou « aucun » si la marge n'est pas réglée
  (`resoudreTauxMarge()` inchangé). Seule appelée par l'import Mobilax et l'import CSV.
  `,90 supérieur` : le plus petit prix en ,90 ≥ au calcul (23,49 → 23,90 ; 23,95 → 24,90).
- **Changement de taux de TVA d'une fiche** : le HT déduit est gardé, le TTC recalculé au centime.
- **Prix par défaut proposés** (fiche, dernier prix vendu, service, prix par modèle) : toujours un TTC ;
  en mode HT, converti par ÷ (1 + taux), arrondi au centime.
- **Écrans** : toute saisie et tout affichage de prix de vente passent en TTC (libellés « Prix TTC »,
  HT affiché en second) — fiche produit, liste du stock, catalogue services, prix par modèle, ticket
  (prix estimé, prix final, lignes), devis (dont le devis public), caisse, factures, reconditionnement,
  rachats (prix de revente), statistiques (CA HT et TTC). Le prix d'achat reste « HT ».
- **Contrats d'API** : les routes qui écrivent un prix de vente acceptent le TTC ; un HT seul encore
  envoyé par un ancien écran ou fichier est converti (transition), le TTC l'emporte si les deux sont
  présents. Les réponses portent le TTC **et** le HT déduit.
- **Import CSV** : colonne `prix_vente_ttc` lue ; `prix_vente_ht` accepté et converti ; absent des
  deux → prix calculé par la marge et l'arrondi de la boutique.
- **Reprise** : migration TTC = arrondi(HT × (1 + taux)) au centime, pour toutes les colonnes de prix
  de vente ; requête de comptage des TTC « non ronds » jouée sur la production avant application, liste
  remise à l'exploitant.
- **NF525** : formats hashés inchangés ; aucune facture émise recalculée ; brouillons existants
  inchangés (Q19).
- **Documents imprimés** : prix unitaire TTC sur les lignes ; récapitulatif HT / TVA par taux / TTC ;
  pour un document en mode HT, prix unitaire HT comme aujourd'hui.

## Testing Decisions

- **Un bon test observe un comportement externe** : un total, un montant facturé, un prix affiché,
  une ligne en base — jamais l'appel d'une fonction interne. Tout test est vu **rouge avant** son
  correctif.
- **Couture 1 — `calculLignes()`** (pure) : tests unitaires des trois modes (TTC, HT, franchise), des
  quantités > 1 sur des prix « non ronds » (19,99 × 3 = 59,97), de la remise, de plusieurs taux sur un
  même document. Les mêmes cas jouent contre le calcul de la caisse à l'écran.
- **Couture 2 — prix calculé par la marge** (pure) : les trois arrondis, la marge absente, les bornes
  (prix déjà en ,90, centime au-dessus).
- **Couture 3 — migration de reprise** : vrai SQLite au schéma réel (`tests/helpers/d1Sqlite.ts`) —
  TTC repris, ancien HT intact, comptage des non-ronds. Précédents : `email-logs-types-migration`,
  `cloture-atomique-sqlite`.
- **Couture 4 — routes de vente** sur vrai SQLite : vente en caisse et émission de facture → total
  facturé = Σ prix × quantité ; journal NF525 vérifié par `verifierIntegriteChaine()` ; facture émise
  avant la bascule inchangée.
- **Couture 5 — E2E** sur la vraie D1 locale : saisie TTC dans la fiche produit, le service, le prix
  par modèle, le ticket, le devis ; caisse (total = prix × quantité, remise) ; client pro servi en HT ;
  réglage d'arrondi + import Mobilax simulé (`page.route()`). Précédents : `caisse-*`,
  `mobilax-*`, `reglages-onglets-sans-ecrasement`.
- Le balayage du menu de gauche (`resolveur-boutique-pages.spec.ts`) reste un gate.

## Out of Scope

- **Régime de la marge** (biens d'occasion, reconditionnés, art. 297 A) — chantier séparé, décidé,
  à cadrer (`todo.md`, questions Q14-Q17).
- **Achats intracommunautaires** (autoliquidation) — chantier « achats » séparé.
- Le **prix d'achat** et les **bons de commande** : restent en HT.
- Recalcul de toute facture émise ou de tout brouillon existant.
- Un arrondi appliqué aux prix saisis à la main.
- L'export comptable (reste en HT).

## Further Notes

- Le chantier touche la **facturation et la caisse (NF525)** : il se code dans la session
  `izigsm/webapp` avec l'exploitant, **pas au socle d'orchestration**.
- Déploiement : migrations à distance **avant** le code ; la reprise des prix doit partir **avec** le
  code qui lit le TTC — seule, elle ne change rien ; le code seul, sans elle, lirait des TTC vides.
- Le comptage des TTC non ronds se fait en lecture sur la production (`--remote`) avant la migration.
- Écrans recensés le 2026-10-03 : `todo.md` § « Caisse : saisir les prix en TTC ».
