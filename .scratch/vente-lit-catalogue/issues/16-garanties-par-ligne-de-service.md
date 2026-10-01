---
id: 16
titre: Garanties par ligne de service
statut: ready-for-agent
bloque-par: [08b, 11]
---

# 16 — Garanties par ligne de service

## Contexte

Le responsable de boutique fixe la **durée de garantie de chaque service** de son catalogue (par
exemple écran 6 mois, autres réparations 3 mois). Quand un ticket est terminé, chaque ligne de
service ouvre **sa propre garantie**, à la durée de son service : sur un même ticket, l'écran reste
couvert 6 mois et la batterie 3. Les garanties déjà émises restent valables telles quelles. L'écran
de décision du parcours IMEI détaille désormais la couverture ligne par ligne, et rappelle les
exclusions (casse, oxydation).
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 74 à 77 ; décision « Garanties ») ;
vocabulaire `CONTEXT.md` (Garantie, Nouvelle panne hors garantie).

**Ne touche ni la caisse ni le NF525** → **confié au socle.** Migration **`0059`** réservée
(`decisions.md` 2026-10-01).

Bloqué par **08b** (écran de décision du parcours IMEI ; l'ancien bloqueur « 08 » a été découpé le
2026-09-30) et **11** (table `lignes_ticket`, migration `0057`, référencée par `0059`).

_Mis au format du modèle le 2026-10-01. Ancien en-tête : `**Status:** ready-for-agent`,
`**Blocked by:** 08 — Parcours IMEI (écran de décision) ; 11 — Lignes de ticket.`_

### Constats du cadrage (2026-10-01)

- **La saisie existe déjà** : `services.garantie_jours` (`0013`, `DEFAULT 0`, commentaire « 0 = sans
  garantie ») a son champ dans la fiche service (`services.js`, `#svc-garantie`) et un badge 🛡 dans
  la liste. Ce qui manque : **personne ne lit cette durée** pour créer une garantie.
- Le formulaire envoie `parseInt(…) || 0` : un champ vide part en **0**. `createService()` écrit
  `?? 0` ; `updateService()` écrit `COALESCE(?, garantie_jours)` — impossible de **vider** la durée.
  Tous les services existants valent donc très probablement 0 : appliquer « 0 = sans garantie » tel
  quel supprimerait toute garantie.
- **Création actuelle** : `createGarantieFromTicket()` (`garantiesService.ts`), appelée par le hook
  de passage en `termine` (`routes/tickets.ts`, `PATCH` statut), **une** garantie par ticket à
  `boutique_settings.garantie_defaut_jours` (repli 90), idempotente par lecture préalable + index
  unique `idx_garanties_ticket_unique` (`ticket_id WHERE actif = 1 AND ticket_id IS NOT NULL`, `0019`).
  L'appel est enveloppé d'un `catch {}` **muet**.
- La route renvoie `garantie: { id, date_fin, garantie_jours }` (une seule) ; `tickets.js` ne la lit
  pas. `sendTicketTermine()` (`emailService.ts`) n'annonce qu'**une** durée.
- 08b : « garantie active » = `actif = 1`, statut `active` **et** `date_fin` future ; « Même panne »
  appelle `createSav({ garantie_id })`, qui consomme **cette** garantie. Une garantie par ligne
  donne donc naturellement une consommation par ligne.

### Décisions de l'exploitant du 2026-10-01

1. **Vide = durée par défaut de la boutique ; 0 = sans garantie** (même règle que le seuil de
   stock). La migration remet les `0` existants à `NULL` (« jamais réglé ») : la colonne n'ayant
   jamais été lue, aucun 0 n'a pu être voulu avec effet. Ensuite, 0 saisi exprès = service sans
   garantie (nettoyage, transfert de données…).
2. **Ticket sans ligne de service** (aucune ligne, ou seulement des pièces et des lignes libres) :
   **une** garantie de ticket à la durée par défaut de la boutique — comportement actuel conservé.
3. **Écran de décision : un bouton « Même panne » par ligne garantie** ; le dossier SAV consomme la
   seule garantie de cette ligne, les autres restent actives.

### Relecture de conception (2026-10-01)

- **Résolution pure** `resoudreGarantieJours(serviceJours, defautBoutique)` : `NULL` → défaut de la
  boutique (`garantie_defaut_jours`, repli 90 si la ligne de réglages manque) ; `0` → **aucune**
  garantie ; `n > 0` → `n`. `??`, jamais `||` (un 0 doit l'emporter). Seul point de résolution — ⊥
  un repli codé ailleurs.
- **Migration `0059`** — `ALTER TABLE` et index seulement, **⊥ recréation de table** (pièges de
  `0040`) :
  - `garanties.ligne_ticket_id INTEGER REFERENCES lignes_ticket(id)` (nullable, sans action de
    suppression) ;
  - `DROP INDEX idx_garanties_ticket_unique` ; **deux** index uniques partiels :
    `(ligne_ticket_id) WHERE actif = 1 AND ligne_ticket_id IS NOT NULL` et
    `(ticket_id) WHERE actif = 1 AND ticket_id IS NOT NULL AND ligne_ticket_id IS NULL` (garantie
    de ticket, décision 2 ; les garanties existantes y tombent toutes) ;
  - `UPDATE services SET garantie_jours = NULL WHERE garantie_jours = 0` (décision 1).
- **Création à `termine`** : une garantie par ligne `nature = 'service'` du ticket dont la durée
  résolue est > 0 (`description_reparation` = désignation de la ligne, `ligne_ticket_id` posé) ;
  aucune ligne de service → garantie de ticket (décision 2). Écriture **idempotente par l'index**
  (`INSERT … ON CONFLICT DO NOTHING` ou équivalent), pas par une lecture préalable seule : un
  second passage en `termine` (ticket rouvert, ligne ajoutée) ne crée que les garanties manquantes,
  et une création interrompue se complète au passage suivant. Une garantie **consommée** (toujours
  `actif = 1`) n'est jamais recréée.
- **Ligne qui porte une garantie** : `DELETE /api/lignes-ticket/:id` → **409** (la clé étrangère
  le refuserait sinon par une erreur SQL brute).
- **Échec silencieux** : le `catch {}` du hook écrit au moins `console.error` (même règle que les
  emails : aucune sortie muette).
- `createGarantie()` (manuelle) et `createSav()` : inchangés hors de ce qui précède.

### Précision du 2026-10-01 — cadrage du ticket 17 (décision de l'exploitant)

**Un ticket SAV terminé n'ouvre aucune garantie** : une réparation sous garantie ne crée pas de
garantie neuve. Le hook de passage en `termine` saute un ticket **SAV valide** = ticket dont un
dossier `sav_dossiers` actif porte `ticket_sav_id` = ce ticket, en statut ≠ `refuse` (un dossier
`refuse` = requalifié en payant par le 08c : ce ticket ouvre alors ses garanties normalement). La
définition « SAV valide » est **une seule fonction de service**, partagée avec le ticket 17 (prix
facturé à 0) — ⊥ la réécrire.

## Critères d'acceptation

Base :

- [ ] Migration `0059` conforme à la relecture ; testée contre un **vrai SQLite** au schéma réel :
      garanties existantes intactes et lisibles ; deux garanties actives pour deux lignes d'un même
      ticket acceptées ; deux pour la même ligne refusées ; deux garanties de ticket (sans ligne)
      refusées ; `services.garantie_jours` 0 → `NULL`, valeurs non nulles inchangées

Serveur :

- [ ] `resoudreGarantieJours()` pure, testée (`NULL`, 0, n, défaut absent)
- [ ] Passage en `termine` : une garantie par ligne de service à durée > 0, à sa durée et à sa date
      de fin ; service à 0 → aucune ; lignes pièce et libres → aucune ; aucune ligne de service →
      une garantie de ticket au défaut (décision 2)
- [ ] ➕ (2026-10-01) Ticket SAV valide terminé → **aucune** garantie ; ticket SAV requalifié en payant
      (dossier `refuse`) terminé → garanties ouvertes comme un ticket — vrai SQLite
- [ ] Idempotence : second passage en `termine` → aucune garantie en double ; ligne de service
      ajoutée entre-temps → seule sa garantie est créée
- [ ] `PATCH` statut renvoie `garanties: [{ id, ligne_ticket_id, description_reparation, date_fin,
      garantie_jours }]` ; `garantie` conservée (première de la liste) pour compatibilité
- [ ] `createService()` sans durée → `NULL` ; `updateService()` à **trois états** pour
      `garantie_jours` (absent = inchangé, `null` ou `""` = vidé, entier 0–3650 = posé ; ⊥
      `COALESCE` sur cette colonne) ; hors bornes → 400
- [ ] `DELETE /api/lignes-ticket/:id` d'une ligne qui porte une garantie → 409
- [ ] `sendTicketTermine()` annonce **chaque** garantie (désignation, durée, date de fin) ; aucune
      garantie → pas de bloc
- [ ] Réponse du parcours IMEI (08b, `GET /api/appareils/parcours`) : une entrée par garantie active,
      avec `garantie_id`, `description_reparation`, `date_fin`
- [ ] Hook : échec de création journalisé (`console.error`), jamais muet
- [ ] SQL dans les services ; routes gardées (`tests/routes-isolation-conformite.test.ts` vert)

Écrans :

- [ ] Fiche service : champ vide = « Durée par défaut de la boutique (N jours) », 0 = « Sans
      garantie » ; l'envoi distingue vide (`null`) de 0 (⊥ `|| 0`) ; badge 🛡 : durée propre, ou
      mention du défaut, ou « sans garantie »
- [ ] Écran de décision (08b) : une ligne par garantie active (réparation, date de fin) avec son
      bouton « Même panne » → `createSav({ garantie_id })` de **cette** garantie ; rappel « Hors
      casse, hors oxydation » ; « Autre panne » inchangé
- [ ] Données rendues échappées ; appels déballés `(await apiX(…)).data`
- [ ] `CACHE_VERSION` (`public/sw.js`) incrémenté

Commun :

- [ ] ∀ test vu rouge avant correctif
- [ ] `npx vitest run` sans nouvel échec par rapport à la baseline mesurée avant le ticket
- [ ] Erreurs tsc ≤ baseline mesurée avant le ticket
      (`npx tsc --noEmit --pretty false | grep -cE "error TS[0-9]+"`)
- [ ] ⊥ caisse ; ⊥ NF525

## Coutures à tester

- **Résolution** — vitest, fonction pure `resoudreGarantieJours()`.
- **Migration** — vitest contre un **vrai SQLite** (`tests/helpers/d1Sqlite.ts`, toutes les
  migrations rejouées) : index uniques, garanties existantes, remise à `NULL` des 0.
- **Création à la clôture** — vrai SQLite : ticket écran (180 j) + batterie (`NULL` → défaut 90) +
  transfert (0) + pièce + ligne libre → deux garanties, aux bonnes dates ; ticket sans ligne de
  service → une garantie de ticket ; second passage → rien de plus ; ligne ajoutée → une de plus ;
  garantie consommée → pas recréée.
- **Routes** — vitest par `app.request()` : `PATCH` statut (forme `garanties`), `PUT` service à
  trois états, `DELETE` ligne garantie → 409.
- **Écrans** — E2E Playwright `tests/e2e/garanties-par-ligne.spec.ts`, vraie D1 locale : régler
  écran 180 jours et batterie vide (défaut 90) ; terminer un ticket portant les deux ; relire les
  deux garanties ; scanner l'IMEI → deux lignes, deux dates, rappel des exclusions ; « Même panne »
  sur l'écran → SAV ouvert, la batterie reste garantie au nouveau scan. L'E2E est joué par le socle
  dans le bac à sable (contrôle e2e de gates.json, à déclarer dans la tâche d'écran) ; un E2E hors
  de sa portée (préproduction, production) se demande dans le compte rendu (P16).

## Notes

- Périmètre : `migrations/0059_garanties_par_ligne.sql` (nouveau), `src/services/garantiesService.ts`,
  `src/services/servicesService.ts`, `src/lib/validators.ts`, `src/services/lignesTicketService.ts`
  (retrait refusé), `src/services/emailService.ts`, `src/routes/tickets.ts`, service et route du
  parcours IMEI (08b), `public/static/js/services.js`, `public/static/js/tickets.js` (écran de
  décision), `public/sw.js`, tests correspondants.
- Découpage conseillé pour le socle : **base + serveur** puis **écran**.
- Fichiers partagés : `routes/tickets.ts` et `tickets.js` (08b, 08c, 09, 11 à 14) — **après** 14 si
  le socle les traite en série ; `garantiesService.ts` (`createSav()`, 08b).
- Déploiement : avant `0059` à distance, **compter** `SELECT COUNT(*) FROM services WHERE
  garantie_jours > 0` en production (lecture) — un résultat non nul dit qu'une boutique a déjà saisi
  des durées, qui seront conservées ; les 0 deviennent « défaut ».
- Ticket 17 (lignes de SAV, coût des garanties) suit celui-ci.

## Critères d'origine (avant le 2026-10-01, repris ci-dessus)

- ~~La durée de garantie d'un service se saisit dans le catalogue (la colonne existe déjà, jamais
      lue jusqu'ici)~~ — la saisie existe déjà ; elle distingue désormais vide et 0 (décision 1)
- ~~Fonction pure de résolution : durée du service, sinon durée par défaut de la boutique ; tests
      vus rouges~~
- ~~Garanties rattachées à une ligne de service : l'unicité « une garantie active par ticket » est
      remplacée par une unicité par ligne — migration testée contre un vrai SQLite, garanties
      existantes intactes~~
- ~~Ticket terminé : une garantie par ligne de service, à la durée résolue ; les lignes de pièce
      et les lignes libres n'en ouvrent pas ; un ticket sans ligne garde le comportement actuel~~ —
      étendu aux tickets sans ligne de service (décision 2)
- ~~Écran de décision (ticket 08) : couverture par ligne, dates de fin, rappel « hors casse, hors
      oxydation »~~ — un bouton « Même panne » par ligne (décision 3)
- ~~L'email de fin de réparation annonce les durées réelles~~
- ~~E2E : régler écran 180 jours et batterie 90 ; terminer un ticket portant les deux ; relire les
      deux garanties ; scanner l'IMEI et voir la couverture détaillée ; vus rouges d'abord~~
- ~~`npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées~~
