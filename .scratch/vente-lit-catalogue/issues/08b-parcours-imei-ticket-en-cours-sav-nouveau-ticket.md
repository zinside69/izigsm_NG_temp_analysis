---
id: 08b
titre: Parcours IMEI — ticket en cours, dossier SAV ou nouveau ticket
statut: ready-for-agent
bloque-par: [04, 08a]
---

# 08b — Parcours IMEI : ticket en cours, SAV ou nouveau ticket

## Contexte

Découpé du ticket 08 le 2026-09-30. Le vendeur scanne ou saisit l'IMEI d'un appareil qui arrive au
comptoir. Un IMEI dont la clé de contrôle est fausse est refusé tout de suite. Si l'appareil a un
ticket **non rendu**, ce ticket s'ouvre. S'il a une **garantie active**, l'écran montre ce qui est
couvert et jusqu'à quand, et demande « même panne ? » : oui ouvre un dossier SAV, non exige un
**motif** (autre panne, casse, oxydation, garantie expirée) et ouvre un nouveau ticket qui le
conserve. Sinon, « aucun dossier » (la prise en charge viendra au ticket 09).
Spec : stories 37 à 41 ; décision « Parcours IMEI » ; vocabulaire `CONTEXT.md` (Garantie, Nouvelle
panne hors garantie). La requalification (story 42) est le ticket **08c**.

Bloqué par 04 (capture douchette partagée, `public/static/js/douchette.js`) et 08a (l'IMEI est
enregistré sur la fiche appareil — sans lui, aucun ticket n'est retrouvable).

**Ne touche ni la caisse ni le NF525** → **confié au socle.** Migration **`0055`** (motif hors
garantie sur le ticket), qui rejoint le lot 1.

### Décision de l'exploitant du 2026-09-30

**Le parcours démarre sur la page Tickets** : bouton « Scanner un appareil » (saisie de l'IMEI) et
capture douchette sur la page (même module que la caisse, ticket 04). Pas en caisse, pas de
recherche globale — la « recherche générale » du ticket d'origine n'existe pas dans l'application.

### Relecture de conception du 2026-09-30

- **L'appareil se retrouve par IMEI sur toutes les fiches appareil de la boutique** (tous clients :
  un appareil revendu a une fiche par propriétaire, 08a). Isolation par `clients.boutique_id`.
- **« Non rendu »** = statut ni `livre` ni `annule`, et non archivé. Plusieurs tickets non rendus
  pour le même IMEI → **liste**, aucun choix automatique.
- **« Garantie active »** = garantie `actif = 1`, statut `active` **et** `date_fin` future (le
  statut seul peut être en retard sur la date : `expirerGaranties()` ne tourne pas en continu).
- **« Même panne » réutilise `createSav()`** (`garantiesService.ts`) : il crée le ticket SAV et
  consomme la garantie. Le ticket SAV créé doit **porter l'`appareil_id`** du ticket d'origine,
  sinon il échappe au prochain scan. ⊥ une seconde création de SAV.
- **« Autre panne »** ouvre le formulaire de prise en charge **prérempli** (client, marque, modèle,
  IMEI, motif) : la panne se décrit comme d'habitude, rien n'est créé sans « Enregistrer ».

## Critères d'acceptation

Base :

- [ ] Migration `0055` : `tickets.motif_hors_garantie` (TEXT, nullable, `CHECK` dans `'autre_panne'`, `'casse'`, `'oxydation'`, `'garantie_expiree'`) ; testée contre un **vrai SQLite** (valeur hors liste refusée, tickets existants intacts)

Serveur :

- [ ] `GET /api/appareils/parcours?imei=` : clé de Luhn fausse → **400** `imei_invalide` **sans requête SQL** ; sinon rend `{ etape, … }` :
  - `ticket_en_cours` + le ou les tickets non rendus ;
  - sinon `garantie` + les garanties actives (réparation, date de fin, ticket d'origine) + l'appareil (client, marque, modèle) ;
  - sinon `aucun`
- [ ] Boutique : celle du jeton ou consultée (`getBoutiqueId()`) ; un IMEI d'une autre boutique → `aucun`
- [ ] `createSav()` pose l'`appareil_id` du ticket d'origine sur le ticket SAV
- [ ] `POST /api/tickets` accepte `motif_hors_garantie` (liste fermée, 400 sinon) ; `GET` du ticket le renvoie

Écran (`tickets.js`, `tickets.html`) :

- [ ] Bouton « Scanner un appareil » (champ IMEI) et capture douchette de la page par `douchette.js` (ticket 04), neutralisée dans un champ de saisie
- [ ] IMEI faux → « IMEI invalide (clé de contrôle) » ; `ticket_en_cours` → la fiche du ticket s'ouvre (liste si plusieurs) ; `aucun` → « Aucun dossier pour cet appareil »
- [ ] `garantie` → écran de décision : réparations garanties et date de fin, « Même panne » / « Autre panne »
- [ ] « Même panne » → `POST /api/sav` (`garantie_id`, motif « même panne ») → le ticket SAV s'ouvre
- [ ] « Autre panne » → choix du motif **obligatoire** dans la liste fermée → formulaire de prise en charge prérempli (client, marque, modèle, IMEI, motif) ; le ticket enregistré porte le motif, affiché dans sa fiche
- [ ] Appels déballés `(await apiX(…)).data` ; données rendues échappées (`esc()` de `tickets.js`)
- [ ] `CACHE_VERSION` (`public/sw.js`) incrémenté

Commun :

- [ ] ∀ test vu rouge avant correctif
- [ ] `npx vitest run` sans nouvel échec par rapport à la baseline mesurée avant le ticket
- [ ] Erreurs tsc ≤ baseline mesurée avant le ticket (`npx tsc --noEmit --pretty false | grep -cE "error TS[0-9]+"`)
- [ ] ⊥ caisse ; ⊥ NF525

## Coutures à tester

- **Migration `0055`** — vitest contre un vrai SQLite.
- **Service de résolution** (`GET /api/appareils/parcours`, SQL dans un service) — vitest contre un **vrai SQLite** (l'ordre de résolution vit dans le SQL) : ticket non rendu prioritaire sur la garantie ; ticket `livre`/`annule`/archivé ignoré ; garantie `active` à date passée ignorée ; garantie consommée ignorée ; deux tickets non rendus → deux ; autre boutique → `aucun`.
- **Route** — vitest par `app.request()` : 400 `imei_invalide` sans appel à la base.
- **`createSav()`** — vitest contre un vrai SQLite : le ticket SAV porte l'`appareil_id` du ticket d'origine.
- **Écran** — E2E Playwright `tests/e2e/parcours-imei.spec.ts`, vraie D1 locale : IMEI faux ; ticket en cours ouvert ; garantie active → « Même panne » → ticket SAV ouvert ; garantie active → « Autre panne » + motif → ticket enregistré avec le motif. L'E2E est joué par le socle dans le bac à sable (contrôle e2e de gates.json, à déclarer dans la tâche d'écran) ; un E2E hors de sa portée (préproduction, production) se demande dans le compte rendu (P16).

## Notes

- Périmètre : `migrations/0055_tickets_motif_hors_garantie.sql` (nouveau), route et service du parcours (`src/routes/appareils.ts` ou `clients.ts`, `src/services/…`), `src/services/garantiesService.ts` (`createSav()`), `src/routes/tickets.ts`, `src/services/ticketService.ts`, `public/static/js/tickets.js`, `public/tickets.html`, `public/sw.js`, tests correspondants.
- Réutilise `luhnValide()` (07, `src/lib/scan.ts`) et `douchette.js` (04) — ⊥ seconde implémentation.
- Garanties : une par ticket d'origine (`idx_garanties_ticket_unique`), en attendant le ticket 16 (garanties par ligne de service).
