---
chantier: integration-mobilax
statut: ready-for-agent
date: 2026-09-10
---

# Spec — Intégration du fournisseur Mobilax dans le stock, les devis, les factures, la caisse et la prise en charge

## Problem Statement

Un réparateur a besoin de pièces détachées et d'accessoires pour honorer une réparation ou une
vente. Aujourd'hui, chaque référence, chaque prix et chaque niveau de stock chez un fournisseur
externe doivent être ressaisis à la main — sur la fiche produit du stock, sur une ligne de devis,
sur une ligne de facture, sur une vente en caisse, ou pour estimer le prix d'une réparation à
l'accueil. Rien ne garantit que le prix ou la disponibilité saisis sont encore exacts au moment
de la vente.

Mobilax expose une API avec 184 716 références. Un accès de préproduction est ouvert depuis le
2026-09-07, un compte y est provisionné depuis le 2026-09-10, et une recherche documentaire
(`project-docs/recherche-api-mobilax-2026-09-09.md`, 4 révisions) a mesuré son comportement réel.

## Solution

Un outil de recherche Mobilax unique, accessible depuis cinq écrans existants — Stock, Devis,
Facture, Caisse, Prise en charge — permet à l'opérateur de retrouver une pièce réelle par nom ou
référence, d'en voir le prix et le stock réels chez le fournisseur, puis :

- dans **Stock** : de l'**importer** comme produit local, avec le prix Mobilax comme coût de
  référence ;
- dans **Devis**, **Facture** et **Caisse** : d'**insérer une ligne** pré-remplie, avec une
  **marge automatique** appliquée pour obtenir le prix de vente ;
- dans **Prise en charge** : de **pré-remplir** le champ d'estimation de prix existant.

Chaque boutique se connecte avec son propre compte Mobilax (tarifs négociés propres à chaque
réparateur), dont la clé est conservée chiffrée.

## User Stories

**Connexion et identifiants**

1. Comme exploitant d'une boutique, je veux saisir la clé API de mon propre compte Mobilax, pour
   que les prix que je vois correspondent à mes tarifs négociés.
2. Comme exploitant, je veux que ma clé Mobilax ne soit jamais lisible en clair par quiconque
   consulte la fiche de ma boutique, pour qu'elle ne fuite pas comme un précédent déjà trouvé
   dans ce logiciel (clé Resend en clair, `bugs.md`).
3. Comme admin plateforme, je ne dois jamais pouvoir lire ni utiliser la clé Mobilax d'une
   boutique cliente, pour respecter l'isolation multi-tenant déjà en vigueur.
4. Comme exploitant d'une boutique sans clé Mobilax configurée, je veux un message clair
   m'indiquant qu'il faut la renseigner, plutôt qu'une recherche qui échoue silencieusement.

**Recherche**

5. Comme opérateur, je veux chercher une pièce Mobilax par nom ou référence, pour la retrouver
   sans connaître son identifiant exact.
6. Comme opérateur, je veux voir le prix et le stock réels d'une pièce trouvée, pour décider en
   connaissance de cause.
7. Comme opérateur, je veux que la recherche fonctionne à l'identique sur les cinq écrans, pour
   ne pas avoir à réapprendre un outil différent à chaque endroit.
8. Comme opérateur, je veux un message clair si Mobilax est indisponible ou si j'ai atteint la
   limite d'appels, pour comprendre que ce n'est pas une panne de mon côté.
9. Comme opérateur, je veux qu'une recherche sans résultat me le dise explicitement, plutôt que
   de me laisser croire que l'outil est resté bloqué.

**Stock**

10. Comme opérateur du stock, je veux importer une pièce Mobilax trouvée comme produit local d'un
    clic, pour ne pas ressaisir nom, référence et prix à la main.
11. Comme opérateur du stock, je veux que le produit importé garde un lien vers sa source
    Mobilax, pour pouvoir revérifier son prix et son stock plus tard.
12. Comme opérateur du stock, je veux un bouton pour revalider le prix et le stock d'un produit
    importé auprès de Mobilax, pour corriger une donnée qui aurait changé depuis l'import.
13. Comme opérateur du stock, je veux fixer moi-même le prix de vente et la quantité après
    import, pour garder la main sur mon inventaire — l'import ne doit rien m'imposer de figé.

**Devis, facture, caisse — la ligne vendue**

14. Comme opérateur créant un devis, je veux insérer une ligne à partir d'une pièce Mobilax
    trouvée, pour ne pas ressaisir sa description et son prix.
15. Comme opérateur créant une facture manuelle, je veux le même outil de recherche que sur les
    devis, pour la même raison.
16. Comme opérateur en caisse, je veux le même outil pour vendre directement une pièce ou un
    accessoire Mobilax, sans passer par une prise en charge.
17. Comme exploitant, je veux qu'une marge s'applique automatiquement sur le prix Mobilax pour
    calculer le prix de vente, pour ne pas avoir à calculer une marge à la main sur chaque ligne.
18. Comme exploitant, je veux définir un taux de marge par défaut pour ma boutique, pour cadrer
    la marge sans avoir à la fixer ligne par ligne.
19. Comme exploitant, je veux pouvoir définir un taux différent pour les pièces détachées et pour
    les accessoires, parce qu'une pièce utilisée dans une réparation et un accessoire vendu au
    comptoir n'ont pas la même logique de marge.
20. Comme opérateur, je veux pouvoir modifier le prix proposé par la marge automatique avant de
    valider la ligne, pour garder la main sur un cas particulier.
21. Comme exploitant, je veux que le tarif d'une prestation de réparation (main-d'œuvre) reste
    fixé directement par ma boutique, sans lien avec Mobilax — seule la pièce a un prix Mobilax.

**Prise en charge**

22. Comme opérateur à l'accueil, je veux chercher une pièce Mobilax pour pré-remplir le prix
    estimé d'une prise en charge, pour donner un chiffrage réaliste au client sans deviner.
23. Comme opérateur à l'accueil, je veux pouvoir ajuster ce prix pré-rempli, pour tenir compte de
    la main-d'œuvre ou d'un aléa que la pièce seule ne couvre pas.

## Implementation Decisions

**Identifiants par boutique**

- La clé API Mobilax de chaque boutique est stockée **chiffrée** sur la ligne `fournisseurs`
  existante de cette boutique (table déjà scindée par `boutique_id`) — aucune nouvelle table de
  identifiants.
- Le chiffrement est réversible (le serveur doit pouvoir déchiffrer pour appeler Mobilax au nom
  de la boutique), via l'API Web Crypto (AES-GCM), avec une clé d'enveloppe portée par un secret
  Cloudflare global. C'est le premier chiffrement réversible de ce dépôt — les usages existants
  de `crypto.subtle` (mot de passe, JWT, chaînage NF525) sont tous à sens unique ou du HMAC ;
  aucun n'est réutilisable tel quel.
- Un utilitaire de chiffrement/déchiffrement dédié est introduit, indépendant de toute logique
  Mobilax, pour pouvoir être réutilisé plus tard sur le défaut déjà connu de la clé Resend en
  clair (hors périmètre de ce chantier, voir « Out of Scope »).
- La valeur chiffrée ne doit jamais apparaître dans une réponse API listant ou lisant une
  boutique ou son fournisseur — corrige explicitement la classe de défaut déjà trouvée sur
  `email_api_key`.

**Service Mobilax**

- Un nouveau module de service dédié à Mobilax porte : l'authentification (obtention et
  renouvellement du jeton, jamais codé en dur — la durée de vie annoncée par l'API varie selon
  l'environnement), la recherche de produits, la lecture du détail complet d'un produit (seul
  point où le prix d'achat de base fiable est confirmé), et l'import d'un produit vers
  l'inventaire local.
- Modelé sur le service existant d'intégration de catalogue externe (`phoneCatalogService`) :
  appel direct à l'API distante (`fetch` natif, aucun nouveau port HTTP), et le port `Database`
  existant pour toute donnée locale.
- Ce service est le **seul** point du dépôt qui manipule la forme brute des réponses Mobilax
  (confirmée non uniforme d'un endpoint à l'autre) — aucun appelant en aval ne doit jamais lire
  un champ Mobilax non normalisé.
- Le prix d'achat de base utilisé pour tout calcul est le champ numérique confirmé par mesure
  réelle et cohérent entre les deux endpoints de lecture Mobilax — pas les champs de tarif
  négocié, dont la sémantique reste non confirmée et qui se sont montrés inactifs sur le compte
  mesuré (voir « Out of Scope »).
- La limite de débit annoncée par l'API (mesurée réelle : dix authentifications par minute,
  trente recherches de produit par minute, partagées par toute l'activité d'une boutique) doit
  être respectée sans retenter silencieusement à l'aveugle — l'appelant reçoit un signal clair
  d'attente plutôt qu'un échec générique.

**Schéma**

- `produits.fournisseur_id` et `produits.reference_fournisseur` (déjà existants) portent le lien
  vers la pièce Mobilax source d'un produit importé — aucune colonne nouvelle sur `produits`.
- Un taux de marge par défaut est ajouté au paramétrage déjà existant par boutique
  (`boutique_settings`), au même niveau que le taux de TVA par défaut déjà présent.
- Un taux de marge optionnel par `famille` de produit (les quatre valeurs déjà en vigueur :
  pièce, accessoire, appareil, consommable) peut surcharger le taux par défaut de la boutique.
  Une famille sans taux propre retombe sur le taux par défaut.
- Une migration D1 porte ces ajouts — appliquée à distance **avant** le déploiement du Worker,
  comme toute migration touchant une colonne lue par du code nouvellement déployé.

**Points d'intégration écran**

- Un module frontend unique expose l'outil de recherche Mobilax, chargé par les cinq pages
  concernées (Stock, Devis, Facture, Caisse, Prise en charge). Chaque page lui fournit ce qu'il
  doit faire du résultat choisi : importer en stock, insérer une ligne au prix marginé, ou
  pré-remplir le champ d'estimation.
- L'insertion d'une ligne (devis, facture, caisse) applique la marge résolue (famille, puis
  défaut boutique) sur le prix Mobilax, et reste modifiable par l'opérateur avant validation —
  jamais un montant figé.
- La prise en charge ne gagne aucun nouveau champ de schéma : le widget alimente le champ de
  prix estimé déjà existant.
- Toute donnée Mobilax affichée (libellé, description, image) passe par l'échappeur déjà en
  vigueur dans ce dépôt (`echapperHtml()`/équivalent) — c'est une donnée tierce comme une autre.

**Isolation et conventions déjà en vigueur**

- Toute route qui lit ou écrit une ressource Mobilax d'une boutique (identifiants, produit
  importé) applique la même garde d'appartenance déjà en usage sur les autres ressources par ID.
- 0 SQL inline en dehors du service.
- L'enveloppe des réponses suit la convention déjà en vigueur dans ce dépôt.

## Testing Decisions

Un bon test vérifie un comportement observable de l'extérieur — jamais l'ordre interne des
appels ni un détail d'implémentation. Précédent direct de ce dépôt pour ce type de service :
tests de `phoneCatalogService.test.ts`.

- **Service Mobilax** : testé aux mêmes seams que les services voisins — le port `Database`
  simulé pour tout accès local, `fetch` global simulé (jamais d'appel réseau réel en suite
  unitaire) pour tout échange Mobilax.
- **Chiffrement/déchiffrement** : testé directement contre l'implémentation réelle de Web
  Crypto, sans simulation — même parti pris que le chaînage SHA-256 de NF525, jamais mocké.
- **Non-fuite de la clé** : un test doit constater que la valeur chiffrée n'apparaît dans aucune
  réponse lisant une boutique ou son fournisseur — garde-fou direct contre la classe de défaut
  trouvée cette semaine sur `email_api_key`.
- **Isolation** : un test doit constater qu'une boutique ne peut ni lire ni utiliser les
  identifiants ou les produits importés d'une autre — même discipline que le garde-fou
  d'isolation déjà en vigueur sur les routes par ID.
- **Résolution de la marge** : couvre le cas taux par défaut seul, le cas famille surchargée, et
  le cas famille sans taux propre retombant sur le défaut.
- **Débit** : un test doit constater qu'un appel refusé pour dépassement de quota produit un
  signal explicite à l'appelant, jamais une nouvelle tentative silencieuse.
- **Écran** : un test Playwright par point d'intégration (les cinq écrans), constatant le
  résultat réel à l'écran après une recherche — la ligne insérée, le produit importé visible
  dans la liste, ou le champ d'estimation rempli — jamais seulement qu'un appel API a réussi.
  Précédent direct : `tests/e2e/plateforme-ne-vend-pas.spec.ts`.

## Out of Scope

- **L'agent IA de suggestion de prix par historique de ventes.** Chantier distinct, sans lien
  avec Mobilax — il analyserait l'historique des ventes propres à iziGSM, pas une donnée
  fournisseur.
- **La synchronisation automatique du stock** (webhooks Mobilax). Le rafraîchissement reste
  manuel pour cette itération.
- **La marge par catégorie libre** (`categorie_id`, arbre propre à chaque boutique). Seule la
  `famille` (quatre valeurs fixes) est couverte ; la catégorie libre pourra venir plus tard si la
  famille s'avère insuffisante.
- **La commande directe auprès de Mobilax** (volet 3 du plan initial). Ce chantier couvre la
  recherche, l'import, l'affichage du prix et l'application d'une marge — jamais le passage
  d'une commande fournisseur.
- **La correction du défaut déjà connu sur `email_api_key`** (clé Resend en clair). Consignée
  séparément (`bugs.md`, `todo.md`), traitée après ce chantier sur décision explicite de
  l'exploitant — même si l'utilitaire de chiffrement construit ici est destiné à la réutiliser.
- **Confirmer la sémantique exacte des champs de tarif négocié Mobilax** (`customer_price`,
  `mbx_price`). La marge se calcule sur le prix de base confirmé fiable ; si un compte à tarif
  négocié actif rend un jour ces champs exploitables, ce sera une évolution de ce chantier, pas
  son périmètre actuel.

## Further Notes

- Le jeton de préproduction actuellement utilisé pour les mesures a transité en clair dans une
  conversation cette semaine — à faire tourner chez Mobilax avant toute mise en production
  réelle de ce chantier (déjà noté dans `todo.md`).
- La recherche documentaire complète, avec ses quatre révisions et les mesures réelles qui ont
  tranché le prix de base utilisable, vit dans
  `project-docs/recherche-api-mobilax-2026-09-09.md` — référence à lire avant tout ticket
  touchant à l'appel Mobilax lui-même.
- Le vocabulaire neuf introduit par ce chantier (produit importé, marge automatique, famille
  comme niveau de marge) n'est pas encore fixé au glossaire (`CONTEXT.md`) — relève de la
  discipline `domain-modeling` au moment de l'implémentation, pas de ce spec.
