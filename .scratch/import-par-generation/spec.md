---
chantier: import-par-generation
statut: ready-for-agent
date: 2026-09-12
---

# Spec — Import par génération depuis un fournisseur connecté

Cadré le 2026-09-12 par `/grill-with-docs` (14 questions) — décisions : `project-docs/decisions.md`
§ « Import par génération » ; vocabulaire : `CONTEXT.md` (série, génération, import par
génération) ; mesures de l'API : `project-docs/recherche-api-mobilax-2026-09-09.md` v1.5.

## Problem Statement

Quand une nouvelle génération d'appareils sort — l'iPhone 17 et ses variantes 17 Air, 17 Pro,
17 Pro Max —, une boutique veut avoir en stock les pièces et accessoires correspondants avant
que les premiers clients n'arrivent. Aujourd'hui, elle doit chercher chaque article fournisseur
un par un dans la recherche fournisseur de la page Stock, puis l'importer d'un clic : pour une
génération qui compte des dizaines d'articles compatibles, c'est des dizaines de recherches et de
clics, sans savoir si elle en a oublié, ni lesquels sont déjà dans son stock.

Le fournisseur ne connaît pas la notion de génération : son catalogue est rangé par séries
(« iPhone 17 Pro »), elles-mêmes regroupées en gammes qui mélangent plusieurs générations
(« Séries 17/16/15 ») ou toute une ligne (« Galaxy S », du S3 au S25). Et il limite le nombre
d'appels : un import de plusieurs dizaines d'articles prend plusieurs minutes et partage son
quota avec les recherches que font les collègues au comptoir.

## Solution

Dans la recherche fournisseur de la page Stock, un mode **« Par génération »** : l'opérateur tape
un nom de base (« iPhone 17 »), iziGSM lui propose les séries correspondantes, toutes cochées, et
un **aperçu** — combien d'articles fournisseur par série, combien sont déjà dans son stock, combien
restent à importer, et en combien de temps. Il décoche au besoin une série, confirme, et suit
l'import sur une barre de progression.

L'import avance à un rythme qui laisse la recherche disponible au comptoir, se met en pause tout
seul si le quota du fournisseur est atteint et reprend après le délai annoncé, s'arrête proprement
si le fournisseur ne répond plus. Chaque article importé suit exactement les règles de l'import
unitaire, avec le stock initial par défaut et le seuil d'alerte par défaut de la boutique. Si
l'import est interrompu, relancer la même génération n'importe que ce qui manque. Un bilan final
dit ce qui a été importé, ce qui était déjà là, et ce qui a échoué.

## User Stories

1. En tant qu'opérateur du stock, je veux un mode « Par génération » dans la recherche
   fournisseur de la page Stock, pour importer une génération entière au même endroit que
   j'importe un article.
2. En tant qu'opérateur du stock, je veux taper un nom de base comme « iPhone 17 », pour retrouver
   toutes les séries de cette génération sans connaître leur nom exact.
3. En tant qu'opérateur du stock, je veux que « iPhone 17 » me propose 17, 17 Air, 17 Pro et
   17 Pro Max, pour couvrir toute la génération en un geste.
4. En tant qu'opérateur du stock, je veux que « Galaxy S2 » ne me propose pas les S20 à S25, pour
   ne pas importer par erreur une autre génération.
5. En tant qu'opérateur du stock, je veux un message clair quand aucune série ne correspond, pour
   corriger ma saisie.
6. En tant qu'opérateur du stock, je veux que les séries proposées soient toutes cochées, pour
   importer toute la génération par défaut.
7. En tant qu'opérateur du stock, je veux pouvoir décocher une série (« pas le 17 Air »), pour
   n'importer que ce que je vends.
8. En tant qu'opérateur du stock, je veux voir, avant de confirmer, le nombre d'articles
   fournisseur par série, pour savoir ce qui va entrer dans mon stock.
9. En tant qu'opérateur du stock, je veux voir combien de ces articles sont déjà dans mon stock,
   pour savoir ce que l'import ajoutera vraiment.
10. En tant qu'opérateur du stock, je veux voir le nombre d'articles à importer et la durée
    estimée, pour choisir le bon moment.
11. En tant qu'opérateur du stock, je veux une confirmation renforcée au-delà de 200 articles
    (« environ 17 min, gardez cet onglet ouvert »), pour ne pas lancer par mégarde un import très
    long.
12. En tant qu'opérateur du stock, je veux que l'aperçu se mette à jour quand je décoche une
    série, pour voir l'effet de mon choix.
13. En tant qu'opérateur du stock, je veux une barre de progression et un journal ligne par ligne,
    pour suivre l'import pendant qu'il tourne.
14. En tant que collègue au comptoir, je veux pouvoir chercher une pièce chez le fournisseur
    pendant un import par génération, pour servir un client sans attendre la fin de l'import.
15. En tant qu'opérateur du stock, je veux que l'import se mette en pause tout seul quand le
    quota du fournisseur est atteint, avec un compte à rebours, pour ne pas avoir à le relancer.
16. En tant qu'opérateur du stock, je veux que l'import reprenne automatiquement à la fin du
    compte à rebours, pour qu'il aille au bout sans moi.
17. En tant qu'opérateur du stock, je veux que l'import s'arrête avec un bilan quand le
    fournisseur ne répond plus, pour savoir où il en est resté.
18. En tant qu'opérateur du stock, je veux qu'un article en échec n'arrête pas les suivants, pour
    qu'une erreur isolée ne bloque pas toute la génération.
19. En tant qu'opérateur du stock, je veux que relancer la même génération n'importe que ce qui
    manque, pour reprendre après une coupure sans créer de doublons.
20. En tant qu'opérateur du stock, je veux que les articles déjà dans mon stock soient ignorés sans
    consommer de quota, pour que l'import aille plus vite et ne gêne pas le comptoir.
21. En tant qu'opérateur du stock, je veux que chaque produit importé soit rempli comme par
    l'import unitaire (nom, référence, EAN en SKU, famille, catégorie, marque, prix d'achat, prix
    de vente selon ma marge), pour ne rien avoir à corriger ensuite.
22. En tant qu'opérateur du stock, je veux que chaque produit importé prenne mon stock initial par
    défaut, pour déclarer en une fois les pièces que j'ai déjà en rayon.
23. En tant qu'opérateur du stock, je veux que chaque produit importé prenne mon seuil d'alerte
    par défaut, pour qu'il soit surveillé comme mes autres produits.
24. En tant qu'opérateur du stock, je veux un bilan final (importés, déjà en stock, échecs), pour
    savoir ce que l'import a produit.
25. En tant qu'opérateur du stock, je veux que chaque échec du bilan nomme l'article et le motif,
    pour pouvoir le traiter à la main.
26. En tant qu'opérateur du stock, je veux la répartition des produits importés par famille
    (pièces, accessoires, appareils, consommables), pour voir ce qui est entré dans mon stock.
27. En tant qu'opérateur du stock, je veux un lien du bilan vers la liste du stock de ce
    fournisseur, pour vérifier les produits importés.
28. En tant qu'opérateur du stock, je veux être prévenu si je ferme l'onglet pendant l'import,
    pour ne pas l'interrompre sans le vouloir.
29. En tant que manager ou admin de boutique, je veux pouvoir lancer un import par génération,
    pour équiper ma boutique.
30. En tant qu'admin plateforme, je ne dois pas pouvoir lancer d'import par génération dans une
    boutique cliente, parce que la plateforme ne fait pas de commerce et que la clé fournisseur
    appartient à la boutique.
31. En tant que boutique, je veux que l'import n'utilise que ma propre clé fournisseur et n'écrive
    que dans mon stock, pour que les stocks restent étanches.
32. En tant que boutique sans fournisseur connecté, je veux un message qui me dit comment en
    brancher un, pour comprendre pourquoi le mode « Par génération » ne fonctionne pas.

## Implementation Decisions

- **Service du fournisseur connecté** (seul lecteur des réponses brutes du fournisseur) — deux
  capacités nouvelles, normalisées comme le reste du service :
  - **Séries d'une génération** : lit le catalogue des séries du fournisseur (sans quota) et
    retient celles dont le nom **est** le texte saisi ou **commence par lui suivi d'un espace**,
    comparaison insensible à la casse et aux espaces superflus. Rend `{ id, nom }` par série.
  - **Aperçu d'une génération** : pour une liste d'identifiants de séries, lit les articles
    fournisseur de chaque série (recherche par série, 100 par page, toutes les pages — 1 appel de
    quota par page), les dédoublonne entre séries, et marque « déjà dans le stock » ceux dont la
    **référence** porte déjà un produit actif de la boutique pour cette fiche fournisseur — même
    clé que l'anti-doublon de l'import. Rend, par série, le nombre d'articles, et au global la
    liste des articles à importer (identifiant, référence, nom) et le nombre déjà en stock.
  - La recherche par série range sa liste sous `data.products` (et non `data` comme la recherche
    texte) : seul le service le sait.
  - Quota atteint et fournisseur indisponible suivent les signaux existants (délai de
    `ratelimit-reset` rendu à l'appelant, aucune nouvelle tentative à l'aveugle).
- **Routes** (famille des routes du fournisseur connecté existantes) : lecture des séries d'une
  génération (texte en paramètre) et lecture de l'aperçu (liste de séries). Mêmes gardes que la
  recherche et l'import : boutique du **jeton de connexion** uniquement, admin plateforme refusé
  (403), fournisseur connecté manquant → message nommé. **Aucune route d'import nouvelle** : la
  boucle réutilise l'import unitaire existant, article par article.
- **Import de chaque article** : inchangé — fiche complète relue chez le fournisseur, famille,
  catégorie, marque, marge, SKU = EAN, doublon rendu en `deja_importe` (compté « déjà en stock »
  au bilan, jamais en échec). Le **stock initial par défaut** et le **seuil d'alerte par défaut**
  de la boutique s'appliquent sans saisie par ligne : l'import est appelé sans quantité en rayon,
  ce qui vaut stock initial par défaut (ticket 05 du chantier `reglages-stock-boutique`).
- **Boucle pilotée par le navigateur** (précédent : la synchronisation du catalogue de services) :
  un import à la fois, **au plus 20 par minute** (un départ toutes les 3 s au minimum) pour laisser
  10 appels par minute aux recherches du comptoir. Sur « quota atteint » : pause, compte à rebours
  du délai rendu par le serveur, puis reprise de l'article en cours. Sur « fournisseur
  indisponible » : arrêt et bilan. Tout autre échec d'un article : consigné, la boucle continue.
  Avertissement du navigateur si l'onglet est fermé pendant l'import.
- **Aperçu à l'écran** : séries cochées par défaut, recalcul à chaque décochage, total à importer,
  déjà en stock, durée estimée (à importer × 3 s, arrondie à la minute) ; confirmation renforcée
  au-delà de 200 articles ; aucun plafond.
- **Bilan** : importés, déjà en stock, échecs nommés (article, motif), répartition des importés
  par famille (lue dans la réponse de chaque import), lien vers le stock filtré sur ce
  fournisseur.
- **Aucune migration, aucune infrastructure serveur nouvelle.** La reprise repose sur l'index
  unique des produits importés (migration `0046`) : relancer une génération ne recrée rien.
- **Service worker** : version de cache incrémentée sur la dernière tâche d'écran du chantier.

## Testing Decisions

- **Un bon test observe le comportement par l'extérieur** — ce que rend le service ou la route, ce
  que voit l'opérateur — jamais la forme d'une requête ni l'appel d'une fonction interne. Chaque
  test est vu rouge avant son correctif.
- **Couture 1 — le service du fournisseur connecté** (existante), fournisseur simulé à sa frontière
  HTTP : correspondance des séries (« iPhone 17 » → 4 séries ; « Galaxy S2 » ⊥ S20–S25 ;
  « iPhone 1 » → rien ; casse et espaces), aperçu paginé sur plusieurs pages, dédoublonnage entre
  séries, « déjà dans le stock » par la référence, quota et indisponibilité rendus comme signaux.
- **Couture 2 — les routes** (existante) : boutique du jeton seulement, admin plateforme refusé,
  fournisseur connecté manquant, paramètres invalides refusés sans appel au fournisseur.
- **Couture 3 — l'écran, sous Playwright, avec les réponses de l'API d'iziGSM simulées
  (`page.route()`) et l'horloge simulée (`page.clock`)** (validée le 2026-09-12) : c'est la seule
  façon de prouver la boucle sans attendre 3 s par article ni dépendre du quota réel — rythme,
  progression, pause et compte à rebours sur quota puis reprise, arrêt sur indisponibilité, échec
  isolé qui n'arrête pas la boucle, déjà-en-stock compté, bilan et répartition par famille,
  décochage d'une série qui recalcule l'aperçu, confirmation renforcée au-delà de 200.
  `serviceWorkers: 'block'` est déjà posé (sinon `page.route()` ne voit pas les requêtes).
- **Un E2E réel en préproduction, limité à l'aperçu** : « iPhone 17 » → séries proposées puis
  aperçu chiffré (catalogue sans quota + 1 recherche par série, **aucun import**) — prouve le
  branchement au vrai fournisseur. Sauté sans clé dans l'environnement, jamais faussement vert.
  En préproduction, les articles de l'iPhone 17 sont tous des accessoires.
- **Prior art** : `mobilaxService.test.ts` (API simulée, quota, doublon), `mobilax-route.test.ts`
  (gardes), `mobilax-recherche-stock.spec.ts` (préproduction réelle, clé lue sans import de
  modules Node), `resolveur-boutique-pages.spec.ts` (stubs réseau + balayage du menu). Fenêtres
  `.modal-overlay` : assertions d'opacité, jamais de visibilité.
- **Gates** : vitest complet (baseline), tsc ≤ 32, E2E du chantier + balayage du menu.

## Out of Scope

- Le **catalogue fournisseur consultable hors stock** (tâche de nuit, 184 716 articles) : il
  exigera une infrastructure serveur de travail long, que ce chantier n'introduit pas.
- Tout autre fournisseur que Mobilax (généraliser au deuxième fournisseur connecté réel).
- Le rafraîchissement des produits déjà importés (ticket 05 du chantier Mobilax).
- Un aperçu article par article, ou un choix par famille avant l'import (la famille n'est connue
  qu'à la lecture de la fiche complète).
- Un import qui continue onglet fermé, et toute notification par email.
- La saisie d'une quantité en rayon par article dans l'import par génération.

## Further Notes

- **Dépendance** : le ticket 05 du chantier `reglages-stock-boutique` (stock initial par défaut
  appliqué à l'import sans quantité) doit être livré avant ou avec ce chantier ; sans lui, les
  produits importés naissent à stock 0 et au seuil 0 codés en dur.
- **Quota** : `/products*` 30/min partagé par toute la boutique ; l'aperçu coûte 1 appel par série
  et par page de 100, chaque import 1 appel (fiche complète). Le catalogue des séries (268 ko) et
  l'arbre des catégories ne consomment pas de quota.
- **Correspondance des séries** : 2 316 séries en préproduction, noms parfois incohérents chez le
  fournisseur (gammes vides, doublons) — la correspondance porte sur le nom de la **série**, jamais
  sur celui de la gamme.
