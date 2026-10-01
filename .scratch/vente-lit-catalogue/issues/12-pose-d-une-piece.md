---
id: 12
titre: Pose d'une pièce
statut: ready-for-agent
bloque-par: [11, 06]
---

# 12 — Pose d'une pièce

## Contexte

Un technicien — celui du ticket ou un collègue — marque une pièce comme **posée** : elle sort du
stock à cet instant, une seule fois, et son auteur est conservé. Une pièce absente du stock ajoutée à
un ticket est **« à commander » avec le numéro du ticket** qui l'attend, et le ticket affiche « pièce
en attente ». Un devis refusé ne fait rien bouger.
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 55 à 61 ; décision « Lignes de ticket ») ;
vocabulaire `CONTEXT.md` (Pose).

**Bloqué par** 11 (table `lignes_ticket`, colonnes `pose_le`, `pose_par`) et par **06** (ajouté le
2026-09-30) : 06 modifie aussi `stock.js` et la page Stock — le coder avant évite des PR en conflit.

**Ne touche ni la caisse ni le NF525** (règle de l'exploitant du 2026-09-30) : ni `caisse.js`, ni
`caisseService.ts`, ni facture, ni `journal_nf525` → **confié au socle**. **Aucune migration** : les
colonnes de pose existent depuis `0057` (ticket 11).

_Mis au format du modèle le 2026-09-30. Ancien en-tête : `**Status:** ready-for-agent`,
`**Blocked by:** 11`._

### Constats du cadrage (2026-09-30)

- Deux listes « à commander » existent, toutes deux sur `sqlSousSeuil()` : le filtre « À commander »
  de la page Stock (`estACommander()`, `stock.js`) et les suggestions d'un bon de commande
  fournisseur (`fournisseursService.ts`, produits sous le seuil). Invariant (`CLAUDE.md` § Stock) :
  **seuil 0 = jamais « à commander » par le seuil**, ⊥ redéfinir `sqlSousSeuil()`.
- Le ticket a déjà un statut `a_commander` dans sa machine à états (`ticketService.ts`).
- `enregistrerMouvement()` n'est **pas atomique** (stock écrit, puis mouvement) : ⊥ l'employer pour
  la pose, où la règle « jamais deux sorties » doit tenir même en cas de double clic.

### Décisions de l'exploitant du 2026-09-30

1. **Une ligne posée ne se retire pas** : `DELETE` → 409 « pièce déjà posée ». Si la pièce revient
   réellement en rayon, l'opérateur fait un mouvement d'entrée « Ajuster le stock » avec son motif.
   Aucun mouvement automatique.
2. **« À commander » est calculé à la lecture, rien n'est stocké** : une ligne de pièce **non posée**
   est « à commander » tant que le stock du produit est **inférieur à sa quantité** ; dès qu'une
   réception remonte le stock, elle redevient disponible, sans écriture. **Limite acceptée** : deux
   tickets qui attendent la dernière pièce se voient tous deux « disponibles ». La colonne
   `etat_piece` (0057) reste inutilisée.
3. **Page Stock ET bon de commande** : le filtre « À commander » et les suggestions d'un bon de
   commande montrent « sous le seuil » (`sqlSousSeuil()`, **inchangé**) **ou** « attendue par un
   ticket », avec les **numéros des tickets** qui l'attendent. Une pièce à seuil 0 attendue par un
   ticket apparaît donc — pour cette raison seulement.
4. **Badge seulement** : fiche et liste des tickets affichent « pièce en attente » tant qu'une ligne
   est à commander. **Le statut du ticket n'est jamais changé automatiquement.**

### Relecture de conception (2026-09-30)

- **La pose est atomique**, par **un seul `db.batch()`** (transaction D1), chaque instruction
  conditionnée par `pose_le IS NULL` sur la ligne : (1) insérer le mouvement de sortie en lisant le
  stock courant (`INSERT … SELECT`), (2) décrémenter le stock, écrêté à 0, (3) poser `pose_le`,
  `pose_par`. Une seconde pose (double clic, course) trouve `pose_le` rempli : les trois instructions
  ne touchent rien, et `changes = 0` sur (3) → **409 « déjà posée »**. Jamais de mouvement sans pose,
  ni de pose sans mouvement, ni deux mouvements.
- **Quantité et produit d'une ligne posée sont figés** (`PUT` → 409 sur ces champs) : les changer
  désaccorderait la ligne et le mouvement déjà écrit. Désignation et prix restent modifiables.
- **Écrêtage comme en caisse** : poser au-delà du stock est permis, stock à 0, et la réponse porte
  `stock_insuffisant` (même forme que `createVente()`).
- **« Attendue par un ticket »** = une ligne de pièce **non posée**, d'un ticket **non rendu** (ni
  `livre` ni `annule`, non archivé), dont la quantité dépasse le stock du produit.

### Précision du 2026-10-01 — cadrage du ticket 17 (décision de l'exploitant)

**Le coût d'une pièce est figé à la pose**, pas à l'ajout : l'instruction (3) du lot, qui pose
`pose_le` et `pose_par`, pose aussi `cout_unitaire = produits.prix_achat_cump` (relu en base au même
instant, sous la même condition `pose_le IS NULL`). La valeur écrite à l'ajout (ticket 11) n'est
qu'**indicative** jusqu'à la pose. Pourquoi : une pièce « à commander » a un coût moyen nul ou ancien
au moment de l'ajout ; le coût des garanties (ticket 17) doit compter son vrai prix d'achat. Vaut pour
toute pose, ticket payant ou ticket SAV (le ticket SAV est un ticket : la pose est la même).

## Critères d'acceptation

Serveur :

- [ ] `POST /api/lignes-ticket/:id/poser` : `requireRole('admin', 'manager', 'technicien')`, garde
      d'isolation, **ouvert à tout technicien de la boutique** (pas seulement celui du ticket) ; ligne
      de nature `piece` d'un ticket seulement (sinon 400) ; pose atomique par `db.batch()` décrite
      ci-dessus ; mouvement `sortie`, motif « Pose — ticket <numéro> », `user_id` = poseur ; réponse
      `{ pose_le, pose_par, stock_avant, stock_apres, stock_insuffisant? }`
- [ ] Seconde pose → **409** « déjà posée », aucun mouvement de plus
- [ ] ➕ (2026-10-01) La pose fige `cout_unitaire` = `prix_achat_cump` du produit à cet instant, dans
      la même instruction que `pose_le` ; une seconde pose ne le réécrit pas — prouvé sur vrai SQLite
      (coût moyen changé entre l'ajout et la pose → la ligne porte le coût de la pose)
- [ ] `DELETE /api/lignes-ticket/:id` sur une ligne posée → **409** (décision 1) ; non posée →
      supprimée comme au ticket 11
- [ ] `PUT /api/lignes-ticket/:id` sur une ligne posée : quantité ou produit → **409** ; désignation et
      prix permis
- [ ] `GET /api/tickets/:id/lignes` : chaque ligne de pièce non posée porte `a_commander` (calculé) ;
      le ticket porte `piece_en_attente`
- [ ] Liste des tickets : `piece_en_attente` par ticket
- [ ] Liste des produits (`listProduits()`) : `tickets_en_attente` (numéros des tickets non rendus
      qui attendent le produit) ; `sqlSousSeuil()` **non modifié** —
      `tests/stock-sous-seuil.test.ts` vert
- [ ] Suggestions d'un bon de commande (`getProduitsACommander()`, `fournisseursService.ts`) : sous le seuil **ou** attendue par
      un ticket, avec les numéros des tickets
- [ ] SQL dans les services, jamais dans un controller

Écrans :

- [ ] Fiche du ticket : bouton « Posée » sur chaque ligne de pièce non posée ; après la pose, « Posée
      le … par … », bouton retiré, retrait de la ligne refusé à l'écran aussi ; « à commander » affiché
      sur la ligne ; badge « pièce en attente »
- [ ] Liste des tickets : badge « pièce en attente »
- [ ] Page Stock : filtre « À commander » = sous le seuil **ou** attendue par un ticket, avec les
      numéros de tickets affichés (`estACommander()` étendu, règle de seuil inchangée)
- [ ] Page Fournisseurs, onglet « À commander » (`loadACommander()`, `fournisseurs.js`) : les pièces
      attendues apparaissent, avec leurs tickets
- [ ] Appels déballés `(await apiX(…)).data` ; données rendues échappées
- [ ] `CACHE_VERSION` (`public/sw.js`) incrémenté

Commun :

- [ ] ∀ test vu rouge avant correctif
- [ ] `npx vitest run` sans nouvel échec par rapport à la baseline mesurée avant le ticket
- [ ] Erreurs tsc ≤ baseline mesurée avant le ticket (`npx tsc --noEmit --pretty false | grep -cE "error TS[0-9]+"`)
- [ ] ⊥ migration ; ⊥ caisse ; ⊥ NF525 ; ⊥ changement automatique du statut d'un ticket

## Coutures à tester

- **Pose** — vitest contre un **vrai SQLite au schéma réel** (`tests/helpers/d1Sqlite.ts`, dont
  `batch()` est transactionnel) : une pose = **un** mouvement, stock décrémenté ; seconde pose → rien
  écrit, 409 ; écrêtage à 0 avec `stock_insuffisant` ; `pose_par` = le technicien qui pose, même
  s'il n'est pas celui du ticket ; échec simulé d'une instruction du lot (déclencheur `RAISE(ABORT)`)
  → ni mouvement, ni stock changé, ni pose.
- **Ligne posée** — vrai SQLite : `DELETE` refusé, `PUT` de la quantité ou du produit refusé, `PUT`
  du prix accepté.
- **À commander** — vrai SQLite : ligne non posée avec stock < quantité → `a_commander` ; après une
  entrée de stock suffisante → plus à commander, sans écriture sur la ligne ; ligne posée ou ticket
  `livre`/`annule` → jamais attendue ; `tickets_en_attente` de `listProduits()` ; suggestions de bon
  de commande avec un produit à seuil 0 attendu par un ticket.
- **Routes** — vitest par `app.request()` : rôles, 404 autre boutique, 400 sur une ligne de service.
- **Écrans** — E2E Playwright `tests/e2e/pose-piece.spec.ts`, vraie D1 locale : poser une pièce, relire
  le stock par l'API (−1), tenter une seconde pose (message, stock inchangé) ; ajouter une pièce en
  rupture → « à commander » sur la ligne, badge « pièce en attente », et la pièce dans le filtre « À
  commander » de la page Stock avec le numéro du ticket. L'E2E est joué par le socle dans le bac à
  sable (contrôle e2e de gates.json, à déclarer dans la tâche d'écran) ; un E2E hors de sa portée
  (préproduction, production) se demande dans le compte rendu (P16).

## Notes

- Périmètre : `src/services/lignesTicketService.ts`, `src/services/stockService.ts` (`listProduits()`),
  `src/services/fournisseursService.ts` (suggestions), `src/services/ticketService.ts`,
  `src/routes/tickets.ts`, `public/static/js/tickets.js`, `public/tickets.html`, `public/static/js/stock.js`,
  `public/static/js/fournisseurs.js` (onglet « À commander »), `public/sw.js`, tests
  correspondants.
- Découpage conseillé pour le socle : **serveur** puis **écran**.
- `CLAUDE.md` § Stock : « le stock d'un produit existant ne bouge que par un mouvement tracé » — la
  pose en est un ; `sqlSousSeuil()` reste le seul lecteur de la règle de seuil.
- Un devis refusé ne touche jamais une ligne : aucun code ici, rien ne sort sans pose (story 61).

## Critères d'origine (avant le 2026-09-30, repris ci-dessus)

- ~~Action « posée » sur une ligne de pièce, ouverte à tout technicien de la boutique ; date et
      auteur enregistrés~~
- ~~La pose écrit **un** mouvement de stock (sortie, motif lié au ticket), écrêtage à 0 comme en
      caisse — prouvé sur la vraie base locale~~
- ~~Une seconde pose de la même ligne est **refusée** (test de route et test en base)~~
- ~~Pièce en rupture ajoutée : la ligne est « à commander », la pièce apparaît dans la liste « à
      commander » **avec le ticket**, le ticket affiche « pièce en attente » ; l'état redevient
      disponible quand le stock le permet~~
- ~~Retirer une ligne déjà posée est refusé, ou remet la pièce en stock par un mouvement tracé —
      choix documenté dans le ticket, jamais une suppression silencieuse~~ — refusé (décision 1)
- ~~La règle « sous le seuil » continue de passer par le fragment SQL commun (garde-fou vert)~~
- ~~E2E : poser une pièce, relire le stock, tenter une seconde pose ; ajouter une pièce en rupture
      et la voir dans « à commander » avec le ticket ; vus rouges d'abord~~
- ~~`npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées~~
