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
`iziGSM Loop Engineering`) se déclenche **toutes les heures depuis le 2026-07-20**
(historique : 13:20 à la création initiale le 2026-07-19, puis 1x/jour à 09:30 le même
jour, puis passage à une répétition horaire le 2026-07-20 — décision explicite de
l'utilisateur pour accélérer le traitement du backlog `todo.md`, tout en gardant le
budget « 1 tâche/déclenchement » de `loop-policy.md` inchangé : c'est la fréquence du
trigger qui augmente, pas la taille d'un run). `MultipleInstances` réglé sur
`IgnoreNew` : si un run est encore en cours au déclenchement suivant, le nouveau
déclenchement est ignoré (jamais deux runs en parallèle sur le même repo).
Voir § 7 pour changer et pour vérifier la configuration actuelle sans supposer qu'elle
n'a pas bougé depuis la rédaction de ce document. Elle lance :

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Said\Downloads\claude-test\izigsm\webapp\scripts\loop\run-loop.ps1"
```

**Dossier réel** : `C:\Users\Said\Downloads\claude-test\izigsm\webapp\` — c'est le
dossier de dev habituel (celui avec tout l'historique de commits), **pas**
`izigsm_NG_temp_analysis\` (un clone redondant créé puis supprimé pendant la mise en
place, voir `bugs.md` "confusion de dossier" si besoin de contexte). Le nom du
**repo GitHub** reste `izigsm_NG_temp_analysis` (`origin` de ce dossier) — seul le nom
du **dossier local** diffère, ce qui a causé la confusion initiale.

**⚠ Heure locale, pas GMT/UTC** : l'heure configurée est interprétée selon le fuseau
horaire de la machine Windows (le Planificateur de tâches n'a pas de notion explicite
de GMT/UTC). **Fuseau confirmé** (`Get-TimeZone`, 2026-07-19) : `Romance Standard
Time` — Europe/Paris, UTC+1 en hiver (CET) / UTC+2 en été (CEST, actuellement actif).
Avec l'heure actuelle (09:30 local depuis le 2026-07-19) : **`09:30` local =
`07:30` GMT/UTC** en ce moment (CEST) — deviendra `08:30` GMT/UTC au passage à l'heure
d'hiver (le Planificateur garde l'heure locale fixe, c'est l'équivalent GMT qui
glisse). Pour l'heure exacte à tout moment, ne pas se fier à ce document — vérifier :
```powershell
(Get-ScheduledTask -TaskName "iziGSM Loop Engineering").Triggers.StartBoundary
```

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
   - `vitest`/`tsc`/`build` ne nécessitent aucun serveur — ils tournent directement sur
     le code.
   - **Playwright a besoin d'un serveur** : la loop lance elle-même `wrangler pages dev`
     sur `localhost:3000`, avec une **base de données D1 locale** (créée/réinitialisée
     sur la machine, pas la vraie base de production) avant de lancer la suite de
     tests. **Rien ne touche jamais `repairdesk.fr` ni les vraies données clients**
     pendant les tests — tout est confiné à cette copie locale jetable, même en cas de
     test qui échoue ou se comporte mal.
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
- **Changer la fréquence** (depuis le 2026-07-20 : répétition horaire, pas un
  déclenchement quotidien à heure fixe — voir § 1) :
  ```powershell
  $Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 3650)
  Set-ScheduledTask -TaskName "iziGSM Loop Engineering" -Trigger $Trigger -Settings (New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable)
  ```
  Remplacer `-Hours 1` par l'intervalle voulu (ex. `-Minutes 30`, `-Hours 2`). Toujours
  garder `-MultipleInstances IgnoreNew` pour éviter deux runs concurrents si un run
  dépasse l'intervalle. Pour revenir à un déclenchement quotidien à heure fixe :
  ```powershell
  Set-ScheduledTask -TaskName "iziGSM Loop Engineering" -Trigger (New-ScheduledTaskTrigger -Daily -At 09:30)
  ```
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

## 9. Notifications Telegram (ajouté le 2026-07-20)

Avant cette date, aucune notification n'existait (§8 ci-dessus le disait explicitement)
— seule trace = terminal/ledger/git log, à consulter activement. Un bot Telegram
(`iziGSM Loop Bot`) a été mis en place pour recevoir un message à chaque run et une
alerte si un run reste bloqué anormalement longtemps.

**Config** : `scripts/loop/telegram.local.json` (`botToken`/`chatId`) — fichier local,
**jamais commité** (`.gitignore`), propre à cette machine. À recréer manuellement sur
toute autre machine qui exécuterait la loop (voir procédure BotFather ci-dessous si
besoin de recréer le bot, sinon juste recopier le fichier avec le token existant).

**`scripts/loop/notify-telegram.mjs`** : envoie un message au bot via l'API Telegram
(`sendMessage`). Volontairement **non bloquant** — toute erreur (config absente, réseau,
API Telegram indisponible) est loggée sur stderr et le script sort en 0, pour ne jamais
faire échouer `run-loop.ps1`/`watchdog.ps1` à cause d'une notification.

**`run-loop.ps1`** envoie désormais une notification Telegram sur **chaque** issue du
run, pas seulement en cas de succès :
- Working tree non propre → abandon, notifié (avec la branche concernée)
- Quota du plan ≥ seuil → abandon, notifié (avec le JSON du quota)
- `claude -p` terminé (code 0 ou non) → notifié, avec renvoi vers
  `.superpowers/sdd/loop-runs.md` pour le détail (commit/escalade/backlog vide)

**Lock + watchdog (`scripts/loop/watchdog.ps1`, tâche planifiée séparée "iziGSM Loop
Watchdog", toutes les 30 min)** : `run-loop.ps1` écrit `scripts/loop/.loop-lock`
(horodatage UTC) juste avant de lancer `claude -p`, le supprime juste après (succès ou
échec). Le watchdog vérifie ce fichier :
- Absent → aucun run en cours, sortie silencieuse (**pas** de notification "tout va
  bien" à chaque passage de 30 min — uniquement des alertes réelles, pour ne pas noyer
  le canal Telegram).
- Présent depuis plus de 60 min (`LOOP_WATCHDOG_THRESHOLD_MIN`, ajustable en variable
  d'environnement) → notification "run probablement bloqué". Le watchdog **n'arrête
  jamais** un processus et **ne touche jamais** au code/git — il alerte, la décision
  reste humaine (cohérent avec le reste de la politique L2, `loop-policy.md`).

**Recréer le bot Telegram (si besoin, autre machine ou token perdu)** :
1. Telegram → chercher `@BotFather` → `/newbot` → nom + username se terminant par `bot`
2. Récupérer le token donné par BotFather
3. Envoyer un message au nouveau bot (n'importe quoi)
4. Ouvrir `https://api.telegram.org/bot<TOKEN>/getUpdates` → repérer `"chat":{"id":...}`
   → c'est le `chatId`
5. Écrire les deux valeurs dans `scripts/loop/telegram.local.json`

**Tâche planifiée watchdog** (créée le 2026-07-20, indépendante de "iziGSM Loop
Engineering") :
```powershell
Get-ScheduledTaskInfo -TaskName "iziGSM Loop Watchdog"   # dernier check / statut
Disable-ScheduledTask -TaskName "iziGSM Loop Watchdog"   # mettre en pause
Enable-ScheduledTask  -TaskName "iziGSM Loop Watchdog"   # reprendre
Unregister-ScheduledTask -TaskName "iziGSM Loop Watchdog" -Confirm:$false  # supprimer
```

**Résumé enrichi (ajouté le 2026-07-20)** : le message Telegram de fin de run (cas
succès, code 0) ne se contente plus de renvoyer vers le ledger — il inclut directement :
- **Actions faites** : `git log --format="- %s" "$PreRunHead..$PostRunHead"` — les
  commits réellement créés par ce run précis (capturé avant l'appel `claude -p`, donc
  inclut aussi bien le commit de tâche que l'auto-commit du ledger qui suit).
- **Prochaine tâche en tête de backlog** : relance `node scripts/loop/pick-task.mjs`
  après le run pour afficher la tête de file actuelle (texte tronqué à 200 caractères).
  **Indicatif seulement** — ne préjuge pas de ce que fera réellement le run suivant
  (une tâche peut être skippée pour risque déjà escaladé, voir Étape 1 de `SKILL.md`).

## 10. Notification de démarrage + fréquence horaire (ajouté le 2026-07-20)

**Pourquoi** : avec un seul run/jour, l'utilisateur a demandé à accélérer le traitement
du backlog `todo.md` (48 tâches ouvertes à cette date) et à savoir, dès le lancement,
que le script tourne correctement et ce qu'il vise — plutôt que d'attendre la fin pour
le découvrir (façon `/context-guardian status` : un checkpoint immédiat de ce qui reste
à faire).

**Fréquence** : tâche planifiée `iziGSM Loop Engineering` passée de 1x/jour (09:30) à
une répétition **toutes les heures**, `MultipleInstances = IgnoreNew` (jamais deux runs
concurrents — voir § 1 et § 7). Le budget « 1 tâche/déclenchement » de
`loop-policy.md` **n'a pas changé** : c'est le déclencheur qui tourne plus souvent, pas
la loop qui traite plusieurs tâches par run. Un run qui trouve immédiatement une tâche
déjà escaladée ou un backlog vide se termine en 1-2 minutes, sans impact notable même à
cadence horaire.

**Notification de démarrage** : juste après le gate quota et le `git pull`, avant
l'appel `claude -p`, `run-loop.ps1` relance `pick-task.mjs` (à titre informatif
uniquement — la skill à l'intérieur de `claude -p` peut décider de skipper cette tâche,
voir Étape 1 de `SKILL.md`) et envoie un message Telegram avec :
- Confirmation que le run démarre (permissions/quota valides)
- Nombre de tâches ouvertes dans `project-docs/todo.md` et `docs/TODO.md`
- Le texte de la tâche en tête de file visée

Best-effort comme le résumé de fin (§9) : toute erreur retombe sur un message court
générique, ne bloque jamais le run.

**Important — limite structurelle à garder en tête** : accélérer la cadence ne change
pas la nature des tâches. La majorité des 48 items de `todo.md` touchent isolation
multi-tenant / NF525 / paiement / migrations / périmètre architectural large —
catégories interdites à l'auto-commit par `loop-policy.md` quelle que soit la fréquence
du trigger. La loop autonome ne vide que la queue mécanique à faible risque ; les gros
chantiers (cache-busting, multi-boutiques, rebranding...) restent du ressort du
pipeline humain (`brainstorming` → `writing-plans` → `subagent-driven-development`).
Une cadence horaire accélère le débit sur cette queue-là, pas sur l'ensemble du backlog.

Best-effort : toute erreur dans la construction de ce résumé (ex. `pick-task.mjs`
indisponible) retombe silencieusement sur le message générique d'origine — ne bloque
jamais la fin du script. Les cas d'abandon (tree sale, quota dépassé) et d'échec
(`claude -p` code ≠ 0) gardent un message court, sans résumé enrichi (rien à résumer,
aucun run n'a eu lieu).
