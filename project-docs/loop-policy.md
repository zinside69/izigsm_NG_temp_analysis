# Politique de la loop d'ingénierie autonome (loop-engineering)

_Créé le 2026-07-19 — définit le niveau d'autonomie, les gardes-fous et le protocole d'escalade pour toute exécution automatisée (Routine planifiée ou script local) du skill `.claude/skills/loop-engineering/SKILL.md`._

Référence conceptuelle : https://github.com/cobusgreyling/loop-engineering (5 blocs : automations/scheduling, worktrees, skills, plugins/MCP, sub-agents maker/checker, + mémoire/état durable).

## Niveau d'autonomie retenu : L2 — Assistée

- Auto-commit + push direct sur `main` (convention déjà en vigueur sur ce repo, pas de PR) **uniquement si** :
  1. Tests unitaires 100 % verts (`npm test`) — pas de régression, y compris sur les échecs pré-existants connus (fuseau horaire) qui doivent rester stables en nombre.
  2. `tsc --noEmit` sans nouvelle erreur.
  3. Gate Playwright (`npm run test:e2e`) 100 % verte.
  4. Revue par le sous-agent "checker" (`superpowers:subagent-driven-development`) sans finding bloquant.
  5. Tâche classée **risque faible** (voir ci-dessous).
- Dans tous les autres cas → **pause et escalade** (rapport écrit + notification), aucun commit ni push. La tâche reste ouverte, non cochée dans `todo.md`.
- Le rôle de la loop est de préparer un maximum de travail vérifié, pas de forcer un déploiement. Rien n'est déployé en prod (`wrangler pages deploy`) automatiquement — le déploiement reste un geste humain explicite, comme aujourd'hui (voir `current-state.md`, chaque déploiement est déclenché "sur confirmation explicite de l'utilisateur").

## Classification du risque

### Risque élevé — escalade obligatoire, jamais d'auto-commit

Une tâche est classée à risque élevé si le plan/diff touche un des éléments suivants (chemins ou mots-clés dans la tâche source) :

| Catégorie | Déclencheurs |
|---|---|
| Authentification / sessions | `src/routes/auth.ts`, `src/services/authService.ts`, `src/lib/auth*.ts`, JWT, OTP, Google OAuth |
| Isolation multi-tenant | toute fonction touchant `boutique_id`, `getBoutiqueId`, filtrage par boutique — historique de 3 failles réelles (photos tickets, isolation cross-boutique) |
| Conformité NF525 / comptabilité | `journal_nf525`, `factureService.ts`, `nf525.ts`, séquences de numérotation (`nextNumero`), clôture caisse |
| RGPD | `purgeClient`, `exportClientRgpd`, purge automatique, tout ce qui touche à la conservation/suppression de données personnelles |
| Paiement / acompte | Stripe, `acompte`, `paiements`, `avoirs` |
| Migrations base de données | tout fichier sous `migrations/*.sql` |
| Sécurité | tout diff touchant à de l'échappement HTML (`escapeHtml`), interpolation SQL brute, upload/accès fichiers (photos R2), tokens signés |
| Périmètre large / architectural | plan couvrant > 1 chantier `docs/superpowers/plans/`, changement de plus de ~8 fichiers, nouvelle dépendance npm |

### Risque faible — éligible à l'auto-commit si tous les gates passent

- Corrections de bugs d'affichage/frontend isolés (pattern `r.success`/`r.data`, autocomplete cassé, CSS).
- Ajout de champs/filtres non sensibles sur des écrans existants.
- Corrections de tests, documentation, commentaires.
- Tâches explicitement marquées d'un tag `[loop-safe]` par l'utilisateur dans `todo.md`.

**Par défaut, en cas de doute sur la classification → traiter comme risque élevé.** Le coût d'une escalade inutile est faible ; le coût d'un auto-push d'une faille de sécurité en prod est élevé (voir historique `bugs.md` : 3 failles d'isolation, 2 failles XSS découvertes après des tests unitaires verts).

## Budget par run

- 1 tâche du backlog par déclenchement (pas de traitement en rafale) — cadence contrôlée par le trigger (Routine ou lancement manuel), pas par la loop elle-même.
- Si aucune tâche éligible n'est trouvée (backlog épuisé ou toutes les tâches restantes sont à risque élevé et déjà escaladées), la loop s'arrête proprement sans rien modifier et le signale dans le ledger.
- Une tâche escaladée n'est pas re-tentée automatiquement au run suivant — elle attend une décision humaine explicite (documentée dans `todo.md` ou `decisions.md`).

## Protocole d'escalade

Quand la loop s'arrête sans commit, elle doit produire un rapport contenant :
1. La tâche source (fichier + ligne dans `todo.md`/`TODO.md`).
2. Pourquoi elle est bloquée (risque élevé / gate rouge / ambiguïté de spec).
3. L'état du travail (worktree conservé, rien perdu — chemin du worktree).
4. Une recommandation concrète (option A/B si ambiguïté, ou le diagnostic exact si gate rouge).

Ce rapport est écrit dans `.superpowers/sdd/loop-runs.md` (ledger, append-only) et, si la loop tourne via une Routine Claude Code Remote, notifié à l'utilisateur (le firing de la Routine se termine sur ce rapport plutôt qu'un silence).

## Ce que la loop ne fait jamais, même en L2

- Ne déploie jamais en prod (`wrangler pages deploy`) — décision humaine systématique, aucune exception.
- Ne force-push jamais, ne réécrit jamais l'historique.
- Ne modifie jamais `docs/superpowers/specs/*.md` déjà approuvés sans passer par une nouvelle itération de `superpowers:brainstorming`.
- Ne supprime jamais de fichier dans `docs/` ou `project-docs/` — uniquement ajout/complément (cohérent avec la règle workspace "historiques de version toujours accumulés, jamais écrasés").
- Ne touche jamais aux secrets (`.dev.vars`, `wrangler secret`).

## Exécution automatisée — décision finale : planification locale (pas de Routine cloud)

**Essayé puis abandonné le 2026-07-19** : un Routine Claude Code Remote (cron cloud,
trigger `trig_01U6odpmpedD5EwSdgzs8Z9E`, supprimé) — écarté car l'utilisateur travaille
exclusivement via la CLI Claude Code locale (Mac/Windows), pas via Claude Code sur le
web. Le Routine tournait dans un environnement cloud séparé, sans les outils
`mcp__Claude_Code_Remote__*` (`add_repo`, `register_repo_root`, `update_trigger`
absents des sessions déclenchées — confirmé dans `session_context.allowed_tools`), sans
canal de notification exploitable par l'utilisateur, et sans aucun moyen de vérifier
son exécution depuis une session normale. Détail complet de l'investigation conservé
dans l'historique de session — non reproduit ici (règle : pas de duplication inutile).

**Mécanisme retenu** : planification native de l'OS de l'utilisateur (`cron`/`launchd`
sur Mac, Planificateur de tâches sur Windows) qui invoque `scripts/loop/run-loop.sh` /
`run-loop.ps1` avec la CLI Claude Code locale normale — aucune restriction d'outils
(c'est une session Claude Code standard), cohérent avec l'infra déjà en place dans le
workspace (`sync.ps1`/`sync`). Configuration à faire par l'utilisateur (voir todo.md).

## Quota du plan Claude — détection et pause (ajouté 2026-07-19, corrigé le même jour)

Avant toute autre chose (étape 0bis de `SKILL.md`), la loop vérifie l'usage du plan
via `scripts/loop/check-quota.mjs` (`ccusage`, lecture des logs locaux Claude Code de
l'environnement d'exécution — **ne voit pas l'usage d'autres machines/sessions du même
compte**, c'est une estimation locale par environnement, pas une lecture exacte du
quota réel côté Anthropic).

- **Seuil** : 80 % (variable `LOOP_QUOTA_THRESHOLD`, limite de référence
  `LOOP_TOKEN_LIMIT` — défaut `max`, heuristique ccusage basée sur le plus haut bloc de
  5h jamais observé localement ; à fixer explicitement si la limite réelle du plan est
  connue, plus fiable qu'un historique local encore court).
- **Au-delà du seuil, avec la planification locale (`run-loop.sh`/`.ps1`)** :
  `check-quota.mjs` fait sortir le script en erreur **avant** d'invoquer `claude -p` —
  aucune session Claude n'est même démarrée ce jour-là. C'est une vraie pause, sans
  action de l'utilisateur nécessaire : la tâche planifiée (cron/Planificateur) retentera
  simplement au prochain cycle prévu (le lendemain), avec un coût nul ce jour-là. Le
  message est visible dans la sortie terminal / les logs du planificateur — pas de
  notification push/email dans ce mode (pas de canal équivalent en local), l'utilisateur
  consulte les logs s'il veut confirmer qu'un jour a été sauté pour cause de quota.
- **Données insuffisantes** (pas encore assez d'historique local) : fail-open, la loop
  continue mais le signale dans son rapport — ne jamais bloquer sur une estimation
  absente.
- Visibilité complémentaire en local (runs manuels via `run-loop.sh`/`.ps1`) :
  [claude-hud](https://github.com/jarrodwatts/claude-hud), statusline terminal
  affichant le contexte/usage en direct — purement local à la machine de
  l'utilisateur, ne couvre pas le Routine cloud (pas de terminal à regarder).

## Context window — checkpoint à 80 % (ajouté 2026-07-19, protocole context-guardian)

Repris de `~/claude-projects/context-guardian.md` (workspace), seuil resserré à 80 %
pour la loop (protocole général : fourchette 70–85 %). Détail complet de la procédure
dans `SKILL.md` § "Surveillance du context window". Résumé : dès qu'un run (typiquement
un plan à plusieurs tâches, plusieurs sous-agents déjà dispatchés) approche 80 % du
context window, la loop arrête de dispatcher de nouveaux sous-agents, écrit un
checkpoint (`current-state.md` + `recovery-prompt.md`), committe le travail déjà
vérifié, et traite le point d'arrêt comme une escalade — reprise par le run suivant
(session neuve), jamais une tentative de continuer au-delà du seuil dans la même
session.

## Évolution

Ce document est la source de vérité du comportement de la loop. Toute modification de la politique (ex. passage à L3 sur un périmètre précis) doit être une décision explicite de l'utilisateur, documentée ici en ajoutant une nouvelle section datée en dessous — jamais en écrasant les règles ci-dessus.

### 2026-07-23 — Intégration du graphe de connaissance (graphify)

Voir `docs/superpowers/specs/2026-07-23-graphify-loop-integration-design.md` pour le
design complet. Résumé opérationnel :

**Nouvelle Étape 1bis** (entre sélection de tâche et classification du risque, voir
`SKILL.md`) : rafraîchit le graphe de connaissance (`graphify-out/graph.json`) et en
extrait un signal de risque + un brief d'implémentation, via
`scripts/loop/graphify-refresh.mjs`.

**Plafond de mise à jour sémantique** : `GRAPH_UPDATE_MAX_SEMANTIC_FILES` (variable
d'environnement, défaut `5`) — au-delà de ce nombre de fichiers non-code modifiés
depuis le dernier graphe, aucune mise à jour n'est lancée ce run (le pipeline
`--update` de `/graphify` est tout-ou-rien, pas de mode AST-only partiel invocable
de l'extérieur) ; le rafraîchissement complet est différé au prochain passage.
Pas un échec, juste une dégradation signalée dans le rapport.

**Fichiers ancres par catégorie de risque** (utilisés par
`graphify-refresh.mjs risk` pour détecter une relation directe dans le graphe, en
complément — jamais en remplacement — de la table de mots-clés ci-dessus) :

| Catégorie | Fichier(s) ancre(s) |
|---|---|
| Auth / sessions | `src/services/authService.ts`, `src/routes/auth.ts`, `src/lib/middleware.ts` |
| Isolation multi-tenant | `src/lib/middleware.ts` (héberge `getBoutiqueId()`) |
| NF525 / comptabilité | `src/lib/nf525.ts`, `migrations/0008_nf525.sql` |
| Paiement / acompte | `migrations/0036_acompte_structure.sql`, `src/services/factureService.ts` |
| RGPD | `src/services/clientService.ts` |

Le signal se déclenche uniquement sur une **relation directe (1 saut) dans le
graphe** entre un nœud du fichier ciblé et un nœud d'un fichier ancre — jamais sur le
simple partage d'une communauté (testé le 2026-07-23 : la communauté la plus grosse
contient 170 nœuds sur 1867, un signal par communauté serait un faux-positif quasi
systématique). En cas de contradiction avec la classification par mots-clés → la
règle « en cas de doute, risque élevé » prévaut toujours.

**Gestion d'erreur** (asymétrique, volontairement) :
- Échec de la mise à jour incrémentale (`graphify-refresh.mjs plan` ne peut pas
  appeler `detect_incremental()`, ou `/graphify --update` échoue) → **non bloquant**,
  la loop continue avec le `graph.json` existant (même périmé). Compteur
  `scripts/loop/.graph-update-failures` incrémenté (fichier local, gitignored) via
  `graphify-refresh.mjs record-result failure`.
- `graph.json` absent ou JSON invalide, même après tentative de rafraîchissement →
  **escalade** (gate rouge standard de l'Étape 7), aucun repli possible —
  `graphify-refresh.mjs verify` sort en code 1.
- `graphUpdateFailures ≥ 3` consécutifs → message Telegram dédié en plus du message de
  fin de run habituel, via `scripts/loop/notify-telegram.mjs`. Remis à 0 dès qu'une
  mise à jour réussit ou qu'aucune n'était nécessaire (`record-result success`).
