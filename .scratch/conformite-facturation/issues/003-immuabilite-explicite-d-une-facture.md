---
id: 003
titre: L'immuabilité d'une facture devient explicite, pas accidentelle
statut: done
bloque-par: []
---

## Contexte

Une facture n'est aujourd'hui ni modifiable ni supprimable — mais **par absence de routes**, pas
par intention : ni `PUT /factures/:id` ni `DELETE /factures/:id` n'existent dans
`src/routes/facturation.ts`.

Deux conséquences :

- L'écran propose un bouton 🗑 (`btnDelete`, conditionné à `!locked`) qui appelle
  `apiDelete('/api/factures/' + id)` — **route morte**. L'exploitant se voit offrir une action
  interdite, qui échoue sans expliquer pourquoi.
- Rien n'empêche un futur chantier de rouvrir cette porte sans savoir qu'elle doit rester close.

Invariant posé par l'exploitant : une facture créée est persistante, non modifiable, non
supprimable. La seule annulation est un avoir.

## Critères d'acceptation

- [x] Le bouton de suppression disparaît de l'écran des factures
- [x] Une tentative de modification ou de suppression répond un **refus motivé** (⊥ 404 muet) qui nomme l'avoir comme seule voie
- [x] Un test statique fait rouge la suite si `PUT`/`DELETE /factures/:id` réapparaît — modèle `tests/routes-isolation-conformite.test.ts`
- [x] Le refus est écrit dans `CLAUDE.md` § Factures comme invariant, avec son motif légal
- [x] ∀ test vu rouge avant correctif
- [x] `npx vitest run` **920/922** · `npx tsc --noEmit` **32** · `npm run build` ✓ (baselines exactes, les 2 échecs sont les permanents de fuseau `agendaService`)
- [x] `npm run test:e2e` **188/188** en 4,1 min, serveur local complet — dont le gate de balayage des
      20 entrées du menu (`resolveur-boutique-pages.spec.ts`), les 3 tests XSS et les 7 pages hors
      socle. La page factures ne casse pas après le retrait du bouton et de `window.deleteFacture`.

## Fait le 2026-09-07

- `src/routes/facturation.ts` : `PUT` et `DELETE /factures/:id` répondent 405 avec un motif unique
  (`REFUS_MUTATION_FACTURE`) nommant l'avoir. Aucun accès base, le param `:id` n'est pas lu.
- `tests/factures-immuabilite-conformite.test.ts` (5 tests, **vus rouges 4/5 avant correctif**) :
  volet fonctionnel sur l'application réelle + volet statique anti-réouverture. Le statique est
  celui qui compte — un test fonctionnel seul resterait vert le jour où quelqu'un remplace le
  refus par une vraie implémentation et en change les attentes.
- `tests/routes-isolation-conformite.test.ts` : deux exemptions motivées, sur le modèle du
  `GET /token-for-ticket/:id` déjà désactivé.
- `public/static/js/factures.js` : bouton 🗑 et fonction `deleteFacture()` retirés,
  `window.deleteFacture` avec. **Le repli hors-ligne supprimait pour de bon la facture du cache
  local** en annonçant « Facture supprimée (hors-ligne) » — pire que l'échec muet décrit par le
  ticket : une pièce comptable disparaissait de l'écran alors que le serveur l'avait toujours.
  Ça referme aussi l'entrée « le bouton 🗑 échoue en silence » de `bugs.md` (2026-08-16).
- `public/sw.js` : `CACHE_VERSION` `izigsm-v2.90` → `izigsm-v2.91` (touche `public/static/js`).

### Défaut trouvé en revue, dans le garde-fou lui-même

La première version du volet statique cherchait des **verbes de mutation**
(`update|delete|supprim`). Elle laissait passer `await modifierFacture(...)` : le garde-fou censé
empêcher la réouverture ne l'aurait pas vue, faute d'avoir le bon mot dans sa liste. Critère
remplacé par **l'absence d'`await`** dans ces handlers — D1 est asynchrone, toute implémentation
réelle en contient un ; un refus n'attend rien. Un second test exige que chaque handler nomme
`REFUS_MUTATION_FACTURE` et réponde 405, sans quoi vider le corps du handler suffirait à verdir
le premier.

**Prouvé par mutation** : en injectant `await modifierFacture(c.get('db'), 1, {})` dans le
handler `PUT`, les 3 tests concernés virent au rouge. Fichier restauré ensuite, 6/6 verts.

### Piège d'outillage revérifié le 2026-09-07

`TaskStop` sur `wrangler pages dev` tue le shell parent **mais pas `workerd.exe`** : le port 3000
restait occupé par un serveur orphelin, exactement le fantôme des checkpoints 80 et 82. Vérifier
`netstat -ano | grep LISTENING` après l'arrêt, et tuer le `workerd` restant par son PID. Un
`node.exe` wrangler survit aussi, mais sur des ports éphémères hauts — sans serveur
d'application derrière, donc sans effet sur la session suivante.

### Le brouillon, tranché

**Non supprimable non plus.** Le ticket laissait la question ouverte au motif qu'un brouillon sans
numéro ne coûte rien à la série. Mais `ajouterPaiement()` refuse une facture `locked = 1` : tout
encaissement vit donc **exclusivement** sur un brouillon. Le supprimer effacerait de l'argent
encaissé. L'invariant reste ainsi d'une seule pièce, sans exception à retenir.

⚠ **Conséquence non traitée** : une facture créée par erreur ne peut plus être retirée de la liste.
Le statut `annulee` existe mais aucune route ne le pose. « Comment se débarrasser d'un brouillon
erroné » reste ouvert — hors périmètre de ce ticket, à cadrer avec le 004.

## Notes

- Un brouillon **sans numéro** (ticket 001) peut, lui, être abandonné sans conséquence sur la
  série : trancher explicitement s'il reste supprimable, et le dire dans l'invariant.
- Le devis, lui, reste modifiable — ⊥ étendre la règle par symétrie sans y penser.
