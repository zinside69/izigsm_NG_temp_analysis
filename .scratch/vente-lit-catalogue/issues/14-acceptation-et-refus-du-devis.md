---
id: 14
titre: Acceptation et refus du devis
statut: ready-for-agent
bloque-par: [13]
---

# 14 — Acceptation et refus du devis

## Contexte

Le client accepte le devis d'un ticket **au comptoir**, en signant sur l'écran, ou **en ligne**, par
le lien qu'il reçoit quand le prix n'est connu qu'après diagnostic. S'il refuse, le ticket se clôt en
« devis refusé » et le vendeur décide au cas par cas de facturer un **forfait de diagnostic** pris
dans le catalogue de services. Un refus ne fait rien bouger dans le stock.
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 61, 67, 68, 72, 73 ; décision « Devis et
facture depuis le ticket »).

Bloqué par 13 (devis depuis le ticket, un devis vivant par ticket).

**Confié au socle** (décision de l'exploitant du 2026-09-30) : le forfait de diagnostic ne crée
qu'une facture **brouillon** par le chemin existant, sans émission — aucun code NF525 modifié ; ni
caisse. **Aucune migration** si `tickets.statut` n'a pas de `CHECK` (aucun relevé au cadrage) ;
sinon, migration **`0058`** réservée pour l'élargir (patron de recréation de `0040`).

_Mis au format du modèle le 2026-09-30. Ancien en-tête : `**Status:** ready-for-agent`,
`**Blocked by:** 13`._

### Constats du cadrage (2026-09-30)

- Réponse en ligne existante : `POST /api/public/devis/:token/repondre { action, signature? }`
  (`public.ts`) — change le statut du devis, **ne touche pas le ticket**.
- `saveSignatureDevis()` (`devisService.ts`) **tronque la signature à 1 000 caractères** : une image
  PNG en data URL (signature dessinée) y serait coupée, donc illisible. La prise en charge, elle,
  valide une data URL entière (`validateSignatureDataUrl()`, `routes/tickets.ts`).
- Colonne `devis.signature_client` commentée « simulé, eIDAS non implémenté » (`0023`).
- Aucun statut de ticket ne dit « devis refusé » (fins de cycle : `livre`, `annule`).

### Décisions de l'exploitant du 2026-09-30

1. **Forfait de diagnostic = facture BROUILLON**, par le chemin existant (`createFacture()`), sans
   émission : l'émission reste un geste manuel sur la page Factures. Facultatif, au cas par cas.
2. **Nouveau statut de ticket `devis_refuse`**, fin de cycle, atteint quand le devis du ticket est
   refusé (comptoir ou en ligne) ; de là, seulement `livre` (appareil rendu).

### Relecture de conception (2026-09-30)

- **Signature au comptoir** : dessinée sur l'écran (même composant que la prise en charge), validée
  par `validateSignatureDataUrl()` et **stockée entière** — ⊥ la troncature à 1 000 caractères pour
  ce chemin. Date de signature posée. Jamais présentée comme une signature électronique qualifiée
  (libellé « signature simple, non qualifiée »).
- **Accepter ne crée aucune facture** : la facture depuis le devis est le ticket 15. Accepter pose
  `accepte`, `repondu_le`, la signature.
- **Le refus passe le ticket en `devis_refuse` par `updateStatut()`**, seul écrivain du statut (et sa
  garde de validation technique, ticket 09, ne concerne que la réparation). Le refus en ligne le fait
  aussi — dans le même service, pas dans la route publique.
- **Transitions du devis respectées** (`devisService.ts`) : seul un devis `envoye` (ou `draft` au
  comptoir) se répond ; un devis déjà accepté ou refusé → 409.
- **Forfait** : service de la boutique, actif ; une ligne à son prix ; facture liée au ticket et au
  client **du ticket** ; un seul forfait par ticket (second → 409).

## Critères d'acceptation

Serveur :

- [ ] `POST /api/devis/:id/accepter-comptoir { signature }` : rôles de boutique, garde d'isolation ;
      signature validée entière ; devis → `accepte`, `repondu_le`, signature et date ; 409 si le
      devis n'est pas dans un état qui se répond ; **aucune facture créée**
- [ ] `POST /api/devis/:id/refuser` (comptoir) et `POST /api/public/devis/:token/repondre` avec
      `refuse` : devis → `refuse` ; **si le devis est lié à un ticket, ce ticket passe `devis_refuse`**
      par `updateStatut()`
- [ ] Statut `devis_refuse` ajouté à la machine à états des tickets (`ticketService.ts`) : atteint
      depuis tout statut non clos ; de là, seulement `livre` ; libellés publics et Kanban à jour
- [ ] `POST /api/tickets/:id/forfait-diagnostic { service_id }` : ticket `devis_refuse` seulement
      (409 sinon) ; service actif de la boutique (400 sinon) ; facture **brouillon** d'une ligne
      (service, prix, TVA, `service_id`), client et boutique du ticket, `ticket_id` posé ; second forfait
      → 409 ; **aucune émission, aucun numéro, rien au journal NF525**
- [ ] Aucune écriture dans `mouvements_stock` sur un refus ni sur le forfait
- [ ] Routes par ID gardées ; `tests/routes-isolation-conformite.test.ts` vert ; SQL dans les services

Écrans :

- [ ] Fiche du devis (lié à un ticket) : « Faire signer au comptoir » (pavé de signature) et
      « Refuser » ; libellé « signature simple, non qualifiée »
- [ ] Page publique : accepter / refuser inchangés dans leur forme ; un refus y clôt le ticket
- [ ] Fiche du ticket `devis_refuse` : statut affiché, bouton « Facturer un forfait de diagnostic »
      (choix d'un service du catalogue) → ouvre la facture brouillon créée
- [ ] Appels déballés `(await apiX(…)).data` ; données rendues échappées
- [ ] `CACHE_VERSION` (`public/sw.js`) incrémenté

Commun :

- [ ] Tests NF525 existants verts (`nf525-*`, `factures-immuabilite-conformite`) ; aucun appel à
      `emettreFacture()` ni `nextNumero()` ajouté
- [ ] ∀ test vu rouge avant correctif
- [ ] `npx vitest run` sans nouvel échec par rapport à la baseline mesurée avant le ticket
- [ ] Erreurs tsc ≤ baseline mesurée avant le ticket (`npx tsc --noEmit --pretty false | grep -cE "error TS[0-9]+"`)

## Coutures à tester

- **Service des réponses** — vitest contre un **vrai SQLite au schéma réel**
  (`tests/helpers/d1Sqlite.ts`) : acceptation au comptoir (statut, date, signature entière > 1 000
  caractères conservée, aucune facture) ; refus comptoir et en ligne → ticket `devis_refuse` ; devis
  déjà répondu → 409 ; aucun mouvement de stock.
- **Machine à états** — vitest : `devis_refuse` atteint, seule sortie `livre`.
- **Forfait** — vrai SQLite : facture brouillon d'une ligne, sans numéro, **aucune ligne dans
  `journal_nf525`** ; ticket non refusé → 409 ; service étranger → 400 ; second forfait → 409.
- **Routes** — vitest par `app.request()` : rôles, 404 autre boutique, réponse publique par jeton.
- **Écrans** — E2E Playwright `tests/e2e/devis-acceptation-refus.spec.ts`, vraie D1 locale : accepter
  au comptoir en signant (devis accepté, aucune facture) ; refuser en ligne par la page publique
  (ticket en « devis refusé ») ; facturer un forfait (facture brouillon, sans numéro) ; stock relu par
  l'API inchangé. L'E2E est joué par le socle dans le bac à sable (contrôle e2e de gates.json, à
  déclarer dans la tâche d'écran) ; un E2E hors de sa portée (préproduction, production) se demande
  dans le compte rendu (P16).

## Notes

- Périmètre : `src/services/devisService.ts`, `src/services/ticketService.ts`,
  `src/services/factureService.ts` (création brouillon seulement), `src/routes/facturation.ts`,
  `src/routes/public.ts`, `src/routes/tickets.ts`, `public/static/js/devis.js`,
  `public/devis-public.html`, `public/static/js/tickets.js`, `public/static/js/kanban.js`,
  `public/sw.js`, tests correspondants.
- Découpage conseillé pour le socle : **serveur** puis **écran**.
- `CLAUDE.md` § Factures : le numéro n'est attribué qu'à l'émission, jamais de numérotation côté
  client — une facture brouillon vit sans numéro.
- La troncature à 1 000 caractères de la signature **en ligne** existe déjà ; ce ticket ne la
  change pas (hors périmètre), il n'utilise pas ce chemin pour le comptoir.

## Critères d'origine (avant le 2026-09-30, repris ci-dessus)

- ~~Signature au comptoir sur le devis d'un ticket, enregistrée avec sa date ; le devis passe
      « accepté »~~
- ~~Le lien public existant permet l'acceptation ou le refus en ligne pour un devis issu d'un
      ticket~~
- ~~La signature n'est jamais présentée comme une signature électronique qualifiée (le schéma la
      dit « simulée »)~~
- ~~Devis refusé → le ticket se clôt dans l'état « devis refusé »~~
- ~~Forfait de diagnostic facultatif : le vendeur choisit un service du catalogue, facturé seul,
      au cas par cas~~ — facture brouillon (décision 1)
- ~~Aucun mouvement de stock sur un refus (les pièces non posées restent en stock)~~
- ~~Transitions de statut du devis respectées ; routes gardées par l'appartenance à la boutique~~
- ~~E2E : accepter au comptoir ; refuser en ligne et clore le ticket ; facturer un diagnostic ;
      relire le stock inchangé ; vus rouges d'abord~~
- ~~`npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées~~
