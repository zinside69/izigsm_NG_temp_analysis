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

## Routine actif (Claude Code Remote)

- **Nom** : `iziGSM loop-engineering — quotidien`
- **trigger_id** : `trig_01U6odpmpedD5EwSdgzs8Z9E`
- **Créé le** : 2026-07-19, cron `0 6 * * *` (6h UTC quotidien)
- **Cadence** : 1×/jour, session fraîche à chaque déclenchement, notifications
  push+email activées.
- Pour retrouver/gérer ce Routine si l'id ci-dessus devient obsolète : lister les
  Routines du compte et chercher ce nom.
- **Limite confirmée le 2026-07-19** (vérifiée directement dans la config du trigger,
  champ `session_context.allowed_tools`) : les sessions déclenchées par ce Routine
  **n'ont accès à aucun outil `mcp__Claude_Code_Remote__*`** (`add_repo`,
  `register_repo_root`, `update_trigger` absents) ni aux outils GitHub MCP. Conséquences
  et contournements :
  - **Récupération du code** : contournée — l'authentification GitHub est posée au
    niveau de l'environnement (`~/.gitconfig`, proxy local), pas de la session. Le
    prompt du Routine utilise `git clone`/`git pull` en Bash brut, sans `add_repo`.
  - **Auto-désactivation au dépassement de quota** : **pas contournable** —
    `update_trigger` est simplement absent de ces sessions, aucun moyen d'appeler
    l'outil depuis là. Voir § "Quota" ci-dessous pour le comportement réel.
  - Un premier trigger (`trig_01E1CviLdvvC19fKgqKpLKho`, supprimé) dépendait des 3
    outils absents et aurait échoué en silence chaque jour — recréé avec ce prompt
    corrigé avant toute mise en production du Routine.

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
- **Au-delà du seuil — comportement réel (pas celui souhaité initialement)** : le choix
  utilisateur du 2026-07-19 était "pause automatique du Routine + notification
  manuelle". Techniquement impossible tel quel : les sessions déclenchées par le
  Routine n'ont pas `update_trigger` (voir § Routine actif), donc **la loop ne peut pas
  se désactiver elle-même**. Comportement effectif :
  - Le run s'arrête immédiatement, ne traite aucune tâche (coût quasi nul — juste le
    check quota).
  - Rapport clair en fin de run (notification push+email automatique, indépendante des
    outils disponibles dans la session).
  - Le Routine se redéclenchera le lendemain et re-signalera si le quota est toujours
    dépassé — ce n'est **pas** un polling agressif (1×/jour, coût négligeable), mais ce
    n'est pas non plus une vraie pause tant que l'utilisateur n'agit pas.
  - **Pause réelle** = geste explicite de l'utilisateur : soit via l'interface Routines
    de claude.ai, soit en demandant à une session outillée (comme celle-ci) de faire
    `update_trigger enabled:false`.
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
