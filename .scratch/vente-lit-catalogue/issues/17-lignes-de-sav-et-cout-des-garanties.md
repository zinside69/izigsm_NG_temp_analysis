---
id: 17
titre: Lignes de SAV et coût des garanties
statut: ready-for-agent
bloque-par: [08c, 12, 13, 16]
---

# 17 — Lignes de SAV et coût des garanties

## Contexte

Un technicien ajoute des lignes à un **dossier SAV**, comme à un ticket, mais facturées **0 €** : la
pièce reprise sous garantie sort du stock à la pose et son **coût** est conservé. Le responsable de
boutique voit enfin **combien lui coûtent ses garanties**.
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 78, 79 ; décisions « Lignes de ticket »,
« Garanties »).

**Ne touche ni la caisse ni le NF525** → **confié au socle.** **Aucune migration** (décision 1 : les
lignes vivent sur le ticket SAV, table `lignes_ticket` de `0057` ; coût figé par la pose du 12).

Bloqué par 12 (pose, coût figé à la pose — précision du 2026-10-01), 16 (garanties par ligne ; le
hook saute les tickets SAV), **08c** (ajouté le 2026-10-01 : la requalification décide quel ticket est
SAV, et touche `sav.js`) et **13** (ajouté le 2026-10-01 : ce ticket refuse le devis d'un ticket SAV
dans la route du 13).

_Mis au format du modèle le 2026-10-01. Ancien en-tête : `**Status:** ready-for-agent`,
`**Blocked by:** 12 — Pose d'une pièce ; 16 — Garanties par ligne de service.`_

### Constats du cadrage (2026-10-01)

- **Un dossier SAV crée déjà son ticket** : `createSav()` (`garantiesService.ts`) insère un ticket
  « [SAV] … » et le pose en `sav_dossiers.ticket_sav_id`. Le 08c requalifie dans les deux sens : SAV →
  payant (dossier `refuse`, garantie réactivée), payant → SAV (dossier créé **sur le ticket
  existant**).
- Le ticket 11 prévoit `lignes_ticket.sav_id` (« exactement un de `ticket_id` / `sav_id` ») et refuse
  les lignes de SAV dans ses routes. Avec la décision 1, **`sav_id` reste inutilisé** ; la contrainte
  ne gêne rien.
- Le prix d'un ticket à lignes est **calculé à la lecture** (somme TTC des lignes, ticket 11) : rien
  à réécrire en base pour qu'un SAV vaille 0 €.
- Aucun coût de main-d'œuvre n'existe dans le dépôt : le coût d'une garantie = **coût des pièces
  posées** (`quantite × cout_unitaire`).

### Décisions de l'exploitant du 2026-10-01

1. **Les lignes d'un SAV vivent sur son ticket SAV** (`ticket_id` = `ticket_sav_id`), avec les routes
   et la pose des tickets 11 et 12. Le prix catalogue reste stocké ; le **facturé vaut 0 €** tant que
   le ticket est un SAV valide, calculé à la lecture. Une requalification (08c) bascule le prix sans
   aucune écriture.
2. **Coût figé à la pose** (amendement du ticket 12, même jour).
3. **Vue du coût : encart « Coût des garanties » en tête de la page SAV**, avec une période (mois en
   cours par défaut) : total, nombre de dossiers, nombre de pièces, détail par dossier.
4. **Un ticket SAV terminé n'ouvre aucune garantie** (amendement du ticket 16, même jour).

### Relecture de conception (2026-10-01)

- **Une seule définition de « SAV valide »** : `estTicketSav(db, ticketId)` (ou fragment SQL
  équivalent, nommé) = un dossier `sav_dossiers` `actif = 1`, `ticket_sav_id` = ce ticket, statut ≠
  `refuse`. Lue par : le total des lignes (ce ticket), le hook de garantie (ticket 16), le refus du
  devis (ci-dessous), le coût des garanties. ⊥ une seconde écriture de cette règle.
- **Lecture des lignes** : `GET /api/tickets/:id/lignes` rend, pour un ticket SAV valide,
  `sous_garantie: true`, `total_facture: 0` et chaque ligne avec `prix_facture: 0` à côté de son
  `prix_unitaire_ht` catalogue ; ticket ordinaire → `sous_garantie: false`, `total_facture` = somme
  du 11 (forme existante conservée).
- **Rien à facturer** : `POST /api/tickets/:id/devis` (ticket 13) sur un ticket SAV valide → **409**
  « Ticket sous garantie (SAV) : rien à facturer ».
- **Coût des garanties** — `GET /api/sav/cout-garanties?du=AAAA-MM-JJ&au=AAAA-MM-JJ` :
  `requireRole('admin', 'manager')` (donnée de marge) ; boutique résolue par `getBoutiqueId()` ;
  périmètre = lignes `nature = 'piece'` **posées** (`pose_le` dans la période, bornes en heure de
  Paris, `src/lib/timezone.ts`) d'un ticket **SAV valide** ; rend `{ total, nb_dossiers, nb_pieces,
  dossiers: [{ sav_id, numero, ticket_id, pieces: [{ designation, quantite, cout_unitaire, cout }],
  cout }] }`. Une ligne posée à `cout_unitaire` nul compte 0 et est **signalée** (`cout_inconnu`),
  jamais ignorée en silence. Dates invalides ou `du > au` → 400.
- **Requalification** : un SAV requalifié en payant sort du coût des garanties (sa pièce reste posée,
  son coût reste sur la ligne) ; un ticket payant requalifié en SAV y entre. Aucun code de bascule :
  c'est la définition partagée qui le donne.
- Lignes de service et lignes libres d'un SAV : 0 € facturé, aucun coût compté.

## Critères d'acceptation

Serveur :

- [ ] `estTicketSav()` (ou fragment nommé) dans un service, seule définition ; testée : dossier
      actif ouvert / résolu / clos → SAV ; `refuse` → non ; ticket sans dossier → non
- [ ] `GET /api/tickets/:id/lignes` : `sous_garantie`, `total_facture`, `prix_facture` par ligne,
      selon la relecture ; aucune écriture
- [ ] Ajout et pose d'une pièce sur un ticket SAV : mêmes routes (11, 12), un seul mouvement de
      sortie, coût figé à la pose
- [ ] `POST /api/tickets/:id/devis` sur un ticket SAV valide → **409**, aucun devis créé
- [ ] Hook de fin de réparation (16) : ticket SAV valide → aucune garantie (critère porté par le 16,
      vérifié ici de bout en bout)
- [ ] `GET /api/sav/cout-garanties` : contrat ci-dessus ; rôles admin et manager (technicien → 403) ;
      autre boutique jamais comptée ; 400 sur période invalide
- [ ] SQL dans les services ; `tests/routes-isolation-conformite.test.ts` vert (la route n'a pas
      d'ID : elle filtre par la boutique résolue)

Écrans :

- [ ] Fiche d'un ticket SAV : bandeau « Sous garantie — SAV-… », colonne « Facturé » à 0 € par ligne,
      total facturé 0,00 € ; ajout de lignes et pose comme sur un ticket ; « Générer le devis »
      masqué
- [ ] Après une requalification en payant (08c), la fiche rouverte affiche les prix catalogue
- [ ] Page SAV : encart « Coût des garanties », période modifiable (mois en cours par défaut), total,
      nombre de dossiers et de pièces, détail par dossier ; pièce à coût inconnu signalée ; encart
      absent pour un technicien
- [ ] Données rendues échappées ; appels déballés `(await apiX(…)).data`
- [ ] **Dernier ticket d'écran du lot 2** : incrémenter `CACHE_VERSION`

Commun :

- [ ] Balayage du menu de gauche vert (`tests/e2e/resolveur-boutique-pages.spec.ts`)
- [ ] ∀ test vu rouge avant correctif
- [ ] `npx vitest run` sans nouvel échec par rapport à la baseline mesurée avant le ticket
- [ ] Erreurs tsc ≤ baseline mesurée avant le ticket
      (`npx tsc --noEmit --pretty false | grep -cE "error TS[0-9]+"`)
- [ ] ⊥ migration ; ⊥ caisse ; ⊥ NF525

## Coutures à tester

- **Définition SAV** — vitest contre un **vrai SQLite au schéma réel** (`tests/helpers/d1Sqlite.ts`) :
  statuts du dossier, dossier inactif, ticket sans dossier.
- **Lignes d'un SAV** — vrai SQLite : `total_facture` 0 sur un SAV, somme sur le même ticket après
  passage du dossier en `refuse` (08c), sans aucune écriture sur `lignes_ticket`.
- **Coût des garanties** — vrai SQLite : deux SAV, une pièce posée chacun, une pièce non posée, une
  pièce posée hors période, un ticket payant avec une pièce posée, un SAV requalifié en payant, une
  autre boutique → seuls les deux premiers comptés ; coût = coût figé à la pose même si le coût moyen
  a changé depuis ; `cout_unitaire` nul signalé.
- **Routes** — vitest par `app.request()` : rôles du coût (technicien 403), 400 sur période, 409 du
  devis d'un SAV.
- **Écrans** — E2E Playwright `tests/e2e/sav-lignes-cout.spec.ts`, vraie D1 locale : ouvrir un SAV
  depuis une garantie, ajouter et poser une pièce, relire le stock par l'API (−1), voir « Facturé
  0,00 € » ; relire l'encart « Coût des garanties » de la page SAV (le coût de la pièce) ; requalifier
  en payant → la fiche montre le prix catalogue et l'encart ne compte plus ce dossier. L'E2E est joué
  par le socle dans le bac à sable (contrôle e2e de gates.json, à déclarer dans la tâche d'écran) ;
  un E2E hors de sa portée (préproduction, production) se demande dans le compte rendu (P16).

## Notes

- Périmètre : `src/services/garantiesService.ts` (définition SAV, coût), `src/services/lignesTicketService.ts`
  (lecture), `src/services/devisService.ts` ou la route du 13 (refus), `src/routes/sav.ts`,
  `src/routes/tickets.ts`, `public/static/js/sav.js`, `public/sav.html`, `public/static/js/tickets.js`,
  `public/sw.js`, tests correspondants.
- Découpage conseillé pour le socle : **serveur** puis **écran**.
- `sav.html` : fenêtres de saisie à `z-index` 40, probablement sous la barre latérale (`CLAUDE.md`
  § Bons de commande, non vérifié) — à mesurer si l'encart ou une fenêtre est touché.
- **Point ouvert, hors périmètre** : une facture **manuelle** liée à un ticket SAV (`POST
  /api/factures` avec `ticket_id`) n'est pas refusée ici ; à trancher au ticket 15 (codé dans
  `izigsm/webapp`).
- **Rappel de déploiement du lot 2** : toutes ses migrations (`0057`, `0059` ; `0058` sans objet)
  appliquées à distance **avant** le code, `d1_migrations` distant relu entre les deux commandes ;
  compter avant `0059` les services à durée > 0 (ticket 16).

## Critères d'origine (avant le 2026-10-01, repris ci-dessus)

- ~~Un dossier SAV porte des lignes (service, pièce, libre), ajoutées avec le même sélecteur ;
      leur prix facturé est 0 €~~ — portées par le ticket SAV (décision 1)
- ~~Le coût unitaire de chaque ligne est conservé (prix d'achat ou coût moyen de la pièce au
      moment de l'ajout)~~ — figé à la pose (décision 2)
- ~~La pose d'une pièce sur un SAV sort la pièce du stock une seule fois, comme sur un ticket~~
- ~~Une vue du coût des garanties sur une période, par boutique, lit ces coûts — prouvée sur la
      vraie base locale~~ — encart de la page SAV (décision 3)
- ~~Routes gardées par l'appartenance à la boutique (garde-fou statique vert)~~
- ~~E2E : ouvrir un SAV, poser une pièce, relire le stock et le coût des garanties ; vus rouges
      d'abord~~
- ~~**Dernier ticket d'écran du lot 2** : incrémenter `CACHE_VERSION`~~
- ~~Balayage du menu de gauche vert ; `npx vitest run` vert (hors les 2 échecs permanents) ;
      erreurs tsc inchangées~~
- ~~Rappel de déploiement du lot 2 : toutes ses migrations appliquées à distance **avant** le code,
      `d1_migrations` distant relu entre les deux commandes~~
