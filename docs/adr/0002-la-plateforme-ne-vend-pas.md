# 0002 — Fermer à la plateforme tout acte inscrit au registre légal d'une boutique

- **Statut** : accepté
- **Date** : 2026-09-08

## Contexte

L'[ADR 0001](0001-journal-separe-actions-plateforme.md) décrit l'admin plateforme comme
traversant toutes les boutiques « avec un accès complet en lecture et en écriture ». C'est cet
accès en écriture que la présente décision restreint.

`journal_nf525` enregistre dans chaque ligne le `user_id` de l'utilisateur connecté, et rien
n'indique que cet utilisateur soit extérieur à la boutique dont c'est le registre. Une vente
passée par la plateforme chez un client inscrit donc **un tiers dans le registre légal de ce
client**, silencieusement.

Ce n'est pas une hypothèse. Mesuré le 2026-09-07 : **100 % des entrées du registre de la
boutique 1** sont signées par le compte de supervision (`boutique_id` NULL), alors que la
boutique 2 est signée par un utilisateur de la boutique — le mécanisme correct existe donc et
fonctionne. Le seul usage constaté de ce pouvoir est de la manipulation de préproduction, jamais
le secours à un exploitant en difficulté.

La question se pose maintenant parce que le ticket 003 vient de graver l'immuabilité d'une
facture : un registre qu'on ne peut plus corriger doit d'abord être exact.

## Décision

**Un compte de supervision — rôle `admin` sans boutique — ne peut poser aucun des trois actes
qui inscrivent une pièce au registre légal d'une boutique cliente** : vente en caisse, émission
de facture, création d'avoir.

- La garde s'appuie sur `isAdminPlateforme(user)` (`src/lib/middleware.ts`), déjà existant.
- Le serveur refuse avec un **motif explicite** nommant la raison — jamais une erreur muette,
  même parti pris que le ticket 003.
- Les commandes correspondantes sont **masquées à l'écran** en supervision : on ne propose pas
  une action vouée à échouer.
- **Aucune soupape**, aucun mode d'exception, aucune délégation d'identité.
- Les **104 autres routes d'écriture** restent ouvertes : la plateforme corrige la cause d'un
  blocage, l'exploitant signe la pièce.
- Les lignes **déjà écrites ne sont pas modifiées** — le journal est append-only.

## Conséquences

**Ce que ça ferme : le dépannage par encaissement.** Si un exploitant est seul et bloqué devant
son client, personne ne peut encaisser à sa place. C'est la contrepartie réelle, assumée. Une
soupape s'ajoutera si le cas se présente vraiment ; elle n'est pas construite pour un besoin qui
ne s'est jamais manifesté.

**Ce que ça amende.** L'ADR 0001 reste valide sur son objet — le journal séparé — mais sa
description d'un « accès complet en écriture » n'est plus exacte. Trois routes en sont désormais
exclues.

**Ce qui devient plus difficile : tester le circuit de vente depuis un compte de supervision.**
C'est précisément ce que faisait la préproduction, et c'est ce qui a produit le défaut. Les
scénarios de test devront passer par un compte rattaché à une boutique.

**Alternatives écartées.** *Voie 2 — la plateforme vend, et la ligne le signale* : retenue au
round 1 du grilling, écartée au round 2. Elle maintient un tiers dans le registre légal pour
préserver un usage jamais constaté, et coûte une colonne, un affichage et un interrupteur.
*Voie 3 — statu quo assumé* : la traçabilité existe ailleurs (ADR 0001), mais le registre
lui-même continuerait de désigner un tiers sans le dire — c'est exactement le défaut à corriger.
*Délégation d'identité* : l'admin agissant sous le compte d'un employé ferait dire au registre
qu'une personne a encaissé alors qu'elle n'était pas là. Le même mensonge, retourné.
