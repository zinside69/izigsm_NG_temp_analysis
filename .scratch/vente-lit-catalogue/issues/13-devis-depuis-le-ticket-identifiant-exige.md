---
id: 13
titre: Devis depuis le ticket, identifiant de l'appareil exigé
statut: ready-for-agent
bloque-par: [08a, 11]
---

# 13 — Devis depuis le ticket, identifiant de l'appareil exigé

## Contexte

Le vendeur génère le **devis d'un ticket** en un geste, à partir de ses lignes, sans rien retaper.
Tant que l'appareil n'a **ni IMEI ni numéro de série**, le devis est refusé avec un message qui dit
quoi faire ; le technicien peut saisir l'identifiant au moment de la réparation, quand l'appareil
redevient lisible. Le devis affiche l'identité de l'appareil.
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 62 à 66 ; décision « Devis et facture depuis
le ticket ») ; vocabulaire `CONTEXT.md` (Appareil).

**Bloqué par** 11 (lignes de ticket) et par **08a** (ajouté le 2026-09-30) : c'est le 08a qui
enregistre l'IMEI ou le numéro de série sur la fiche appareil du client (`tickets.appareil_id`) et le
rend modifiable depuis le ticket — la garde de ce ticket lit cette fiche. **À coder après la tâche
écran du ticket Mobilax 06** (T-007), qui modifie aussi `devis.js`.

**Ne touche ni la caisse ni le NF525** (règle de l'exploitant du 2026-09-30) : un devis reste
modifiable et n'écrit rien au journal → **confié au socle**. **Aucune migration**.

_Mis au format du modèle le 2026-09-30. Ancien en-tête : `**Status:** ready-for-agent`,
`**Blocked by:** 11`._

### Constats du cadrage (2026-09-30)

- **Le passage actuel du ticket au devis est cassé** : `createDevisFromTicket()` (`tickets.js`) pose
  l'identifiant dans `localStorage` (`izigsm_new_devis_from_ticket`) ; `checkFromTicket()`
  (`devis.js`) relit le ticket dans un **cache local** (`getDB('tickets')`), ne reprend **qu'une
  ligne** (description, prix saisi) et retrouve le client **par comparaison de nom**.
- **Les lignes de devis n'écrivent pas `service_id`** (`devisService.ts`, `INSERT INTO
  lignes_document` : `produit_id` seul), alors que la colonne existe depuis `0049`.
- **Le devis n'a pas de document imprimable** : il s'affiche dans la fenêtre de détail
  (`openDevisDetail()`, `devis.js`) et, pour le client, sur la page publique `devis-public.html`
  (`GET /api/public/devis/:token`).
- Statuts de devis : `draft` (`brouillon` en base), `envoye`, `accepte`, `refuse`, `expire`, `annule`.

### Décisions de l'exploitant du 2026-09-30

1. **Un ticket a au plus un devis vivant.** « Générer le devis » sur un ticket qui a déjà un devis
   ni `refuse`, ni `expire`, ni `annule` **ouvre ce devis** au lieu d'en créer un second. Un
   nouveau devis n'est généré que si le précédent est refusé, expiré ou annulé.
2. **Le devis est une copie indépendante** des lignes du ticket au moment du clic, **modifiable**
   comme aujourd'hui (remise, ajustement). Le ticket n'est pas mis à jour par le devis ; c'est le
   devis accepté qui fera foi pour la facture (ticket 15).
3. **Identité de l'appareil affichée dans la fiche du devis ET sur la page publique**
   (`devis-public.html`, là où le client accepte) : marque, modèle, IMEI ou numéro de série, **en
   entier**, lus en direct sur le ticket (un devis n'est pas figé).

### Relecture de conception (2026-09-30)

- **Génération côté serveur** : nouvelle route `POST /api/tickets/:id/devis`. La boutique et le
  client sont ceux **du ticket** — jamais pris dans le corps, jamais retrouvés par le nom. Les
  lignes sont relues **en base**, jamais envoyées par le navigateur.
- **Garde d'identifiant** : l'appareil du ticket (`tickets.appareil_id` → `appareils`) doit avoir un
  IMEI **ou** un numéro de série non vide ; sinon **422** avec un message qui dit quoi faire
  (« Saisissez l'IMEI ou le numéro de série de l'appareil dans le ticket »). Un ticket sans appareil
  (antérieur au 08a) est refusé de la même façon. **Aucune garde à la création du ticket** (story 62).
- **Ticket sans ligne** → 422 « Ajoutez au moins une ligne au ticket ».
- **Une course** (deux clics) ne doit pas créer deux devis vivants : la vérification « un devis
  vivant existe » et la création se font de façon à ce que le second appel ouvre le premier (test de
  double appel).
- **Aucun mouvement de stock**, aucune écriture sur les lignes du ticket.

## Critères d'acceptation

Serveur :

- [ ] `POST /api/tickets/:id/devis` : `requireRole('admin', 'manager', 'technicien')`, garde
      d'isolation sur le ticket ; rend `{ devis_id, cree: true|false }` (`false` = devis vivant
      existant ouvert, décision 1)
- [ ] Garde d'identifiant et ticket sans ligne → **422** avec les messages ci-dessus, aucun devis créé
- [ ] Devis créé en `draft`, pour la boutique et le client **du ticket**, `ticket_id` posé ; une
      ligne de devis par ligne de ticket (désignation, quantité, prix unitaire HT, TVA,
      **`produit_id` et `service_id` recopiés**) ; totaux calculés par le service des devis existant
- [ ] `devisService.ts` écrit `service_id` sur les lignes de devis (création et conversion) — ⊥
      perte du lien au catalogue
- [ ] Double appel concurrent sur le même ticket → **un seul** devis vivant
- [ ] Aucune écriture dans `mouvements_stock` ni sur `lignes_ticket`
- [ ] `GET /api/devis/:id` et `GET /api/public/devis/:token` renvoient l'identité de l'appareil du
      ticket lié (`appareil_marque`, `appareil_modele`, `imei`, `numero_serie`), lue en direct ; un
      devis sans ticket n'en renvoie pas
- [ ] SQL dans les services, jamais dans un controller

Écrans :

- [ ] Fiche du ticket : « Générer le devis » appelle la route ; 422 → message affiché ; succès → la
      page Devis s'ouvre **sur ce devis** (`/devis?ouvrir=<id>`, `openDevisDetail()`)
- [ ] Le passage par `localStorage` est retiré : `createDevisFromTicket()` et `checkFromTicket()`
      n'utilisent plus `izigsm_new_devis_from_ticket` ni le cache local
- [ ] Fiche du ticket : l'IMEI ou le numéro de série se saisit en cours de réparation (champ du 08a) ;
      la garde se lève aussitôt (nouvel essai accepté sans recharger)
- [ ] Fenêtre de détail du devis et page publique `devis-public.html` : bloc « Appareil : marque,
      modèle, IMEI ou n° de série » quand le devis est lié à un ticket, valeurs échappées
- [ ] Appels déballés `(await apiX(…)).data`
- [ ] `CACHE_VERSION` (`public/sw.js`) incrémenté

Commun :

- [ ] ∀ test vu rouge avant correctif
- [ ] `npx vitest run` sans nouvel échec par rapport à la baseline mesurée avant le ticket
- [ ] Erreurs tsc ≤ baseline mesurée avant le ticket (`npx tsc --noEmit --pretty false | grep -cE "error TS[0-9]+"`)
- [ ] ⊥ migration ; ⊥ caisse ; ⊥ NF525 ; ⊥ mouvement de stock

## Coutures à tester

- **Génération** — vitest contre un **vrai SQLite au schéma réel** (`tests/helpers/d1Sqlite.ts`) :
  toutes les lignes recopiées avec `produit_id` **et** `service_id` ; boutique et client du ticket ;
  garde sans identifiant / sans appareil / sans ligne → rien créé ; IMEI seul suffit, numéro de série
  seul suffit ; devis vivant existant → rendu tel quel (`cree: false`) ; devis refusé → nouveau devis ;
  double appel → un seul devis ; aucune ligne dans `mouvements_stock`.
- **Lecture de l'identité** — vrai SQLite : `GET` du devis et de la page publique portent l'identité
  de l'appareil du ticket, et la suivent si l'identifiant du ticket change.
- **Routes** — vitest par `app.request()` : rôles, 404 ticket d'une autre boutique, 422.
- **Écrans** — E2E Playwright `tests/e2e/devis-depuis-ticket.spec.ts`, vraie D1 locale : ticket avec
  deux lignes et sans identifiant → « Générer le devis » refusé avec le message ; saisie de l'IMEI
  dans le ticket → devis généré, ouvert, avec les deux lignes et le bloc « Appareil » ; second clic →
  le même devis s'ouvre ; la page publique du devis affiche l'appareil. L'E2E est joué par le socle
  dans le bac à sable (contrôle e2e de gates.json, à déclarer dans la tâche d'écran) ; un E2E hors
  de sa portée (préproduction, production) se demande dans le compte rendu (P16).

## Notes

- Périmètre : `src/services/devisService.ts`, `src/routes/tickets.ts` (nouvelle route
  `POST /api/tickets/:id/devis`), `src/routes/facturation.ts` (lecture `GET /api/devis/:id`),
  `src/routes/public.ts`, `src/services/publicService.ts`,
  `public/static/js/tickets.js`, `public/static/js/devis.js`, `public/devis-public.html`,
  `public/sw.js`, tests correspondants.
- Découpage conseillé pour le socle : **serveur** puis **écran**.
- `CLAUDE.md` § checkpoint 73 : les routes `/api/devis` lisent la boutique dans le **corps** — la
  nouvelle route, elle, la tire du ticket ; ne pas la faire dépendre du corps.
- Page publique : rien de nouveau n'y est **écrit** ; l'IMEI y est montré en entier (décision 3) —
  comme le suivi de ticket public, le lien est un secret du client.

## Critères d'origine (avant le 2026-09-30, repris ci-dessus)

- ~~Génération du devis **côté serveur** depuis les lignes du ticket, identifiants de produit et
      de service recopiés ; le passage par le stockage du navigateur (une seule ligne reprise) est
      retiré~~
- ~~Garde : refus explicite de la génération tant que l'appareil n'a ni IMEI ni numéro de série ;
      l'un des deux suffit~~
- ~~L'identifiant se saisit depuis le ticket en cours de réparation ; la garde se lève aussitôt~~
- ~~Le devis affiche marque, modèle, IMEI ou numéro de série (lecture vivante : un devis reste
      modifiable)~~
- ~~Générer un devis ne touche pas au stock~~
- ~~Route gardée par l'appartenance à la boutique ; le devis est créé pour la boutique du ticket
      (le corps porte la boutique, comme l'exigent les routes de devis)~~ — la boutique vient du
      ticket, jamais du corps (relecture de conception)
- ~~E2E sur la vraie base locale : devis refusé sans identifiant, saisie, devis généré avec toutes
      les lignes ; vus rouges d'abord~~
- ~~`npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées~~
