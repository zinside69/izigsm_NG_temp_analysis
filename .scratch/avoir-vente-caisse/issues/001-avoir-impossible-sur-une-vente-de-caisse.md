---
id: 001
titre: Aucune vente de caisse ne peut être annulée par un avoir
statut: wontfix
bloque-par: []
---

> **Absorbé le 2026-08-02** par
> `.scratch/conformite-facturation/issues/002-vente-de-caisse-verrouillee-et-annulable-par-avoir.md`.
> Même défaut, cadre plus large : l'exploitant a posé l'invariant « facture persistante, non
> modifiable, non supprimable, annulation par avoir lié », qui commande aussi la numérotation et
> l'immuabilité. Le choix A|B posé ci-dessous est tranché là-bas (A : la vente pose `locked = 1`).
> Fichier conservé pour la trace, ⊥ le traiter séparément.

## Contexte

Constaté en **production** le 2026-08-02, en cherchant à annuler la vente de test
`FAC-2026-00003` (60 € TTC, boutique 1).

Une vente encaissée au point de vente crée une facture `statut = 'payee'` mais
**`locked` n'est jamais posé** :

```
caisseService.ts  INSERT INTO factures (…, statut, notes) VALUES (…, 'payee', ?)
```

Or l'émission d'un avoir l'exige, et le refus vient du **service**, pas seulement de l'écran :

```
factureService.ts  if (!facture.locked)
                     throw 'Impossible d'émettre un avoir sur une facture non émise.'
```

Côté interface, le bouton ↩️ est conditionné à `f.locked` : il ne s'affiche même pas.
∴ **aucune vente POS n'est corrigeable**, pour aucun rôle, depuis toujours.

**Pourquoi c'est sérieux** : NF525 impose qu'une transaction encaissée se corrige par un
document rectificatif, jamais par suppression. La ligne vit déjà dans `journal_nf525` avec son
hash chaîné — la supprimer en SQL romprait la chaîne et ferait échouer
`GET /api/boutiques/:id/nf525/verify`, qui passe au vert aujourd'hui. ⊥ jamais toucher la table
en direct.

## La décision à prendre (⊥ tranchée)

Deux corrections possibles, ⊥ équivalentes :

**A — la vente de caisse pose `locked = 1` à la création** *(recommandé)*
Une vente POS **est** une facture émise : elle est numérotée, payée, chaînée NF525. Le `locked = 0`
actuel est vraisemblablement un oubli, pas une intention. Rend l'avoir disponible sans toucher à sa
garde.
⚠️ Effet de bord à vérifier : `ajouterPaiement()` refuse une facture `locked = 1`
(`factureService.ts`) — vérifier qu'aucun chemin de caisse n'encaisse **après** création. Vérifier
aussi les écrans qui conditionnent une action à `!locked` (suppression, édition).

**B — la garde de l'avoir accepte aussi `statut = 'payee'`**
Plus petit périmètre, ⊥ effet de bord sur les paiements. Mais laisse deux notions de « facture
émise » coexister (`locked` vs `statut`), ce qui est précisément le genre d'ambiguïté qui produit
des défauts silencieux dans ce dépôt.

**⊥ retenir** : corriger les lignes existantes en SQL. Les factures déjà créées resteront
`locked = 0` ; décider séparément s'il faut les reprendre, et ⊥ jamais toucher `journal_nf525`.

## Critères d'acceptation

- [ ] Décision A|B tranchée et consignée dans `decisions.md` avec sa justification
- [ ] Une vente enregistrée en caisse peut être annulée par un avoir, de bout en bout, à l'écran
- [ ] L'avoir apparaît dans le journal NF525 et `nf525/verify` reste **intègre** après émission
- [ ] Si A : un test couvre le fait qu'aucun chemin d'encaissement ne casse (`ajouterPaiement()` refuse une facture verrouillée)
- [ ] Test vu **rouge** avant correctif
- [ ] Sort des factures déjà créées (`locked = 0`) : tranché et écrit, même si la réponse est « on les laisse »
- [ ] `npx vitest run` 893 verts · `npx tsc --noEmit` ≤ 32 · `npx playwright test` vert

## Notes

- Facture témoin en production : `FAC-2026-00003`, id 4, boutique 1, `payee`, `locked = 0`, 60 € TTC.
- Invariant du dépôt (`CLAUDE.md` § Factures) : « toute validation précède `nextNumero()` » — un
  numéro consommé ne se rend pas. Vaut aussi pour le numéro d'avoir.
- `POST /api/avoirs` exige `facture_id`, `motif`, `lignes[]` et vérifie l'appartenance de la
  facture support à la boutique de l'appelant.
