# CONTEXT — glossaire du domaine iziGSM

Définitions faisant autorité pour le code, les specs et les tickets. Un terme employé
ici l'est partout de la même façon.

> **État : amorcé.** Ce glossaire a été dérivé du schéma (`migrations/`) et des routes
> (`src/routes/`), pas d'un entretien métier. Les définitions marquées ⚠ sont des
> lectures du code à confirmer. `/grill-with-docs` et `/domain-modeling` l'affûtent.

## Multi-tenant

**Boutique** — le tenant. Unité d'isolation de **toutes** les données métier. Chaque
enseigne cliente du SaaS est une boutique indépendante (modèle repairdesk.co /
monatelier.net).

**`boutique_id`** — la clé d'isolation. Tout endpoint lisant ou écrivant une donnée
métier la filtre par le `boutique_id` de l'utilisateur authentifié. Un endpoint sans ce
filtre est une **faille d'isolation**, pas un oubli de confort.

**Multi-sites** — une même enseigne exploitant plusieurs boutiques, avec dashboard
consolidé et transferts de stock/personnel entre elles. Confirmé en roadmap, distinct
du multi-tenant. ⚠ Non implémenté à ce jour.

**Admin plateforme** — l'exploitant du SaaS, pas un client. Seul rôle qui traverse
toutes les boutiques, par conception : son `boutique_id` est `NULL` et
`assertBoutiqueOwnership()` le laisse passer. Il supervise et dépanne les boutiques
clientes ; il ne produit pas dans une boutique à lui. En base, le rôle porte le nom
`admin` (`roles.id = 1`) — nom conservé, les gardes d'isolation en dépendent.

**Manager** — le dirigeant d'une boutique cliente (`roles.id = 2`). C'est le compte que
le client appelle spontanément « son admin ». Il ne traverse rien : son `boutique_id`
le borne à sa propre boutique.

> ⚠️ **« Admin » seul est ambigu et ne doit plus être employé dans une spec** : selon le
> locuteur, il désigne l'admin plateforme (qui voit tout) ou le manager d'une boutique
> (qui ne voit que la sienne) — deux rôles opposés. Écrire **admin plateforme** ou
> **manager**, jamais « admin » tout court. *(Tranché le 2026-07-31.)*

## Réparation

**Ticket** — un dossier de réparation : un appareil confié par un client, suivi de la
prise en charge à la restitution. Table `tickets`, historique de statuts dans
`tickets_statuts_historique`, photos dans `tickets_photos`.

**Appareil** — le matériel confié, rattaché à un client. Table `appareils`. Identifié par son
**IMEI** (téléphone) **ou** son **numéro de série** (tablette, ordinateur, console) : l'un des
deux doit être connu **avant toute facturation**, pas à la prise en charge — un appareil hors
d'usage ne le laisse pas toujours lire (tranché le 2026-09-17).

**Ligne de ticket** — ce qu'une réparation comporte : un **service** du catalogue (main
d'œuvre), une **pièce** du stock, ou une ligne **libre**. Le prix du ticket est la somme de ses
lignes ; elles forment le devis, puis la facture. Un dossier SAV en porte aussi, facturées 0 €,
pour tracer le coût des garanties. _Aucune table ne les porte encore (chantier « la vente lit le
catalogue »)._
_À éviter_ : prestation (mot de conversation, sans définition ici), intervention.

**Pose** — le geste qui marque une pièce d'une ligne de ticket comme montée sur l'appareil. C'est
**la pose, et elle seule, qui sort la pièce du stock** : un devis refusé ne fait rien bouger, et
la conversion du devis en facture ne décrémente jamais une seconde fois. Tout technicien de la
boutique peut la marquer ; son auteur est conservé.

**Prise en charge** — le document remis au client à l'ouverture du ticket, valant
reconnaissance de dépôt.

**Garantie** — couverture d'une réparation, **par ligne de service** : sa durée vient du service
du catalogue, politique de la boutique (ex. écran 6 mois, autres réparations 3 mois). **Hors
casse, hors oxydation.** Face à une garantie active, le **vendeur** tranche au comptoir si la
nouvelle panne est couverte ; un refus porte un **motif** (autre panne, casse, oxydation,
garantie expirée) ; le technicien peut requalifier après examen (tranché le 2026-09-17).
`garanties` — ⚠ aujourd'hui **une par ticket**, à la durée de la boutique
(`garantie_defaut_jours`) : `services.garantie_jours` existe mais n'est lu par aucun code.

**Nouvelle panne hors garantie** — panne qui ne concerne aucune réparation encore garantie, ou
dont la garantie est terminée, ou due à une casse ou une oxydation. Elle ouvre un **nouveau
ticket**, les précédents restant dans l'historique de l'appareil. Son contraire ouvre un **SAV**.

**SAV** — retour après réparation. `sav_dossiers`, adossé à `garanties`.

**Reconditionnement** — remise en état d'un appareil destiné à la revente, pas à la
restitution à un client. `ordres_reconditionnement`.

**Rachat** — acquisition d'un appareil auprès d'un client. Table `rachats`.

## Documents commerciaux

**Devis** — proposition chiffrée, non comptable.

**Facture** — document comptable. Numérotation légale via `sequences`, immuable une
fois émise.

**Avoir** — annulation partielle ou totale d'une facture. Ne modifie jamais la facture
d'origine. `avoirs` + `lignes_avoir`.

**Ligne de document** — poste d'un devis ou d'une facture. Table commune
`lignes_document`.

**Paiement** — encaissement rattaché à une facture. Table `paiements`.

## Caisse & conformité

**NF525** — norme française d'inviolabilité des logiciels de caisse. `journal_nf525`
est un journal en append-only : jamais de `UPDATE`, jamais de `DELETE`.

**Signataire** — l'utilisateur connecté au moment où une pièce est inscrite au registre.
Le registre d'une boutique ne porte que des membres de cette boutique : un **admin
plateforme** ne peut y écrire aucune pièce (vente, facture émise, avoir). Voir
[ADR 0002](docs/adr/0002-la-plateforme-ne-vend-pas.md). Il n'existe pas de « caissier »
distinct : celui qui encaisse est celui qui est connecté.

**Clôture journalière** — arrêté de caisse d'une journée. `clotures_journalieres`.

**Séquence** — compteur de numérotation par boutique et par type de document, garant de
la continuité légale. Table `sequences`.

## Stock & achats

**Produit** — article vendable ou pièce détachée, rangé en `categories`.

**Code-barres (EAN13)** — identifie **un et un seul** produit dans une boutique. Scanné au
comptoir, il désigne l'article sans ambiguïté (tranché par l'exploitant le 2026-09-16).
`produits.code_barre` — règle tenue par la base (migration `0048`, produits actifs, code non
vide) ; un doublon est refusé en **nommant** le produit qui porte déjà le code.

**SKU** — code article interne à la boutique. **Distinct du code-barres**, même quand les deux
portent la même valeur : l'import fournisseur renseigne aujourd'hui le SKU avec l'EAN de la
pièce, ce qui est une commodité, pas une identité. `produits.sku` — **unique par boutique**
(migration `0048`, même périmètre). En pratique, la fiche produit n'ayant pas de champ
code-barres, un vendeur y tape souvent l'EAN comme SKU : à l'import d'une pièce fournisseur, un
SKU déjà porté compte donc comme **« déjà en stock »** (tranché le 2026-09-17).

**Code maison** — code-barres créé par la boutique pour ce qui n'a pas de code fournisseur :
tout produit **créé hors import grossiste**, et les **services** (imprimés sur une planche de
codes au comptoir). Préfixe **`2`** (plage GS1 à circulation restreinte), puis le **type**
(1 produit, 2 service), puis l'identifiant. Un article qui porte déjà l'EAN de son fournisseur
n'en reçoit **jamais** : on scanne l'étiquette d'origine. Un appareil d'occasion n'en reçoit pas
non plus : il se scanne par son **IMEI**.
_À éviter_ : code interne, EAN interne.

**File d'étiquettes** — les étiquettes en attente d'impression, accumulées au fil des créations de
produits, puis imprimées **en lot** sur le rouleau — par paires, le rouleau ayant deux pistes.
Tenue **par boutique** : qui déballe en réserve n'est pas qui imprime au comptoir.
_À éviter_ : panier d'étiquettes, planche.

**Mouvement de stock** — entrée ou sortie de quantité. Toute variation de la quantité d'un
produit en passe par un ; la quantité courante est tenue à jour sur le produit à chaque
mouvement (tranché le 2026-09-12 d'après le code).

**Stock initial** — quantité déjà en rayon déclarée à la création d'un produit, entrée par un
mouvement de stock et valorisée au prix d'achat connu.

**Seuil d'alerte** — quantité à partir de laquelle un produit est à commander. **0 = produit
non surveillé** ; pour n'être alerté qu'à la rupture, seuil 1.
_À éviter_ : stock minimum.

**À commander** — état d'un produit surveillé dont la quantité est inférieure ou égale à son
seuil d'alerte.
_À éviter_ : stock bas, alerte stock.

**Rupture** — quantité nulle, que le produit soit surveillé ou non. Un état, pas une alerte.

**Fournisseur** — chez qui une boutique achète. Chaque fiche fournisseur appartient à une
boutique.
_À éviter_ : plateforme (réservé à l'exploitant du SaaS), grossiste.

**Fournisseur connecté** — fournisseur dont le catalogue est interrogé en direct, avec la clé
propre de la boutique (qui porte son tarif négocié).

**Article fournisseur** — entrée du catalogue d'un fournisseur connecté. N'est pas un produit
de la boutique.
_À éviter_ : pièce Mobilax.

**Produit importé** — produit créé depuis un article fournisseur, dont il garde le lien. Il se
gère ensuite comme tout produit.

**Disponibilité fournisseur** — quantité qu'un fournisseur connecté annonce pouvoir livrer, lue
à la demande, jamais conservée. Distincte du stock de la boutique.
_À éviter_ : stock fournisseur.

**Série** — un modèle d'appareil tel qu'un fournisseur connecté le catalogue (« iPhone 17 Pro »).

**Génération** — ensemble des séries dont le nom commence par un même nom de base (« iPhone 17 »
→ 17, 17 Air, 17 Pro, 17 Pro Max), telles que l'opérateur les confirme. Ne se lit que dans le nom
des séries : aucun fournisseur ne la porte.
_À éviter_ : famille de séries (« famille » est la famille d'un produit), gamme (regroupement
propre au fournisseur, sans rapport fiable avec une génération), modèle.

**Import par génération** — import en une fois, dans le stock, de tous les articles fournisseur
compatibles avec une génération.
_À éviter_ : import en masse, import par modèle.

**Import d'une sélection** — import en une fois, dans le stock, des articles fournisseur que
l'opérateur a cochés dans les résultats d'une recherche fournisseur.
_À éviter_ : import en masse, import groupé.

**Service** — prestation facturable sans stock (main d'œuvre, diagnostic).
`categories_services` + `services`.

**Bon de commande** — commande passée à un fournisseur. `bons_commande` +
`lignes_bon_commande`.

## Personnel

**Employé** — membre du personnel d'une boutique. Distinct de **User** (compte de
connexion) : `employes` porte le métier, `users` l'authentification. ⚠ Lien exact à
confirmer.

**Pointage** — enregistrement de temps de présence.

**Commission** — rémunération variable calculée sur l'activité.

**Rôle / Permission** — `roles`, `permissions`, plus un mécanisme de code PIN pour les
actions sensibles en boutique.

## Termes à trancher

Mots surchargés, à résoudre avant d'être employés dans une spec :

- **Ticket** — désigne à la fois le *dossier de réparation* (`tickets`) et le *document
  imprimé* remis au client. Deux notions, un seul mot.
- **Garantie** — coexistence de `garanties` et `garanties_new` dans le schéma. Laquelle
  fait autorité ?
- **Mon Atelier / MyDesk** — rebranding en cours depuis 2026-07-23. Les deux noms
  circulent. Voir `project-docs/decisions.md`.
