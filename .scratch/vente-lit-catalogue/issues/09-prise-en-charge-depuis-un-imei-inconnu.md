---
id: 09
titre: Prise en charge depuis un IMEI inconnu, validation technique
statut: ready-for-agent
bloque-par: [08b]
---

# 09 — Prise en charge depuis un IMEI inconnu

## Contexte

Quand un IMEI valide ne correspond à aucun dossier, l'écran propose de créer une prise en charge,
IMEI déjà rempli, le modèle se saisissant à la main. La prise en charge est créée **complète au
comptoir** — le client repart avec son document signé — puis un technicien la **valide** plus tard.
Une prise en charge peut aussi naître sans IMEI ni numéro de série, pour un appareil hors d'usage.
Spec : stories 44, 46, 47, 62 ; décision « Parcours IMEI » ; vocabulaire `CONTEXT.md` (Appareil,
Prise en charge).

Bloqué par **08b** (l'étape `aucun` du parcours, d'où part la proposition) — le ticket 08 a été
découpé le 2026-09-30.

**Ne touche ni la caisse ni le NF525** → **confié au socle.** Migration **`0056`** (validation
technique), qui rejoint le lot 1.

_Mis au format du modèle le 2026-09-30. Ancien en-tête : `**Status:** ready-for-agent`,
`**Blocked by:** 08`._

### Décisions de l'exploitant du 2026-09-30

1. **La validation bloque la réparation, et elle seule.** Un ticket « à valider » ne peut pas passer
   « en réparation » : 409 « Prise en charge à valider par un technicien avant réparation ». Tout le
   reste passe — impression, signature, diagnostic, devis, remise du document au client. Le
   comptoir n'attend jamais ; seul l'atelier attend (story 47 et « sans retenir quiconque »
   réconciliés).
2. **Valident : technicien, manager, admin de boutique. Un ticket créé par un technicien naît
   validé par lui** (auteur et date posés) : il l'a vu en le créant. Les autres naissent « à
   valider ».
3. **Le lot 1 part sans le ticket 10** (service de base d'IMEI, prestataire non choisi) : sans lui,
   le modèle se saisit à la main (story 44). Consigné dans `decisions.md`.

### Relecture de conception du 2026-09-30

- **Deux sites de création de ticket** : `createTicket()` (`ticketService.ts`) et `createSav()`
  (`garantiesService.ts`, ticket SAV). La règle d'état initial s'applique **aux deux**, par une
  fonction commune — ⊥ la réécrire deux fois.
- **Un seul écrivain du statut** : `updateStatut()` (`ticketService.ts`), appelé par
  `PUT /api/tickets/:id/statut` — que le Kanban emploie aussi. La garde vit **là**, jamais dans un
  écran : un glisser-déposer du Kanban est refusé comme un clic.
- **Statuts bloqués** : `en_reparation` **et** `termine` (un ticket ne doit pas sauter la
  réparation pour finir « terminé » sans avoir été vu). `livre` et `annule` restent permis : un
  client peut reprendre un appareil non réparé. Choix de Claude, à confirmer à la relecture.
- **Tickets existants** : la colonne est ajoutée avec `DEFAULT 'valide'` — les anciens tickets sont
  validés d'office ; seuls les nouveaux naissent « à valider ». Sans cela, tout l'historique
  apparaîtrait à valider.
- **Un ticket sans IMEI ni numéro de série** est déjà possible (champ facultatif, 08a) : un test le
  fixe, aucun code.

## Critères d'acceptation

Base :

- [ ] Migration `0056` : `tickets.validation_technique` (TEXT NOT NULL, `DEFAULT 'valide'`, `CHECK` dans `'a_valider'`, `'valide'`), `tickets.valide_par` (INTEGER, nullable), `tickets.valide_at` (DATETIME, nullable) ; testée contre un **vrai SQLite** : tickets existants à `valide`, valeur hors liste refusée

Serveur :

- [ ] Fonction commune d'état initial : créateur **technicien** → `valide`, `valide_par` = lui, `valide_at` = maintenant ; sinon → `a_valider`. Appelée par `createTicket()` **et** `createSav()`
- [ ] `updateStatut()` : ticket `a_valider` vers `en_reparation` ou `termine` → refus (409 par la route, message ci-dessus) ; tout autre statut permis
- [ ] `POST /api/tickets/:id/valider` : `requireRole('admin', 'manager', 'technicien')`, `assertBoutiqueOwnership()` ; pose `valide`, `valide_par`, `valide_at` ; déjà validé → 409 ; `tests/routes-isolation-conformite.test.ts` vert
- [ ] Liste et détail du ticket renvoient `validation_technique`, `valide_par` (nom), `valide_at` ; filtre `?validation=a_valider` sur la liste

Écrans :

- [ ] Parcours IMEI (08b), étape `aucun` : bouton « Créer une prise en charge » → formulaire de prise en charge avec l'IMEI prérempli, modèle saisi à la main
- [ ] Page Tickets : badge « À valider » sur la ligne et la fiche ; filtre « À valider » ; bouton « Valider la prise en charge » pour les rôles autorisés ; la fiche affiche ensuite qui a validé et quand
- [ ] Kanban : un déplacement refusé (409) remet la carte à sa place et affiche le message du serveur
- [ ] Impression de la prise en charge et signature inchangées pour un ticket « à valider »
- [ ] Appels déballés `(await apiX(…)).data` ; données rendues échappées
- [ ] `CACHE_VERSION` (`public/sw.js`) incrémenté

Commun :

- [ ] Balayage du menu de gauche vert (`resolveur-boutique-pages.spec.ts`)
- [ ] ∀ test vu rouge avant correctif
- [ ] `npx vitest run` sans nouvel échec par rapport à la baseline mesurée avant le ticket
- [ ] Erreurs tsc ≤ baseline mesurée avant le ticket (`npx tsc --noEmit --pretty false | grep -cE "error TS[0-9]+"`)
- [ ] ⊥ caisse ; ⊥ NF525

## Coutures à tester

- **Migration `0056`** — vitest contre un vrai SQLite.
- **État initial** (`createTicket()`, `createSav()`) — vitest contre un **vrai SQLite** : technicien → `valide` avec auteur et date ; manager → `a_valider` ; ticket SAV suit la même règle.
- **`updateStatut()`** — vitest contre un vrai SQLite : `a_valider` → `en_reparation` refusé, → `termine` refusé, → `en_diagnostic`/`livre`/`annule` permis ; `valide` → `en_reparation` permis.
- **Route** `POST /api/tickets/:id/valider` — vitest par `app.request()` : 200, 409 déjà validé, 404 autre boutique, rôles.
- **Écrans** — E2E Playwright `tests/e2e/prise-en-charge-validation.spec.ts`, vraie D1 locale : IMEI inconnu → « Créer une prise en charge » → IMEI prérempli → ticket créé « à valider » et imprimable → passage en réparation refusé (message) → validé en technicien (`TECHNICIEN` de `fixtures/comptes.ts`) → passage en réparation accepté ; ticket créé sans IMEI ni numéro de série ; déplacement Kanban refusé puis carte revenue. L'E2E est joué par le socle dans le bac à sable (contrôle e2e de gates.json, à déclarer dans la tâche d'écran) ; un E2E hors de sa portée (préproduction, production) se demande dans le compte rendu (P16).

## Notes

- Périmètre : `migrations/0056_tickets_validation_technique.sql` (nouveau), `src/services/ticketService.ts`, `src/services/garantiesService.ts` (`createSav()`, état initial seulement), `src/routes/tickets.ts`, `public/static/js/tickets.js`, `public/tickets.html`, `public/static/js/kanban.js`, `public/sw.js`, tests correspondants.
- Le critère d'origine « dernier ticket d'écran du lot 1 : incrémenter `CACHE_VERSION` » est remplacé par un incrément **à chaque ticket d'écran** : les tickets du lot sont codés en parallèle (socle et exploitant), aucun n'est « le dernier » de façon sûre.

## Critères d'origine (avant le 2026-09-30, repris ci-dessus)

- ~~IMEI valide sans dossier → proposition de prise en charge, IMEI prérempli dans la fiche
      appareil, modèle saisi à la main~~
- ~~La prise en charge se crée et s'imprime immédiatement, signature comprise, comme aujourd'hui~~
- ~~Nouvel état de validation technique sur le ticket (migration testée) : « à valider » à la
      création, « validé » par un technicien, avec son auteur et sa date~~ — un ticket créé par un technicien naît validé (décision 2)
- ~~Les tickets à valider sont visibles des techniciens ; la validation ne bloque ni l'impression
      ni la suite du parcours au comptoir~~ — elle bloque le passage en réparation (décision 1)
- ~~Un ticket peut être créé sans IMEI ni numéro de série (aucune garde à la création)~~
- ~~Route de validation gardée par l'appartenance à la boutique (garde-fou d'isolation vert)~~
- ~~E2E : scanner un IMEI inconnu, créer la prise en charge, la valider en technicien ; créer un
      ticket sans identifiant ; vus rouges d'abord~~
- ~~**Dernier ticket d'écran du lot 1 fait par un agent** : incrémenter `CACHE_VERSION` si le
      lot part en production sans le ticket 10~~ — voir Notes
- ~~Balayage du menu de gauche vert ; `npx vitest run` vert (hors les 2 échecs permanents) ;
      erreurs tsc inchangées~~
