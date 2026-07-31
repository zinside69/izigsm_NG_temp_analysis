# iziGSM — TODO (project-docs, distinct de docs/TODO.md qui suit les sprints produit)

## ⚠ NOTE (pas une tâche) — listener Telegram désactivé le 2026-07-31

Volontairement rédigé **sans case à cocher** : `pick-task.mjs` ne retient que les lignes
`- [ ] …`, et la loop piocherait sinon une tâche qui consiste à réarmer son propre
déclencheur.

Tâche planifiée **"iziGSM Loop Telegram Listener"** stoppée et désactivée pour la durée
du chantier isolation `boutique_id`. À réarmer une fois le chantier clos :

```powershell
Enable-ScheduledTask -TaskName "iziGSM Loop Telegram Listener"
```

Détail et motif : `loop-runbook.md` § 11.

## ✅ PRIORITÉ CRITIQUE — Écritures cross-tenant sur 5 endpoints facture/avoir (revue finale 2026-07-30, CORRIGÉ le 2026-07-31)
Trouvé par la revue finale du chantier facture. **Dette antérieure, pas une régression de ce chantier**, mais même classe que les failles `GET /tickets/:id` et `PUT/DELETE /tickets/:id` déjà corrigées le 2026-07-19 (`bugs.md`) — et sur l'objet que ce chantier vient d'enrichir de données réglementaires irrécupérables.

Aucun de ces handlers ne dérive ni ne vérifie `boutique_id` (`getFacture()` ne filtre pas) :
- `src/routes/facturation.ts:427` `GET /factures/:id` — **lecture** complète d'une facture d'une autre boutique : client, email, téléphone, adresse, lignes, paiements, hash NF525, snapshots réglementaires
- `src/routes/facturation.ts:466` `POST /factures/:id/emettre` — **émission et verrouillage définitif** du brouillon d'une autre boutique : irréversible, écrit dans le journal NF525 de la boutique victime avec l'`user_id` de l'attaquant, et fige le snapshot
- `src/routes/facturation.ts:439` `POST /factures/:id/paiement` — enregistrement d'un paiement sur une facture d'une autre boutique
- `src/routes/facturation.ts:506` `GET /avoirs/:id` et `:518` `POST /avoirs`

- [x] Appliquer le patron déjà en place sur `POST /api/factures` et `PUT /devis/:id/convertir` (relecture + comparaison `boutique_id` + `403`) aux 5 endpoints
- [x] Étendre `tests/e2e/isolation.spec.ts` — RED d'abord, comme pour la faille `convertir` : RED observé (5 échecs, statuts reçus 200/200/200/200/**201**), puis GREEN 13/13
- [x] Envisager à cette occasion un helper `assertBoutiqueOwnership(db, table, id, boutiqueId)` : le patron est désormais copié à l'identique 3 fois et le sera 5 de plus — l'extraction cesse d'être prématurée → helper créé dans `src/lib/middleware.ts`, signature retenue `(user, resource, label)` (la ressource est déjà chargée par la route, inutile de refaire une requête générique par table)

Détail complet + effets démontrés endpoint par endpoint : `bugs.md`. **Pas encore déployé.**
Les 3 sites d'isolation antérieurs (`facturation.ts:257`, `:299`, `:371`) n'ont pas été migrés
vers le helper (code déjà validé) — migration optionnelle, à faire seulement si on retouche ces routes.

## ✅ PRIORITÉ CRITIQUE — 36 routes par ID sans isolation `boutique_id` (audit 2026-07-31, CORRIGÉ le 2026-07-31)
Rapport complet : `project-docs/audit-isolation-2026-07-31.md` (84 routes par ID analysées → 47 suspectes → 18 candidates
par l'audit statique initial). **Le compte réel n'était ni 13 ni 18 : 36 routes ont finalement reçu une garde.**
L'écart vient d'un faux négatif systématique de l'audit statique — voir `bugs.md` et la section « Statut » de
`audit-isolation-2026-07-31.md` pour le détail. `PUT /employes/:id` (modification d'une fiche RH d'une autre boutique),
`GET /produits/:id` (prix d'achat/marge/fournisseur d'autrui) et `POST /tickets/:id/archiver`
(route oubliée par la campagne du 2026-07-19 dans un fichier pourtant audité) ont été les 3 premières confirmées manuellement.
- [x] Vérifier une par une les 15 candidates restantes de l'audit initial (liste dans le rapport) — 17/18 confirmées failles réelles (1 exemption légitime : `DELETE /employes/:id` en `admin`-only)
- [x] Écrire le garde-fou de conformité (`tests/routes-isolation-conformite.test.ts`) — a révélé 23 failles supplémentaires que l'audit manuel avait manquées
- [x] Corriger les 36 routes avec `assertBoutiqueOwnership()` ou l'équivalent service (`getTicketBoutiqueId`, `getBonCommandeBoutiqueId`, `getCategorieBoutiqueId`, `getRdvBoutiqueId`) — 125 tests e2e (`tests/e2e/isolation-routes.spec.ts`), test de conformité vert
- [x] Trancher la piste de fond : garde-fou de conformité statique retenu (`tests/routes-isolation-conformite.test.ts`), plutôt qu'un middleware par défaut sur toute route `/:id` — voir § Lecture d'ensemble du rapport

## Dette et bugs découverts pendant le chantier isolation routes par ID (2026-07-31, aucun corrigé)
Trouvés en cours de route par les tâches 1 à 14 du chantier `feat/isolation-routes-par-id` (voir
`.superpowers/sdd/2026-07-31-isolation-routes-par-id/progress.md`) — hors périmètre de ce chantier,
qui ne devait modifier que des routes d'isolation. Documentés ici pour ne pas les perdre.

- [ ] 🔴 `service_modeles.modele_id` référence `modeles_appareils_old`, table supprimée par la migration
  `0031` (`ALTER TABLE RENAME` puis `DROP` dans la même migration) : `POST /services/modeles/:id/services`
  renvoie **500 pour tout appelant, admin compris**, très probablement en production. Exige une nouvelle
  migration D1. Trouvé Task 11-13 — les 2 tests e2e concernés assertent `!== 403/404` au lieu de `=== 200`,
  limite documentée dans le test.
- [ ] 🔴 `updateEmploye()` (`src/services/personnelService.ts`) échoue en 500 sur un body partiel :
  `prenom`/`nom` restent `undefined` et violent une contrainte NOT NULL. `PUT /api/employes/:id` est donc
  cassé pour toute mise à jour partielle. Trouvé Task 2, sans rapport avec l'isolation.
- [ ] 🟡 Les 3 gardes posées le 2026-07-31 dans `src/routes/facturation.ts` (lignes ~464, ~496, ~564,
  commit `5636b57`, **déjà déployé**) utilisent du SQL inline et violent la convention « 0 SQL inline dans
  les controllers » (voir `CLAUDE.md` § Architecture). Fonctionnelles, mais à migrer vers une fonction de
  service. Trouvé Task 3.
- [ ] 🟡 `POST /services/marques` et `POST /services/modeles` restent ouverts aux managers : la création
  dans le référentiel global n'est pas restreinte, contrairement à la modification et à la suppression
  (passées à `requireRole('admin')` par Task 6). Trouvé Task 6.
- [ ] 🟡 L'inscription renvoie `500 "Erreur serveur."` quand le nom de boutique est déjà pris, au lieu d'un
  message explicite — un prospect reçoit une erreur serveur incompréhensible.
- [ ] 🟡 `public/static/js/factures.js` : `confirmPaiement()` et `deleteFacture()` retombent sur un
  enregistrement **local** en cas d'erreur réseau (« hors-ligne »), donc la base ne voit jamais l'opération ;
  et `numero: … || ('FAC-' + id)` fabrique un numéro d'affichage. Même famille que le fallback localStorage
  supprimé au checkpoint 64, sur des objets NF525-adjacents.

## 🟡 `addMonthsParis()` — mois précédent faux les 31 (trouvé 2026-07-31, PAS corrigé)
`statsService.ts:45` : le décalage de mois via `Date.setUTCMonth()` déborde les 31 (2026-06-31 → 2026-07-01),
donc `ca_mois_precedent` = CA du mois courant et `evolution_ca_pct` = 0 % les 31 mai / juillet / octobre / décembre,
pour toutes les boutiques. Root cause complète et fix pressenti dans `bugs.md`.
- [ ] Corriger `addMonthsParis()` (composition arithmétique année/mois, ou jour forcé à 1 avant décalage)
- [ ] Vérifier les autres appelants du helper (`getCaMensuel()` utilise `addMonthsParis(today, -11)`)
- [ ] Note gate : tant que ce n'est pas corrigé, la baseline vitest est de **4 échecs les 31 concernés**, 2 le reste du temps

## 🟡 Divergences de cohérence trouvées en revue finale (2026-07-30, PAS corrigées)
- [ ] `src/services/statsService.ts:121` et `:132` interrogent la valeur de statut **morte** `'emise'` : aucun `INSERT INTO factures` du dépôt ne l'écrit (vérifié sur les 4 sites), seul le `DEFAULT` de schéma la porte encore. Conséquence : le KPI `factures_en_retard` (`:166`) renvoie **toujours 0** en production. Bonus : la valeur de `:121` est destructurée sous le nom `devis_en_attente` (`:77`) alors qu'elle compte des **factures**
- [ ] Double enregistrement NF525 selon le chemin d'entrée : `PUT /devis/:id/convertir` (`facturation.ts:258-275`) appelle `enregistrerTransaction()` **à la conversion**, sur un brouillon non verrouillé, alors que `POST /api/factures` laisse `emettreFacture()` l'enregistrer **au verrouillage**. Émettre ensuite un brouillon issu du bouton « → Facture » de `devis.js:595` insère une **seconde** ligne `journal_nf525` avec le même `reference_id`. `verifyChain()` reste valide, mais deux transactions fiscales pour un document unique est un problème d'audit
- [ ] La garde `400` sur `client_id` incohérent avec le devis source (ajoutée le 2026-07-30) n'a pas de test automatisé — seulement une vérification live

## 🔴 Facture verrouillée = encaissement impossible (découvert 2026-07-30, décision prise, PAS implémenté)
`ajouterPaiement()` (`src/services/factureService.ts:163`) refuse toute facture `locked = 1` : `if (facture.locked) throw new Error('Facture verrouillée — modification interdite (CGI art. 289).')`, traduit en `403` par la route. Conséquence : **une facture ne peut être encaissée que tant qu'elle est brouillon**, et le flux normal « j'émets, le client paie ensuite » est impossible. C'est pourquoi l'acompte et le bouton « Émettre & encaisser » font paiement *puis* émission. L'interface propose pourtant « enregistrer un paiement » sur les factures émises — action qui échoue systématiquement (constaté sur `FAC-2026-00005`, `en_attente` + `locked=1` + `montant_paye=0`).

**Décision utilisateur du 2026-07-30** : autoriser l'encaissement sur facture émise. Retirer la garde `locked` de `ajouterPaiement()` **uniquement** — les lignes et montants restent inaltérables. Justification : encaisser n'est pas modifier la facture ; les paiements vivent dans leur propre table avec leur trace, et le chaînage NF525 porte sur le document émis, pas sur son règlement.
- [ ] Retirer la garde `locked` de `ajouterPaiement()` sans toucher aux autres gardes d'immuabilité
- [ ] Vérifier qu'aucun autre chemin ne dépend de ce refus (notamment `createFactureAcompte()` et `createFacture()` qui encaissent avant d'émettre — leur ordre reste valide, mais ne doit plus être *obligatoire*)
- [ ] Tests : encaissement sur facture émise, encaissement partiel puis solde, statut résultant

## 🔴 Facturation automatique à la clôture du ticket (demandé 2026-07-30, cadré, PAS commencé)
Remplace et précise l'item « Workflow facturation auto » de la section impression plus bas. Quand une réparation est marquée terminée, une facture doit être générée automatiquement pour pouvoir encaisser.

**Décisions utilisateur du 2026-07-30** :
- **État initial** : brouillon à la clôture du ticket, **émission au moment de l'encaissement** — même patron que `createFactureAcompte()` et que l'action « Émettre & encaisser » (`ajouterPaiement()` puis `emettreFacture()`). Fonctionne indépendamment du chantier ci-dessus.
- **Contenu** : si un devis accepté existe pour ce ticket, réutiliser `convertirDevis()` (qui déduit déjà l'acompte versé) ; sinon construire les lignes depuis les services et pièces du ticket.
- Nécessite son propre `superpowers:brainstorming` : déclencheur exact (quel statut de ticket, réversibilité si le ticket est rouvert), doublon à éviter si une facture existe déjà, et comportement quand le ticket n'a ni devis ni lignes chiffrables.

## 🟡 Envoi de facture par email (chantier séparé acté 2026-07-30, PAS commencé)
Aucun template de facture n'existe dans `src/services/emailService.ts` — contrairement aux devis qui ont un vrai `POST /devis/:id/envoyer` (`src/routes/facturation.ts:192`, avec garde `422` si `client_email` est vide). C'est la raison pour laquelle le statut `en_attente` est libellé « Émise » et non « Envoyée » : rien n'est jamais envoyé aujourd'hui.
- Acquis : `factures.tracking_token` (UUID) est déjà posé par `emettreFacture()` à l'émission, prévu pour la vitrine de suivi client — aucune migration nécessaire.
- Piège connu : `sendEmail()` est fire-and-forget (`waitUntil()`), un email valide en syntaxe mais erroné part sans confirmation de livraison. Même limite que tous les emails transactionnels du projet.
- À trancher au brainstorming : un envoi réel doit-il créer un statut distinct, ou une simple date `envoye_le` comme sur les devis ?

## 🟡 Mise en page du document facture — aligner sur le modèle A4 (chantier séparé acté 2026-07-30, PAS commencé)
Référence : `docs/modele-facture.pdf`, **ou** le template A4 du ticket `_buildTicketA4HTML()` (`public/static/js/tickets.js`), déjà refondu le 2026-07-25 en s'inspirant de ce même PDF (accent gris ardoise unique, aucun aplat de couleur — voir `decisions.md` et `docs/superpowers/specs/2026-07-25-refonte-fiche-a4-design.md`).
- Le PDF **n'est pas lisible sur le poste Windows actuel** (rendu PDF absent, `poppler-utils` non installé) ; le template ticket est lisible directement dans le code et constitue la référence praticable.
- État de départ : les deux documents partagent déjà `print.css` et le vocabulaire de classes `print-*`, mais la facture conserve des couleurs en dur (`#d1d5db`, `#22c55e`, `#ef4444`) là où le ticket a été neutralisé — elle n'a jamais reçu le passage de la refonte de juillet.
- Ne jamais contourner ni dupliquer le garde-fou « 1 page A4 » de `_triggerPrint()` (`app.js`, partagé tickets/factures/devis).
- Validation obligatoirement humaine : une impression réelle, non automatisable (`window.print()` fige toute session pilotée).

## 🟡 Facture — défauts isolés trouvés le 2026-07-30 (PAS traités)
- [ ] `listFactures()` (`src/services/factureService.ts`) ne sélectionne pas `total_ht`/`total_tva` : les colonnes « Montant HT » et « TVA » de la liste affichent toujours `0,00 €` alors que les valeurs sont correctes en base
- [ ] `PUT /api/boutiques/:id/settings` ne peut pas **effacer** `mention_facture` : `COALESCE(?, mention_facture)` fait retomber un `null` volontaire sur l'ancienne valeur. Même classe que les 5 champs d'`agenda.html` de l'audit de persistance
- [ ] `mention_facture` n'est affichée que sur la **facture** — l'étendre aux devis et aux avoirs
- [ ] Snapshot vendeur : `telephone` et `email` de la boutique ne sont pas capturés par `emettreFacture()` et restent donc vivants dans l'en-tête du document (hors socle réglementaire, mais incohérent avec le reste du bloc figé)

## 🔴 P1 — Audit persistance des champs (2026-07-30, PAS traité)
Détail complet, root cause exacte (fichier+ligne) et méthode dans `project-docs/audit-persistance-2026-07-30.md` — audit complet des 22 pages de repairdesk.fr (3 subagents en parallèle, lecture seule), déclenché par la découverte du bug `t-imei`.

**Fonctionnalités entières hors service :**
- [x] `factures.html` — corrigé 2026-07-30 : `POST /api/factures` implémenté (`createFacture()` + délégation `convertirDevis()`), 3 actions explicites (brouillon / émettre / émettre & encaisser), TVA par ligne, signature morte retirée du modal, fallback localStorage supprimé. Socle de la facture électronique ajouté au passage (migration `0037` : date d'exécution, snapshot vendeur/acheteur figé à l'émission, régime de franchise TVA ; ventilation TVA et mentions légales sur le document imprimé) — le format structuré UBL/CII et le raccordement PDP restent un chantier dédié. Faille d'isolation trouvée et corrigée sur `PUT /devis/:id/convertir` (voir `bugs.md`). Validé en local live + gates vitest/Playwright.
- [x] `personnel.html` — corrigé 2026-07-30 (commit `385c171`) : `<script src="/static/js/app.js">` ajouté avant `personnel.js` + pattern `r.success`/`r.data` → `r.data.success`/`r.data.data` sur les 4 appels (`loadEmployes`, `pointer`, `submitAddEmploye`, `loadRapport`/`renderRapport`). Validé en local live (wrangler pages dev) : création employé + pointage réels, `POST /api/pointage/:id/pointer` 200, aucune erreur console. Édition employé + gestion PIN/permissions restent absentes de l'UI (backend déjà prêt) — hors scope de ce fix, à tracker séparément si besoin.

**Données perdues silencieusement (pas d'erreur visible) :**
- [ ] `tickets.html` — `t-priority` en création : toujours enregistré `'normale'` quel que soit le choix Basse/Moyenne/Haute (fonctionne en édition)
- [ ] `stock.html` — `stock-notes` : jamais persisté (ni interface TS, ni colonne SQL), création et édition
- [ ] `stock.html` — `stock-qty` en édition : modification de quantité stock silencieusement ignorée — risque d'erreurs d'inventaire réel
- [ ] `services.html` — `modele-marque-id` en édition : changement de marque d'un modèle existant ignoré
- [ ] `caisse.html` — `remise_pct` : taux de remise saisi perdu (total correct, mais facture non réimprimable avec le détail réel — impact NF525-adjacent)
- [ ] `settings.html` — `monnaie` : figée à EUR quoi que sélectionne l'utilisateur (mineur, sauf besoin multi-devise)
- [ ] `agenda.html` — 5 champs impossibles à **vider** en édition (`rdv-description`, `rdv-nom-client`, `rdv-tel-client`, `rdv-client-id`, `rdv-ticket-id`) : `body.xxx ?? ancienneValeur` retombe sur l'ancienne valeur quand le frontend envoie `null` volontaire

**Bug d'affichage transversal `r.success`/`r.data` — données enregistrées mais invisibles/signalées en échec (3 fichiers non couverts par le fix du 2026-07-16/17) :**
- [ ] `reconditionnement.js` (11 fonctions) — **bloque l'ouverture des modals "Modifier un ordre" et "Terminer un ordre"**, vérification bon d'achat caisse toujours en échec
- [ ] `fournisseurs.js` (12 fonctions) — listes/KPIs jamais affichés, risque de doublons si l'utilisateur re-soumet en croyant avoir échoué
- [ ] `caisse.js` (9 fonctions) — ventes/encaissements réels affichés comme des échecs
- [ ] `services.js` — marques/modèles/liaisons toujours vides à l'écran malgré des données réelles en base

**Suspects mineurs (best-effort) :**
- [ ] `services.html` `svc-duree`/`liaison-prix-specifique` + `rachats.html` `r-prix` : saisie `0` transformée en `null` (`parseFloat(...) || null`)
- [ ] `stock.html` `stock-category` : impossible de retirer une catégorie déjà assignée (COALESCE)
- [ ] `devis.html` `d-tva` : taux par défaut ne s'applique qu'aux nouvelles lignes, pas de perte de donnée

**Décision produit à prendre séparément** : `qualirepar.html` — voir chantier dédié ci-dessous (branchement API réelle en cours de cadrage).

**Pages vérifiées saines, rien à faire** : `clients.html`, `sav.html`.

## ✅ Backfill recovery-prompt.md — checkpoints manquants — TERMINÉ le 2026-07-30
`recovery-prompt.md` doit être régénéré à **chaque** `/init checkpoint` (= `/context-guardian checkpoint` complet, pas une mise à jour partielle de `current-state.md` seule) — convention de nommage déjà actée, jamais suivie systématiquement jusqu'ici.
- [x] Backfiller les 22 entrées manquantes (29-30, 33-34, 38, 40-56) — reconstruites depuis `current-state.md` + `git log` (croisement complet), session dédiée du 2026-07-30. `recovery-prompt.md` couvre maintenant en continu les checkpoints 21→61, aucun trou restant. Entrées marquées `*(reconstruite rétroactivement...)*` pour transparence (même convention que `docs/TODO.md`/`JOURNAL_MODIFICATIONS.md` pour le contenu documenté après coup).
- [x] À partir de maintenant : tout `/init checkpoint` sur ce projet doit systématiquement toucher `current-state.md` + `recovery-prompt.md` + `CLAUDE.md` (si nouvel invariant) + mémoire persistante (si changement d'état significatif) — jamais un sous-ensemble (règle déjà actée au checkpoint 61, `feedback_checkpoint_protocol.md`)

## 🟡 Logo boutique multi-tenant (identifié 2026-07-25, brainstorming refonte A4, PAS commencé)
Colonne `boutiques.logo_url` existe déjà en base (migration `0002_boutiques.sql`) mais totalement morte : aucune UI dans `settings.html` pour la renseigner, non exposée par `GET /api/boutiques/:id`. Partiellement plombée côté devis (`devisService.ts` sélectionne déjà `logo_url AS boutique_logo`) mais jamais rendue dans `devis.js`. Décision utilisateur (brainstorming `docs/superpowers/specs/2026-07-25-refonte-fiche-a4-design.md`) : upload fichier vers R2 (même pattern que les photos de tickets), branché sur les 3 documents imprimables (fiche A4 ticket, devis, factures). Fallback si absent : nom de la boutique en texte seul (pas de mark générique "iziGSM"). La fiche A4 ticket est déjà préparée côté template pour consommer `logoUrl` dès que ce chantier livre (voir spec) — nécessite son propre `superpowers:brainstorming` (validation format/taille image, cadrage, endpoint d'upload dédié ou réutilisation du pattern photos).
- [ ] Brainstorming dédié (hors périmètre de la spec A4 du 2026-07-25)
- [ ] Champ upload logo dans l'onglet Boutique de `settings.html`
- [ ] Endpoint upload R2 (nouveau ou réutilisation pattern photos tickets)
- [ ] Exposer `logo_url` sur `GET /api/boutiques/:id`
- [ ] Brancher sur `devis.js`/factures (le A4 ticket sera déjà prêt via le chantier ci-dessous)

## 🔴 Chantier impression ticket A4/thermique — refonte + email auto (demandé 2026-07-24, PAS commencé)
Reprend et étend le chantier impression déjà déployé (checkpoint 33, voir plus bas) — ne le remplace pas.

**Contenu commun aux deux formats** (description, client, réparateur, état du matériel à l'entrée, commentaires **publics uniquement** — jamais les notes internes) :
- [x] Auditer le contenu actuel de la fiche imprimée A4 vs cette liste — identifier les écarts avant de coder — fait par la loop-engineering (audit lecture seule, aucun code modifié), résultat détaillé dans `current-state.md` checkpoint 54 : description/client/réparateur/état matériel déjà présents, **commentaires publics manquants** (aucun champ dédié dans le modèle, `notes_internes` jamais affiché) — écart réel à corriger lors de la mise en page

**Format A4** :
- [x] Revoir la mise en page sur le modèle `docs/bon de réparation.pdf` (bandeau, structure) — tranché le 2026-07-25 (brainstorming + plan + subagent-driven-development, `docs/superpowers/specs|plans/2026-07-25-refonte-fiche-a4-*.md`) : ni l'indigo actuel ni le bleu marine/ambre du PDF, accent gris ardoise unique inspiré de `docs/modele-facture.pdf` (aucun aplat de couleur). Voir `decisions.md` pour le détail. **Déployé en production le 2026-07-25** (`repairdesk.fr`) après validation visuelle réelle en navigateur. Un débordement 2 pages a été découvert juste après ce déploiement (signalé par capture d'écran utilisateur) — corrigé le même jour, voir la case "une seule page A4" ci-dessous et `bugs.md`.
- [x] Ajouter IMEI / N° de série (absent actuellement) — obsolète, déjà implémenté : `_buildTicketA4HTML()` (`public/static/js/tickets.js:764-765`) affiche IMEI et N° Série dans le bloc "Appareil" (`d.imei`/`d.numeroSerie`, alimentés depuis la jointure `appareils` — voir `tickets.js:601-602`), confirmé toujours présent après la refonte visuelle A4 du 2026-07-25 (loop-engineering, aucun code modifié, revérification lecture seule)
- [x] Ajouter le détail des options de récupération (ex. 10€ TTC déduits de la réparation, recyclage sous 4 semaines) — obsolète, déjà implémenté : politique confirmée avec l'utilisateur le 2026-07-25 (frais de diagnostic 10€ TTC conservés si devis refusé ou réparation impossible, recyclage 4 semaines après notification), texte identique déjà présent dans l'encart "Acompte versé" (`tickets.js:804-812`, validé le 2026-07-18). Voir `decisions.md` § 2026-07-25.
- [x] Garantir le rendu sur **une seule page A4** — corrigé le 2026-07-25 suite à un débordement réel en production (signalé par capture d'écran), voir `bugs.md`. Resserrage statique + `@page{margin:0}` + garde-fou dynamique `.print-compact` dans `_triggerPrint()` (app.js) qui s'applique automatiquement si le contenu mesuré dépasse le budget — garantie valable pour tout contenu futur, pas seulement le cas observé.

**Format thermique (nouveau)** :
- [ ] Contenu réduit : nom client, description, entête réparateur, date de prise en charge, QR code ou code-barre (retrouver le ticket dans le logiciel), lien vitrine de suivi client
- [ ] Se servir du modèle `docs/test impression.pdf`
- [ ] **Solution technique d'impression pas encore choisie** (QZ Tray envisagé au départ, mais à explorer/valider — voir décision utilisateur 2026-07-24, aucune techno arrêtée)

**Email automatique à l'impression** (A4 ou thermique) :
- [ ] Envoyer un email de confirmation de prise en charge au client au moment de l'impression (décision utilisateur 2026-07-24) — vérifier s'il existe déjà un template proche (`sendTicketCree` ?) à réutiliser ou s'il faut un nouveau template dédié

**Facturation — 2 chantiers séparés mais liés à l'impression/documents** :
- [ ] Configurer l'affichage des prix en HT ou TTC **au moment de la création/configuration de la boutique** (montants réparation + facturation d'articles) — nouveau champ de config boutique
- [ ] Facture : toujours 2 chiffres après la virgule, s'inspirer de `docs/modele-facture.pdf`
- [ ] Mentions légales + CGV + CGR à ajouter dans devis/avoir/facture — à récupérer sur www.telnet-beynost.fr (ne pas inventer le texte)
- [ ] Workflow facturation auto : ticket passé "réparation terminée" → génère une facture en mode **brouillon** automatiquement ; le technicien peut ensuite la passer en **acquittée** (= client a payé) → déclenche le chaînage NF525 + enregistrement comptabilité

## ✅ Sélection modèle smartphone cassée — CORRIGÉ le 2026-07-30
- [x] Le filtre par constructeur ne restreint pas la liste des modèles — `onModeleInput()` (`tickets.js`) ignorait la marque déjà sélectionnée (`t-device-type-id`) et filtrait sur les 500 modèles en cache sans restriction. Fix : filtre d'abord par `marque_id` si une marque est sélectionnée. Validé contre l'API réelle (local live) — commit `1898da7`.

## 🔴 Devis — durée de vie 15 jours (2026-07-24, PAS traité)
- [ ] Un devis devient caduc (désactivé) 15 jours après sa création
- [ ] Le technicien ou l'admin doit pouvoir le rouvrir et le modifier après péremption

## 🟡 Détection automatique du nom de société par ville (2026-07-24, PAS traité, priorité à confirmer)
- [ ] À l'inscription/configuration boutique : proposer automatiquement un nom de société à partir de la ville renseignée — mécanisme exact à définir (API SIRENE déjà utilisée ailleurs dans le projet pour la recherche entreprise, cf. § "Fonctionnalité manquante — recherche entreprise à l'inscription")

## ✅ Prise en charge — email/téléphone non conservés sur la fiche client — CORRIGÉ le 2026-07-30
- [x] Investigation : le nom/téléphone/email d'un client existant sélectionné dans la prise en charge **étaient** déjà reportés dans le formulaire (`populateClients()`, handler `change` depuis 2026-06-01) — ce sous-point de l'énoncé était obsolète.
- [x] **Vrai bug confirmé** : si le téléphone/email retapé dans la prise en charge diffère de la fiche client existante (notamment quand elle n'a encore aucun email), la saisie restait piégée sur le seul ticket (`ticket.client_email`) — jamais reportée sur `clients.email`/`clients.telephone`. `saveTicket()` (`tickets.js`) compare désormais la saisie à la fiche en cache et fait un `PUT /api/clients/:id` (fiche complète relue puis fusionnée — jamais un objet partiel, `updateClient()` fait un UPDATE complet sans COALESCE, risque réel d'écraser adresse/SIRET/type_client sinon) si ça diffère. Non bloquant : un échec de cette synchro n'empêche jamais la création du ticket.
- [x] Vérifié que `POST /devis/:id/envoyer` (`facturation.ts:198`) bloque déjà correctement l'envoi si `client_email` est vide (`422`, garde existante depuis 2026-06-17, `ee5cfdc`) — donc le scénario littéral "devis marqué envoyé sans email" n'est pas reproductible via ce endpoint. Risque résiduel non traité par ce fix (documenté, pas un regression de ce chantier) : `sendEmail()` est fire-and-forget (`waitUntil()`), un email valide en syntaxe mais faux (typo) serait accepté sans confirmation de livraison — même classe de limitation que les autres emails transactionnels du projet.
- [x] Validé en local live : client créé sans email → prise en charge avec nouvel email saisi → `GET /api/clients/:id` confirme l'email persisté, `type_client`/`adresse` intacts (pas d'écrasement). Commit `71a87a2`.

## 🔴 Page Clients (`/clients`) — 3 bugs (2026-07-24, 1/3 corrigé)
- [ ] Import client (fichier) non fonctionnel
- [ ] Recherche client non fonctionnelle
- [x] Bouton "Actions" sur une fiche client : icône non visible — CORRIGÉ le 2026-07-30 : `clients.html` ne chargeait jamais le CDN FontAwesome (contrairement à la plupart des autres pages), donc **toutes** les icônes `<i class="fas fa-*">` de la page étaient invisibles (Actions, empty-state), pas seulement le bouton signalé. Fix : ajout du lien CDN (même version que `settings.html`). Vérifié servi par le serveur local — commit `1898da7`.

## 🔵 Champ "Couleur" de l'appareil (identifié 2026-07-30, comparatif monatelier.net/aide/prise-en-charge, best-effort)
Monatelier demande explicitement la couleur de l'appareil à la prise en charge (aide à l'identification sans IMEI). Absent du formulaire iziGSM (`tickets.html`) et du schéma `appareils` — nécessiterait une migration DB (nouvelle colonne). Priorité basse, pas bloquant.
- [ ] Ajouter le champ (DB + formulaire + fiche imprimée) — best-effort, non prioritaire

## 🟡 État de l'appareil à l'entrée — checklist à cocher + nouveaux items (2026-07-24, PAS traité)
Actuellement saisie libre (texte) — remplacer par des cases à cocher pour le technicien (plus rapide, évite les erreurs/oublis).
- [ ] Passer d'une saisie texte à une checklist d'états prédéfinis
- [ ] Items à ajouter (liste non exhaustive, à compléter avec le technicien) : façade arrière fissurée/rayée/cassée, connecteur de charge cassé, batterie gonflée ou HS, bouton power HS, bouton volume HS

## 🔴 PRIORITÉ CRITIQUE — Faille isolation `GET /api/tickets/:id` (découvert 2026-07-19) — CORRIGÉE le 2026-07-19
Voir `bugs.md` § "FAILLE — `GET /api/tickets/:id` sans aucune isolation `boutique_id`" pour le détail complet — n'importe quel compte authentifié (n'importe quelle boutique) peut lire l'intégralité d'un ticket d'une autre boutique (client, IMEI, diagnostic, facture d'acompte) en itérant sur l'ID numérique. Découvert par le gate Playwright de la loop-engineering (`tests/e2e/isolation.spec.ts`), classé risque élevé par `loop-policy.md` — escaladé, pas d'auto-fix par la loop, corrigé manuellement par l'utilisateur.
- [x] Corriger `GET /api/tickets/:id` (`src/routes/tickets.ts:160`) avec le même patron `getBoutiqueId(user, queryBoutiqueId)` + vérification `ticket.boutique_id !== boutiqueId → 403` déjà utilisé sur `/api/tickets/:id/photos` — commit `ae6795f`, déployé, validé en prod réelle
- [x] Auditer dans la foulée `PUT /:id`, `PUT /:id/statut`, `DELETE /:id`, `POST /:id/acompte` — fait par la loop-engineering (audit statique read-only, sans modification de code) : `POST /:id/acompte` déjà sûr, **3 routes vulnérables trouvées**, voir item 🔴 juste en dessous
- [x] Le test `tests/e2e/isolation.spec.ts` (gate `test:e2e`) passe intégralement — suite relancée par la loop-engineering après le fix, 7/7 verts

## 🔴 PRIORITÉ CRITIQUE — Faille isolation `PUT /:id`, `PUT /:id/statut`, `DELETE /:id` (découvert 2026-07-19, audit loop-engineering) — CORRIGÉE, DÉPLOYÉE ET VALIDÉE le 2026-07-19
Voir `bugs.md` § "FAILLE — `PUT /:id`, `PUT /:id/statut`, `DELETE /:id` sans isolation `boutique_id`" et `.superpowers/sdd/loop-runs.md` (run du 2026-07-19) pour le détail complet ligne par ligne. Même classe que la faille `GET /:id` déjà corrigée — escaladé par la loop (risque élevé : isolation multi-tenant + paiement), pas d'auto-fix. Correctif préparé sur la branche `fix/isolation-tickets-put-delete` (même patron que `ae6795f`), relu, mergé sur `main` (`22b3071`) et déployé en prod.
- [x] `PUT /api/tickets/:id` (`src/routes/tickets.ts:259`) — aucun garde, `updateTicket` (`ticketService.ts:552`) filtre par `id` seul → corrigé, déployé
- [x] `PUT /api/tickets/:id/statut` (`src/routes/tickets.ts:287`) — aucun garde, `updateStatutTicket` (`ticketService.ts:625`) filtre par `id` seul, déclenche aussi garantie + emails cross-boutique → corrigé, déployé
- [x] `DELETE /api/tickets/:id` (`src/routes/tickets.ts:352`) — `requireRole` limite le rôle mais pas la boutique, `deleteTicket` (`ticketService.ts:688`) filtre par `id` seul → corrigé, déployé
- [x] `tests/e2e/isolation.spec.ts` étendu pour couvrir ces 3 routes — 10/10 tests verts (suite complète), vérifié aussi en non-régression (PUT légitime même boutique → 200 inchangé)
- [x] Relire le diff, merger sur `main` (`22b3071` via `a517bae`), déployer (`npx wrangler pages deploy`)
- [x] **Validé en prod réelle** (`telnet@bbox.fr`, manager boutique 2, 2026-07-19) : `PUT /api/tickets/1` (boutique étrangère) → 403 confirmé (avant fix : 200)

## ✅ Cache-busting par hash de contenu — TERMINÉ et mergé sur `main` (checkpoint 53, 2026-07-24)
Suite à l'incident du 2026-07-18 (contenu déployé figé par le Service Worker pendant une fenêtre de propagation CDN, voir `bugs.md` § "Contenu déployé absent chez un utilisateur malgré CACHE_VERSION à jour") — le fix déployé (`cache:'reload'` au précache) réduisait le risque sans l'éliminer structurellement.

**Chantier** : hasher le contenu des fichiers statiques dans leur nom (`tickets.a3f8e1.js` au lieu de `tickets.js`) — élimine la classe de bug à la source, une URL hashée ne peut jamais être servie périmée sous ce nom. Voir checkpoint 53 pour le détail complet (script `scripts/build-hash-assets.mjs`, spec/plan `docs/superpowers/specs|plans/2026-07-24-cache-busting-*`).
- [x] Configurer le build pour hasher les assets `public/static/js/*.js`/`*.css` — script post-build isolé (`scripts/build-hash-assets.mjs`), pas d'intégration Rollup native (décision de design, voir spec)
- [x] Générer un manifeste de build (`dist/static/manifest.json`, mapping nom logique → nom hashé)
- [x] Adapter les balises `<script src="...">`/`<link href="...">` dans les pages HTML pour référencer les noms hashés (via le manifeste)
- [x] Régénérer dynamiquement la liste de précache `APP_SHELL` du Service Worker (`public/sw.js`) à partir du manifeste
- [x] Fichiers hashés en cache long + immutable (`Cache-Control: public, max-age=31536000, immutable`) — `dist/_headers`, vérifié fonctionnel sous le worker Hono avancé
- [x] `sw.js` et les pages HTML en no-cache (`dist/_headers`) — vérifié fonctionnel

## Chantier impression ticket — 8/8 tâches terminées, approuvées et DÉPLOYÉES (checkpoint 33, 2026-07-18)

## Chantier impression ticket — 8/8 tâches terminées, approuvées et DÉPLOYÉES (checkpoint 33, 2026-07-18)
Voir `recovery-prompt.md` (checkpoint 32) pour le détail complet, notamment la clarification importante sur ce que couvrait réellement Task 4/4b (pas un "ticket technicien", contrairement à une hypothèse initiale de l'utilisateur).
- [x] Task 6 (révisée) — ticket 3 volets thermique (client×2 + technicien), remplace le ticket client seul de Task 5 — commit `62b03e4`
- [x] Task 7 (révisée) — 2 boutons d'impression ("Fiche A4"/"Ticket 3 volets") + dispatch `printTicket(id, format)` — commit `47d7bb7`
- [x] Task 8 — deep-link technicien `tickets.html?open=<token>` implémenté — commit `f8609b6`. **Bug trouvé en validation réelle, non corrigé** : ne fonctionne jamais pour un compte admin (`boutique_id: null`) — voir `bugs.md` § "Deep-link technicien ne fonctionne jamais pour un compte admin" pour le détail complet et la cause racine (route `GET /api/tickets` exige `boutique_id` sans exception admin)
- [ ] Corriger le bug deep-link admin (voir `bugs.md`) — nécessite de modifier la route partagée `GET /api/tickets`, hors périmètre de Task 8, décision utilisateur : reporté à plus tard
- [ ] Décider si un restyle visuel complet de la fiche A4 (bandeau bleu marine façon `bon de réparation.pdf`) est souhaité, séparément du contenu déjà ajouté (décision actuelle : système visuel indigo existant conservé)
- [ ] Namespacer les futurs fichiers `.superpowers/sdd/task-N-*.md` créés hors plan écrit (ex. `impression-ticket-task-N-*.md`) — collision de naming générique a causé l'écrasement d'un rapport d'un chantier précédent (non récupérable, mais sans perte d'information unique)
- [x] Bug mineur non bloquant : nom de boutique sur fiche imprimée lit la 1ère boutique de `GET /api/boutiques` non filtrée, pas forcément celle du ticket — corrigé par la loop-engineering le 2026-07-24, commit `ece114d` (`_fetchTicketPrintData` utilise désormais `GET /api/boutiques/:id` avec le `boutique_id` du ticket)
- [ ] Déploiement groupé du chantier impression ticket à prévoir après Task 8 (rien déployé pour l'instant, seul l'acompte structuré l'est) [loop-safe]

## Bug étendu — pattern `r.success`/`r.data` cassé, ampleur à confirmer (découvert le 2026-07-16, PAS traité) — RÉSOLU par `c281411` le 2026-07-17, checkboxes réconciliées par la loop-engineering le 2026-07-20
En corrigeant `devis.js` (3 fonctions, voir `bugs.md`), un balayage rapide a montré le même pattern cassé (`r.success`/`r.data` lu directement sur le retour d'`apiGet`/`apiPost`/`apiPut`, au lieu de `r.data.success`/`r.data.data`) dans **`agenda.js`, `sav.js` et `stats.html`** — au moins 17 endpoints backend renvoyant `{success, data}` imbriqué sont potentiellement concernés côté frontend (comptage rapide des routes, pas un audit exhaustif fonction par fonction). Même classe de bug que `settings.html` (checkpoint 23) et `devis.js` (ce jour) : silencieux, aucune erreur visible, juste des données jamais affichées ou des stats à zéro en permanence.

**Réconciliation loop-engineering (2026-07-20)** : le commit `c281411` (2026-07-17, « fix(agenda,sav,stats): pattern r.success/r.data cassé sur 19 fonctions ») a déjà corrigé les 3 fichiers — agenda.js (8 fonctions), sav.js (8 fonctions), stats.html (3 fonctions pleinement corrigées + 4 avec wrapper corrigé & noms de champs backend alignés) — et a été validé en local live (`wrangler pages dev` + D1 local, script Node rejouant les endpoints, cf. message de commit). Audit statique de la loop confirmé : plus aucun `r.success`/`r.data` direct fautif dans les 3 fichiers, uniquement `r.ok`/`r.data?.data`/`r.error` avec commentaires explicatifs. Cas hors périmètre restants (non liés à ce pattern) : `top_appareils`/`ca_genere` n'existent pas côté backend (fonctionnalités jamais implémentées, laissées vides). Les cases étaient simplement restées décochées — même décalage documentation/code que le bug slug (`92f0db8`).
- [x] Auditer `agenda.js` fonction par fonction (KPIs, RDV, clients/tickets cache, détail RDV) — page Agenda potentiellement très impactée (plusieurs fonctions concernées d'après le grep initial) — **FAIT** (`c281411`, 8 fonctions)
- [x] Auditer `sav.js` fonction par fonction (garanties, dossiers SAV, expiration) — **FAIT** (`c281411`, 8 fonctions)
- [x] Auditer `stats.html` (7 occurrences de `r.success` repérées) — page Stats/Analytics potentiellement affichant des chiffres faux depuis toujours — **FAIT** (`c281411`, 3 pleinement + 4 wrapper corrigé)
- [x] Pour chaque site, vérifier d'abord la route backend correspondante (`{success, data}` imbriqué vs corps plat) avant de corriger — certains sites peuvent être corrects si la route ne nest pas sous `data` (cf. `devis.js` : création/conversion étaient déjà bons) — **FAIT** (champs backend vérifiés & alignés dans `c281411`)
- [x] Valider chaque fix en local live avec de vraies données (pas juste relire le code) — un test à 0/vide ne prouve rien, ce bug produit justement des zéros silencieux — **FAIT** (validé en local live dans `c281411`, cf. message de commit)

## Checkpoint 23 (2026-07-16) — Bugs ouverts traités : reset password + créneaux RDV

Suite du checkpoint 22 (lots A-D déjà déployés). Traite les 2 derniers bugs connus non corrigés listés dans `bugs.md`/`recovery-prompt.md`.

### E. Reset password jamais envoyé — commité, pushé, déployé (`2dbb297`), **validé en prod avec envoi réel reçu** (`telnet@bbox.fr`, 2026-07-16) — voir `bugs.md` § reset-password-request pour le détail complet
`sendResetPasswordEmail()` (nouveau, `emailService.ts`, modèle `sendOtpInscription()`) remplace l'appel `sendEmail()` mal paramétré dans `routes/auth.ts`. `tsc` : erreur historique `Expected 1 arguments, but got 5` disparue. Non validé en envoi réel (pas de `RESEND_API_KEY` locale, envoi prod nécessite confirmation explicite — action "envoi de message" soumise à autorisation).

### F. Créneaux RDV bookables (boutique_creneaux vide) — commité, pushé, déployé (`2dbb297`) — voir `todo.md` § Bug prise de RDV en ligne pour le détail complet
`creneauxService.ts` (nouveau) + routes `GET`/`PUT /api/boutiques/:id/creneaux` + onglet "Horaires RDV" dans `settings.html`. 12 tests nouveaux. Cycle complet validé en local live (API + UI + génération réelle de créneaux publics via `getDisponibilites()`).

### G. Bug annexe découvert : `settings.html` entier cassé depuis la migration ApiService→apiGet — commité, pushé, déployé (`2dbb297`) — voir `bugs.md` § settings.html pour le détail complet
10 sites avec `r.success`/`r.data` au lieu de `r.data.success`/`r.data.data` — les 5 onglets existants (Boutique, Numérotation, Facturation, Paiements, Emails) ne préaffichaient jamais les valeurs existantes et affichaient toujours un toast d'échec même en cas de succès, depuis le commit `a62c4fd`. Tous corrigés dans le même passage.

- [x] `tsc --noEmit` : aucune nouvelle erreur sur les fichiers touchés (2 erreurs pré-existantes `auth.ts:335`/`622` sans lien, confirmées via `git stash`)
- [x] Tests 803/805 (12 nouveaux `creneauxService.test.ts`, mêmes 2 échecs pré-existants `computeFin()`)
- [x] Commit + push + déploiement (`2dbb297`, `wrangler pages deploy`), `repairdesk.fr/api/health` → 200 après déploiement

## Checkpoint 22 (2026-07-15, suite session ; lot C déployé le 2026-07-16) — Prise en charge : autocomplete + schéma ; Fiche client : type société + SIRET

### A. Prise en charge — autocomplete marque/modèle + grille schéma (commits `c30984e`, `03e384d`, déployés)
- [x] Bug corrigé : `onModeleInput()` (`tickets.js`) lisait `res.data` au lieu de `res.data?.data` — l'autocomplete Modèle ne renvoyait jamais aucune suggestion depuis toujours (route `/api/services/modeles` fonctionnait, seule l'extraction JS était fausse)
- [x] Champ Appareil (marque) : `<select>` figé à 7 options → autocomplete texte sur les 126 marques réelles (`onMarqueInput()`, même pattern debounce 300ms / 2 caractères min que Modèle)
- [x] Nouveau : grille schéma de déverrouillage 9 points dans État & Sécurité — toggle PIN/Schéma, points cliquables + tracé SVG, stocké dans la colonne texte existante `code_deverrouillage` (préfixe `SCHEMA:1-5-9-...`, **aucune migration nécessaire**), round-trip édition vérifié, affichage lisible en fiche détail (`formatCodeDeverrouillage()`)
- [x] **Faille XSS trouvée et corrigée** (revue de sécurité automatique déclenchée sur le code du jour) : suggestions marque/modèle construisaient un `onclick="...('${nom}')"` par interpolation de chaîne dans `innerHTML` — un nom externe (API phone-specs, ou marque créée par un admin) contenant un guillemet double aurait cassé l'attribut et permis une injection HTML. Remplacé par `data-*` + `addEventListener` délégué (même pattern que le fix XSS `signature_client` du 2026-07-11) ; `escapeHtml()` encode désormais aussi `"`/`'`.
- [x] `sw.js` `CACHE_VERSION` `v2.52`→`v2.53`
- [x] Tests 791/793 (2 échecs pré-existants `computeFin()`, sans rapport), `tsc --noEmit` sans nouvelle erreur
- [x] Déployé en prod, validé en local (`wrangler pages dev`) avant déploiement — toggle, sélection marque/modèle, tracé schéma, sauvegarde, réédition round-trip

### B. Fiche client — type particulier/professionnel + adresse (commit `f3938c5`, déployé, migration `0035` appliquée en prod)
- [x] Migration `0035_clients_type_societe.sql` : colonnes `type_client` (défaut `particulier`), `raison_sociale`, `siret`, `tva_intracom` sur `clients`
- [x] Modal client (`clients.html`/`clients.js`) : toggle Particulier/Professionnel, champs société conditionnels (raison sociale obligatoire si Pro, SIRET validé 14 chiffres côté client ET serveur — `validateClientTypeSociete()` dans `routes/clients.ts`)
- [x] Autocomplete adresse/code postal/ville via `api-adresse.data.gouv.fr` (BAN, gratuite sans clé) — `fetch()` direct hors `ApiService` pour ne jamais transmettre le JWT iziGSM à ce tiers
- [x] **Bug corrigé** : `listClients()` ne renvoyait jamais `adresse`/`code_postal`/`siret`/`tva_intracom` dans son SELECT — rouvrir un client en édition affichait les placeholders au lieu des vraies valeurs saisies (préexistant, révélé en testant cette fonctionnalité). Détail dans `bugs.md`.
- [x] `purgeClient()` RGPD (Art. 17) étendu : anonymise aussi `raison_sociale`/`siret`/`tva_intracom`
- [x] Sidebar (`app.js`) : "Clients" remonté de la section Gestion vers la section Principale, juste sous Tableau de bord
- [x] Badge "🏢 Pro" + raison sociale affichés dans la liste clients (`clients.js`)
- [x] `sw.js` `CACHE_VERSION` `v2.53`→`v2.54`
- [x] Tests `clientService.test.ts` mis à jour (mocks SQL désynchronisés par les nouvelles colonnes — 6 tests réparés), 791/793 global
- [x] Déployé en prod, validé en local puis en direct (création client Pro, édition round-trip, sélection dans le menu déroulant CLIENT d'une nouvelle prise en charge)

### C. Recherche entreprise par SIRET — **pushé et déployé le 2026-07-16** (commit `97f96b2`, rebasé en `a25c472` sur `origin/main`)
Décisions validées avec l'utilisateur (AskUserQuestion) : API `recherche-entreprises.api.gouv.fr` (gratuite sans clé, remplace l'ancienne API Sirene INSEE qui demandait une clé — un MCP data.gouv.fr n'est pas utilisable par le navigateur d'un utilisateur final en prod, seulement par moi en dev) ; déclenchement auto dès 14 chiffres valides ; pré-remplissage raison sociale + adresse complète + TVA intracom calculée depuis le SIREN.
- [x] `onSiretInput()`/`lookupSiret()` (`clients.js`) — recherche auto à 14 chiffres, utilise `matching_etablissements[0]` (pas `siege`, qui pointerait sur le siège social si le SIRET saisi est un établissement secondaire)
- [x] `computeTvaFromSiren()` — formule standard clé = (12 + 3×(SIREN mod 97)) mod 97, vérifiée sur un cas réel (SIREN 130025265 → `FR07130025265`)
- [x] `_fillIfEmpty()` — ne remplit jamais un champ déjà saisi manuellement (vérifié en test : raison sociale tapée à la main conservée, adresse/CP/ville/TVA remplis car vides)
- [x] Validé en local (`wrangler pages dev`) avec un SIRET réel (DINUM, `13002526500013`) — raison sociale, adresse, code postal, ville, TVA tous corrects
- [x] Tests 791/793 (aucun changement backend, pur frontend)
- [x] **Commité** (message `feat(clients): recherche entreprise par SIRET...`)
- [x] **Pushé le 2026-07-16** — rebase sans conflit sur `origin/main` (commit auto-intercalé `3d05bab` chore backup D1, sans lien), push `a25c472`
- [x] **Déployé le 2026-07-16** (`npm run build` + `wrangler pages deploy dist --project-name izigsm`), `repairdesk.fr/api/health` → 200 après déploiement
- [x] **Validé en prod le 2026-07-16** (Claude in Chrome, `admin@izigsm.fr`, SIRET réel DINUM `13002526500013`) : toast "Fiche entreprise trouvée et pré-remplie", raison sociale/adresse/code postal/ville/TVA (`FR07130025265`) tous corrects — round-trip complet confirmé, aucune donnée de test enregistrée (modal fermé sans "Enregistrer")

### D. Fix sécurité — isolation photos tickets — **corrigé, testé, commité, pushé et déployé le 2026-07-16** (commit `506990f`)
Bug ouvert depuis le checkpoint 21 (2026-07-15), signalé priorité à évaluer dans `bugs.md`/`recovery-prompt.md`.
- [x] `GET`/`POST /api/tickets/:id/photos` (`routes/tickets.ts`) : `getBoutiqueId(c)` (contexte Hono seul) remplacé par `getBoutiqueId(user, queryBoutiqueId)` (via `ctx(c)`), même pattern que `/photos/:photoId/url` déjà correct
- [x] Condition de garde durcie : `if (!boutiqueId || ticket.boutique_id !== boutiqueId)` (deny-by-default), au lieu de l'ancienne `if (boutiqueId && ...)` qui laissait passer quand `boutiqueId` était `undefined`
- [x] Commentaires JSDoc ajoutés expliquant le fix et son lien avec `/url`
- [x] `tsc --noEmit` : aucune nouvelle erreur liée à `tickets.ts`. Tests 791/793 (mêmes 2 échecs pré-existants `computeFin()`)
- [x] **Test d'isolation dédié en local live** (`wrangler pages dev` + D1 local) : technicien créé pour `TestBoutique2` (id 2) → `GET`/`POST /api/tickets/1/photos` (ticket de la boutique 1) → **403** (avant fix : 200, faille reproduite et confirmée) ; accès légitime (admin + `boutique_id` correct) → 200 ; `boutique_id` erroné passé par un admin → 403. Utilisateur de test supprimé après coup.
- [x] **Limite découverte, non corrigée (hors périmètre)** : `admin@izigsm.fr` a `boutique_id: null` — reçoit désormais 403 sur ces 3 endpoints photos sans `boutique_id` explicite dans l'UI (déjà le cas pour `/url` depuis le 2026-07-15, pas une régression de ce fix). Détail `bugs.md`.
- [x] **Commit + push + déploiement** (`506990f`, `wrangler pages deploy`), `repairdesk.fr/api/health` → 200 après déploiement

## Analyse comparative monatelier.net — couverture complète (2026-07-11 v3)

- [x] **FAIT** — Les 19 pages du centre d'aide `monatelier.net/aide/*` lues intégralement (v2 n'en couvrait que 9, via les liens précédent/suivant qui ratent 10 pages non reliées linéairement — sitemap complet retrouvé via le menu latéral). `docs/ANALYSE_COMPARATIVE_MONATELIER.md` v3.
  - Nouveaux gaps trouvés : SAV Constructeur Agréé (Apple/Samsung, absent à 100%), prise en charge à distance plus riche que supposé (statut EN_TRANSIT dédié, réexpédition trackée), badge "Réceptionné par" distinct du technicien assigné, import Excel (pas juste CSV) avec fichier modèle téléchargeable, tableau de bord équipe (CA/marge/délai moyen par technicien)
  - Nuance importante : QualiRépar chez monatelier est un simple bouton de remise pré-remplie par catégorie d'appareil (pas une intégration API de tracking Soumis→Validé→Remboursé comme le suggérait le marketing en v2) — le gap reste réel côté iziGSM mais l'ampleur du travail est revue à la baisse
  - Section "💡 À s'inspirer" ajoutée : 7 idées concrètes à faible coût (fichier modèle import, badge RDV→ticket, aperçu notification avant envoi, tableau CA/marge/délai par technicien, PIN switch déjà fait côté iziGSM)
  - `docs/monatelier_aide_notes.md` mis à jour avec le sitemap complet 19 pages + notes structurelles gestion d'équipe (pertinent pour le futur `populateTechniciens()`)

## Chantier prise en charge — état/sécurité/signature (démarré 2026-07-11)

Point de départ : `docs/ANALYSE_COMPARATIVE_MONATELIER.md` §1 (gaps liés à l'écran de prise en charge).

- [x] Migration `migrations/0033_ticket_prise_en_charge.sql` — colonnes `etat_appareil` (JSON), `code_deverrouillage`, `code_sim`, `signature_client`, `signature_date` sur `tickets`. **Appliquée en production.**
- [x] Backend `ticketService.ts`/`routes/tickets.ts` — champs optionnels sur create/update, exclus de `listTickets()`/`getKanban()` (uniquement dans `getTicketById()`)
- [x] Frontend `tickets.html`/`tickets.js` — nouvel onglet "État & Sécurité" (checklist + codes), signature réellement capturée et envoyée (avant : booléen seulement, dessin jamais transmis)
- [x] Affichage fiche détail (checklist + codes + image signature) et fiche imprimable existante (`printTicket()`) mise à jour pour montrer l'état constaté + la vraie signature si capturée
- [x] Tests `ticketService.test.ts` mis à jour, suite complète 704/707 (3 échecs = tests fuseau horaire déjà connus, sans lien)
- [x] Validé en local (navigateur réel, D1 local) — checklist, codes, signature dessinée à la main, persistance confirmée, absence des champs sensibles en liste
- [x] **Faille XSS corrigée le 2026-07-11** — `signature_client` validé strictement (data URL PNG/JPEG base64 uniquement) côté API ET frontend avant toute interpolation dans `<img src>`, trouvée par revue de sécurité automatique. Détail dans `bugs.md`.
- [x] **Bug bloquant création de ticket corrigé le 2026-07-11** — `client_id` jamais envoyé + 4 champs mal nommés (`marque`/`modele`/`description`/`devis_montant` → `appareil_marque`/`appareil_modele`/`description_panne`/`prix_estime`) + valeurs de priorité non alignées avec l'enum API. Validé en local sur les deux chemins (client existant / nouveau client créé à la volée). Détail complet dans `bugs.md`. **Ce chantier est maintenant réellement utilisable de bout en bout.**
- [ ] Non corrigé, hors scope (fonctionnalité à construire, pas un renommage) : assignation technicien à la création — `<select id="t-technician">` contient des noms en dur, jamais les vrais employés, `technicien_id` jamais envoyé. Nécessite un `populateTechniciens()` sur le modèle de `populateClients()`.
- [ ] 🟡 **P2** (déprioritisé le 2026-07-30, à reprendre plus tard) — Décision à prendre : multi-appareils par ticket (`appareil_id` est singulier en base aujourd'hui, colonnes `appareil_marque`/`appareil_modele`/`appareil_id` directement sur `tickets` — un seul appareil possible par ticket). Reconfirmé par la lecture de `monatelier.net/aide/prise-en-charge` (bouton "+ Ajouter un appareil"). Nécessiterait soit une vraie table `ticket_appareils` (relation 1-N), soit plusieurs sous-tickets liés à une même prise en charge — vraie décision d'architecture, pas un ajout de champ. Identifié dans l'analyse comparative §1.4, pas encore scopé.
- [ ] Décision à prendre : acompte structuré à la prise en charge (§1.6 de l'analyse) — actuellement une convention informelle en notes libres

## Migration Cloudflare — TERMINÉE le 2026-07-10

Plan complet : `docs/superpowers/plans/2026-07-09-migration-cloudflare.md` (9 tâches).
Spec : `docs/superpowers/specs/2026-07-09-migration-cloudflare-design.md`.

- [x] Task 1 : npm install + vérif tooling
- [x] Task 2 : R2 activé sur le compte Cloudflare
- [x] Task 3 : migrations D1 (déjà appliquées avant cette session — vérifié 48 tables réelles)
- [x] Task 4 : bucket R2 `izigsm-photos` + binding `PHOTOS` (commits `e1b1c58`, `6f26a51`)
- [x] Task 5 : secret `RESEND_API_KEY` posé (sous-domaine `mail.repairdesk.fr` déjà vérifié Resend)
- [x] Task 6 : build + déploiement HEAD (`885cc1e3`, commit `6f26a51`)
- [x] **Task 7 — TERMINÉE (2026-07-10)** : validation fonctionnelle sur `izigsm.pages.dev` (via API, navigateur indisponible)
  - [x] `/api/health` → v2.45.0 ✓
  - [x] `/register`, `/login` se chargent ✓
  - [x] Connexion avec `admin@izigsm.fr` / `Admin@2026!` (contournement — voir bugs.md, `/register` cassé) — `/api/auth/login` 200, JWT émis, `/api/auth/me` confirme role admin
  - [x] Créer un client + un ticket — client id `6`, ticket `TKT-2026-00006` (boutique `iziGSM Paris 11`, id 1)
  - [x] Uploader une photo sur le ticket (valide R2) — 201, `r2_key: tickets/6/photos/a04dbb1e-....jpg`, relue via `/photos/:id/view` (200, contenu identique)
  - [x] Écoute logs pendant le test (`wrangler pages deployment tail 885cc1e3-... --project-name izigsm --format json --status error`) — aucune erreur sur les 6 appels
- [x] **Task 8 — TERMINÉE (2026-07-10)** : `repairdesk.fr` attaché au projet Pages `izigsm`, ancien A record Gandi supprimé (confirmation explicite obtenue), CNAME créé manuellement (`repairdesk.fr → izigsm.pages.dev`, auto-provisioning Cloudflare bloqué), statut `active`, `/api/health` répond en prod
- [x] **Task 9 — TERMINÉE (2026-07-10)** : MX/SPF/DKIM/webmail/www re-vérifiés intacts, docs `current-state.md` + `decisions.md` clôturés

**Migration Cloudflare complète.** `repairdesk.fr` sert l'app en production, plus de dépendance Genspark.

## Dette technique découverte pendant la migration (voir bugs.md pour le détail)
- [x] `/register` cassé — **CORRIGÉ et VALIDÉ le 2026-07-10** (commits `e6b75b9`, `3129836`, déployé `8bcbb1d4`) — flow email OTP réel, testé bout-en-bout par l'utilisateur (inscription → email reçu → code vérifié → dashboard), voir bugs.md
- [x] `docs/ARCHITECTURE_MODULES.md` §2 — noms de tables obsolètes corrigés par la loop-engineering (2026-07-20, risque faible, auto-commit) : `statuts_historique`→`tickets_statuts_historique` (0004), `lignes_facture`→`lignes_document` (0006), `sessions_caisse`/`lignes_caisse`→`clotures_journalieres` (0008), `otp_codes`→`otp_tokens` (0009), `tickets_sav`→`sav_dossiers` (0019) — chaque nom vérifié contre les `CREATE TABLE` réels de `migrations/*.sql`
- [ ] 3 tests unitaires sensibles au fuseau horaire (non-bloquant)
- [ ] `escapeHtml()` manquant sur `client_prenom` dans 5 templates email (`sendTicketCree`, `sendTicketTermine`, `sendTicketLivre`, `sendSavOuvert`, `sendRelance`, `sendRelanceDevis`) — même faille corrigée sur l'email OTP, préexistante ailleurs

## Dette technique héritée (préexistante, voir bugs.md)
- [x] `tests/phoneCatalogService.test.ts` — **déjà créé** (migration Ports & Adapters, checkpoint 14, 2026-07-15) ; case obsolète réconciliée par la loop-engineering le 2026-07-23 (risque faible, docs seulement). Le fichier existe (209 lignes, 11 tests) et couvre les 5 fonctions exportées de `src/services/phoneCatalogService.ts` (`syncBrands`, `syncModelesByBrand`, `syncSelectedBrands`, `getLastSyncStatus`, `getCatalogStats`) via `fetch` mocké en échec → chemin de repli dataset statique. Vérifié vert par la loop : `npx vitest run tests/phoneCatalogService.test.ts` → 11/11. Décalage documentation/code (même classe que la case slug `92f0db8` et la réconciliation r.success 2026-07-20).
- [x] Investiguer `/robots.txt` 500 sur Genspark — **sans objet** (réconcilié loop-engineering 2026-07-23, risque faible, docs seulement) : Genspark abandonné le 2026-07-10 (migration Cloudflare terminée, « plus de dépendance Genspark »), donc le 500 spécifique à cet hébergeur n'a plus d'objet. Sur Cloudflare, `/robots.txt` renvoie **200** — servi comme asset statique (`public/robots.txt`, exclu des Pages Functions par `public/_routes.json:11`), avec une route Hono de redondance (`src/index.tsx:242`, `c.text(ROBOTS_TXT, 200, ...)` — réponse statique, aucun 500 possible). Aucun code à modifier ; décalage documentation/état (même classe que les réconciliations `92f0db8`/r.success/phoneCatalogService).
- [ ] `www.repairdesk.fr` → Error 521 (service redirection Gandi injoignable, apex OK)

## Fonctionnalité manquante — recherche entreprise à l'inscription
- [x] **FAIT le 2026-07-10** — `GET /api/public/entreprise-search` (`recherche-entreprises.api.gouv.fr`, gratuite, sans clé) : autocomplete fonctionnel sur `register.html` étape 2 + onboarding post-Google (`register.html`/`login.html`), préremplit nom/SIRET/adresse/CP/ville. `createBoutiqueWithSettings()` persiste enfin ces champs (colonnes existaient déjà en base, jamais remplies avant).

## Conformité légale — purge RGPD automatique (Art. 5.1.e)
Seul vrai gap de conformité restant identifié dans le CDC. `checkAndPurgeExpiredClients()` / `checkAndPurgeExpiredTickets()` n'existent pas — purge sur demande (Art.17) fonctionne, mais pas de purge automatique après expiration des durées légales de conservation. Voir aussi la tension avec le registre anti-recel art. 321-7 (documentée dans `bugs.md`).
- [ ] Scoper et implémenter la purge automatique (batch + 3 états base active/archive légale/destruction)

## Roadmap confirmée — Multi-sites géré (MOD-16 CDC, ex-B07)
Confirmé le 2026-07-10 : ce n'est PAS hors périmètre produit. Un client possédant plusieurs boutiques doit pouvoir avoir un dashboard consolidé (vue toutes boutiques), naviguer vers chaque site, et transférer stock/personnel entre boutiques de son groupe. Cohabite avec le modèle actuel (boutiques indépendantes par défaut, façon RepairDesk/MonAtelier) — un client peut simplement posséder plusieurs boutiques indépendantes reliées à son compte.
Chantier d'architecture, pas un ajout incrémental — le modèle actuel est strictement 1 user = 1 boutique_id (JWT). Nécessite : notion de groupe propriétaire, utilisateur multi-boutiques, mécanismes de transfert stock/personnel tracés. **À scoper en session dédiée** (conception avant code).
- [ ] Session de conception : modèle de données groupe/multi-accès, impact sur l'isolation multi-tenant actuelle (vérifiée étanche le 2026-07-10), UI dashboard consolidé

## Outils marketing pour les boutiques (2026-07-10, à revisiter)
Déjà en place : vitrine publique, catalogue services public, prise de RDV en ligne, page de suivi réparation client, emails automatiques (statut/facture/devis), relances devis. Manquant, identifié en croisant `CDC_Manus.md` §5.7/5.12/5.14 avec le code réel :
- [ ] **Programme de parrainage** — `referral_code`/`referred_by` prévus dans le modèle CRM (CDC §5.7), jamais implémentés (= item C10 gap analysis, Post-MVP)
- [ ] **Collecte d'avis clients** — sondage post-réparation automatique, jamais construit (= item C11 gap analysis, Post-MVP)
- [ ] **Email anniversaire client** — trigger prévu dans l'"Automation Engine" du CDC (§5.12), aucune trace dans le code, jamais planifié en sprint
- [ ] **Dépôt à distance / devis avec photos** — formulaire public de capture de lead sans déplacement (CDC §5.14 `/pro/:slug/depot` + `/devis`) — item N06 gap analysis, Post-MVP

Impact business (avis de l'agent, à discuter) : dépôt à distance = acquisition, parrainage + avis clients = rétention/confiance — probablement les plus proches de "killer features" chez la concurrence (RepairDesk/MonAtelier).

## Bug — boutiques créées en libre-service sans slug (vitrine/RDV inaccessibles) — CORRIGÉ le 2026-07-11 (checkbox jamais mise à jour, corrigé rétroactivement le 2026-07-16)
Constaté le 2026-07-10 en testant les liens vitrine/RDV. `createBoutiqueWithSettings()` (`authService.ts`, utilisée par `/register` et `/complete-onboarding`) ne générait jamais de `slug`, contrairement à la route admin `POST /api/boutiques` (`boutiques.ts:137`) qui avait déjà la logique d'auto-génération. Résultat : toute boutique créée via inscription libre-service (ex. SOTELI, Desk1) avait `slug: NULL` en base → sa page vitrine/RDV publique (`rdv-public.html?slug=...`) était injoignable, aucun client ne pouvait réserver.
- [x] `slugify()` extrait dans `lib/db.ts`, réutilisé par `createBoutiqueWithSettings()` (`authService.ts`) et la route admin — corrigé dans le commit `92f0db8` (2026-07-11, "feat: prise en charge (état/sécurité/signature) + fix slug + fix création ticket"), **jamais coché dans ce fichier alors que le fix était déjà en prod** — décalage documentation/code découvert et corrigé le 2026-07-16 en reprenant cet item comme "bug ouvert"
- [x] Backfill des boutiques déjà créées sans slug appliqué en prod dans le même commit (message de commit explicite : "Backfill appliqué en prod (SOTELI, Desk1)")
- [x] **Revérifié le 2026-07-16** via `GET /api/boutiques` (compte admin, prod) : les 3 boutiques ont toutes un slug valide — `iziGSM Paris 11` → `izigsm-paris-11`, `SOTELI` → `soteli`, `Desk1` → `desk1`. Aucune action de code nécessaire, seule la documentation était en retard.

## Bug — prise de RDV en ligne : aucun créneau disponible (table boutique_creneaux vide) — CORRIGÉ le 2026-07-16
Constaté le 2026-07-10 en testant `rdv-public.html`. `getDisponibilites()` (`publicService.ts:286`) lit la table `boutique_creneaux` (horaires bookables hebdomadaires par boutique) pour générer les créneaux — **cette table était vide pour toutes les boutiques, sans exception**, et **aucune UI ni route API n'existait pour la configurer** (seule la migration `0025_rdv_public.sql` la créait). Le moteur lui-même était correct : il croise déjà les créneaux template avec les vrais RDV existants (table `rendez_vous`, celle de l'agenda interne) pour exclure les créneaux occupés — booking public et agenda interne déjà connectés au niveau données.
- [x] `src/services/creneauxService.ts` (nouveau) — `listCreneaux()`, `replaceCreneaux()` (delete-then-insert du planning complet, choix volontaire plutôt qu'un diff partiel), `validateCreneaux()` (jour 1-7, format HH:MM, heure_debut < heure_fin, durée 5-480 min)
- [x] Routes `GET`/`PUT /api/boutiques/:id/creneaux` (`routes/boutiques.ts`), même pattern d'isolation que `/:id/settings` (admin/manager, non-admin restreint à sa boutique)
- [x] Nouvel onglet "Horaires RDV" dans `settings.html` — grille 7 jours, plages multiples par jour (ajout/suppression dynamique), lecture/écriture directe du DOM au submit (même pattern que les autres onglets `saveXxx()`)
- [x] 12 tests unitaires `tests/creneauxService.test.ts` (0 test existant avant, comme `phoneCatalogService.ts`) — validation pure + `listCreneaux`/`replaceCreneaux` sur `mockDatabase`
- [x] **Bug annexe découvert et corrigé au passage** : `settings.html` entier était cassé depuis la migration ApiService→apiGet (`r.success`/`r.data` au lieu de `r.data.success`/`r.data.data`) — détail complet dans `bugs.md`, impacte les 5 onglets existants en plus du nouveau
- [x] **Validé en local live** (`wrangler pages dev`, compte manager réel boutique 2) : cycle complet API (GET vide→PUT 2 plages→GET confirme) + `getDisponibilites()` publique confirme 14 créneaux générés pour un lundi avec 2 plages (09h-12h + 14h-18h/30min) — la chaîne données→moteur→UI est bout-en-bout fonctionnelle ; validations 422 (heures invalides, jour hors 1-7) et isolation cross-boutique (403) confirmées ; round-trip complet dans le navigateur (ajout plage + "✅ Planning enregistré")
- [ ] Vérifier besoin exprimé par l'utilisateur : affichage agenda (RDV en cours + disponibilités) directement sur le dashboard technicien (au-delà de la page `/agenda` dédiée déjà existante) — à clarifier en session dédiée, hors périmètre de ce fix

## Bug majeur — emails transactionnels jamais envoyés — CORRIGÉ et VALIDÉ le 2026-07-10
- [x] `waitUntil()` ajouté sur les 5 triggers fire-and-forget (tickets créé/terminé/livré/archivage auto, SAV ouvert, devis envoyé)
- [x] Fallback `RESEND_API_KEY` globale quand la boutique n'a pas sa propre clé (expéditeur forcé `mail.repairdesk.fr`)
- [x] `FRONTEND_URL=https://repairdesk.fr` ajoutée (`wrangler.jsonc`) — les liens emails pointaient vers `localhost:3000` en prod
- [x] Validé bout-en-bout : ticket `TKT-2026-00009`, email reçu par `telnet@bbox.fr`, lien de suivi correct — commit `2968bfa`
- Détail complet dans `bugs.md`. Dette restante notée là-bas : `/factures/:id/emettre` n'envoie toujours aucun email (jamais implémenté, GAP_ANALYSIS_ENRICHI.md corrigé en conséquence).

## Analyse comparative — monatelier.net vs repairdesk.fr (demandé 2026-07-10)
- [x] **FAIT le 2026-07-11 (v2)** — Analyse comparative complète : `docs/ANALYSE_COMPARATIVE_MONATELIER.md`. v1 basée sur du marketing seul (pages `/aide/*` = SPA inaccessibles au fetch simple) ; v2 relit `/aide/*` intégralement via navigateur (Claude in Chrome) — 9 pages, dont `/aide/premiers-pas` (répartition officielle Solo/Pro, source la plus fiable trouvée). Chaque gap recoupé avec le code iziGSM (`Grep src/`), pas seulement avec `GAP_ANALYSIS_ENRICHI.md`.
  - Gaps prioritaires liés au chantier prise en charge en cours : signature électronique bon de dépôt (dès plan Solo monatelier), codes de sécurité appareil (PIN/schéma déverrouillage — absent à 100% côté iziGSM), état des lieux structuré (checklist rayures/dégâts — absent, iziGSM n'a que des notes libres), multi-appareils par ticket (`appareil_id` est singulier en base, à corriger si retenu), acompte structuré (actuellement une convention informelle en notes libres, pas un champ dédié)
  - Autres gaps confirmés : signature eIDAS devis (`G08`, déjà connu), QualiRépar (absent à 100%, jamais scopé), TVA sur la marge pour le rachat/reconditionné (nouveau — vrai sujet de conformité fiscale, à vérifier sérieusement), SMS transactionnels (`L10`), Retours client/RMA fournisseurs (`H07`/`H08`), parrainage (`C10`), export FEC (`F11`), éditeur de templates email/SMS, widget anniversaires
  - **Corrections vs v1** : vente directe en caisse et remises par ligne sont en fait déjà implémentées côté iziGSM (`caisseService.ts`, `factureService.ts` `remise_pct`) — v1 les avait citées comme gaps par erreur ; inventaire temps réel retiré (la doc officielle monatelier ne décrit qu'un dashboard, pas un comptage physique) ; logo boutique sur documents probablement déjà en place (`boutiques.logo_url` existe et est utilisé)
  - Parité ou avantage iziGSM confirmé : Agenda/RDV (iziGSM en avance — booking en ligne déjà actif), livre de police 321-7, SAV garanties/tickets, à-commander/CUMP, vitrine publique, rapports/KPIs, caisse NF525, granularité des statuts ticket (9 statuts iziGSM vs 7 colonnes monatelier), avoirs & bons d'achat

## Rebranding — retirer "Mon Atelier" / "monatelier", remplacer par "MyDesk" (demandé 2026-07-10)
"Mon Atelier" est utilisé comme nom de boutique par défaut/placeholder à plusieurs endroits du code — à remplacer par "MyDesk" pour ne pas rappeler la marque du concurrent monatelier.net. Occurrences trouvées (recherche `mon atelier|monatelier`, insensible à la casse) :
- [x] `public/static/js/app.js:27,385,386` — fallback `session.company`/`user.boutique_name` dans le wrapper ApiService partagé (impacte tout le dashboard) — commit `283c8c5`, mergé sur `main` le 2026-07-24 (loop-engineering, réimplémenté proprement sur branche fraîche depuis `main` à jour, l'ancienne branche `loop/rebrand-app-js-mydesk` étant stale de 26 commits)
- [x] `public/static/js/register.js:230,231` — fallback session après inscription email/OTP — commit `5506b73`, mergé sur `main` le 2026-07-24 (loop-engineering, gate Playwright désormais exécutable sur Windows depuis `d7c5ed1`)
- [x] `public/login.html:81,156,157,267,268` — placeholder input onboarding Google + fallback session (×2 occurrences : handleGoogleCredential et submitOnboarding) — commit `600ffa6`, mergé sur `main` le 2026-07-24 (loop-engineering, réimplémenté sur branche fraîche depuis `main` à jour, l'ancienne branche `loop/rebrand-login-html-mydesk` étant stale de 15 commits/gate Playwright pré-`d7c5ed1`)
- [x] `public/register.html:158,201,326,447,448` — placeholder `company_name`, lien "🇧🇪 Mon atelier est en Belgique" (formulation générique, à reformuler aussi), placeholder onboarding Google, fallback session — commit `4b5f195`, mergé sur `main` le 2026-07-24 (loop-engineering, lien reformulé en "Mon entreprise est en Belgique" par cohérence avec la terminologie déjà utilisée ailleurs dans le fichier — "Nom de l'entreprise", "Rechercher mon entreprise")
- [x] `src/routes/auth.ts:652` — exemple dans un commentaire JSDoc (`workshopName: "Mon Atelier"`) → `"MyDesk"` — CORRIGÉ le 2026-07-30, commit `1898da7`
- Vérifier aussi les autres pages internes (`dashboard.html`, `settings.html`, etc.) non auditées ici — recherche limitée à `src/` et `public/` en surface

## Page de suivi ticket — étape "Accord" avec double validation boutique→client — IMPLÉMENTÉE le 2026-07-16 (spécifié 2026-07-10)
La timeline "Progression" existe déjà (`suivi.html:93-94`, `renderTimeline()` L276-303) avec une étape `attente_accord` / label "Accord" / icône `fa-handshake` (`STEPS`, `suivi.html:151`) — mais son état est aujourd'hui purement dérivé du statut linéaire du ticket (fait/actif/à venir), sans notion d'approbation client réelle.

**Comportement demandé** : quand la boutique valide un diagnostic/devis (passe le ticket en `attente_accord`), un lien d'approbation est envoyé au client. Dès que le client clique et accepte, l'étape passe au vert (preuve d'acceptation). États chronologiques de l'étape "Accord" :
- **Gris** : ticket pas encore arrivé à cette étape
- **Orange** : boutique a validé / lien envoyé, en attente de réponse client
- **Vert** : client a cliqué et accepté

**Décisions de conception validées avec l'utilisateur (2026-07-10)** :
1. **Email d'abord, SMS bloqué** : le lien part par email (Resend, même mécanisme que le reste — déjà fiable depuis le fix du jour). Le SMS reste explicitement hors scope tant qu'un fournisseur SMS (Twilio ou autre) n'est pas choisi — c'était Post-MVP partout ailleurs dans le projet, pas de raison de le sortir du lot ici sans décision dédiée.
2. **Réutiliser le flow devis existant**, ne pas dupliquer un système de token : `devis.ticket_id` (FK optionnelle, `migrations/0006_facturation.sql:10`) et `devis.statut` (`envoye`/`accepte`/`refuse`) couvrent déjà exactement ce besoin. `devis-public.html` + `POST /api/public/devis/:token/repondre` gèrent déjà la page cliquable + l'action d'acceptation.

**Implémenté le 2026-07-16** :
- [x] `renderTimeline()` (`suivi.html`) calcule l'état de l'étape "Accord" à partir de `devis_statut` (nouveau paramètre) : `envoye`→orange (`.step-accord-pending`, pulse), `accepte`→vert (même si le ticket est encore littéralement au statut `attente_accord`, fenêtre entre acceptation et changement de statut par l'équipe), sinon comportement générique inchangé (gris/bleu selon position dans `STEPS`)
- [x] `getTicketPublicByToken()`/`getTicketById()` (`publicService.ts`/`ticketService.ts`) exposent `devis_statut` — `LEFT JOIN devis d ON d.id = (SELECT id FROM devis WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1)` (le plus récent, un ticket peut avoir eu plusieurs devis dans le temps)
- [x] **Bug annexe trouvé en validant** : la route `GET /api/public/ticket/:token` (`routes/public.ts`) filtre explicitement les champs renvoyés au client — `devis_statut` était bien résolu par le service mais jamais copié dans la réponse JSON. Corrigé dans le même commit.
- [x] Envoi du devis (`POST /devis/:id/envoyer`, déjà fonctionnel) confirmé comme déclencheur naturel de l'état orange — aucun changement nécessaire côté envoi.
- [x] **Override "client injoignable"** (demandé le 2026-07-16, pas dans la spec initiale) : `POST /api/devis/:id/accord-manuel` (nouveau, `routes/facturation.ts`), autorisé `admin`/`manager`/`technicien` — délibérément plus large que `PUT /devis/:id/statut` (admin/manager seulement) mais **volontairement étroit** (transition `envoye→accepte` uniquement, pas un alias du endpoint générique) pour ne pas élargir tout le pouvoir de gestion des devis au rôle technicien. Tracé (`ACCORD_MANUEL_STAFF` en plus du log générique `updateStatutDevis()`), sans délai imposé (décision explicite 2026-07-16 : le jugement "client injoignable" est laissé à l'équipe).
- [x] Bouton "Valider l'accord manuellement (client injoignable)" dans la fiche détail ticket (`tickets.js`, nouveau bloc "Accord devis"), visible uniquement si `devis_statut === 'envoye'`.
- [ ] SMS : décision fournisseur à prendre séparément (Twilio le plus documenté dans le projet) avant d'ajouter ce canal — toujours hors scope
- [ ] Nuance visuelle mineure non traitée : le badge de statut principal (`statut_label`, dérivé de `t.statut` seul) peut afficher "Accord en attente" alors que la timeline montre déjà l'étape verte (devis accepté, ticket pas encore avancé manuellement) — pas une régression, juste deux sources d'info distinctes, pourrait mériter un ajustement de libellé si ça prête à confusion en usage réel

**Validé en local live (2026-07-16)** : cycle complet — devis créé/envoyé → timeline `suivi.html` affiche l'étape "Accord" en orange pulsant (capture confirmée) → override manuel depuis la fiche ticket (compte manager réel) → badge passe à "✅ Accord client obtenu", bouton disparaît → timeline publique repasse en vert. Isolation rôle vérifiée : technicien bloqué (403) sur `PUT /devis/:id/statut` (endpoint générique) mais autorisé sur `POST /devis/:id/accord-manuel` ; 409 confirmé en re-tentant l'override sur un devis déjà accepté. Entrée `audit_logs` `ACCORD_MANUEL_STAFF` confirmée en base. Tests 803/805 (12 tests SQL fixtures mis à jour dans `ticketService.test.ts`/`publicService.test.ts` suite au nouveau LEFT JOIN, mêmes 2 échecs pré-existants `computeFin()`).

## Chantier acompte structuré — sous-projet (A) IMPLÉMENTÉ le 2026-07-17, DÉPLOYÉ le 2026-07-18 (subagent-driven-development, 10 tâches)
Design approuvé le 2026-07-16 (spec `docs/superpowers/specs/2026-07-16-acompte-structure-design.md`, commit `ae094a7`), plan écrit le même jour (`docs/superpowers/plans/2026-07-16-acompte-structure.md`, commit `15bdea8`, 10 tâches TDD), **implémenté et revu de bout en bout le 2026-07-17** — ledger complet des 10 tâches + revue finale dans `.superpowers/sdd/progress.md`.

**Résumé fonctionnel** : bouton "Demander un acompte" sur ticket et devis (admin/manager), montant libre facturé immédiatement comme une vraie facture verrouillée (`type_facture='acompte'`, séquence `FAC-` partagée, aucune extension NF525). Déduite automatiquement à la facture finale (`convertirDevis()`, ligne négative "Acompte déjà facturé"). Annulation d'un ticket avec acompte perçu → avoir généré automatiquement (`date_expiration` +60 jours, réellement persistée). Affichage : badge staff (tickets.js/devis.js) + "Acompte versé/Solde restant" sur la page de suivi client publique (`suivi.html`).

- [x] Migration `0036_acompte_structure.sql` (`factures.type_facture`, `avoirs.date_expiration`)
- [x] `createFactureAcompte()` (`factureService.ts`) — crée+émet+verrouille, rejette les doublons (409)
- [x] `createAvoir()` accepte `date_expiration` optionnel
- [x] `getTicketById()`/`getDevis()` exposent `facture_acompte_*` (id/numéro/montant/HT/taux TVA réel)
- [x] `POST /api/tickets/:id/acompte` + `POST /api/devis/:id/acompte` (admin/manager, isolation boutique testée en live)
- [x] `convertirDevis()` déduit l'acompte de la facture finale (ligne négative + totaux réduits)
- [x] UI `tickets.js` (bouton, badge, annulation→avoir) + UI `devis.js` (dupliquée, `tickets.js` non chargé sur `devis.html`) + UI `suivi.html` (acompte versé/solde restant)
- [x] Revue finale de branche (modèle opus) : "With fixes" → les 2 findings Important traités (voir ci-dessous)

**2 findings de la revue finale traités** :
- Validation `montant_ht` durcie (typeof/isNaN, pas juste `<= 0`) sur les 2 routes + `createFactureAcompte()` — une chaîne non numérique produisait des totaux NaN sur une facture verrouillée NF525.
- `changeStatus()` (annulation avec avoir) utilisait un taux TVA fixe 20% + approximation `montant/1.2` — corrigé pour lire le HT/taux réels de l'acompte (`facture_acompte_ht`/`facture_acompte_tva_taux`, exposés par `getTicketById()`), même précaution que le fix `convertirDevis()` (éviter un taux fantôme dans `getRapportComptable()`, le rapport destiné à l'expert-comptable).

**Confirmé comme périmètre MVP intentionnel (pas un gap)** : `avoirs.date_expiration` est persistée mais aucune logique n'applique/consomme automatiquement l'expiration (cohérent avec le reste du projet — aucun type d'avoir n'a de logique de consommation automatique, la purge RGPD automatique est déjà un chantier séparé identifié ci-dessous).

**Dette mineure non bloquante, à traiter si besoin réel se présente** :
- [ ] Check "un seul acompte par dossier" (`createFactureAcompte()`) non atomique (read-then-insert) — index UNIQUE partiel disponible si une vraie collision survient un jour (`ON factures(ticket_id) WHERE type_facture='acompte'`, idem `devis_id`)
- [ ] `devis.js` `demanderAcompte()` ne rafraîchit pas automatiquement la fiche après succès (contrairement à `tickets.js`) — rechargement manuel nécessaire pour voir le badge
- [ ] `suivi.html` calcule le solde depuis `prix_final`/`prix_estime` du ticket, pas depuis les totaux devis/facture faisant autorité — écart possible après conversion
- [ ] Aucun test d'intégration bout-en-bout create→convert→deduct→avoir (couverture actuelle = tests unitaires isolés par fonction, DB mockée)
- [ ] `LEFT JOIN factures` dans `getTicketPublicByToken()` sans garde d'unicité si un ticket avait un jour 2+ acomptes (verbatim du plan)

**Non déployé au moment de cette mise à jour** — build+déploiement en attente de décision utilisateur.

- [ ] **Sous-projet (B) — paiement en ligne Stripe** : toujours hors scope, nécessite le choix d'un prestataire avant tout cadrage

## Chantier Ports & Adapters + assignation technicien (2026-07-12)

Spec : `docs/superpowers/specs/2026-07-12-architecture-ports-adapters-design.md`. Plan : `docs/superpowers/plans/2026-07-12-ports-adapters-technicien-assignment.md`. Objectif long terme : sortir de Cloudflare (VPS + Postgres), sans changer le CDC fonctionnel.

- [x] Port `Database` (`src/ports/database.ts`) + adaptateur D1 (`src/adapters/cloudflare/d1Database.ts`) + mock de test (`tests/helpers/mockDatabase.ts`)
- [x] Premier service migré : `userService.listUsers()` (candidat plus sûr que `personnelService.ts` cité en exemple dans le spec — zéro test préexistant à risquer)
- [x] Injection du port dans le contexte Hono (`index.tsx`) + branchement `routes/users.ts`
- [x] `populateTechniciens()` — remplace les 3 noms en dur du select technicien par les vrais utilisateurs (`GET /api/users`), `saveTicket()` envoie `technicien_id` numérique
- [x] **Corrigé le 2026-07-12** (revue finale de branche) : `technicien_id` validé contre `boutique_id` du ticket (isolation multi-tenant) — détail dans `bugs.md`
- [x] **Corrigé le 2026-07-12** : `editTicket()` présélectionne à nouveau le technicien assigné — détail dans `bugs.md`
- [ ] Migrer les 19 autres services vers le port `Database` (rollout service par service) — ordre établi le 2026-07-12 (simple → complexe, `sirenService.ts` hors périmètre car ne touche jamais D1) :
  - [x] **photosService.ts** — `getTicketForPhoto`/`listPhotos`/`getPhotoById` migrées (lecture pure, aucun `auditLog`). `uploadPhoto`/`deletePhoto` restent sur `D1Database` (dépendent de `auditLog()`, non porté). Tests → `mockDatabase`, 18/18 ✅. Câblage `routes/tickets.ts` : `dbPort` (port, `c.get('db')`) pour les 3 fonctions migrées, `db` brut (`c.env.DB`) inchangé pour upload/delete. **Validé en local live** (2026-07-12) : `wrangler d1 migrations apply --local` + `npm run dev`, flux complet upload→liste→vue binaire→suppression sur ticket réel (D1 + R2 locaux), 6/6 étapes ✅, aucune donnée de test résiduelle.
  - [x] **publicService.ts** — les 8 fonctions migrées intégralement (aucune ne dépend d'`auditLog`), y compris `createRdvPublic` (`INSERT...RETURNING` via `db.get()`, fonctionne à l'identique sur D1 via `.first()`). Tests → `mockDatabase`, 30/30 ✅. Câblage `routes/public.ts` : `c.get('db')` partout sauf `devisService`/`sirenService` (non migrés, inchangés). **Validé en local live** (2026-07-12) : 5 endpoints publics testés sans auth (ticket, boutique, catalogue, disponibilités, création RDV), 5/5 ✅, données de test nettoyées après coup.
  - [x] **boutiqueService.ts** — les 8 fonctions migrées intégralement (aucune ne dépend d'`auditLog`), y compris `createBoutique` (2 opérations séquentielles : `INSERT boutiques RETURNING id` via `db.get()` + `INSERT boutique_settings` via `db.run()`). Tests → `mockDatabase` (ajout de `__setNotFound` au helper, absent jusqu'ici), 24/24 ✅. Câblage `routes/boutiques.ts` : `c.get('db')` partout sauf `nf525.ts` (non migré, inchangé). **Validé en local live** (2026-07-12) : liste, détail, stats (4 KPIs), update boutique + settings (idempotents), création (vérifie l'init des settings), 6/6 ✅. Nettoyage : `DELETE` via `wrangler d1 execute` bloqué par un bug CLI sans rapport (`no such table: main.modeles_appareils_old`, erreur wrangler locale, pas un problème de schéma réel) — contourné par accès direct au fichier SQLite local (`.wrangler/state/v3/d1/.../*.sqlite`).
  - [x] **rachatService.ts** — `listRachats`/`getRachat`/`exportLivrePolice` migrées (lecture pure). `createRachat`/`updateStatutRachat` restent sur `D1Database` (dépendent d'`auditLog`/`nextNumero`, non migrés). **0 test existant avant** → 17 tests écrits (`tests/rachatService.test.ts`), 17/17 ✅. **Bug découvert et corrigé en validation live** : `GET /api/rachats/export` répondait 404 depuis toujours (collision de route avec `/:id`, sans lien avec la migration) — détail dans `bugs.md`.
## Fuseau horaire France (Europe/Paris) — `lib/timezone.ts` (créé le 2026-07-12)

Bug découvert en validant `personnelService.ts` en local (machine UTC+2) : `new Date("YYYY-MM-DD HH:MM:SS")` (format SQLite `CURRENT_TIMESTAMP`, sans suffixe de fuseau) est interprété comme heure LOCALE du runtime plutôt qu'UTC — gonfle les durées calculées de l'écart local/UTC. Sans impact en prod (Cloudflare Workers tourne nativement en UTC), mais l'utilisateur a demandé une correction structurelle : `lib/timezone.ts` créé avec `parseUtcTimestamp()` (parse correct en UTC) et `todayParis()` (jour du "aujourd'hui" en heure française, DST auto via Intl/ICU — pas de table codée en dur).

**Décision utilisateur (2026-07-12)** : l'horodatage correct n'est pas qu'un sujet RH/pointage — il est important dans la relation client (tickets, devis, factures, garanties). Documenter maintenant, corriger service par service au moment de leur migration Ports & Adapters plutôt qu'un rewrite groupé immédiat (zones à enjeu légal NF525/garanties, chacune mérite sa propre validation).

- [x] `lib/timezone.ts` créé (`parseUtcTimestamp`, `todayParis`)
- [x] Appliqué à `personnelService.ts` (`listEmployes`, `pointagesAujourdhui`) — `DATE('now')` → paramètre lié `todayParis()`, `new Date(...)` brut → `parseUtcTimestamp(...)`
- [ ] **À appliquer lors de la migration de `ticketService.ts`** (#14 dans l'ordre) : `jours_anciennete` (`julianday('now')`), comparaison `date_promesse` vs `new Date()` pour détecter un ticket en retard (`ticketService.ts:308,315,332,351,737`)
- [ ] **À appliquer lors de la migration de `garantiesService.ts`** (#18) : dates de fin de garantie, `jours_restants`, alertes d'expiration à 7 jours (`garantiesService.ts:125,179,282,301,339,571,689`) — directement visible au client (page suivi, notifications)
- [x] **Vérifié lors de la migration de `factureService.ts`** (2026-07-12) : les horodatages `date_transaction`/`issued_at` (`factureService.ts:224,242,414`) sont des `new Date().toISOString()` — capture d'instant UTC déjà correcte et non ambiguë (contrairement à un `DATE('now')` SQL ou un `new Date("YYYY-MM-DD HH:MM:SS")` sans suffixe). Rien à corriger : ces lignes ne présentent pas le bug de fuseau horaire (parsing ambigu / borne "aujourd'hui" UTC vs France) traité dans `personnelService.ts`/`caisseService.ts`.
- [ ] `routes/facturation.ts:162` — affichage de la date de validité du devis au client (`toLocaleDateString('fr-FR')`), à vérifier/harmoniser avec `todayParis()`/Europe/Paris au moment du même chantier
- [x] `agendaService.ts` (#19) et `statsService.ts` (#20) traités le 2026-07-15 — `todayParis()`/`currentMonthParis()` appliqués, voir entrées détaillées ci-dessous

## Ports & Adapters — services migrés

- [x] **personnelService.ts** — 8/9 fonctions migrées (`listEmployes`, `getEmploye`, `updateEmploye`, `desactiverEmploye`, `pointer`, `pointagesAujourdhui`, `rapportPointage`, `statutsTempsReel`). `createEmploye` reste sur `D1Database` (dépend d'`auditLog`). Tests → `mockDatabase` (36/36 ✅, `createEmploye` reste sur `mockD1`). Câblage `routes/personnel.ts` : `c.get('db')` partout sauf `createEmploye`. **Validé en local live** : 8/8 endpoints ✅ (liste, détail, update, pointage absent→en_poste, heures du jour, rapport, statuts temps réel, désactivation). Observation sans gravité : `heures_travaillees` gonflé de 2h sur cette machine (UTC+2 local) — même bug de fuseau déjà documenté (`agendaService`/`statsService`), sans impact prod (Cloudflare Workers tourne en UTC), non retraité.
  - [x] **caisseService.ts** — 7/8 fonctions migrées intégralement (aucune ne dépend d'`auditLog`). `createVente` reste sur `D1Database` (dépend de `nextNumero()`) — duplique `getHashPrecedent` en interne (même pattern que `photosService.ts`). `getCaisseJournal`/`cloturerJournee`/`getKpisCaisse` : `DATE('now')`/`strftime(...,'now')` (UTC) remplacés par `todayParis()`/`currentMonthParis()` — critique ici, une clôture NF525 doit suivre la journée commerciale française. Requête dupliquée dead-code retirée dans `getKpisCaisse` (5ème promesse jamais lue). Tests : 14→31 (17 ajoutés pour `createVente`/`enregistrerEncaissement`/`getCaisseJournal`/`cloturerJournee`, non couverts avant). **Bug critique découvert et corrigé** : vente POS d'un produit en stock cassée à 100% + facture orpheline sans entrée NF525 (détail complet dans `bugs.md`). Validé en local live : flux complet vente→KPIs→journal→clôture→intégrité chaîne, 6/6 ✅.
  - [x] **factureService.ts** — 6/9 fonctions migrées (`listFactures`, `getFacture`, `listAvoirs`, `getAvoir`, `getDevisPourNf525`, `updateFactureHash`). `ajouterPaiement`/`emettreFacture`/`createAvoir` restent sur `D1Database` (dépendent d'`auditLog`/`enregistrerTransaction`/`nextNumero`/`db.batch()` — batch absent du port `Database`). **Fuseau horaire vérifié, aucun fix nécessaire** : les `new Date().toISOString()` (`factureService.ts:224,242,414`) sont des captures d'instant déjà correctes (UTC-Z explicite), pas des comparaisons de bornes "aujourd'hui" comme dans `caisseService.ts`/`personnelService.ts` — voir note ci-dessus. Tests restructurés (41/41 ✅, `mockDatabase` pour les 6 migrées / `mockD1` pour les 3 restantes). **Validé en local live** : devis créé → converti en facture (`getDevisPourNf525`+`updateFactureHash`) → émise → avoir créé → `listFactures`/`getFacture`/`listAvoirs`/`getAvoir` testés avec données réelles, 6/6 ✅.
  - [x] **devisService.ts** (2026-07-13) — 6/10 fonctions migrées (`listDevis`, `getDevis`, `getDevisByToken`, `getStatsDevis`, `expireDevisPerimes`, `saveSignatureDevis`, toutes lecture pure ou UPDATE simple sans `RETURNING`). `createDevis`/`updateDevis`/`updateStatutDevis`/`convertirDevis` restent sur `D1Database` (dépendent de `nextNumero()`, `upsertLignes()` via `db.batch()`, et/ou `auditLog()`). Tests scindés `mockDatabase`/`mockD1` par fonction (58/58 ✅). Câblage `routes/facturation.ts` (`listDevis`/`getStatsDevis`/`expireDevisPerimes`/`getDevis` ×2 → `c.get('db')`) et `routes/public.ts` (`getDevisByToken` ×2, `saveSignatureDevis` → `c.get('db')`). **Validé en local live** : cycle complet devis (créer→lister→consulter→stats→modifier→envoyer→consultation publique par token→signature+acceptation publique→expire→conversion en facture), 10/10 étapes ✅, données de test nettoyées après coup (devis, facture, lignes_document, audit_logs).
  - [x] **authService.ts** (2026-07-14) — 13/13 fonctions migrées intégralement (aucune ne dépend d'`auditLog`/`nextNumero`/`batch`). `createBoutiqueWithSettings` (2 opérations séquentielles INSERT boutiques RETURNING id + INSERT boutique_settings) et `attachBoutiqueToUser` (idempotence `boutique_id IS NULL`) migrées sans changement de comportement. Tests → `mockDatabase`, 25/25 ✅. Câblage `routes/auth.ts` : `c.get('db')` pour les 13 fonctions authService, `c.env.DB` inchangé pour `auditLog`/`sendEmail` (non migrés). **Validé en local live** : login, /me, refresh, register→verify-otp (avec et sans `workshopName`), resend-otp, complete-onboarding (+ rejet idempotent au 2e appel), reset-password-request→reset-password (mot de passe admin restauré après test), logout — 12/13 fonctions couvertes (Google OAuth exclu, nécessite un vrai token externe). Données de test (2 users, 2 boutiques) nettoyées après coup.
  - [x] **stockService.ts** (2026-07-14) — 6/10 fonctions migrées (`listProduits`, `getProduitById`, `enregistrerMouvement`, `listCategories`, `createCategorie`, `getKpisStock`, toutes sans dépendance `auditLog`). `createProduit`/`updateProduit`/`deleteProduit`/`importCatalogueCsv` restent sur `D1Database` (dépendent d'`auditLog()`). Tests scindés `mockDatabase`/`mockD1` par fonction (56/56 ✅). Câblage `routes/stocks.ts` : helper `ctx()` étendu avec `dbPort` (port, `c.get('db')`) en plus de `db` (D1 brut, `c.env.DB`) — 6 endpoints sur `dbPort`, 4 sur `db`. **Validé en local live** : create/list catégorie, create/get/list produit, KPIs, mouvement stock (sortie), update/delete produit, import CSV — 10/10 fonctions couvertes, données de test nettoyées.
  - [x] **clientService.ts** (2026-07-14) — 11/12 fonctions migrées (toutes sauf `purgeClient`, qui dépend d'`auditLog`). `exportClientRgpd()` migrée (appelle `getClientById()` en interne, cohérent). Câblage `routes/clients.ts` (pattern `dbPort`/`db` — `db` conservé pour les 4 `auditLog()` appelés directement dans la route), `routes/sav.ts` (nouveau `Variables.db`), `routes/tickets.ts` (`dbPort` ajouté au handler `POST /`). Tests scindés `mockDatabase`/`mockD1` (48/48 ✅). **2 bugs RGPD critiques découverts et corrigés en validation live** (`exportClientRgpd`/`purgeClient` cassés depuis toujours — table `appareils_client` inexistante + colonne `imei` inexistante sur `tickets`) — détail complet dans `bugs.md`. **Validé en local live** : CRUD client, appareils, historique CRM, import CSV, export RGPD (Art. 15), purge RGPD (Art. 17), hooks email `tickets.ts`/`sav.ts` (`getClientEmailPrenom`) — 11/12 fonctions couvertes (Google OAuth non applicable ici), données de test nettoyées.
  - [x] **fournisseursService.ts** (2026-07-14) — 6/12 fonctions migrées (`listFournisseurs`, `getFournisseur`, `listBonsCommande`, `getBonCommande`, `getKpisFournisseurs`, `getProduitsACommander`). `createFournisseur`/`updateFournisseur`/`deleteFournisseur`/`createBonCommande`/`updateStatutBonCommande`/`receptionnerBonCommande` restent sur `D1Database` (dépendent d'`auditLog`). Câblage `routes/fournisseurs.ts` : `Variables.db` + `c.get('db')` ajoutés (le fichier n'avait aucun helper `ctx()`/pattern `dbPort` avant cette migration), 6 endpoints migrés / 6 inchangés. Tests scindés `mockDatabase`/`mockD1` par describe-block (65/65 ✅). Bonus : 5 erreurs TypeScript préexistantes corrigées en passant (casts non-sûrs `as Fournisseur`/`as BonCommande`/`as LigneBonCommande[]` remplacés par des génériques `db.get<T>`/`db.all<T>` correctement typés). **Validé en local live** : CRUD fournisseur, CRUD bon de commande, cycle complet réception (CUMP recalculé stock 5→8, `prix_achat_cump` mis à jour, statut→`received`), KPIs, vue "à commander" — 12/12 fonctions couvertes, données de test nettoyées.
  - [x] **servicesService.ts** (2026-07-15) — 8/22 fonctions migrées (`listCategories`, `listServices`, `getService`, `getCatalogueArbre`, `listMarques`, `listModeles`, `getServicesByModele`, `getModeleWithServices` — toutes lecture pure). Les 14 fonctions d'écriture restent sur `D1Database` (chacune appelle `auditLog()` directement, aucune exception). Câblage `routes/services.ts` : `Variables.db` ajouté, `c.get('db')` pour les 8 fonctions migrées, `c.env.DB` inchangé pour les 14 autres. Tests scindés `mockDatabase`/`mockD1` (38/38 ✅, dont 7 nouveaux tests pour des fonctions jusque-là non couvertes : `listServices`, `getService`, `getCatalogueArbre`, `createService`, `updateService`, `deleteService`, `updateCategorie`). Bonus : 5 erreurs TypeScript préexistantes corrigées en passant (casts `as T` non-sûrs → génériques `db.all<T>`/`db.get<T>`). **Bug préexistant découvert et corrigé en validation live** (Sprint 2.38, sans lien avec la migration) : `GET /api/services/marques`/`GET /api/services/modeles` étaient inaccessibles depuis leur création — collision de route avec `/services/:id` déclarée avant elles. Détail complet dans `bugs.md`. **Validé en local live** : cycle complet catégorie→service→catalogue arbre→marque→modèle→liaison service-modèle→dissociation, 12/14 étapes ✅ (liaison INSERT bloquée par un artefact CLI wrangler local déjà documenté le 2026-07-12, sans lien avec le code), données de test nettoyées (soft delete).
  - [x] **ticketService.ts** (2026-07-15) — 6/11 fonctions migrées (`listTickets`, `getKanban`, `getTicketById`, `getTicketBoutiqueId`, `getTicketAvecClient` — lecture pure — + `checkAndArchiveTickets`, écriture sans dépendance `auditLog`/`nextNumero`, migrée aussi selon la règle établie). `createTicket`/`updateTicket`/`updateStatutTicket`/`deleteTicket`/`archiveTicket` restent sur `D1Database` (dépendent d'`auditLog()`/`nextNumero()`). Bonus sécurité en migrant `checkAndArchiveTickets` : l'ancien SQL interpolait `boutique_id = ${boutiqueId}` directement dans la chaîne (pas de `?`) — remplacé par un paramètre lié. `lib/timezone.ts` appliqué à `getKanban()` : `date_promesse` (format SQLite sans suffixe de fuseau) passait par `new Date(...)` brut pour le calcul `en_retard` → `parseUtcTimestamp()`, vérifié empiriquement sans régression sur les dates courtes ("YYYY-MM-DD"). `jours_anciennete`/fenêtre 7 jours (`julianday('now')`, `datetime('now', ...)`) laissés tels quels : comparaison UTC↔UTC pure côté SQLite, aucune ambiguïté de fuseau (contrairement à `new Date()` côté JS). Câblage `routes/tickets.ts` : `dbPort` (déjà présent dans `ctx()` depuis Sprint 2.36) utilisé pour les 6 fonctions migrées. Tests scindés `mockDatabase`/`mockD1` (45/45 ✅, dont 3 nouveaux tests : `en_retard` avec date_promesse dépassée, `checkAndArchiveTickets` scopé/non scopé). **Validé en local live** : liste, kanban, cycle complet création→diagnostic→réparation→terminé (hook garantie+email via fonctions migrées)→livré→archivage→suppression, 6/6 ✅, données de test nettoyées.
  - [x] **reconditionnementService.ts** (2026-07-15) — 12/13 fonctions migrées (toutes sauf `createOrdre`, qui dépend de `nextNumero()`). Aucune fonction du fichier n'appelle `auditLog()`. `genererCodeUnique()` (helper privé de `createBonAchat`) migrée aussi, param `boutiqueId` mort retiré (codes bons d'achat globaux, jamais utilisé dans le SQL). Câblage `routes/reconditionnement.ts` : `Variables.db` + `dbPort` ajoutés (le fichier n'avait aucun pattern port avant cette migration, 2 routers `reconditionnement`/`bonsAchat`), 12 endpoints migrés / 1 inchangé (`POST /reconditionnement`). Tests scindés `mockDatabase`/`mockD1` par describe-block (50/50 ✅, `createOrdre` reste seul sur `mockD1`). **Validé en local live** : KPIs, cycle ordre complet (créer→lire→modifier→en_cours→terminer avec création produit occasion), cycle bon d'achat (créer→lister→lire→vérifier→annuler), 10/11 étapes ✅ (consommation bloquée par une contrainte FK `factures` attendue — aucune facture réelle en local, comportement identique avant/après migration, sans lien avec le changement de driver), données de test nettoyées (annulation).
  - [x] **phoneCatalogService.ts** (2026-07-15) — 5/5 fonctions migrées intégralement (`syncBrands`, `syncModelesByBrand`, `syncSelectedBrands`, `getLastSyncStatus`, `getCatalogStats`) — aucune ne dépend d'`auditLog`/`nextNumero`/`batch`. Câblage `routes/services.ts` : les 5 endpoints `catalog/*` passés sur `c.get('db')`. **0 test existant avant migration** (seul service métier sans couverture, `bugs.md`) → `tests/phoneCatalogService.test.ts` créé (11 tests), `global.fetch` mocké en échec systématique pour forcer le chemin de repli déterministe vers les datasets statiques embarqués (évite tout appel réseau réel en test). **Validé en local live** : stats, sync-status, sync-brands (126 marques), sync-modeles (fairphone, 5/5), sync-selected (cat, 22/22), stats après sync cohérentes — 6/6 endpoints ✅.
  - [x] **emailService.ts** (2026-07-15) — 13/13 fonctions migrées intégralement (`sendOtpInscription` exclue, n'utilise jamais D1) — aucune dépendance `auditLog`/`nextNumero`/`batch`. Câblage `routes/tickets.ts` (`sendTicketCree`/`sendTicketTermine`/`sendTicketLivre` → `dbPort`), `routes/sav.ts` (`sendSavOuvert` → `c.get('db')`, `Variables.db` déjà présent), `routes/notifications.ts` (`Variables.db` ajouté de zéro, 6 endpoints migrés), `routes/facturation.ts` (`sendEmail` → `c.get('db')`, déjà câblé). Tests : swap complet `mockD1`→`mockDatabase` (24/24 ✅, aucun test perdu). **2 bugs préexistants découverts et corrigés en validation live** : (1) `routes/auth.ts:481` `sendEmail()` appelée avec 5 arguments positionnels au lieu d'un objet `SendEmailParams` — email de réinitialisation mot de passe jamais envoyé, erreur avalée silencieusement ; **non corrigé** (décision de conception nécessaire, hors périmètre migration — voir `bugs.md`) ; (2) `processRelancesDevis()` référençait une colonne `d.montant_ttc` inexistante (vraie colonne : `total_ttc`) — relance devis batch cassée depuis toujours, **corrigée** (alias SQL `d.total_ttc AS montant_ttc`). **Validé en local live** : stats, logs, email test (simulé), relances tickets, relances devis (0 après fix, avant : 500), hooks ticket créé/SAV ouvert déclenchés sans erreur — 8/8 ✅.
  - [x] **garantiesService.ts** (2026-07-15) — 9/10 fonctions migrées (`createGarantieFromTicket`, `createGarantie`, `getGarantie`, `listGaranties`, `checkAndExpireGaranties`, `listSav`, `getSav`, `updateSavStatut`, `getKpisSav`). `createSav` reste sur `D1Database` (dépend de `nextNumero()` ×2). Fuseau horaire vérifié, rien à corriger : `julianday()` compare des timestamps absolus UTC↔UTC (`date_fin` en ISO8601 avec `Z`), pas de frontière calendaire ambiguë — même conclusion que `factureService.ts`. Câblage `routes/sav.ts` (`Variables.db` déjà présent) + `routes/tickets.ts` (`createGarantieFromTicket` hook → `dbPort`). Tests scindés `mockDatabase`/`mockD1` (65/65 ✅, `createSav()` seul bloc resté sur `mockD1`) — 1 test ajusté (`getKpisSav` : 5→4 requêtes parallèles, la 5ème lue mais jamais utilisée dans le retour a été retirée en migrant, dead code). **Validé en local live** : cycle complet ticket terminé→garantie auto-créée→SAV ouvert depuis garantie→garantie consommée→statut SAV→clôture→expiration, 10/10 ✅.
  - [x] **agendaService.ts** (2026-07-15) — 12/12 fonctions migrées intégralement, aucune dépendance `auditLog`/`nextNumero`/`batch`. `lib/timezone.ts` appliqué à `getKpisAgenda()` : `today` (comparé à `DATE(debut)`, `debut` saisi en heure locale France jamais convertie) passait par `new Date().toISOString()` (UTC) → `todayParis()`. `getWeekStart()`/`getWeekEnd()` refaits en arithmétique UTC pure sur la date Paris (`getUTCDay`/`setUTCDate`) au lieu de `new Date().getDay()` (dépendant du fuseau de la machine d'exécution). Câblage `routes/agenda.ts` (`Variables.db` ajouté, 9 endpoints) + `index.tsx` (route publique iCal `GET /api/calendar/:token.ics`). Tests : swap complet `mockD1`→`mockDatabase` (73/75 ✅, 2 échecs confirmés pré-existants via `git stash` — bug `computeFin()` sensible au fuseau machine, détail dans `bugs.md`, sans lien avec cette migration). **Bug confirmé en direct lors de la validation live** : `POST /api/agenda` avec `debut` 14:00 + 45min a renvoyé `fin` = 12:45 (repro exacte du bug `computeFin()`) — sans impact production (Workers = UTC), non corrigé (hors périmètre driver DB). **Validé en local live** : KPIs, vue calendrier, token iCal, CRUD RDV complet (créer→lire→modifier→statut→supprimer), 9/9 ✅.
  - [x] **statsService.ts** (2026-07-15) — 10/10 fonctions migrées intégralement (`getKpisDashboard`, `getCaMensuel`, `getTicketsParStatut`, `getTopProduits`, `getActiviteRecente`, `exportCsvTickets`, `exportCsvCa`, `exportCsvTechniciens`, `getRapportComptable`, `getRapportTechnicien`) — **dernier service du chantier, 20/20 services migrés**. `lib/timezone.ts` appliqué partout où une borne "aujourd'hui"/"ce mois-ci" était déléguée à `DATE('now')`/`strftime(...,'now')` (UTC serveur) ou `new Date()` local — `today`/`currentMonth`/`previousMonth`/`in30Days` calculés une fois via `todayParis()`/`currentMonthParis()` + 2 helpers locaux `addDaysParis()`/`addMonthsParis()` (arithmétique UTC pure sur la date Paris, même pattern que `getWeekStart`/`getWeekEnd` d'`agendaService.ts`). Câblage `routes/stats.ts` (`Variables.db` ajouté, 10 endpoints via `ctx()`). Tests étendus de 15 à 33 (7 fonctions jusque-là non testées couvertes). **3 bugs préexistants découverts et corrigés en validation live** : (1) `exportCsvCa()`/`getRapportComptable()` référençaient `mode_paiement` sur `factures` — colonne inexistante (vit sur `paiements`, relation 1:N) — les deux endpoints étaient cassés depuis toujours (500 systématique), corrigés par sous-requête corrélée / JOIN ; (2) le test "1er du mois courant" documenté comme pré-existant non-bloquant depuis le 2026-07-09 est désormais **réparé** (root cause : mélange `new Date()` local + `toISOString()` UTC, résolu par la migration timezone). Détail complet dans `bugs.md`. **Validé en local live** : 10/10 endpoints ✅ (KPIs, CA mensuel, tickets/statut, top produits, activité récente, rapport techniciens, rapport comptable, 3 exports CSV).
- [ ] Ports `Storage`/`Cache` (R2/D1KV → disque local/Redis) — pas nécessaires tant que la bascule VPS n'est pas engagée
- [x] `populateTechniciens()` liste tous les rôles (admin/manager/technicien), pas seulement les techniciens — **CORRIGÉ le 2026-07-16**, voir `bugs.md`
- [ ] Pas de test dédié pour `D1DatabaseAdapter` (seuls le service migré et le mock sont couverts) — validé en live, à ajouter quand pertinent
- [ ] `GET /api/users` réservé aux rôles admin/manager — un technicien ouvrant "Nouvelle prise en charge" ne voit pas la liste se remplir (échec silencieux). Envisager un endpoint dédié accessible à tous les rôles authentifiés si ça devient gênant en usage réel
- [ ] Adaptateur Postgres, migration des données, déploiement Node.js sur VPS — hors scope tant que non engagé

## Bug prod critique — numérotation documents non isolée par boutique — CORRIGÉ le 2026-07-12

Détail complet dans `bugs.md`. Root cause : `numero` avait une contrainte `UNIQUE` globale (`tickets`, `factures`, `devis`, `avoirs`, `rachats`) alors que les compteurs (`sequences`) sont calculés indépendamment par boutique.

- [x] Migration `migrations/0034_numero_unique_par_boutique.sql` : `UNIQUE(boutique_id, numero)` sur les 5 tables, testée en local puis appliquée en prod
- [x] Validé en local : même numero accepté sur 2 boutiques différentes, toujours rejeté sur la même boutique, AUTOINCREMENT/FK intacts
- [x] Validé en prod : création de ticket Desk1 (boutique_id=3) → 201 (échouait en 500 avant), ticket/client de test nettoyés
