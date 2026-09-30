---
id: 11
titre: Lignes de ticket
statut: ready-for-agent
bloque-par: [03, 08c, 09]
---

# 11 — Lignes de ticket

## Contexte

Un ticket de réparation porte enfin des **lignes** : le technicien y ajoute une réparation du
catalogue (au prix prévu pour ce modèle), une pièce du stock ou une ligne libre. Les réparations
cochées à la prise en charge deviennent des lignes au lieu d'être oubliées. Le prix du ticket est la
**somme de ses lignes** ; les anciens tickets gardent le prix saisi à la main. Aucun mouvement de
stock à ce stade : la pièce sort à la pose (ticket 12).
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 48 à 54 ; décision « Lignes de ticket ») ;
vocabulaire `CONTEXT.md` (Ligne de ticket).

**Bloqué par** 03 (**done**), et par **08c et 09** (ajoutés le 2026-09-30) : ces tickets modifient
les mêmes fichiers (`routes/tickets.ts`, `ticketService.ts`, `tickets.js`) — les coder avant évite
des PR en conflit.

**Ne touche ni la caisse ni le NF525** (règle de l'exploitant du 2026-09-30) : `caisse.js`,
`caisseService.ts`, factures et `journal_nf525` ne sont pas modifiés → **confié au socle**.
Migration **`0057`** (numéro réservé le 2026-09-30, `decisions.md`).

_Mis au format du modèle le 2026-09-30. Ancien en-tête : `**Status:** ready-for-agent`,
`**Blocked by:** 03`._

### Constats du cadrage (2026-09-30)

- À la prise en charge, l'autocomplétion du modèle pose `t-device-model-id` et affiche les
  réparations prévues pour ce modèle, avec leur prix spécifique et **des cases à cocher**
  (`loadServicesSuggestionsForModele()`, `tickets.js`) — mais **ni l'identifiant du modèle ni les
  cases ne sont envoyés** : le ticket ne garde que `appareil_modele` en texte.
- Deux prix saisis existent sur `tickets` : `prix_estime` et `prix_final` ; l'écran affiche
  `prix_final ?? prix_estime`.
- Le sélecteur de la caisse vit dans `caisse.js` (fermeture) : il n'est pas réutilisable tel quel.

### Décisions de l'exploitant du 2026-09-30

1. **Le ticket garde son modèle** : colonne `tickets.modele_id`, posée quand le vendeur choisit le
   modèle dans l'autocomplétion. Toute ligne de service — cochée à la prise en charge **ou** ajoutée
   plus tard — prend le **prix spécifique de ce modèle** (`service_modeles.prix_ht_specifique`),
   sinon le prix du service. Ticket sans `modele_id` (existants, modèle tapé à la main) → prix du
   service.
2. **Sélecteur de la fiche ticket à part, même route** : il appelle `GET /api/catalogue/recherche`
   (mêmes résultats typés, même rendu visuel que la caisse), sans toucher `caisse.js`. Les dossiers
   SAV que la route renvoie ne sont pas proposés comme lignes.
3. **Prix d'un ticket = somme TTC de ses lignes dès qu'il en a une** ; `prix_estime` et
   `prix_final` restent en base, non modifiés, et ne sont plus lus pour ce ticket. Sans ligne : prix
   saisi, comme aujourd'hui (story 54).
4. **Coût unitaire** : pièce → **coût moyen** (`prix_achat_cump`) du produit au moment de l'ajout,
   figé sur la ligne ; service et ligne libre → `NULL`.

### Relecture de conception (2026-09-30)

- **Les prix par défaut se calculent côté serveur**, à la création de la ligne, depuis le catalogue
  (service : prix du modèle sinon prix du service ; pièce : prix de vente et TVA du produit) — ⊥ un
  prix envoyé par le navigateur pour une ligne de catalogue. La ligne reste **modifiable** ensuite
  (désignation, quantité, prix), comme en caisse.
- **Table rattachée à un ticket OU à un dossier SAV** (spec), mais ce ticket n'ouvre de routes que
  pour les tickets : les lignes de SAV sont le ticket 17. La contrainte « exactement un des deux »
  est posée dès maintenant.
- **État de la pièce, date et auteur de pose** : colonnes créées ici, **laissées vides** — leur
  logique (à commander, pose, mouvement de stock) est le ticket 12. ⊥ écrire un mouvement de stock.
- **Les réparations cochées sont validées par le serveur** : services de la boutique, actifs ; un
  identifiant étranger → 400, aucun ticket créé.
- **`modele_id` est un référentiel global** (`modeles_appareils`, migration `0031`) : vérifier qu'il
  existe, pas qu'il appartient à la boutique.

## Critères d'acceptation

Base :

- [ ] Migration `0057` : table `lignes_ticket` — `id`, `boutique_id` NOT NULL, `ticket_id`, `sav_id`
      (`CHECK` : exactement un des deux non nul), `nature` (`CHECK` dans `'service'`, `'piece'`,
      `'libre'`), `service_id`, `produit_id` (`CHECK` de cohérence : service → `service_id` non nul,
      pièce → `produit_id` non nul, libre → les deux nuls), `designation` NOT NULL, `quantite` > 0,
      `prix_unitaire_ht` ≥ 0, `tva_taux`, `cout_unitaire` (nullable), `etat_piece` (nullable,
      `CHECK` dans `'disponible'`, `'a_commander'`), `pose_le`, `pose_par` (nullables), `created_by`,
      `created_at` ; index `(ticket_id)`, `(sav_id)`, `(boutique_id)` ; **et** colonne
      `tickets.modele_id` (INTEGER, nullable). `ADD COLUMN` et `CREATE TABLE` seulement
- [ ] Test de la migration contre un **vrai SQLite** : chaque `CHECK` refuse ce qu'il doit, tickets
      existants intacts (`modele_id` NULL)

Serveur (`src/services/lignesTicketService.ts` nouveau, routes dans `src/routes/tickets.ts`) :

- [ ] `GET /api/tickets/:id/lignes` : lignes du ticket et total TTC (arrondi au centime par ligne,
      comme la caisse)
- [ ] `POST /api/tickets/:id/lignes { nature, service_id | produit_id | (designation, prix_unitaire_ht, tva_taux), quantite? }` :
      service → prix du modèle du ticket sinon du service, TVA du service ; pièce → prix de vente, TVA
      et `cout_unitaire` = `prix_achat_cump` du produit ; libre → valeurs du corps (désignation non
      vide, prix ≥ 0). Service ou produit d'une autre boutique, ou inactif → 400. **Aucun mouvement de
      stock**
- [ ] `PUT /api/lignes-ticket/:id` (désignation, quantité, prix unitaire, TVA) et
      `DELETE /api/lignes-ticket/:id` ; ligne de dossier SAV → refusée ici (ticket 17)
- [ ] Toutes ces routes : `requireRole('admin', 'manager', 'technicien')`, garde d'isolation sur le
      ticket ou la ligne (`assertBoutiqueOwnership()`) ; `tests/routes-isolation-conformite.test.ts`
      vert
- [ ] `POST /api/tickets` accepte `modele_id` (existant dans `modeles_appareils`, sinon 400) et
      `services: number[]` (services actifs de la boutique, sinon 400 et **aucun ticket créé**) ; chaque
      service devient une ligne de service au prix du modèle
- [ ] Liste et détail des tickets renvoient `nb_lignes` et `total_lignes_ttc` ; le prix affichable
      est `total_lignes_ttc` si `nb_lignes > 0`, sinon `prix_final ?? prix_estime` — calcul dans le
      service, jamais dupliqué à l'écran
- [ ] SQL dans les services, jamais dans un controller

Écrans (`tickets.js`, `tickets.html`) :

- [ ] Prise en charge : `modele_id` et les réparations **cochées** envoyés avec le ticket
- [ ] Fiche du ticket : section « Lignes » (nature, désignation, quantité, PU HT, TVA, total TTC,
      retirer), total ; sélecteur appelant `/api/catalogue/recherche` (produits et services, rendu
      aligné sur la caisse, dossiers SAV écartés) ; formulaire de ligne libre ; lignes modifiables
- [ ] Liste des tickets : prix = total des lignes pour un ticket qui en a, prix saisi sinon
- [ ] Appels déballés `(await apiX(…)).data` ; données rendues échappées (`esc()` de `tickets.js`)
- [ ] `CACHE_VERSION` (`public/sw.js`) incrémenté

Commun :

- [ ] ∀ test vu rouge avant correctif
- [ ] `npx vitest run` sans nouvel échec par rapport à la baseline mesurée avant le ticket
- [ ] Erreurs tsc ≤ baseline mesurée avant le ticket (`npx tsc --noEmit --pretty false | grep -cE "error TS[0-9]+"`)
- [ ] ⊥ `caisse.js`, `caisseService.ts`, factures, `journal_nf525` ; ⊥ mouvement de stock

## Coutures à tester

- **Migration `0057`** — vitest contre un vrai SQLite (`node:sqlite`) : chaque `CHECK`, tickets intacts.
- **Service des lignes** — vitest contre un **vrai SQLite au schéma réel** (`tests/helpers/d1Sqlite.ts`,
  ou un port `Database` sur ce SQLite) : prix du modèle, repli sur le prix du service, pièce (prix,
  TVA, coût moyen figé), ligne libre, service/produit d'une autre boutique refusé, **aucune ligne dans
  `mouvements_stock`**, total TTC arrondi par ligne, `nb_lignes`/`total_lignes_ttc` et repli sur
  `prix_final ?? prix_estime`.
- **Création de ticket** — vitest contre un vrai SQLite : `modele_id` inconnu → 400 ; service étranger
  → 400 et aucun ticket ; réparations cochées → lignes au prix du modèle.
- **Routes** — vitest par `app.request()` : rôles, 404 autre boutique, ligne de SAV refusée.
- **Écrans** — E2E Playwright `tests/e2e/lignes-ticket.spec.ts`, vraie D1 locale : prise en charge
  avec modèle choisi et une réparation cochée → la ligne apparaît dans la fiche au prix du modèle ;
  ajouter une pièce (stock relu par l'API : inchangé) et une ligne libre ; le total affiché est la
  somme ; un ticket sans ligne garde son prix saisi. L'E2E est joué par le socle dans le bac à sable
  (contrôle e2e de gates.json, à déclarer dans la tâche d'écran) ; un E2E hors de sa portée
  (préproduction, production) se demande dans le compte rendu (P16).

## Notes

- Périmètre : `migrations/0057_lignes_ticket.sql` (nouveau), `src/services/lignesTicketService.ts`
  (nouveau), `src/services/ticketService.ts`, `src/routes/tickets.ts`, `public/static/js/tickets.js`,
  `public/tickets.html`, `public/sw.js`, tests correspondants.
- Découpage conseillé pour le socle : **serveur** (migration, service, routes, création de ticket)
  puis **écran** (prise en charge, fiche, liste, E2E), comme T-002/T-003.
- Prior art : `service_modeles` et la route `GET /api/services/modeles/:id/services` (prix effectif
  par modèle) ; rendu d'un résultat de catalogue `renderResultatCatalogue()` (`caisse.js`, à imiter,
  pas à importer) ; arrondi des lignes de `createVente()`.
- Ordre de déploiement : `0057` à distance **avant** le code, avec le lot concerné
  (`modop-deploiement.md`).

## Critères d'origine (avant le 2026-09-30, repris ci-dessus)

- ~~Nouvelle table des lignes, rattachée **à un ticket ou à un dossier SAV** : nature (service,
      pièce, libre), produit ou service visé, désignation, quantité, prix unitaire HT, TVA, coût
      unitaire, état de la pièce, date et auteur de pose — migration testée contre un vrai SQLite~~
- ~~Ajouter, modifier, retirer une ligne ; routes par identifiant gardées par l'appartenance à la
      boutique (garde-fou statique vert)~~
- ~~Une ligne de service prend le prix prévu pour le modèle de l'appareil, sinon le prix du service~~
- ~~Les réparations cochées à la prise en charge sont **envoyées** et créent des lignes de service
      (fin des cases jamais relues)~~
- ~~Prix du ticket calculé depuis les lignes ; un ticket sans ligne garde ses prix saisis~~
- ~~L'écran du ticket réutilise le sélecteur de la caisse (une seule recherche)~~ — même route, sélecteur à part (décision 2)
- ~~Ajouter une pièce ne touche pas au stock~~
- ~~E2E sur la vraie base locale : cocher une réparation à la prise en charge et la retrouver en
      ligne ; ajouter une pièce et une ligne libre ; lire le total ; vus rouges d'abord~~
- ~~`npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées~~
