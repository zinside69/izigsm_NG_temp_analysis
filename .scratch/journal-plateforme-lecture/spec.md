---
chantier: journal-plateforme-lecture
statut: ready-for-agent
date: 2026-08-02
adr: docs/adr/0001-journal-separe-actions-plateforme.md
---

# Spec — Lecture du journal des actions de plateforme

## Problem Statement

`journal_actions_plateforme` se remplit depuis ticket 04. ⊥ interface pour le lire.

- Exploitant client demande « qu'avez-vous fait sur ma facture ? » → ⊥ réponse.
- Admin plateforme : seul recours = console D1 du tableau de bord Cloudflare.
- Registre non produisible → tranche ⊥ litige. Motif ADR 0001 reste théorique.

Second défaut, mesuré en prod : routes `/:id` (`PUT /api/factures/9`,
`DELETE /api/clients/20`) écrivent `boutique_id` NULL — middleware résout par query puis
corps, ⊥ par ressource. ∴ lignes qui comptent le plus (factures, cas de litige de l'ADR)
ne disent pas chez qui.

## Solution

Deux vues, deux publics, sur la même table :

- **Admin plateforme** → page dédiée, ∀ boutiques, filtres boutique | auteur | période.
- **Manager** → onglet dans ses réglages, sa boutique seule, ⊥ IP.

Résolution de la cible corrigée d'abord : sans elle, vue manager = registre à trous
silencieux — apparence complète, contenu partiel. Pire qu'⊥ registre.

## User Stories

1. Comme admin plateforme, je veux lire ∀ actions de plateforme, pour répondre à un client qui conteste une modification.
2. Comme admin plateforme, je veux filtrer par boutique, pour reconstituer ce qui s'est passé chez un client précis.
3. Comme admin plateforme, je veux filtrer par auteur, pour savoir ce qu'une personne de mon équipe a fait.
4. Comme admin plateforme, je veux filtrer par période, pour cadrer sur la date d'un litige.
5. Comme admin plateforme, je veux croiser ces filtres, pour isoler une intervention sans lire 400 lignes.
6. Comme admin plateforme, je veux voir les lignes à cible non résolue marquées comme telles, pour ⊥ croire qu'elles concernent la boutique filtrée.
7. Comme admin plateforme, je veux voir l'IP d'origine, pour distinguer une intervention interne d'un accès anormal.
8. Comme admin plateforme, je veux voir le statut HTTP, pour distinguer une action qui a abouti d'une qui a échoué.
9. Comme admin plateforme, je veux voir le corps expurgé, pour dire ce qui a changé & ⊥ seulement qu'une chose a changé.
10. Comme admin plateforme, je veux atteindre le journal depuis la console des boutiques, pour ⊥ mémoriser une URL.
11. Comme manager, je veux voir les interventions du support sur ma boutique, pour savoir ce qui a été touché chez moi.
12. Comme manager, je veux ⊥ voir les interventions chez d'autres boutiques, parce que ⊥ mes données.
13. Comme manager, je veux un libellé compréhensible (« Modification de la facture n°9 »), parce que `PUT /api/factures/9` ⊥ me dit rien.
14. Comme manager, je veux la date & l'heure, pour recouper avec ma propre chronologie.
15. Comme manager, je veux le nom de l'intervenant, pour savoir à qui m'adresser.
16. Comme manager, je veux voir ce qui a été envoyé (corps expurgé), pour vérifier la valeur exacte posée sur ma facture.
17. Comme manager, je veux ⊥ voir l'adresse IP d'un salarié de la plateforme, parce que ⊥ nécessaire à mon besoin (minimisation RGPD).
18. Comme manager, je veux trouver ces interventions dans mes réglages, parce que c'est là que je vais déjà pour ce qui touche ma boutique.
19. Comme manager sans intervention subie, je veux un écran qui le dit explicitement, pour distinguer « rien fait chez moi » de « écran cassé ».
20. Comme lecteur des deux vues, je veux les 30 derniers jours par défaut & une pagination, pour ⊥ attendre le chargement de tout l'historique.
21. Comme lecteur, je veux qu'un compte supprimé ou une boutique désactivée affiche quand même sa ligne, parce qu'un registre qui perd ses lignes ⊥ vaut rien.
22. Comme exploitant, je veux qu'une action sur une ressource `/:id` désigne la bonne boutique, pour que le registre couvre les factures — le cas même du litige.
23. Comme développeur, je veux qu'une route future par ID hérite de la résolution sans y penser, parce que 3 campagnes d'isolation ont montré qu'⊥ point unique = trous.

## Implementation Decisions

### Résolution de la boutique visée (3ᵉ niveau)

- `assertBoutiqueOwnership()` — garde d'isolation déjà appelée par 36 routes par ID —
  reçoit la ressource & son `boutique_id`. Elle **dépose** la cible dans le contexte de
  requête. Middleware de journalisation la lit en **dernier recours** : query → corps →
  cible déposée.
- Motif : la garde & le journal veulent la même information, et la garde est déjà un point
  de passage unique tenu par un garde-fou statique (`routes-isolation-conformite`).
- ⊥ carte des routes dans le middleware (écartée par ADR 0001).
- ⊥ requête SQL supplémentaire : la ressource est déjà chargée par la garde.
- Routes exemptées de garde (`EXEMPTIONS`, motif `admin-only` | `referentiel-global` |
  `public`) → cible reste nulle. Assumé & visible dans la vue plateforme.
- ⊥ rattrapage rétroactif : lignes antérieures gardent `boutique_id` NULL, l'information
  n'existe plus.

### Lecture

- api: `GET /api/journal-plateforme` → `{ success, data, pagination }`
  - query: `boutique_id?`, `user_id?`, `date_debut?`, `date_fin?`, `page?`, `limit?`
  - ! réservée admin plateforme (`role === 'admin'` & `boutique_id` absent).
  - ∀ jointures en `LEFT JOIN` : table ⊥ FK, un compte supprimé garde sa ligne.
- api: `GET /api/journal-plateforme/ma-boutique` → `{ success, data, pagination }`
  - boutique dérivée du jeton, ⊥ de la query. Un manager ⊥ vise autrui.
  - ⊥ colonne `ip_address` dans la réponse — retirée côté **service**, ⊥ côté page.
    (Leçon ticket 04 : garantie confiée à l'appelant finit oubliée.)
- Lecture ⊥ journalisée : `journalPlateformeMiddleware` ne prend que les méthodes mutantes.
- Défaut de période : 30 derniers jours. Pagination sur `(boutique_id, created_at)`,
  index déjà posé par migration 0039.
- ⊥ migration dans ce chantier.

### Libellés

- Correspondance chemin → libellé métier, **côté lecture**, ⊥ dans le middleware d'écriture.
- ∀ chemin absent de la table → repli sur `METHODE /chemin` brut.
- ∴ table vieillit sans devenir fausse.

### Vues

- Page plateforme : socle partagé (`buildSidebar`), atteinte depuis la console des boutiques.
  ! `main.css` (règle cp75), ! ajout à `MENU_GAUCHE` & `PAGES_AVEC_SOCLE` si entrée de menu.
- Onglet manager dans les réglages, nommé « Interventions du support ».
- ∀ donnée d'API rendue → `echapperHtml()`. Le corps expurgé est une saisie utilisateur
  réinjectée : vecteur XSS stockée direct (cf. audit du 2026-08-02).
- ∀ appel : `const res = (await apiGet(…)).data` — garde-fou statique
  `frontend-enveloppe-api-conformite` fait échouer la suite sinon.

## Testing Decisions

Bon test ici = observe ce qu'un rôle **voit**, ⊥ la forme du code. Un test qui vérifie
qu'`assertBoutiqueOwnership` appelle `c.set()` décrit l'implémentation ; un test qui
vérifie que la ligne écrite porte la bonne boutique la contraint.

Deux seams, ⊥ nouveau :

1. **Harnais middleware** (unitaire, app Hono minimale + middleware réel).
   Prior art : les 3 tests § « résolution de la boutique visée ».
   Étendu d'une route `/:id` posant une garde d'isolation → la ligne porte la cible.
   ! aussi : route `/:id` **sans** garde → cible nulle, ligne écrite quand même.
2. **Playwright E2E** — couvre endpoint + interface + isolation d'un seul point.
   Prior art : `console-boutiques.spec.ts`, `isolation-routes.spec.ts`,
   `resolveur-boutique-pages.spec.ts`.
   ! un manager d'une boutique A ⊥ obtient les lignes de B, par l'écran comme par l'API.
   ! la réponse manager ⊥ porte `ip_address` (assertion sur le corps, ⊥ sur l'écran :
   une colonne masquée en CSS reste dans la réponse).

! ∀ test vu rouge avant son correctif (`modop-tests.md`).
Baselines à tenir : `vitest` 893/895 (2 échecs permanents de fuseau `agendaService`),
`tsc` ≤ 32, `playwright` 186/186.

## Out of Scope

- Console enrichie (CA, tickets ouverts, dernière activité) → backlog, cadrage propre.
- Purge / rétention → conservation illimitée décidée ; ticket ouvert si le volume l'exige.
- Export CSV | PDF du journal → personne ne l'a demandé.
- Journalisation des **lectures** → ADR 0001 ne couvre que les mutations.
- Rattrapage des lignes historiques à cible nulle → impossible.
- Colonnes `entite_type` / `donnees_avant` → écartées par ADR 0001, ⊥ rouvrir ici.

## Further Notes

- ADR 0001 = décision structurante. ! lire avant d'implémenter.
- Table ⊥ FK, volontairement : boutique désactivée & compte supprimé gardent leurs lignes.
  ∴ ∀ jointure en `LEFT JOIN`, ∀ affichage tolère un `user_id` | `boutique_id` orphelin.
- `!boutique_id` ⊥ signifie « compte incomplet » : 3 cas partagent ce nul (admin
  plateforme, onboarding Google inachevé, données corrompues). ! dire lequel on vise.
- Vocabulaire imposé (`CONTEXT.md`) : « admin plateforme » | « manager », ⊥ « admin » seul.
- `CACHE_VERSION` (`public/sw.js`) ! incrémenté sur la dernière tâche frontend du chantier.
- Déploiement ⊥ automatique, ! confirmation explicite utilisateur.
