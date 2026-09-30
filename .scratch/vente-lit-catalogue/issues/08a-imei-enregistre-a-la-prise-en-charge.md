---
id: 08a
titre: L'IMEI saisi à la prise en charge est enregistré (fiche appareil du client)
statut: ready-for-agent
bloque-par: [07]
---

# 08a — L'IMEI saisi à la prise en charge est enregistré

## Contexte

Découpé du ticket 08 le 2026-09-30 (décision de l'exploitant) : **préalable** au parcours IMEI.

**Défaut constaté le 2026-09-30 (perte silencieuse de données)** : le formulaire de prise en charge
(`tickets.js`) envoie `imei`, mais `POST /api/tickets` ne le lit pas — il n'accepte qu'un
`appareil_id`, et aucune colonne `imei` n'existe sur `tickets`. L'IMEI tapé au comptoir **n'a
jamais été enregistré** : aucun ticket n'est retrouvable par IMEI, et le parcours du 08b ne
trouverait rien. Les tickets déjà créés ne peuvent pas être rattrapés (la donnée n'existe pas).

Bloqué par 07 : il crée `luhnValide()` (`src/lib/scan.ts`), réutilisée ici.

**Ne touche ni la caisse ni le NF525** → **confié au socle.** Aucune migration.

### Décision de l'exploitant du 2026-09-30

**L'IMEI est porté par la fiche appareil du client** (table `appareils`, qui existe avec `imei` et
`numero_serie`, migration `0003`), pas recopié sur le ticket. À la création du ticket, on retrouve
l'appareil du client par son IMEI, sinon on le crée, et on pose `appareil_id`. La page ticket lit
déjà `appareil_imei` / `appareil_numero_serie` par jointure (`getTicketById()`).

### Choix proposés par Claude le 2026-09-30 (à confirmer à la relecture)

- **Un seul champ « IMEI / n° de série »** : exactement 15 chiffres → IMEI, **clé de Luhn
  obligatoire** (400 sinon) ; toute autre saisie non vide → numéro de série ; vide → aucun appareil
  créé (comportement actuel).
- **Recherche de l'appareil existant** : même client **et** même IMEI (ou même numéro de série). Un
  même IMEI chez un autre client (appareil revendu) crée une nouvelle fiche appareil pour ce client :
  le parcours du 08b cherchera sur toutes les fiches de la boutique.

**Précision du 2026-09-30 — relecture de conception du socle (P15, 5 constats), décisions de l'exploitant**
1. **PUT : rattacher, jamais réécrire.** La fiche appareil est partagée par les tickets du client.
   Au PUT, on refait la recherche ou la création avec les règles du POST, puis on remplace seulement
   `tickets.appareil_id`. ⊥ tout `UPDATE` de `appareils.imei` ou `appareils.numero_serie` depuis ce
   chemin : un ticket clos garde son IMEI.
2. **Client vérifié d'abord.** `client_id` doit appartenir à la boutique de l'appelant (404 sinon)
   avant toute recherche ou création d'appareil. Le SQL de recherche et de création joint `clients`
   sur `boutique_id = ?`. C'est une faille existante de `POST /api/tickets`, corrigée ici.
3. **Validations avant toute écriture.** Luhn, client de la boutique, `appareil_id` explicite et
   technicien sont tous vérifiés avant la première écriture sur `appareils` : aucun appareil orphelin
   si la création ou la modification du ticket échoue.
4. **Preuves SQL sur un vrai SQLite.** Le refus d'un `appareil_id` d'un autre client ou d'une autre
   boutique se prouve dans les tests de service contre un vrai SQLite ; le test de route sur mock ne
   vérifie que la conversion en 400.
5. **PUT, trois états du champ.** Absent → `appareil_id` inchangé ; `""` → inchangé aussi (décision
   de l'exploitant) ; valeur → recherche ou création, puis nouveau rattachement.

## Critères d'acceptation

- [ ] `POST /api/tickets` lit le champ (`imei` du formulaire actuel) : 15 chiffres à Luhn juste → appareil retrouvé ou créé avec `imei` ; 15 chiffres à clé fausse → **400** « IMEI invalide (clé de contrôle) », aucun ticket créé ; autre saisie non vide → appareil retrouvé ou créé avec `numero_serie` ; vide → `appareil_id` NULL
- [ ] Appareil retrouvé = même `client_id` et même `imei` (ou `numero_serie`), jamais un appareil d'un autre client ; créé avec la marque et le modèle du ticket
- [ ] `appareil_id` explicite dans le corps : **vérifié** (l'appareil appartient au client du ticket, client de la boutique), sinon 400 — ⊥ accepter un `appareil_id` d'une autre boutique
- [ ] ~~`PUT /api/tickets/:id` : modifier le champ met à jour (ou crée) l'appareil du ticket selon les mêmes règles~~ — **barré le 2026-09-30** (demande de l'exploitant) : contredisait la précision P15, décision 1. Remplacé par : `PUT /api/tickets/:id` : champ **absent ou `""`** → `appareil_id` inchangé ; **valeur** → recherche ou création de la fiche selon les règles du POST, puis **nouveau rattachement** de `tickets.appareil_id` ; ⊥ tout `UPDATE` de `appareils.imei` ou `appareils.numero_serie` (la fiche est partagée par les tickets du client)
- [ ] Le SQL vit dans les services (`clientService.ts` / `ticketService.ts`), jamais dans le controller
- [ ] Écran : le champ de `tickets.html` est libellé « IMEI / n° de série » ; message 400 affiché en clair ; la fiche ticket rouverte affiche la valeur enregistrée
- [ ] `CACHE_VERSION` (`public/sw.js`) incrémenté
- [ ] `project-docs/bugs.md` : l'entrée du défaut (écrite au cadrage le 2026-09-30) passe à « CORRIGÉ », avec le correctif
- [ ] ∀ test vu rouge avant correctif
- [ ] `npx vitest run` sans nouvel échec par rapport à la baseline mesurée avant le ticket
- [ ] Erreurs tsc ≤ baseline mesurée avant le ticket (`npx tsc --noEmit --pretty false | grep -cE "error TS[0-9]+"`)
- [ ] ⊥ migration ; ⊥ caisse ; ⊥ NF525

## Coutures à tester

- **Services** de rattachement de l'appareil — vitest contre un **vrai SQLite** (la règle vit dans le SQL : recherche par client + IMEI) : appareil créé, retrouvé, jamais celui d'un autre client ; numéro de série ; vide.
- **Route** `POST /api/tickets` et `PUT /api/tickets/:id` — vitest par `app.request()` : 400 sur clé de Luhn fausse sans ticket créé, `appareil_id` d'une autre boutique refusé.
- **Écran** — E2E Playwright `tests/e2e/prise-en-charge-imei.spec.ts`, vraie D1 locale : créer un ticket avec un IMEI → rouvrir la fiche → l'IMEI s'affiche ; clé fausse → message, aucun ticket. L'E2E est joué par le socle dans le bac à sable (contrôle e2e de gates.json, à déclarer dans la tâche d'écran) ; un E2E hors de sa portée (préproduction, production) se demande dans le compte rendu (P16).
- ➕ **Couture ajoutée le 2026-09-30** — vrai SQLite : deux tickets partagent une fiche, on modifie le champ du second, et l'IMEI lu par le premier ne change pas ; un `client_id` d'une autre boutique ne crée ni ne retrouve aucune fiche ; un technicien d'une autre boutique donne 422, sans aucune ligne `appareils` créée ; un PUT sans le champ, ou avec `""`, sur un ticket qui a un appareil le laisse inchangé.

## Notes

- Périmètre : `src/routes/tickets.ts`, `src/services/ticketService.ts`, `src/services/clientService.ts`, `public/static/js/tickets.js`, `public/tickets.html`, `public/sw.js`, `project-docs/bugs.md`, tests correspondants.
- `appareils` n'a pas de `boutique_id` : l'isolation passe par `clients.boutique_id`. Toute requête sur `appareils` joint le client.
- `bugs.md` § « Tension IMEI purge RGPD / registre anti-recel » : la purge RGPD met l'IMEI à NULL — inchangé ici, ne pas y toucher.
