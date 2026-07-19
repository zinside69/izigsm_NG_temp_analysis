# iziGSM — Runbook loop-engineering (comment ça marche, au quotidien)

_Créé le 2026-07-19, après la mise en place et la validation du pipeline complet (Windows local, tâche planifiée quotidienne)._

Ce document explique **ce qui se passe concrètement, étape par étape**, une fois la
tâche planifiée en place — pour comprendre ce que tu vas voir arriver (ou pas) sans
avoir à relire toute la conversation qui a mené à cette config.

Pour le "pourquoi" des règles (niveau d'autonomie, classification du risque) : voir
`project-docs/loop-policy.md`, qui fait foi en cas de contradiction avec ce document.
Pour l'historique des bugs rencontrés en mettant ça en place : voir `bugs.md`.
Pour les instructions exactes que suit Claude à l'intérieur du run : voir
`.claude/skills/loop-engineering/SKILL.md`.

---

## 1. Le déclencheur — tâche planifiée Windows

Une tâche du Planificateur de tâches Windows (`schtasks`/`Register-ScheduledTask`, nom
`iziGSM Loop Engineering`) se déclenche **tous les jours à l'heure configurée** (13:20
au moment de la mise en place — modifiable, voir § 7). Elle lance :

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Said\Downloads\claude-test\izigsm\webapp\scripts\loop\run-loop.ps1"
```

**Dossier réel** : `C:\Users\Said\Downloads\claude-test\izigsm\webapp\` — c'est le
dossier de dev habituel (celui avec tout l'historique de commits), **pas**
`izigsm_NG_temp_analysis\` (un clone redondant créé puis supprimé pendant la mise en
place, voir `bugs.md` "confusion de dossier" si besoin de contexte). Le nom du
**repo GitHub** reste `izigsm_NG_temp_analysis` (`origin` de ce dossier) — seul le nom
du **dossier local** diffère, ce qui a causé la confusion initiale.

**⚠ Heure locale, pas GMT/UTC** : `13:20` est interprété selon le fuseau horaire
configuré sur la machine Windows (le Planificateur de tâches n'a pas de notion
explicite de GMT/UTC — `Get-TimeZone` en PowerShell donne le fuseau exact configuré).
Si la machine est en Europe/Paris, `13:20` local ≈ `11:20` GMT/UTC en été (CEST,
UTC+2) ou `12:20` GMT/UTC en hiver (CET, UTC+1) — à vérifier, ne pas supposer.

C'est un `powershell.exe` normal, dans un contexte non-interactif (pas de fenêtre
visible, pas de personne pour cliquer "autoriser" quoi que ce soit) — c'est pour ça que
tout ce qui suit doit pouvoir tourner sans intervention humaine.

## 2. Ce que fait `run-loop.ps1`, dans l'ordre

1. **Se positionne sur le dossier du repo** (`Set-Location`, calculé depuis
   l'emplacement du script lui-même — peu importe d'où la tâche est lancée).
2. **Vérifie que le working tree est propre** (`git status --porcelain`). Si quoi que
   ce soit traîne de non commité → arrêt immédiat, rien d'autre ne se passe. La loop ne
   part jamais d'un état sale (pourrait écraser du travail en cours).
3. **Vérifie le quota** (`node scripts/loop/check-quota.mjs`, voir § 4) — si le seuil de
   80 % est dépassé, le script s'arrête ici, avant même de démarrer Claude. Coût nul ce
   jour-là ; la tâche planifiée retentera simplement demain.
4. **Se synchronise avec `origin/main`** (`git checkout main && git pull`) — récupère
   tout ce qui a pu être poussé depuis la dernière fois (par toi, ou par un run
   précédent de la loop).
5. **Lance Claude Code en mode non-interactif** (`claude -p ... --permission-mode
   acceptEdits`) avec un prompt qui pointe vers la skill `loop-engineering`. C'est à
   partir d'ici que la vraie logique métier prend le relais (§ 3).
6. **Auto-commit du ledger** (`.superpowers/sdd/loop-runs.md` uniquement, jamais
   d'autre fichier) — si Claude a écrit une entrée sans la committer (cas d'une
   escalade, où rien d'autre n'est poussé), le script la committe/pousse lui-même
   automatiquement. Garantit que le **prochain** run démarre toujours sur un working
   tree propre, sans intervention manuelle à chaque fois qu'un run escalade.
7. **Vérifie le code de sortie de Claude** et l'affiche clairement — succès ou échec,
   jamais un silence qui ressemblerait à un succès.

## 3. Ce qui se passe DANS la session Claude (skill `loop-engineering`)

Une fois Claude démarré, il suit `.claude/skills/loop-engineering/SKILL.md` à la
lettre. Dans l'ordre :

1. **Prérequis** — relit `current-state.md`, `bugs.md`, `decisions.md` pour ne pas
   redécouvrir des choses déjà connues.
2. **Sélection de la tâche** (`scripts/loop/pick-task.mjs`) — pioche la première tâche
   non cochée de `project-docs/todo.md` puis `docs/TODO.md`, priorité 🔴 d'abord.
   S'il n'y a rien à faire → le run s'arrête proprement, rapport "backlog vide".
3. **Classification du risque** — la tâche est-elle sensible (auth, isolation
   multi-tenant, NF525, RGPD, paiement, migration SQL, périmètre large) ? Si oui →
   **escalade immédiate, aucun code touché**. Sinon → continue.
4. **Isolation dans un worktree git** (`git worktree add ../izigsm-loop-<slug> -b
   loop/<slug> main`) — tout le travail se fait à côté, jamais directement sur ton
   checkout principal.
5. **Planification + implémentation** — pour une tâche simple : implémentation directe
   avec un sous-agent implémenteur + un sous-agent reviewer (c'est ce qui explique les
   multiples processus `claude` que tu as pu voir dans `Get-Process` — chaque sous-agent
   en est un). Pour une feature plus grosse/ambiguë : passe par
   `brainstorming` → `writing-plans` → `subagent-driven-development` (le workflow
   déjà utilisé manuellement sur ce repo avant la loop).
6. **Gates de vérification** — dans l'ordre, chacun doit être vert avant le suivant :
   `vitest` → `tsc --noEmit` → `npm run build` → Playwright (`npm run test:e2e`) →
   optionnellement browser-use si la tâche introduit un nouveau parcours utilisateur.
   Le premier rouge arrête tout, pas de commit partiel.
7. **Décision finale** :
   - **Tous les gates verts + risque faible** → commit + push direct sur `main` (même
     convention que ton usage manuel), case cochée dans `todo.md`, entrée ajoutée dans
     `current-state.md`.
   - **Sinon** → rien n'est poussé, la tâche reste ouverte, un rapport d'escalade est
     écrit.
8. **Ledger** — dans tous les cas, une entrée est ajoutée à
   `.superpowers/sdd/loop-runs.md` (fichier qui s'accumule, jamais réécrit).

## 4. Le gate quota (`check-quota.mjs`)

Utilise `ccusage` pour estimer l'usage du **bloc de 5h actif** par rapport à une limite
de référence (`max` par défaut = plus haut bloc jamais observé sur cette machine).
**Point important dans ta config actuelle** : tu factures via une clé API
(`ANTHROPIC_API_KEY`), pas via ton abonnement claude.ai — ce gate suit un modèle pensé
pour un abonnement à quota glissant, pas des crédits prépayés à la consommation. Il
reste utile (fail-open s'il ne comprend pas la situation, ne bloque jamais à tort) mais
ne remplace pas une vraie alerte de solde côté console.anthropic.com.

## 5. Ce que TU dois faire selon ce qui s'est passé

| Résultat du run | Ce qui s'est passé | Ce que tu fais |
|---|---|---|
| **Commit poussé sur `main`** | Tâche traitée, tous les gates verts, risque faible | Rien d'obligatoire — mais jette un œil au diff (`git log -p -1`) et au nouveau checkpoint dans `current-state.md` quand tu as un moment. Rien n'est déployé en prod automatiquement (`wrangler pages deploy` reste toujours manuel). |
| **Escalade** | Risque élevé, gate rouge, ou ambiguïté de spec | Lis le rapport final (affiché dans le terminal + dans `.superpowers/sdd/loop-runs.md`). Décide : corriger toi-même, clarifier dans `decisions.md`, ou marquer la tâche `[loop-safe]` dans `todo.md` si tu es sûr qu'elle peut être auto-traitée au prochain passage. |
| **Backlog vide** | Rien à faire dans `todo.md`/`TODO.md` | Rien à faire — ou ajoute des tâches si tu veux que la loop continue à travailler. |
| **Erreur technique** (git, permissions, quota, credit API épuisé) | Problème d'infrastructure, pas de code touché | Diagnostiquer comme on vient de le faire pour la mise en place (voir `bugs.md` pour les cas déjà rencontrés). |

## 6. Où regarder les résultats

- **Sortie terminal** de la tâche planifiée — pas de fenêtre visible par défaut ;
  passe par `Get-ScheduledTaskInfo -TaskName "iziGSM Loop Engineering"`
  (`LastTaskResult` : `0` = succès) ou relance manuellement
  (`Start-ScheduledTask`) pour voir en direct.
- **`.superpowers/sdd/loop-runs.md`** — historique complet de tous les runs,
  append-only.
- **`git log --oneline -10`** sur `main` — les commits de la loop se reconnaissent à
  leur message (`type: description`, même convention que tes commits manuels).
- **`project-docs/todo.md`** / **`project-docs/current-state.md`** — mis à jour à
  chaque commit réussi.

## 7. Comment intervenir

- **Mettre en pause** :
  ```powershell
  Disable-ScheduledTask -TaskName "iziGSM Loop Engineering"
  ```
  Reprendre : `Enable-ScheduledTask -TaskName "iziGSM Loop Engineering"`
- **Voir l'heure actuelle et le fuseau de la machine** :
  ```powershell
  (Get-ScheduledTask -TaskName "iziGSM Loop Engineering").Triggers
  Get-TimeZone
  ```
- **Changer l'heure** (toujours en heure LOCALE de la machine, pas GMT/UTC — voir § 1) :
  ```powershell
  Set-ScheduledTask -TaskName "iziGSM Loop Engineering" -Trigger (New-ScheduledTaskTrigger -Daily -At 06:00)
  ```
  Remplacer `06:00` par l'heure locale voulue (ex. `13:20` = actuel au moment de la
  rédaction).
- **Changer le dossier/chemin du script** (si le dossier de travail change à nouveau) :
  ```powershell
  $Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument '-NoProfile -ExecutionPolicy Bypass -File "<nouveau chemin complet>\scripts\loop\run-loop.ps1"'
  Set-ScheduledTask -TaskName "iziGSM Loop Engineering" -Action $Action
  # Vérifier :
  (Get-ScheduledTask -TaskName "iziGSM Loop Engineering").Actions
  ```
- **Lancer un run manuellement** (sans attendre l'heure planifiée) :
  ```powershell
  .\scripts\loop\run-loop.ps1
  ```
  ou, pour observer sans rien laisser s'exécuter/committer :
  ```powershell
  $env:LOOP_PERMISSION_MODE = "plan"
  .\scripts\loop\run-loop.ps1
  ```
- **Supprimer complètement** :
  ```powershell
  Unregister-ScheduledTask -TaskName "iziGSM Loop Engineering" -Confirm:$false
  ```

## 8. Limites connues (état actuel, pas un historique)

- **⚠ Confiance du workspace (one-time setup par dossier)** — Claude Code refuse
  d'honorer `.claude/settings.json` (donc tous les gates `npm`/`node`/`git`) tant que
  le dossier exact n'a pas été "trusté" via une session interactive au moins une fois.
  Symptôme si oublié : `Ignoring N permissions.allow entries from .claude/settings.json:
  this workspace has not been trusted`, puis les gates échouent en silence. **Si le
  chemin du dossier change un jour** (déplacement, nouveau clone, nouvelle machine),
  refaire une fois avant de compter sur la tâche planifiée :
  ```powershell
  cd <chemin du dossier>
  claude
  # accepter le dialogue de confiance, puis /exit
  ```
- Le gate quota suppose un usage type abonnement claude.ai, pas des crédits API à la
  consommation (voir § 4) — surveille ton solde sur console.anthropic.com séparément
  tant que `ANTHROPIC_API_KEY` reste actif.
- Pas de notification push/email en local (contrairement à ce qui avait été envisagé
  avec un Routine cloud, abandonné — voir `loop-policy.md`) — la seule trace est la
  sortie terminal / le ledger / `git log`. Il faut consulter activement, rien ne
  "pousse" l'information vers toi.
- `browser-use` (validation exploratoire) nécessite une clé `ANTHROPIC_API_KEY` en
  variable d'environnement dédiée et l'installation de ses dépendances Python — pas
  encore fait, la validation exploratoire ne se déclenchera pas tant que ce n'est pas
  configuré (le pipeline continue de fonctionner sans, ce n'est pas bloquant).
- Une seule tâche traitée par run — pour vider un backlog plus vite, relancer
  manuellement plusieurs fois plutôt que d'augmenter la fréquence de la tâche planifiée
  sans réflexion (chaque run peut committer sur `main`, mieux vaut les espacer assez
  pour avoir le temps de relire).
- `.gitignore` exclut désormais `*.pdf`/`*.docx`/`izigsm_v*.zip`/`izigsm_*backup*` —
  nécessaire car ces fichiers de référence (CDC, backups) traînaient sans être suivis
  dans le dossier de dev habituel, ce qui faisait échouer le check "working tree
  propre" de l'Étape 0 en permanence. N'affecte aucun fichier déjà suivi
  (`docs/CDC_izigsm.pdf` reste tracké normalement).
