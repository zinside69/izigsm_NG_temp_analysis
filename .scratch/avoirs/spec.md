---
titre: Les avoirs visibles, plafonnés, et une facture couverte qui n'est plus « à encaisser »
statut: ready-for-agent
cadrage: grilling du 2026-10-06 (Q1 à Q19, `project-docs/decisions.md` § 2026-10-06 « Chantier avoirs cadré »)
---

# Spec — Avoirs : voir, plafonner, couvrir

## Problem Statement

Le 2026-10-06, pendant la recette du chantier prix TTC en production, l'exploitant a émis l'avoir
`AV-2026-00001` pour annuler la facture `FAC-2026-00009` (70,52 €). L'avoir existe — il est en base et
chaîné au journal NF525 — mais **l'exploitant ne le trouve nulle part** : aucune page ne liste, n'ouvre
ni n'imprime un avoir. La seule trace est la fenêtre qui l'a créé.

Pire, la facture qu'il annule **reste « Émise, 70,52 € à encaisser »** : rien ne relie l'avoir à la
facture à l'écran, rien ne réduit ce qu'elle doit encore. Elle apparaîtra « en retard » à son échéance.
Le tableau de bord, lui, compte les impayés sur un statut que plus aucun code n'écrit : il ne voit ni
la facture couverte, ni les vraies factures en attente.

Trois autres défauts, découverts en cadrant :

- un avoir **n'a aucun plafond** : on peut émettre 1 000 € d'avoir sur une facture de 70 €, ou cumuler
  plusieurs avoirs au-delà de son montant ;
- la **clôture de caisse additionne les avoirs du jour aux ventes**, en positif : un jour où un avoir
  est émis, le total clôturé est faux ;
- l'annulation d'un ticket qui avait un acompte crée un avoir valable 60 jours — un **bon d'achat** —
  mais l'enregistre comme un « remboursement ».

Enfin, la fenêtre d'avoir s'ouvre sur une ligne vide : pour annuler une facture de deux lignes, il faut
les retaper à la main.

## Solution

L'avoir devient un document qu'on **voit** : un onglet « Avoirs » dans la page Factures liste tous les
avoirs de la boutique, chacun s'ouvre et s'imprime, et le lien entre une facture et ses avoirs se lit
dans les deux sens.

Une facture **couverte** sort des « à encaisser » : ce que le client doit encore — le **reste dû** —
se calcule partout de la même façon (total TTC − paiements − avoirs émis), et une facture entièrement
couverte par ses avoirs passe à l'état **« annulée »**, son contenu restant figé.

L'émission d'un avoir devient sûre : le cumul des avoirs d'une facture ne dépasse jamais son total, et
le refus arrive avant qu'aucun numéro ne soit consommé. La fenêtre d'avoir est préremplie des lignes de
la facture. La clôture de caisse sépare les ventes et les avoirs du jour. L'avoir né d'un acompte
annulé est enregistré pour ce qu'il est : un bon d'achat, avec son expiration visible.

## User Stories

### Voir les avoirs

1. En tant que manager, je veux un onglet « Avoirs » dans la page Factures, afin de retrouver un avoir
   sans connaître sa facture d'origine.
2. En tant que manager, je veux voir pour chaque avoir son numéro, sa date, son client, sa facture
   d'origine, son type, son motif et son montant TTC, afin de l'identifier d'un coup d'œil.
3. En tant que manager, je veux voir la date d'expiration d'un bon d'achat dans la liste, afin de
   savoir jusqu'à quand le client peut l'utiliser.
4. En tant que manager, je veux chercher un avoir par son numéro ou par le nom du client, afin de le
   retrouver quand le client se présente.
5. En tant que manager, je veux filtrer les avoirs par type (remboursement, bon d'achat, échange), afin
   de suivre par exemple les bons d'achat en circulation.
6. En tant que manager, je veux voir le total des avoirs émis dans le mois, afin de mesurer ce que les
   annulations représentent.
7. En tant que manager, je veux que la liste des avoirs soit paginée comme celle des factures, afin
   qu'elle reste rapide quand les avoirs s'accumulent.
8. En tant que manager, je veux ouvrir un avoir pour voir ses lignes (désignation, quantité, prix
   unitaire TTC, taux de TVA, total), afin de savoir exactement ce qui a été annulé.
9. En tant que manager, je veux cliquer sur la facture d'origine depuis un avoir, afin d'aller voir la
   vente qu'il annule.
10. En tant que technicien, je veux consulter la liste et le détail des avoirs, afin de renseigner un
    client au comptoir.
11. En tant que technicien, je veux pouvoir imprimer un avoir, afin de le remettre à un client qui l'a
    perdu.
12. En tant que technicien, je ne veux pas pouvoir créer d'avoir, afin que l'annulation d'une vente reste
    une décision du manager.
13. En tant que manager, je veux que les avoirs d'une autre boutique ne m'apparaissent jamais, afin que
    chaque boutique ne voie que ses propres documents.

### Le lien facture ↔ avoir

14. En tant que manager, je veux voir sur une facture la liste de ses avoirs (numéro et montant), afin de
    savoir qu'elle a été annulée en tout ou partie.
15. En tant que manager, je veux voir dans la liste des factures qu'une facture a un avoir, afin de ne pas
    relancer un client pour une vente annulée.
16. En tant que manager, je veux voir sur une facture annulée par avoir la mention « Annulée par AV-… »,
    afin de comprendre son état sans ouvrir l'avoir.

### Le reste dû et la facture couverte

17. En tant que manager, je veux que le reste dû d'une facture soit son total TTC, moins ce qui a été
    payé, moins ses avoirs émis, afin de savoir ce que le client doit vraiment.
18. En tant que manager, je veux qu'une facture au reste dû nul ne soit ni « à encaisser » ni
    « en retard », afin que ces compteurs ne mentent pas.
19. En tant que manager, je veux qu'une facture entièrement couverte par ses avoirs passe à l'état
    « annulée », afin que son état dise la vérité comptable.
20. En tant que manager, je veux qu'une facture déjà payée puis entièrement couverte par un avoir passe
    aussi « annulée », ses paiements restant visibles dans sa fiche, afin que la vente annulée ne compte
    plus comme une vente.
21. En tant que manager, je veux qu'un avoir partiel diminue le reste dû sans changer l'état de la
    facture, afin qu'une facture partiellement annulée reste à encaisser pour la différence.
22. En tant que manager, je veux que plusieurs avoirs partiels qui finissent par couvrir la facture la
    fassent passer « annulée » au dernier d'entre eux, afin que le cumul compte autant qu'un avoir total.
23. En tant que manager, je veux qu'une facture annulée reste consultable et réimprimable à l'identique,
    afin de pouvoir la présenter à un contrôle.
24. En tant que manager, je veux que la facture `FAC-2026-00009`, déjà couverte par `AV-2026-00001`,
    apparaisse « annulée » après la mise à jour, afin que les avoirs émis avant ce chantier soient traités
    comme les suivants.
25. En tant que manager, je veux que l'encart « impayés » du tableau de bord compte les factures au reste
    dû non nul, afin que le tableau de bord et la page Factures donnent le même chiffre.

### Émettre un avoir sans erreur

26. En tant que manager, je veux que la fenêtre d'avoir s'ouvre avec les lignes de la facture déjà
    remplies (désignation, quantité, prix unitaire TTC, taux), afin d'annuler une facture entière en un
    clic.
27. En tant que manager, je veux pouvoir modifier ou retirer des lignes préremplies, afin d'émettre un
    avoir partiel.
28. En tant que manager, je veux que les lignes préremplies d'une facture émise avant la bascule en TTC
    proposent leur prix TTC déduit du HT, afin de ne pas avoir à le recalculer.
29. En tant que manager, je veux qu'un avoir dont le cumul dépasserait le total de la facture soit
    refusé, avec un message qui dit le montant encore annulable, afin de corriger ma saisie.
30. En tant que manager, je veux que ce refus n'ait consommé aucun numéro d'avoir, afin que la série
    légale reste sans trou.
31. En tant que manager, je veux qu'un avoir ne puisse viser qu'une facture émise de ma boutique, afin
    qu'aucune annulation ne touche une facture brouillon ou celle d'un autre.
32. En tant que manager, je veux que le motif reste obligatoire, afin que chaque annulation soit
    justifiée.
33. En tant que manager, je veux que le taux de TVA de chaque ligne d'avoir soit conservé tel que saisi
    (20 %, 10 %, 5,5 %, 0 %), afin que l'avoir reflète la facture qu'il annule.

### Imprimer un avoir

34. En tant que manager, je veux imprimer un avoir sur le même gabarit qu'une facture, titré « AVOIR »
    avec son numéro, afin de remettre un document clair au client.
35. En tant que manager, je veux que l'avoir imprimé porte « relatif à la facture FAC-… du jj/mm/aaaa »,
    afin que le client et le comptable relient les deux documents.
36. En tant que manager, je veux voir le motif et le type de l'avoir sur l'impression, et l'expiration
    d'un bon d'achat, afin que le client sache ce qu'il détient.
37. En tant que manager, je veux que l'identité du vendeur et de l'acheteur imprimée sur l'avoir soit
    celle figée sur la facture d'origine, afin qu'un avoir réimprimé dans un an porte les mêmes noms et
    adresses que sa facture.
38. En tant que manager, je veux que les montants de l'avoir soient imprimés en positif, avec la
    ventilation de la TVA par taux, afin que le document soit lisible.
39. En tant que manager, je veux qu'un avoir saisi en TTC s'imprime avec une colonne « P.U. TTC », afin
    qu'il reprenne les prix que le client a vus.
40. En tant que manager, je veux qu'un avoir émis avant ce chantier se réimprime en « P.U. HT », à
    l'identique, afin de ne pas modifier un document déjà remis.
41. En tant que manager, je veux qu'un avoir tienne sur une page A4, afin de l'imprimer comme une facture.

### Bon d'achat né d'un acompte

42. En tant que manager, je veux qu'annuler un ticket dont l'acompte était facturé crée un avoir de type
    « bon d'achat », afin que son type dise ce que le client a reçu.
43. En tant que manager, je veux voir l'expiration de ce bon d'achat (60 jours) dans la liste et sur
    l'impression, afin de la rappeler au client.
44. En tant que manager, je veux que ce bon d'achat respecte lui aussi le plafond de la facture
    d'acompte, afin que la règle soit la même pour tous les avoirs.

### Clôture de caisse

45. En tant que manager, je veux que la clôture du jour garde le total des ventes sans y ajouter les
    avoirs, afin que le chiffre des ventes soit juste.
46. En tant que manager, je veux voir sur la clôture une ligne « Avoirs émis » (HT, TVA, TTC), afin que
    les annulations du jour soient tracées à part.
47. En tant que manager, je veux voir le net du jour (ventes − avoirs), afin de connaître le chiffre
    réellement acquis.
48. En tant que contrôleur NF525, je veux que la clôture d'un jour où un avoir a été émis reste chaînée
    et vérifiable, afin que l'inaltérabilité soit préservée.
49. En tant que manager, je veux que les clôtures passées restent inchangées, afin qu'aucun document
    clôturé ne soit réécrit.

### Admin plateforme

50. En tant qu'admin plateforme, je veux consulter la liste et le détail des avoirs d'une boutique
    sélectionnée, afin de répondre à son manager, sans pouvoir en émettre.

## Implementation Decisions

- **Glossaire** (`CONTEXT.md`, 2026-10-06) : Avoir (toujours rattaché à une facture, plafonné, n'est pas
  un remboursement), Bon d'achat (type d'avoir, avec expiration), Reste dû, Facture annulée. Ces termes,
  et eux seuls, à l'écran et dans le code.
- **Reste dû — une seule définition.** Une fonction du service de facturation le calcule : total TTC −
  paiements − somme des avoirs émis de la facture ; **une facture `payee` a un reste dû de 0** (la caisse
  pose `payee` sans écrire le montant payé — défaut connu, hors chantier). La liste des factures, leurs
  compteurs « en attente » / « en retard » et l'encart « impayés » du tableau de bord passent tous par
  elle. L'encart cesse de lire le statut `emise`, que rien n'écrit.
- **Somme des avoirs d'une facture** : une seule requête, partagée par le reste dû, le plafond et
  l'écriture de l'état « annulée ». Calculs en **centimes entiers**.
- **Émission d'un avoir** (service existant) — ajouts, dans cet ordre, tous **avant** l'attribution du
  numéro :
  1. la facture visée est émise (verrouillée) — contrôle existant ;
  2. **plafond** : somme des avoirs existants + total TTC de l'avoir ≤ total TTC de la facture, sinon
     refus `plafond_depasse` avec le montant encore annulable ;
  3. puis numéro, écritures, journal NF525 (inchangés) ;
  4. **après** l'écriture au journal : si le cumul atteint le total TTC, la facture passe `annulee`. Seule
     la colonne d'état change, comme pour un paiement : contenu, numéro, identités figées et chaînage de la
     facture restent intacts.
- **Ligne d'avoir en TTC** : `lignes_avoir` reçoit `prix_unitaire_ttc` et `mode_calcul` (`ttc` | `ht`,
  défaut `ht`), sur le modèle des lignes de facture. Un avoir saisi en TTC les écrit ; les anciens restent
  en `ht`. Les fonctions communes « colonnes de prix d'une ligne » / « ligne en TTC » servent aussi ici —
  aucune seconde définition.
- **Migration `0068`** (réservée) :
  - `lignes_avoir` + `prix_unitaire_ttc`, `mode_calcul` ;
  - `clotures_journalieres` + `avoirs_ht`, `avoirs_tva`, `avoirs_ttc` (défaut 0) ;
  - **reprise** : toute facture dont la somme des avoirs atteint le total TTC passe `annulee` (en
    production : `FAC-2026-00009`). Aucune facture partiellement couverte n'est touchée.
- **Clôture de caisse** : le total existant ne cumule plus que les écritures de vente du jour ; les
  écritures de type `avoir` alimentent les trois nouvelles colonnes. L'empreinte de clôture **garde son
  format** : elle enchaîne déjà toutes les écritures du jour (avoirs compris) ; seul le total qu'elle
  intègre devient « ventes seules ». La clôture n° 1 (03/10, sans avoir) n'est pas recalculée. Écriture
  toujours en une transaction (port `batch()`).
- **Routes** : `GET /avoirs` (liste) s'enrichit de la recherche (numéro, client), du filtre par type et
  renvoie le total du mois ; `GET /avoirs/:id` (détail, garde d'appartenance existante) renvoie aussi de
  quoi imprimer — lignes, facture d'origine (numéro, date) et ses identités figées. `GET /factures` et
  `GET /factures/:id` exposent le **reste dû** et les **avoirs liés** (numéro, montant). Consultation :
  tous les rôles de la boutique et l'admin plateforme ; émission inchangée (manager, admin de boutique ;
  admin plateforme refusé).
- **Écran Factures** : onglet « Avoirs » (liste, recherche, filtre, total du mois, pagination) ; détail
  d'un avoir avec bouton d'impression ; colonne ou badge « avoir » dans la liste des factures, mention
  « Annulée par AV-… » ; fenêtre d'avoir préremplie des lignes de la facture (PU TTC ; ligne HT d'avant la
  bascule → HT × (1 + taux)), lignes modifiables et supprimables. Données d'API toujours échappées.
  Réponses d'API déballées au point d'appel.
- **Impression d'un avoir** : même mécanisme que la facture (gabarit, garde-fou une page A4, feuille de
  style résolue par le manifeste) ; titre AVOIR et numéro ; « relatif à la facture FAC-… du … » ; motif,
  type, expiration d'un bon d'achat ; identités lues sur les **instantanés de la facture d'origine** ;
  montants positifs ; TVA par taux ; « P.U. TTC » dès qu'une ligne est en TTC, sinon « P.U. HT » à
  l'identique.
- **Acompte d'un ticket annulé** : l'écran des tickets envoie le type `bon_achat` (au lieu de laisser le
  défaut `remboursement`) ; l'expiration à 60 jours est conservée.
- **Version de cache** du service worker incrémentée au dernier ticket d'écran.

## Testing Decisions

- **Un bon test observe un comportement externe** : un numéro attribué ou non, un état de facture, un
  reste dû, une ligne de clôture, ce que l'écran affiche — jamais l'appel d'une fonction interne. Tout
  test est vu **rouge avant** son correctif.
- **Couture 1 — services de facturation et de caisse sur vrai SQLite** au schéma réel
  (`tests/helpers/d1Sqlite.ts`) :
  - plafond : avoir unique trop grand, cumul de deux avoirs trop grand → refus, **compteur de numéros
    d'avoir inchangé** ; avoir exactement égal au reste annulable → accepté ;
  - état : avoir total → `annulee` ; facture payée + avoir total → `annulee` ; avoir partiel → état
    inchangé, reste dû diminué ; deux partiels qui couvrent → `annulee` au second ;
  - reste dû : en attente sans avoir, partiellement couverte, payée (0), annulée (0) ;
  - clôture d'un jour avec une vente et un avoir : total des ventes sans l'avoir, colonnes « avoirs »
    renseignées, chaîne NF525 intègre (`verifierIntegriteChaine()`).
  Précédents : `factures-ttc-sqlite`, `vente-ttc-sqlite`, `cloture-atomique-sqlite`.
- **Couture 2 — migration `0068` sur vrai SQLite** : colonnes ajoutées ; facture couverte → `annulee` ;
  facture partiellement couverte et facture sans avoir intactes ; clôtures existantes inchangées.
  Précédents : `email-logs-types-migration`, `cloture-atomique-sqlite`.
- **Couture 3 — E2E sur la vraie D1 locale** : onglet « Avoirs » (liste, recherche, filtre, total du
  mois) ; facture couverte affichée « annulée » avec son avoir, sortie des compteurs ; fenêtre d'avoir
  préremplie puis avoir partiel ; impression d'un avoir vérifiée sur le **document généré** (titre,
  facture d'origine, « P.U. TTC », identités), sans boîte d'impression ; encart « impayés » du tableau de
  bord ; annulation d'un ticket avec acompte → bon d'achat avec expiration ; technicien qui consulte et
  imprime mais ne voit pas « Créer un avoir » ; charge XSS dans le motif rendue inerte. Précédents :
  `factures-ttc`, `caisse-*`, `xss-gabarits`.
- Les garde-fous statiques existants restent verts (isolation des routes par ID, enveloppe d'API, écrivains
  NF525) ; le balayage du menu de gauche reste un gate (aucune entrée ajoutée).

## Out of Scope

- **Export comptable et chiffre d'affaires nets des avoirs** — chantier séparé, à cadrer avec
  l'expert-comptable (date de l'avoir ou de la facture, CA net).
- **Remboursement d'argent** sur un avoir (sortie d'espèces ou de CB, effet sur la caisse) — chantier
  caisse / NF525.
- **Utilisation d'un bon d'achat en caisse** (état `utilise`, contrôle de l'expiration).
- **Montant payé non écrit par un encaissement de caisse** — contourné ici (facture `payee` → reste dû 0).
- Annulation d'un avoir, avoir sans facture, avoir multi-factures.
- Envoi d'un avoir par email.

## Further Notes

- **Qui code** (Q19) : les tickets NF525 — plafond + état « annulée » + reprise, et clôture — se codent
  **dans la session `izigsm/webapp` avec l'exploitant**, jamais au socle. Les tickets d'écran (onglet,
  préremplissage, impression, tableau de bord, bon d'achat) sont confiables au socle, après relecture de
  leur conception.
- **Déploiement** : `0068` à distance **avant** le code ; relire `d1_migrations` et l'état de
  `FAC-2026-00009` (attendu : `annulee`) avant `npm run deploy`.
- Ancien ticket `.scratch/avoir-vente-caisse/issues/001` (2026-08-02) : absorbé par le chantier
  conformité facturation (une vente de caisse se verrouille et s'annule par avoir) — déjà fait, rien à
  reprendre.
- Recette en production attendue : `FAC-2026-00009` affichée « Annulée par AV-2026-00001 », l'avoir
  retrouvé dans l'onglet et réimprimé.
