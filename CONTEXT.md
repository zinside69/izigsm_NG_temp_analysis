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

**Appareil** — le matériel confié, rattaché à un client. Table `appareils`.

**Prise en charge** — le document remis au client à l'ouverture du ticket, valant
reconnaissance de dépôt.

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

**Clôture journalière** — arrêté de caisse d'une journée. `clotures_journalieres`.

**Séquence** — compteur de numérotation par boutique et par type de document, garant de
la continuité légale. Table `sequences`.

## Stock & achats

**Produit** — article vendable ou pièce détachée, rangé en `categories`.

**Mouvement de stock** — entrée ou sortie, source unique de vérité de la quantité.
⚠ À confirmer : le stock est-il recalculé depuis les mouvements ou dénormalisé ?

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
