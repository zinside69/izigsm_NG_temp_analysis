---
id: spec
titre: Supervision admin plateforme — chantier 1 (console des boutiques, sélection, bandeau, journal)
statut: ready-for-agent
bloque-par: []
---

# Spec — Supervision admin plateforme (chantier 1)

_Issue du grilling du 2026-07-31 (`/grill-with-docs`). Vocabulaire : `CONTEXT.md` § Multi-tenant.
Décision structurante : `docs/adr/0001-journal-separe-actions-plateforme.md`._

## Problem Statement

L'admin plateforme — l'exploitant du SaaS, pas un client — se connecte et ne voit **aucune
boutique cliente**. Il ne peut donc ni superviser ni dépanner les enseignes qui l'appellent,
alors que c'est sa seule raison d'utiliser l'application : il ne produit pas dans une boutique
à lui.

La capacité existe pourtant côté API : `assertBoutiqueOwnership()` laisse passer le rôle
`admin` sur les 36 routes gardées, et `GET /api/boutiques` renvoie bien toutes les boutiques
actives. C'est l'interface qui n'a jamais été construite pour ce rôle : `apiGet` injecte
`boutique_id` **depuis la session**, or l'admin plateforme a un `boutique_id` NULL — par
conception, c'est précisément ce qui lui permet de traverser. Résultat : aucun `boutique_id` à
injecter, des listes vides, et un `400 boutique_id requis` sur les routes qui en exigent un.
S'y ajoute un libellé trompeur « MyDesk » en en-tête, qui n'est qu'un repli cosmétique quand
aucun nom de boutique n'est connu.

Symétriquement, le client n'a aujourd'hui **aucun moyen de savoir** ce que l'exploitant a fait
sur ses données. Tant que l'admin plateforme ne voyait rien, le point était théorique ; dès
qu'il pourra agir depuis l'interface, il ne l'est plus — en particulier sur une facture, où un
litige se tranche sur qui a fait quoi.

## Solution

À la connexion, l'admin plateforme n'arrive plus sur un tableau de bord vide mais sur une
**console des boutiques** : la liste des enseignes clientes, avec pour chacune son nom, son
slug et son nombre de comptes. Il en choisit une.

Ce choix vaut alors **pour toute sa session** : les 29 pages existantes travaillent sur la
boutique choisie, sans qu'aucune d'elles n'ait à être modifiée. Un **bandeau permanent** en
haut de l'écran rappelle en continu « Vous consultez la boutique X » et permet d'en changer
en un clic — contrepartie non négociable d'un accès qui reste complet, en lecture **et** en
écriture.

Toute action qu'il effectue sur une boutique qui n'est pas la sienne est enregistrée dans un
**journal de plateforme**, distinct de l'`audit_logs` du client, alimenté par un middleware :
aucune route, présente ou future, ne peut y échapper par oubli.

Rien ne change pour un manager : il ne voit pas la console, ne voit pas le bandeau, et son
`boutique_id` continue de le borner à sa propre boutique.

## User Stories

1. En tant qu'admin plateforme, je veux arriver sur la console des boutiques à la connexion, afin de commencer mon travail là où il commence réellement : le choix du client à dépanner.
2. En tant qu'admin plateforme, je veux voir la liste de toutes les boutiques actives, afin de retrouver celle dont le gérant vient de m'appeler.
3. En tant qu'admin plateforme, je veux voir le nom de chaque boutique, afin de l'identifier comme le client se nomme lui-même.
4. En tant qu'admin plateforme, je veux voir le slug de chaque boutique, afin de faire le lien avec son adresse de vitrine publique et de prise de rendez-vous.
5. En tant qu'admin plateforme, je veux voir le nombre de comptes de chaque boutique, afin de mesurer d'un coup d'œil la taille de l'enseigne avant d'y entrer.
6. En tant qu'admin plateforme, je veux filtrer ou rechercher dans la liste par nom, afin de retrouver une boutique sans parcourir la liste quand elles seront nombreuses.
7. En tant qu'admin plateforme, je veux sélectionner une boutique d'un seul clic, afin d'entrer dans son contexte sans étape intermédiaire.
8. En tant qu'admin plateforme, je veux que la boutique choisie reste active en changeant de page, afin de mener un dépannage qui traverse plusieurs écrans sans la resélectionner à chaque fois.
9. En tant qu'admin plateforme, je veux que les listes des 29 pages existantes affichent les données de la boutique choisie, afin de dépanner avec les écrans que le client décrit au téléphone, et non des écrans à part.
10. En tant qu'admin plateforme, je veux ne plus recevoir de `400 boutique_id requis` une fois une boutique choisie, afin que les pages qui exigent ce paramètre cessent d'être inutilisables pour moi.
11. En tant qu'admin plateforme, je veux un bandeau permanent nommant la boutique consultée, afin de ne jamais croire par erreur que j'agis ailleurs.
12. En tant qu'admin plateforme, je veux que ce bandeau reste visible sur toutes les pages, afin qu'aucune navigation ne me fasse perdre ce repère.
13. En tant qu'admin plateforme, je veux ne pas pouvoir masquer ce bandeau, afin que la garantie donnée au client ne dépende pas de mon confort.
14. En tant qu'admin plateforme, je veux revenir à la console depuis le bandeau, afin de changer de boutique sans me déconnecter.
15. En tant qu'admin plateforme, je veux que la boutique choisie soit oubliée à la déconnexion, afin qu'une session suivante reparte d'un choix explicite.
16. En tant qu'admin plateforme, je veux un message clair quand aucune boutique cliente n'existe encore, afin de comprendre que l'écran est vide parce qu'il n'y a rien, et non parce qu'il est cassé.
17. En tant qu'admin plateforme, je veux que l'en-tête n'affiche plus « MyDesk » quand je n'ai sélectionné aucune boutique, afin de ne pas lire le nom d'une boutique qui n'existe pas.
18. En tant qu'admin plateforme, je veux que mes actions d'écriture sur une boutique cliente soient enregistrées, afin de pouvoir rendre compte de mon intervention en cas de contestation.
19. En tant qu'admin plateforme, je veux que cet enregistrement soit automatique, afin de ne pas dépendre de ma vigilance ni de celle du prochain développeur.
20. En tant que manager d'une boutique, je veux que l'application se comporte exactement comme avant, afin que la supervision de l'exploitant ne dégrade pas mon usage quotidien.
21. En tant que manager d'une boutique, je veux ne pas voir la console des boutiques, afin de ne pas me voir proposer un écran qui ne me concerne pas.
22. En tant que manager d'une boutique, je veux que mes propres actions ne polluent pas le journal de plateforme, afin que ce registre ne parle que des interventions de l'exploitant.
23. En tant que client d'une boutique, je veux que les interventions de l'exploitant sur mes données laissent une trace, afin qu'un litige sur une facture puisse être tranché sur des faits.
24. En tant que responsable du SaaS, je veux que le journal de plateforme survive à la désactivation d'une boutique, afin qu'un registre de supervision reste consultable après la fin d'un contrat.
25. En tant que développeur, je veux qu'une route écrite demain soit journalisée sans que j'y pense, afin de ne pas rejouer les trois campagnes successives de correction d'isolation.
26. En tant que développeur, je veux que le garde-fou de conformité d'isolation reste vert, afin qu'aucune route de ce chantier n'entre sans garde ni exemption motivée.
27. En tant que développeur, je veux que le vocabulaire « admin plateforme » / « manager » soit employé partout dans le code et l'interface, afin que « admin » seul cesse de désigner deux rôles opposés.

## Implementation Decisions

### Rôles et vocabulaire

- Le rôle en base reste `admin` (`roles.id = 1`) : les 36 gardes en dépendent, aucune n'est
  modifiée par ce chantier. C'est l'**affichage** et la **prose** qui disent « admin
  plateforme ».
- La distinction opérationnelle est « `role === 'admin'` **et** `boutique_id` NULL ». L'ADR
  interdit d'attribuer une boutique à un compte admin plateforme — le middleware s'appuie sur
  cette invariante.

### Console des boutiques

- Nouvelle page servie comme les autres pages statiques (`public/`), avec son fichier JS dédié
  — un fichier JS par page, convention en place.
- Elle consomme `GET /api/boutiques`, qui renvoie **déjà** toutes les boutiques actives à ce
  rôle. Le seul manque est le **nombre de comptes** : enrichissement du chemin admin plateforme
  uniquement (`listAllBoutiques`), par agrégat sur les comptes rattachés. Le chemin manager
  (`listBoutiqueForUser`) n'est pas touché — inutile pour lui, et toute modification y serait
  une prise de risque sur le chemin tenant.
- Un manager qui atteindrait l'URL de la console par hasard est renvoyé vers son tableau de
  bord : l'écran n'a pas de sens pour lui, et l'API ne lui renverrait de toute façon que sa
  propre boutique.
- **État vide** : si aucune boutique active n'existe, la console affiche un message explicite
  disant qu'aucune boutique cliente n'est enregistrée. Aucun bouton de création — créer une
  boutique reste hors périmètre (voir Out of Scope).

### Sélection de boutique et portée de session

- La boutique choisie est mémorisée **dans l'objet de session déjà existant**, pas dans une
  nouvelle clé de stockage : elle hérite ainsi du bon support (`localStorage` ou
  `sessionStorage` selon « se souvenir de moi ») et surtout de la purge à la déconnexion, sans
  code de nettoyage supplémentaire à écrire ni à oublier.
- Le résolveur de `boutique_id` du frontend donne la priorité à la boutique sélectionnée, puis
  retombe sur celle de la session. C'est le **point de passage unique** : les 29 pages
  existantes basculent sans être modifiées, puisque toutes passent par les mêmes helpers d'appel
  API.
- Conséquence assumée : seuls les appels passant par ces helpers basculent. Tout appel `fetch`
  écrit à la main ailleurs continuerait d'ignorer la sélection — à traiter comme un défaut s'il
  en existe, pas comme un cas à contourner.
- Aucune sélection = aucun `boutique_id` injecté, comportement actuel inchangé. La console
  étant le point d'entrée, ce cas se limite à l'admin plateforme qui n'a pas encore choisi.

### Bandeau permanent

- Bannière haute, pleine largeur, au-dessus du contenu, rendue par le socle partagé — donc
  présente sur toute page qui construit son interface avec ce socle, sans intervention page par
  page.
- Contenu : « Vous consultez la boutique **X** » + une action de retour à la console.
- Non masquable, non refermable : c'est la contrepartie de l'accès en écriture, elle ne peut pas
  dépendre du confort de celui qu'elle signale.
- Affichée **uniquement** pour l'admin plateforme ayant sélectionné une boutique. Jamais pour un
  manager.

### Libellé de l'en-tête

- Le repli « MyDesk » cesse d'être affiché à un compte sans boutique : l'en-tête indique
  **« Console plateforme »** tant qu'aucune boutique n'est sélectionnée, puis le **nom de la
  boutique consultée** ensuite.
- « MyDesk » reste le nom de repli d'une boutique cliente sans nom configuré — ce chantier ne
  touche pas au rebranding en cours.

### Journal des actions de plateforme

- **Nouvelle table**, distincte d'`audit_logs`, conformément à l'ADR 0001. Colonnes retenues —
  sous-ensemble d'`audit_logs` **plus** ce que seul un middleware peut connaître :
  `user_id` (l'admin plateforme), `boutique_id` (la boutique visée), la méthode HTTP, le chemin
  appelé, le statut de la réponse, une capture tronquée du corps de requête, `ip_address`,
  `created_at`.
- `entite_type` / `entite_id` / `donnees_avant` / `donnees_apres` sont **écartés** : un
  middleware ne connaît ni l'entité métier ni son état avant mutation. Les inventer par analyse
  du chemin produirait un registre faux ; les obtenir exigerait de repasser par les 77 appels
  dispersés à `auditLog()`, ce que l'ADR écarte explicitement.
- **Pas de contrainte de clé étrangère** vers `boutiques` ni `users` : un registre de supervision
  doit survivre à la désactivation d'une boutique ou à la suppression d'un compte. Le dépôt a par
  ailleurs déjà payé le prix d'une clé étrangère laissée pendante par une migration (`0031` →
  `0038`).
- Index sur (`boutique_id`, `created_at`) et sur `user_id` — la consultation du chantier 2 lira
  par boutique et par date.

### Middleware de journalisation

- Middleware Hono appliqué globalement, **après** l'authentification (il a besoin de l'identité)
  et positionné de façon à observer le statut de la réponse.
- Règle de déclenchement : la requête est **mutante** (POST / PUT / PATCH / DELETE) **et**
  l'appelant est un admin plateforme. Un manager agissant chez lui n'écrit jamais dans ce
  journal ; une lecture n'y écrit jamais.
- Résolution de la boutique visée, dans l'ordre : paramètre de requête `boutique_id`, puis
  `boutique_id` du corps, sinon **non résolue**.
- **Complétude avant précision** : une action dont la boutique visée n'est pas résolue est
  quand même journalisée, avec une cible nulle. Ne jamais taire une ligne faute de pouvoir la
  qualifier — c'est exactement le trou que l'ADR reproche à une journalisation dispersée.
- L'écriture du journal ne doit jamais faire échouer la requête métier ni la retarder
  visiblement : elle suit le patron d'écriture différée déjà employé dans le dépôt pour les
  effets de bord non bloquants.
- Le corps de requête capturé est tronqué et ne doit jamais contenir de secret (mot de passe,
  jeton, code de déverrouillage, code SIM) — ces champs sont retirés avant écriture.

### Contraintes transverses

- Aucune nouvelle route par identifiant n'est introduite ; si le chantier en ajoutait une, elle
  devrait satisfaire le garde-fou de conformité (garde explicite ou exemption motivée).
- La version de cache du service worker est à incrémenter sur la dernière tâche frontend du
  chantier — sans quoi les navigateurs déjà venus continueront de servir l'ancien socle.
- La migration créant la table doit être appliquée **à distance avant** tout déploiement du
  Worker. Le jeton Cloudflare de session n'ayant pas les droits D1 distants, cette commande est
  à faire lancer par l'utilisateur.

## Testing Decisions

**Ce qu'est un bon test ici** : il observe un comportement visible de l'extérieur — ce que
l'utilisateur voit, ce que l'API répond, ce que le journal contient — jamais la forme interne du
code. Un test qui vérifierait la clé de stockage employée ou la signature d'une fonction serait à
refuser : ces choix doivent pouvoir changer sans casser la suite.

**Trois cas systématiques**, patron hérité du chantier d'isolation : *l'étranger est refusé*, *le
propriétaire légitime passe*, *l'admin plateforme passe*. Tester le refus seul ne suffit jamais —
une garde trop stricte reste verte si personne ne vérifie que l'ayant droit passe encore.

### Seam 1 — Playwright, navigateur (`tests/e2e/`)

Prior art : `tests/e2e/auth.spec.ts` (connexion réelle, assertions sur l'URL et sur des éléments
visibles).

- L'admin plateforme arrive sur la console après connexion, et non sur le tableau de bord.
- La console liste les boutiques du seed avec nom, slug et nombre de comptes.
- Sélectionner une boutique mène à une page métier peuplée des données de cette boutique.
- Le bandeau nomme la boutique consultée et reste présent après navigation vers une autre page.
- L'action du bandeau ramène à la console.
- Un manager connecté n'a ni console ni bandeau, et atteint son tableau de bord comme avant.
- Après déconnexion puis reconnexion, aucune boutique n'est présélectionnée.

### Seam 2 — Playwright, API (`tests/e2e/`)

Prior art : `tests/e2e/isolation-routes.spec.ts` et la fixture de création de tenant étranger.

- `GET /api/boutiques` répond à l'admin plateforme avec toutes les boutiques actives, chacune
  portant son nombre de comptes.
- Le même appel par un manager ne renvoie que sa boutique — et le chemin manager reste inchangé.
- Une page métier appelée avec la boutique sélectionnée répond `200` là où elle répondait `400`
  faute de `boutique_id`.

### Seam 3 — Vitest + mock du port `Database` (`tests/`)

Prior art : les suites de services existantes et leurs mocks. C'est le seul seam où l'écriture du
journal est observable en chantier 1, sa **lecture** appartenant au chantier 2.

- Une mutation d'un admin plateforme sur une boutique cliente écrit une ligne, avec l'auteur, la
  boutique visée, la méthode, le chemin et le statut.
- Une lecture (GET) n'écrit rien.
- Une mutation d'un manager sur sa propre boutique n'écrit rien.
- Une mutation d'un admin plateforme dont la boutique visée n'est pas résolue écrit quand même
  une ligne, cible nulle.
- Les champs sensibles du corps de requête n'apparaissent pas dans la ligne écrite.
- Un échec d'écriture du journal ne fait pas échouer la requête métier.

### Seam 4 — Garde-fou de conformité (existant, à ne pas casser)

`tests/routes-isolation-conformite.test.ts` doit rester vert.

### Baselines à ne pas dégrader

`npx vitest run` → 873/875 (les 2 échecs permanents sont des tests de fuseau d'`agendaService`).
`npx tsc --noEmit` → 32 erreurs préexistantes. Toute validation frontend se fait en local live
(serveur `wrangler pages dev` + vraies données), jamais par relecture de code — et le serveur est
à relancer après chaque build, faute de quoi les tests visent l'ancien bundle.

## Out of Scope

- **Chantier 2** : enrichissement de la console (chiffre d'affaires, tickets ouverts, dernière
  activité) et **consultation du journal de plateforme** dans l'interface. Le chantier 1 écrit le
  journal, il ne le lit pas.
- Tout tableau de bord **agrégé inter-boutiques** : écarté au grilling précisément pour ne pas
  introduire de requête sans filtre tenant dès l'écran d'accueil.
- Création, modification ou désactivation d'une boutique depuis la console.
- Modification des gardes d'isolation : les 36 routes gardées laissent déjà passer ce rôle.
- Reprise du rebranding « Mon Atelier » → « MyDesk » sur les pages internes non auditées.
- Export ou reconstitution d'historique croisant `audit_logs` et le journal de plateforme — coût
  assumé de l'ADR, à traiter le jour où une fonctionnalité d'historique le demandera.
- Multi-sites (une enseigne exploitant plusieurs boutiques) : notion distincte, non implémentée.
- Déploiement : jamais automatique, toujours sur confirmation explicite de l'utilisateur.

## Further Notes

- Le besoin a été constaté **en production** par l'utilisateur, connecté au compte d'exploitation
  après la rotation d'identifiants du 2026-07-31 : il ne voyait aucune boutique cliente.
- La leçon des trois campagnes d'isolation (2026-07-19, 07-30, 07-31) gouverne le choix du
  middleware : ce qui repose sur la discipline du développeur finit par avoir des trous, et un
  audit statique qui cherche un signal dans un *fichier* plutôt que dans le *handler* examiné
  produit des faux négatifs massifs — 13 failles annoncées, 36 réelles.
- Le découpage en deux chantiers est une décision du grilling : livrer d'abord ce qui débloque le
  dépannage, enrichir ensuite.
