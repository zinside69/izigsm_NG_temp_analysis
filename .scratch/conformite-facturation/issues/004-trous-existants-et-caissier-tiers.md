---
id: 004
titre: La plateforme ne vend pas — fermer les actes inscrits au registre légal d'une boutique
statut: done
bloque-par: [001, 002]
---

## Contexte

Une vente passée par la plateforme chez un client inscrit l'admin plateforme comme
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

**Quatre fonctions** écrivent au registre légal. La garde vit **en elles**, pas dans les routes
(seam confirmé le 2026-09-08) : elles ne reçoivent qu'un `userId` et reliront le rôle en base.

| Écrivain | Service | Atteint par |
|---|---|---|
| `createVente()` | `caisseService` | `POST /caisse/vente` |
| `enregistrerEncaissement()` | `caisseService` | `POST /caisse/encaissement` |
| `emettreFacture()` | `factureService` | `POST /factures` (`emettre`, `emettre_encaisser`), `POST /factures/:id/emettre`, **et `POST /devis/:id/acompte` via `createFactureAcompte()`** |
| `createAvoir()` | `factureService` | `POST /avoirs` |

**Pourquoi le seam est dans le service** : l'acompte n'atteint `emettreFacture()` qu'indirectement.
Une garde posée route par route l'aurait raté — c'est la classe d'oubli qui a produit les 23 routes
invisibles de l'audit d'isolation. Une garde dans l'écrivain couvre les chemins indirects et toute
route future, par construction (même raisonnement que l'ADR 0001).

**Deux chemins composites écrivent AVANT d'atteindre `emettreFacture()`** et refusent donc
d'emblée, garde en tête de fonction :

| Chemin | Ce qu'il écrit avant d'émettre |
|---|---|
| `createFactureAcompte()` | facture brouillon, `lignes_document`, **paiement** |
| `createFacture(action: 'emettre_encaisser')` | facture, `lignes_document`, **paiement** |

Sans cette garde en tête, un refus tardif laisserait un brouillon et un encaissement orphelins,
et le contrôle d'unicité de l'acompte bloquerait ensuite l'exploitant légitime sur ce devis.
`createFacture(action: 'brouillon')` **reste ouvert** : un brouillon n'inscrit rien au registre.

**Hors périmètre, mesuré** — ces routes n'écrivent rien au registre :
`POST /factures/:id/paiement` (`ajouterPaiement()` seul), `PUT /devis/:id/convertir` (crée un
brouillon), `POST /caisse/cloture` (écrit dans `clotures_journalieres`, pas `journal_nf525`).

⚠ Le périmètre initial de ce ticket était **faux sur trois points** : il omettait
`/caisse/encaissement` et l'acompte, et incluait à tort l'enregistrement d'un paiement. Corrigé
après mesure des appelants réels, pas après relecture.

## Critères d'acceptation

- [x] La garde applique **la même définition** qu'`isAdminPlateforme()` (rôle `admin` **et**
      aucune boutique), sans nouvelle notion de rôle ni test sur le rôle seul. Elle ne
      l'**appelle** pas : ce helper vit dans `src/lib/middleware.ts`, qui tire `hono/factory` —
      l'importer depuis `lib/nf525.ts` ferait dépendre le domaine de l'infrastructure HTTP.
      La définition est donc écrite deux fois, et chaque site pointe l'autre
- [x] Chacun des actes ci-dessus refuse un admin plateforme avec un **motif explicite**
      nommant la raison — ni 404 muet, ni échec silencieux
- [x] Les commandes correspondantes sont **masquées à l'écran** quand la session est en
      supervision : aucune action proposée qui échouera
- [x] Aucune soupape, aucun mode d'exception, aucune délégation d'identité
- [x] Une route d'écriture **hors** de ce périmètre reste accessible à un admin plateforme
      (preuve que la fermeture ne déborde pas)
- [x] Aucune ligne de `journal_nf525` n'est modifiée — `FAC-2026-00003` reste telle quelle
- [x] Test vu **rouge avant** le correctif côté **serveur** — 6 slices, chacun vu rouge
- [x] Volet **rendu** : `factures.js` (émettre, avoir) et `caisse.js` (vente), couverts par
      `tests/e2e/plateforme-ne-vend-pas.spec.ts` — 3 cas, chacun vu rouge avant correctif

## Reporté — la note des numéros manquants (ex-point A)

`FAC-2026-00001` et `FAC-2026-00002` n'existent nulle part sur la boutique 1. Position tenue :
⊥ réécrire, ⊥ fabriquer de factures rétroactives — créer des documents qui n'ont jamais existé
est plus discutable qu'un trou expliqué, et toucher aux numéros émis casserait le chaînage.

La note traçable (numéros, boutique, cause, date) **n'est pas produite maintenant** : ces trous
appartiennent à un système qui n'est pas en service, la note n'a donc aujourd'hui ni comptable ni
contrôleur pour destinataire. À reprendre au moment de la mise en service.

## Vérifié en production le 2026-09-09

Déployé : prod `izigsm-v2.92` → **`v2.93`**, aucune migration (le ticket n'en a ajouté aucune).

| Contrôle | Résultat |
|---|---|
| `sw.js` prod | `izigsm-v2.93` |
| `/api/health` | `200` |
| `factures.21e3b681.js` réellement servi | `application/javascript`, ⊥ HTML — `peutSigner`, `btnEmettre`, `btnAvoir` présents |
| `caisse.2529fecd.js` réellement servi | `application/javascript`, ⊥ HTML — garde et `btn-nouvelle-vente` présents |
| Écran, admin plateforme | commandes masquées — constaté par l'exploitant |
| Écran, compte de boutique | `FAC-2026-00001` et `00002` gardent 🔒 et l'avoir — la fermeture ne déborde pas |

**Deux limites à ne pas surinterpréter.** Le contrôle du compte de boutique est une lecture
**visuelle** d'une capture, pas une lecture du DOM par `title` ; il conclut sur `peutSigner`, que
les deux boutons partagent. Et le volet **serveur** (`assertPeutEcrireAuRegistre()`) n'a pas été
mesuré en production : le bundle du Worker n'est pas lisible de l'extérieur, et le prouver
exigerait de tenter une écriture sous une session d'admin plateforme.

## Effets de bord sur la suite existante — traités

Trois tests E2E fabriquaient leurs données sous `admin@izigsm.fr`, qui est l'admin plateforme
du seed (`boutique_id` NULL). C'est l'effet de bord annoncé par l'ADR 0002.

| Test | Traitement |
|---|---|
| `isolation.spec.ts` — avoir (GET et POST) | fixtures basculées sur `manager@izigsm.fr` via `loginSeedManager()` |
| `resolveur-boutique-pages.spec.ts` — vente en caisse | joué sous un `createTenantAdmin()` ; `TenantAdmin` expose désormais son mot de passe |
| `facture-avoir-visible.spec.ts` — 2 cas admin plateforme | `verifierEtatVerrouille()` remplace `verifierBoutons()` : le badge 🔒 porte la preuve de `f.locked`, et l'absence du bouton d'avoir devient l'attendu |

Aucun de ces tests n'a été affaibli : celui de `facture-avoir-visible` prouve désormais **deux**
faits là où il en prouvait un.

## Notes

- ⊥ toucher `journal_nf525` en direct, sous aucun prétexte.
- Contrepartie assumée : un exploitant seul et bloqué devant son client ne peut plus être dépanné
  par un encaissement de la plateforme. Coût présenté avant la décision, pas découvert après.
- Effet de bord à prévoir : tester le circuit de vente depuis un admin plateforme ne sera
  plus possible — c'est précisément ce qui a produit le défaut. Les scénarios devront passer par
  un compte rattaché à une boutique.
