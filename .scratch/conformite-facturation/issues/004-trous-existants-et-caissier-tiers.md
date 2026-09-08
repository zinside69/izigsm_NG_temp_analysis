---
id: 004
titre: La plateforme ne vend pas — fermer les actes inscrits au registre légal d'une boutique
statut: ready-for-agent
bloque-par: [001, 002]
---

## Contexte

Une vente passée par la plateforme chez un client inscrit le compte de supervision comme
signataire dans la **chaîne NF525 du client** :

```
FAC-2026-00003 | user_id 1 = support@soteli.fr (boutique_id NULL = admin plateforme)
               | ligne NF525 boutique_id = 1
```

Un tiers apparaît donc dans le registre légal d'une boutique. La traçabilité est assurée par
ailleurs (`journal_actions_plateforme`, ADR 0001), mais **le registre lui-même ne le signale
pas**.

Mesure du 2026-09-07 : **100 %** des entrées du registre de la boutique 1 portent ce compte,
tandis que la boutique 2 est signée par un utilisateur de la boutique — le mécanisme correct
existe et fonctionne. Le seul usage constaté est de la manipulation de préproduction, jamais le
secours à un exploitant.

La question se pose maintenant parce que le ticket 003 vient de graver l'immuabilité d'une
facture : un registre qu'on ne peut plus corriger doit d'abord être exact.

## Décision (grilling round 2, 2026-09-08)

**Voie 1 — la plateforme ne vend pas.** Détail, motifs et alternatives écartées :
[ADR 0002](../../../docs/adr/0002-la-plateforme-ne-vend-pas.md) et `project-docs/decisions.md`
§ 2026-09-08.

Ce choix **renverse la voie 2** retenue au round 1, sur objection de l'exploitant : la plateforme
sert à superviser et déboguer, pas à faire du commerce.

## Périmètre

Les **trois** actes qui inscrivent une pièce au registre légal, et eux seuls :

| Acte | Point d'entrée |
|---|---|
| Vente en caisse | `POST /api/caisse/vente` → `createVente()` |
| Émission de facture (avec ou sans encaissement) | `POST /api/factures` (`emettre`, `emettre_encaisser`), `POST /api/factures/:id/emettre` |
| Enregistrement d'un paiement | `POST /api/factures/:id/paiements` |
| Création d'un avoir | route d'avoir (`avoirs`) |

Les **104 autres routes d'écriture** du dépôt restent ouvertes : la plateforme corrige la cause
d'un blocage, l'exploitant signe la pièce.

## Critères d'acceptation

- [ ] La garde s'appuie sur `isAdminPlateforme(user)` (`src/lib/middleware.ts`), sans nouvelle
      notion de rôle ni test sur le rôle seul
- [ ] Chacun des actes ci-dessus refuse un compte de supervision avec un **motif explicite**
      nommant la raison — ni 404 muet, ni échec silencieux
- [ ] Les commandes correspondantes sont **masquées à l'écran** quand la session est en
      supervision : aucune action proposée qui échouera
- [ ] Aucune soupape, aucun mode d'exception, aucune délégation d'identité
- [ ] Une route d'écriture **hors** de ce périmètre reste accessible à un compte de supervision
      (preuve que la fermeture ne déborde pas)
- [ ] Aucune ligne de `journal_nf525` n'est modifiée — `FAC-2026-00003` reste telle quelle
- [ ] Test vu **rouge avant** le correctif, couvrant serveur **et** rendu

## Reporté — la note des numéros manquants (ex-point A)

`FAC-2026-00001` et `FAC-2026-00002` n'existent nulle part sur la boutique 1. Position tenue :
⊥ réécrire, ⊥ fabriquer de factures rétroactives — créer des documents qui n'ont jamais existé
est plus discutable qu'un trou expliqué, et toucher aux numéros émis casserait le chaînage.

La note traçable (numéros, boutique, cause, date) **n'est pas produite maintenant** : ces trous
appartiennent à un système qui n'est pas en service, la note n'a donc aujourd'hui ni comptable ni
contrôleur pour destinataire. À reprendre au moment de la mise en service.

## Notes

- ⊥ toucher `journal_nf525` en direct, sous aucun prétexte.
- Contrepartie assumée : un exploitant seul et bloqué devant son client ne peut plus être dépanné
  par un encaissement de la plateforme. Coût présenté avant la décision, pas découvert après.
- Effet de bord à prévoir : tester le circuit de vente depuis un compte de supervision ne sera
  plus possible — c'est précisément ce qui a produit le défaut. Les scénarios devront passer par
  un compte rattaché à une boutique.
