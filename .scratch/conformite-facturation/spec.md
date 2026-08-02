---
chantier: conformite-facturation
statut: ready-for-agent
date: 2026-08-02
---

# Spec — Conformité de la facturation : série continue, document immuable, avoir lié

## Problem Statement

Invariant posé par l'exploitant (2026-08-02) :

> Une facture créée est **persistante, non modifiable, non supprimable**, chaînée NF525.
> Annuler comptablement = créer un **avoir**. Facture et avoir restent **toujours liés**.
> ⊥ trou entre les numéros. La série et le chaînage sont **propres à chaque tenant**.

Ce que le code respecte **déjà** (vérifié en production le 2026-08-02, ⊥ redécouvrir) :

- Numérotation par tenant : `sequences(boutique_id, type, annee)`. Deux boutiques portent
  réellement `FAC-2026-00001` — preuve que les séries sont séparées (migration `0034`).
- Chaînage NF525 par tenant : `WHERE boutique_id = ?` sur les 4 chemins — hash précédent,
  vente, clôture journalière, vérification d'intégrité.
- Avoir lié à sa facture : `avoirs.facture_id NOT NULL`.
- ⊥ route `PUT /factures/:id`, ⊥ route `DELETE /factures/:id` : une facture n'est ni modifiable
  ni supprimable par l'API.

Ce qui **manque** :

1. **Le numéro est consommé avant que le document existe.** `nextNumero()` est appelé puis
   l'`INSERT` suit : tout échec entre les deux brûle un numéro sans laisser de facture.
   Constaté en production — boutique 1 : `FAC-2026-00001` et `FAC-2026-00002` n'existent nulle
   part, sa première facture réelle est `FAC-2026-00003`. Trous ≠ art. 289 CGI.
2. **Un brouillon porte un numéro définitif** alors qu'il n'est pas une facture.
3. **L'immuabilité est de fait, ⊥ intentionnelle** : elle tient à l'absence de routes. L'écran
   propose un bouton 🗑 qui appelle `DELETE /api/factures/:id` — route morte. Rien n'empêche
   qu'un futur chantier rouvre cette porte sans savoir qu'elle doit rester close.
4. **Une vente de caisse n'est pas verrouillée** (`locked` jamais posé) ⇒ aucune vente encaissée
   n'est annulable par avoir, pour aucun rôle. Cf. ticket absorbé
   `.scratch/avoir-vente-caisse/issues/001`.
5. **Une vente passée par la plateforme inscrit le compte de supervision comme caissier** dans
   la chaîne NF525 du client — un tiers apparaît dans le registre légal d'une boutique.

## Solution

- Le numéro n'est attribué qu'à l'**émission**. Un brouillon vit sans numéro.
- Une facture émise est **verrouillée**, quelle que soit son origine — caisse comprise.
- Toute annulation passe par un **avoir**, lié à sa facture, dans les deux sens.
- L'interface cesse de proposer ce que la règle interdit.
- Une intervention de la plateforme sur la caisse d'un client est tranchée : interdite, ou
  explicitement désignée comme telle dans le registre.

## User Stories

1. Comme exploitant, je veux une série de factures sans trou, pour être en règle lors d'un contrôle.
2. Comme exploitant, je veux qu'un échec technique pendant la création ne brûle jamais un numéro.
3. Comme exploitant, je veux qu'un brouillon abandonné ne laisse aucune trace dans ma série.
4. Comme exploitant, je veux qu'une facture émise ne puisse plus être modifiée, par personne.
5. Comme exploitant, je veux qu'une facture émise ne puisse pas être supprimée, par personne.
6. Comme exploitant, je veux annuler une vente encaissée par un avoir, parce que c'est la seule correction légale.
7. Comme exploitant, je veux qu'un avoir renvoie à sa facture et la facture à son avoir, pour justifier l'annulation.
8. Comme exploitant, je veux que ma série et mon chaînage restent les miens, sans continuité avec une autre boutique.
9. Comme exploitant, je veux ⊥ voir de bouton qui promet une action interdite.
10. Comme exploitant, je veux savoir si une écriture de mon registre vient d'un intervenant extérieur à ma boutique.
11. Comme exploitant contrôlé, je veux expliquer les trous existants par un document traçable, ⊥ par des factures fabriquées après coup.
12. Comme développeur, je veux qu'un test empêche la réouverture d'une route de modification ou de suppression de facture.

## Implementation Decisions

- **`nextNumero()` migre dans `emettreFacture()`** — point de passage unique des 3 chemins de
  création (manuelle, conversion de devis, acompte) + caisse. Un brouillon a `numero = NULL`.
  Conséquences à traiter : affichage d'un brouillon sans numéro, recherche, tri, et l'unicité
  `(boutique_id, numero)` qui doit tolérer plusieurs `NULL`.
- **La vente de caisse pose `locked = 1`** dès la création : une vente POS *est* une facture
  émise (numérotée, payée, chaînée). ⚠️ `ajouterPaiement()` refuse une facture verrouillée —
  vérifier qu'aucun chemin d'encaissement n'intervient après.
- **L'immuabilité devient explicite** : les routes de modification et de suppression répondent
  un refus motivé plutôt que d'être absentes, et un test statique interdit leur réintroduction.
  Le bouton 🗑 de l'écran disparaît.
- **Lien bidirectionnel** : `avoirs.facture_id` existe ; la facture doit exposer ses avoirs.
- **Trous existants** : ⊥ réécriture, ⊥ factures rétroactives — ce serait fabriquer des documents
  qui n'ont jamais existé, pire qu'un trou expliqué. Une note traçable en tient lieu.
- **⊥ jamais toucher `journal_nf525` en direct** : chaîne de hash, la rompre fait échouer
  `nf525/verify`.

## Testing Decisions

Bon test : observe ce qu'un rôle **obtient**, ⊥ la forme du code.

- Numérotation : après un échec d'émission, le numéro suivant est **inchangé** (le compteur ne
  bouge que sur succès). Prior art : `tests/factureService.test.ts`.
- Immuabilité : un test statique sur les routes, modèle `routes-isolation-conformite.test.ts`,
  fait rouge la suite si `PUT`/`DELETE /factures/:id` réapparaît.
- Avoir sur vente de caisse : E2E — vente, puis avoir, puis `nf525/verify` **intègre**.
- Isolation des séries : deux boutiques émettent chacune leur première facture et obtiennent le
  **même** numéro ; leurs chaînes de hash ne se croisent pas.
- ! ∀ test vu rouge avant son correctif.

## Out of Scope

- Refonte de la présentation des factures.
- Facture électronique 2026 (socle déjà posé au checkpoint 64, chantier distinct).
- Purge ou archivage des documents.
- Rattrapage des trous existants par création de documents.

## Further Notes

- Invariant existant (`CLAUDE.md`) : « toute validation précède `nextNumero()` » — ce chantier le
  renforce plutôt qu'il ne le contredit.
- `statut = 'emise'` n'est écrit par aucun `INSERT` du dépôt mais survit dans le `DEFAULT` du
  schéma et fausse les KPI de `statsService` — à surveiller en touchant aux statuts.
- Facture témoin en production : `FAC-2026-00003`, boutique 1, `payee`, `locked = 0`, 60 €.
