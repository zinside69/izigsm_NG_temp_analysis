---
chantier: reglages-stock-boutique
statut: done (2026-09-12, tickets 01-05 — déploiement en attente de 0047)
date: 2026-09-12
---

# Spec — Réglages de stock propres à chaque boutique

Cadré le 2026-09-12 par `/grill-with-docs` (21 questions) — décisions : `project-docs/decisions.md`
§ « Réglages de stock par boutique » ; vocabulaire : `CONTEXT.md` § Stock & achats.

## Problem Statement

Chaque boutique gère son stock à sa manière, mais iziGSM lui impose des valeurs qu'elle n'a pas
choisies et qui changent selon le chemin emprunté pour créer un produit. Un produit saisi à la
main naît avec un seuil d'alerte de 2, un produit importé par fichier CSV avec un seuil de 5, un
produit importé d'un fournisseur connecté avec un seuil de 0 — et un produit créé sans seuil
explicite retombe sur 5. Aucune de ces valeurs n'a été décidée par la boutique, et aucune ne se
règle.

Le même désordre touche le stock initial. Une boutique qui démarre et importe ses articles
fournisseur ne peut pas déclarer les pièces qu'elle a déjà en rayon au moment de l'import : le
produit importé naît à 0, et comme la quantité d'un produit existant ne se modifie plus que par un
mouvement de stock tracé, elle doit ensuite ajuster chaque produit un par un.

Enfin, quand un produit naît avec du stock (saisie manuelle, fichier CSV), ces pièces sont
valorisées à **0 €** au coût moyen tant qu'aucun bon de commande n'a été reçu : la valeur du stock
affichée par la boutique est fausse dès le premier produit créé.

## Solution

Chaque boutique dispose, dans ses Réglages, d'un onglet **Stock** portant deux valeurs par défaut :
le **seuil d'alerte par défaut** et le **stock initial par défaut**. Tant que la boutique n'a rien
réglé, les deux valent 0 : aucune surveillance ni aucun stock ne lui est imposé.

Le seuil d'alerte par défaut s'applique à **toute** création de produit — formulaire manuel
pré-rempli, fichier CSV quand la colonne est vide, import depuis un fournisseur connecté. Le stock
initial par défaut pré-remplit un champ **« Qté en rayon »** sur chaque ligne de résultat de la
recherche fournisseur, pour déclarer en un geste les pièces déjà présentes.

Toute quantité de départ, quel que soit le chemin, entre par un **mouvement « Stock initial »** et
est **valorisée au prix d'achat connu**. Le seuil 0 garde un seul sens dans toutes les boutiques :
**produit non surveillé**. Tant que la boutique n'a enregistré aucun seuil par défaut, la page
Stock le lui rappelle discrètement.

Changer un réglage ne modifie aucun produit existant.

## User Stories

1. En tant que manager d'une boutique, je veux un onglet « Stock » dans les Réglages, pour régler
   mes valeurs par défaut de stock au même endroit que mes autres paramètres.
2. En tant que manager, je veux fixer un seuil d'alerte par défaut, pour que mes nouveaux produits
   soient surveillés comme je l'entends sans le saisir à chaque fois.
3. En tant que manager, je veux fixer un stock initial par défaut, pour que la saisie des pièces
   déjà en rayon à l'import soit pré-remplie selon mon usage.
4. En tant que manager qui n'a rien réglé, je veux que mes nouveaux produits ne soient ni
   surveillés ni dotés d'un stock par défaut, pour qu'iziGSM ne m'impose aucun choix.
5. En tant que manager, je veux voir mes réglages actuels à l'ouverture de l'onglet, pour savoir
   ce qui s'appliquera à mes prochains produits.
6. En tant que manager, je veux qu'une valeur laissée vide soit enregistrée comme « non réglée »,
   pour revenir au comportement d'usine sans deviner quelle valeur le représente.
7. En tant que manager, je veux qu'un seuil ou un stock négatif, ou non entier, soit refusé avec un
   message clair, pour ne jamais enregistrer une valeur absurde.
8. En tant que manager, je veux qu'enregistrer l'onglet Stock ne touche à aucun autre réglage de ma
   boutique (TVA, paiements, marges), pour ne pas écraser un onglet voisin sans le voir.
9. En tant qu'admin de boutique, je veux les mêmes droits que le manager sur l'onglet Stock, pour
   gérer ma boutique sans dépendre de lui.
10. En tant qu'employé sans rôle de gestion, je ne dois pas pouvoir modifier ces réglages, pour que
    seules les personnes responsables du stock en décident.
11. En tant que manager d'une boutique, je ne dois pas pouvoir modifier les réglages de stock d'une
    autre boutique, pour que les stocks restent étanches entre boutiques.
12. En tant qu'admin plateforme, je veux pouvoir régler le stock d'une boutique cliente, pour la
    dépanner à sa demande.
13. En tant qu'admin plateforme, je veux que cette intervention soit inscrite au journal des
    actions de plateforme, pour qu'elle reste traçable.
14. En tant qu'opérateur du stock, je veux que le formulaire de création d'un produit propose mon
    seuil d'alerte par défaut, pour ne le modifier que lorsque ce produit fait exception.
15. En tant qu'opérateur du stock, je veux que la quantité du formulaire de création reste à 0, pour
    ne jamais enregistrer par mégarde des pièces que je n'ai pas.
16. En tant qu'opérateur du stock, je veux pouvoir saisir une quantité à la création manuelle quand
    j'ai les pièces, pour déclarer mon stock de départ.
17. En tant qu'opérateur du stock, je veux qu'un produit créé sans seuil explicite prenne le seuil
    par défaut de ma boutique, et non une valeur d'iziGSM, pour que tous les chemins de création
    obéissent au même réglage.
18. En tant qu'opérateur du stock, je veux qu'un fichier CSV dont la colonne seuil est remplie
    impose sa valeur, pour que mon fichier exprime un choix explicite.
19. En tant qu'opérateur du stock, je veux qu'une ligne CSV dont la colonne seuil est vide prenne
    mon seuil par défaut, pour ne pas avoir à le répéter dans le fichier.
20. En tant qu'opérateur du stock, je veux qu'une ligne CSV dont la colonne quantité est vide crée
    un produit à 0, pour qu'un fichier incomplet ne crée pas de stock fictif.
21. En tant qu'opérateur du stock, je veux un champ « Qté en rayon » à côté du bouton d'import de
    chaque article fournisseur, pour déclarer les pièces déjà présentes sans clic supplémentaire.
22. En tant qu'opérateur du stock, je veux que ce champ soit pré-rempli par mon stock initial par
    défaut, pour importer en série sans le retaper.
23. En tant qu'opérateur du stock, je veux qu'une « Qté en rayon » à 0 importe le produit sans
    stock, pour que l'import reste un geste d'un clic dans le cas courant.
24. En tant qu'opérateur du stock, je veux qu'un produit importé prenne mon seuil d'alerte par
    défaut, pour qu'il soit surveillé comme mes autres produits.
25. En tant qu'opérateur du stock, je veux qu'une quantité de départ apparaisse dans l'historique du
    produit comme un mouvement « Stock initial », pour savoir d'où viennent ces pièces.
26. En tant que gérant, je veux que le stock initial soit valorisé au prix d'achat du produit, pour
    que la valeur de mon stock soit juste dès la création.
27. En tant que gérant, je veux que le stock initial d'un produit importé soit valorisé au prix
    d'achat du fournisseur, pour que la valorisation reflète ce que la pièce me coûte.
28. En tant que gérant, je veux qu'un produit créé sans stock garde un coût moyen sans objet
    jusqu'à sa première entrée, pour ne pas fausser la valorisation.
29. En tant que manager, je veux que modifier un réglage ne change aucun produit existant, pour que
    mes seuils déjà ajustés à la main restent tels quels.
30. En tant que manager qui n'a enregistré aucun seuil par défaut, je veux un rappel discret sur la
    page Stock, pour savoir que mes nouveaux produits ne sont pas surveillés.
31. En tant que manager, je veux que ce rappel mène à l'onglet Réglages › Stock, pour régler en un
    clic.
32. En tant que manager qui a enregistré un seuil par défaut — même 0 —, je ne veux plus voir ce
    rappel, pour que mon choix de ne rien surveiller soit respecté.
33. En tant qu'opérateur du stock, je veux qu'un seuil de 0 signifie toujours « non surveillé », et
    un seuil de 1 « alerte-moi à la rupture », pour que le mot garde le même sens partout.
34. En tant qu'admin plateforme qui consulte une boutique cliente, je veux voir ses réglages de
    stock comme elle les voit, pour comprendre le comportement qu'elle constate.

## Implementation Decisions

- **Deux colonnes sur les réglages de boutique** (`boutique_settings`), par une migration
  (numéro suivant `0046`, qui doit être appliquée avant) : seuil d'alerte par défaut et stock
  initial par défaut, **entiers nullables sans valeur par défaut**. `NULL` = « jamais réglé »,
  distinct de 0 enregistré : c'est cette distinction qui commande le rappel de la page Stock
  (story 32). Toute lecture traite `NULL` comme 0 au moment d'appliquer la valeur.
- **Une résolution unique des valeurs par défaut**, dans le service des réglages de boutique, sur
  le modèle de la résolution des taux de marge : fonction pure qui, à partir des réglages, rend le
  seuil par défaut et le stock initial par défaut effectifs. ⊥ un repli codé chez un appelant.
- **Route d'écriture dédiée** sur la boutique (même famille que celle des marges) : remplacement
  complet des deux valeurs, un champ absent ou vide valant `NULL`. Droits identiques aux marges :
  admin et manager de la boutique ; admin plateforme pour une boutique cliente ; tout compte
  rattaché à une boutique n'écrit que chez lui (403 sinon). Validation : `NULL` ou entier ≥ 0,
  sinon 422 sans rien écrire. **Jamais par la route des réglages généraux**, qui reçoit des corps
  partiels (piège déjà payé : TVA écrasée).
- **Lecture** : les deux valeurs sortent avec les réglages déjà renvoyés par la lecture d'une
  boutique ; aucune route de lecture nouvelle.
- **Création de produit** (service du stock) : un seuil absent du corps prend le seuil par défaut
  de la boutique, et non plus le repli 5 ; le repli codé en dur disparaît. Quand la quantité de
  départ est > 0, le mouvement « Stock initial » (déjà écrit aujourd'hui) est conservé **et le
  coût moyen est posé au prix d'achat HT** de la création — ce que l'insertion ne fait pas
  aujourd'hui. Quantité 0 : coût moyen laissé tel quel.
- **Import CSV** : son insertion propre abandonne le seuil 5 codé en dur ; colonne seuil vide →
  seuil par défaut de la boutique ; colonne quantité vide → 0 ; coût moyen posé au prix d'achat de
  la ligne quand la quantité est > 0, avec son mouvement existant. Une colonne remplie l'emporte
  toujours sur le réglage. La mise à jour d'un produit existant par le CSV n'est pas concernée.
- **Import depuis un fournisseur connecté** : le corps de la requête d'import accepte une
  **quantité en rayon facultative** (entier ≥ 0 ; absente → stock initial par défaut de la
  boutique ; invalide → 400 sans appel au fournisseur). Le produit importé prend le seuil par
  défaut de la boutique au lieu de 0 codé en dur. Quantité > 0 → mouvement « Stock initial » et
  coût moyen = prix d'achat relu chez le fournisseur. Les autres règles de l'import (fiche relue,
  doublon, marge, famille) ne changent pas.
- **Règle du seuil inchangée** : la condition « à commander » reste la règle unique existante et
  **ne lit aucun réglage** — seuil 0 = non surveillé dans toutes les boutiques.
- **Écran Réglages** : nouvel onglet « Stock » (deux champs numériques, un texte d'aide qui dit
  que 0 = non surveillé et que 1 alerte à la rupture, qu'un champ vide revient au réglage d'usine
  et que rien n'est rétroactif), enregistrement par la route dédiée, sur le modèle de l'onglet
  Marges.
- **Écran Stock** : le formulaire de création pré-remplit le seuil avec le seuil par défaut
  effectif (au lieu de 2) et laisse la quantité à 0 ; un rappel discret, avec lien vers
  Réglages › Stock, s'affiche tant que le seuil par défaut n'a jamais été enregistré (`NULL`) ;
  chaque ligne de résultat de la recherche fournisseur porte un champ « Qté en rayon »
  pré-rempli par le stock initial par défaut, transmis à l'import.
- **Service worker** : version de cache incrémentée sur la dernière tâche d'écran du chantier.

## Testing Decisions

- **Un bon test observe un comportement par l'extérieur** : ce qu'une boutique voit à l'écran ou
  ce que l'API renvoie et relit, jamais la forme d'une requête SQL ni l'appel d'une fonction
  interne. Chaque test est vu rouge avant son correctif.
- **Couture principale — l'application sous Playwright, sur la vraie D1 locale** (validée le
  2026-09-12). Les règles de ce chantier vivent dans le SQL (valeurs par défaut, coût moyen,
  mouvements) : les mocks du dépôt rendent ce qu'on leur configure et ne prouveraient rien. Par
  requêtes API avec un compte de boutique neuve : enregistrer et relire les réglages, refus de
  valeurs invalides, refus d'une autre boutique, admin plateforme autorisé et journalisé, création
  manuelle et CSV avec et sans seuil explicite, stock initial présent dans l'historique et valorisé
  (valeur de stock au coût moyen ≠ 0), réglages voisins intacts après enregistrement de l'onglet.
  Par l'écran : onglet Stock (chargement, enregistrement, relecture), pré-remplissage du formulaire
  de création, apparition puis disparition du rappel, champ « Qté en rayon » pré-rempli.
- **Couture existante — le service d'import depuis un fournisseur connecté**, fournisseur simulé à
  sa frontière HTTP (validée le 2026-09-12) : quantité en rayon absente → stock initial par
  défaut ; quantité fournie → mouvement « Stock initial » et coût moyen au prix du fournisseur ;
  seuil par défaut appliqué ; quantité invalide refusée sans appel au fournisseur. Évite de brûler
  le quota de préproduction à chaque cas.
- **Prior art** : `reglages-onglets-sans-ecrasement.spec.ts` (onglets des Réglages, corps partiels),
  `bon-commande-reglement.spec.ts` (règle SQL prouvée sur D1 locale), `stock-seuil-zero.spec.ts` et
  `stock-fiche-quantite.spec.ts` (boutique neuve, API + écran, fenêtres par opacité),
  `mobilaxService.test.ts` (import, API simulée), `resolveur-boutique-pages.spec.ts` (balayage du
  menu, gate de non-régression).
- **Gates** : vitest complet (baseline 2 échecs agenda), tsc ≤ 32, E2E du chantier + balayage du
  menu, sur un serveur local relancé après chaque changement serveur.

## Out of Scope

- Un seuil par défaut **par famille** (pièce, accessoire, appareil, consommable).
- Un réglage qui redéfinirait le sens du seuil 0 (« alerter à la rupture ») — écarté : seuil 1.
- Tout effet rétroactif, y compris un bouton « appliquer le seuil à tous mes produits ».
- La réécriture du coût moyen des produits existants valorisés à 0 €.
- Le reconditionnement, qui crée un produit sans mouvement de stock (`bugs.md`, 🟡) — chantier à
  part ; son seuil reste celui qu'il pose aujourd'hui.
- L'import en masse par modèle (il consommera le stock initial par défaut, sans saisie par ligne —
  à cadrer dans son propre chantier).
- La mise à jour d'un produit existant par import CSV.

## Further Notes

- **Ordre de mise en production** : `0046` (doublon d'import, checkpoint 103) est encore en attente
  en distant ; la migration de ce chantier la suit. Migrations distantes **avant** le déploiement,
  `d1_migrations` distant relu entre les deux.
- **Changement de comportement assumé** : sans réglage, un produit saisi à la main ou importé par
  CSV n'est plus surveillé (0 au lieu de 2 ou 5). Le rappel de la page Stock est la parade
  décidée — il doit être livré dans le même déploiement que ce changement.
- Vocabulaire : « à commander », « rupture », « seuil d'alerte », « stock initial »,
  « fournisseur connecté », « article fournisseur », « produit importé » — `CONTEXT.md`. ⊥ « stock
  bas », « stock minimum », « pièce Mobilax » dans les textes d'écran de ce chantier.
