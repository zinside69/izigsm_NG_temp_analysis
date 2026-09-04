---
id: 002
titre: Une vente de caisse est verrouillée, et annulable par un avoir
statut: done
bloque-par: [001]
---

## Livré le 2026-09-04

`createVente()` pose le verrou d'émission **après** l'écriture au journal NF525 — même ordre
qu'`emettreFacture()`. Le poser dans l'`INSERT` rendrait la facture immuable avant l'existence
de la chaîne : un échec du journal laisserait une facture verrouillée et orpheline, irréparable.

Alignement complet sur `emettreFacture()`, décidé par l'exploitant : `locked`, `issued_at`,
`hash_nf525`, `tracking_token`, `vendeur_snapshot`, `acheteur_snapshot`. Second site de figeage
des identités, assumé et documenté dans `CLAUDE.md`.

Vérifié en live local : `FAC-2026-00266` verrouillée avec ses six marques d'émission, puis
`AV-2026-00054` émis sur cette vente — geste impossible avant ce ticket. Gates conformes à la
baseline : vitest 907/909, tsc 32, playwright 188/188.

Aucune migration : les six colonnes existent depuis `0006`/`0010`/`0037`.

**Un critère reste non satisfait, et il est insatisfiable ici** — voir ticket **005**.

## Contexte

Absorbe `.scratch/avoir-vente-caisse/issues/001` (même défaut, cadre plus large).

La caisse crée sa facture en `statut = 'payee'` mais ne pose **jamais** `locked` :

```
caisseService.ts  INSERT INTO factures (…, statut, notes) VALUES (…, 'payee', ?)
factureService.ts if (!facture.locked) throw 'Impossible d'émettre un avoir sur une facture non émise.'
```

∴ **aucune vente encaissée n'est annulable**, pour aucun rôle, depuis toujours. Or NF525 impose
la correction par document rectificatif, jamais par suppression — et supprimer la ligne romprait
la chaîne de hash.

Une vente POS **est** une facture émise : numérotée, payée, chaînée.

## Critères d'acceptation

- [x] Une vente de caisse crée une facture `locked = 1`
- [x] Aucun chemin d'encaissement ne casse : `ajouterPaiement()` refuse une facture verrouillée — vérifier vente, encaissement, acompte
      → `createVente()` insère dans `paiements` en direct, sans passer par `ajouterPaiement()` ; les deux seuls appelants (`routes/facturation.ts:415` et `:490`) sont hors POS
- [x] Le bouton d'avoir apparaît sur une vente de caisse, et l'avoir s'émet de bout en bout à l'écran
      → aucune modification frontend nécessaire : `factures.js:237` conditionne déjà le bouton ↩️ sur `f.locked`
- [ ] ~~`nf525/verify` reste **intègre** après émission de l'avoir~~ — **INSATISFIABLE, voir ticket 005**
      → le vérificateur et l'écrivain des avoirs utilisent deux formats de hash incompatibles ; aucun avoir ni aucune facture émise n'a jamais passé ce contrôle depuis l'origine. Mesuré : 170 anomalies = les 170 entrées de l'écrivain B, 0 sur l'entrée A. Défaut pré-existant, hors périmètre de ce ticket.
- [x] L'avoir reste lié à sa facture, et la facture expose ses avoirs (lien lisible dans les deux sens)
- [x] Sort des factures existantes à `locked = 0` : tranché et écrit, même si la réponse est « on les laisse »
      → **on les laisse**. Décision de l'exploitant du 2026-09-04 : ce dossier est en préprod, toutes les factures seront remises à zéro avant la mise en production réelle. Aucune migration de backfill : réécrire `locked` sur des documents déjà chaînés reviendrait à toucher l'historique NF525.
- [x] ∀ test vu rouge avant correctif
      → 4 tests vus rouges puis verts. Deux ajouts sont verts d'emblée et **ne prouvent pas le correctif** : le garde-fou « la facture reste déverrouillée si le journal échoue » (aucun UPDATE n'existait avant) et les 3 tests `createAvoir()`, qui caractérisent le mécanisme existant.
- [x] `npx vitest run` 893 verts · `npx tsc --noEmit` ≤ 32 · `npx playwright test` vert
      → **907/909** (les 2 échecs permanents de fuseau `agendaService`, identiques à la baseline cp77) · **32** · **188/188**

## Notes

- Facture témoin en production : `FAC-2026-00003`, id 4, boutique 1, `payee`, `locked = 0`, 60 €.
- `avoirs.facture_id NOT NULL` existe déjà (migration `0010`, conservé par `0034`).
- ⊥ jamais toucher `journal_nf525` en direct.
