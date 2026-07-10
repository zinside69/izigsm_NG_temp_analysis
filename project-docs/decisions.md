# iziGSM — Décisions

## 2026-07-09 — Migration hébergement Genspark → Cloudflare direct

**Décision** : quitter le déploiement `gsk hosted deploy` (Genspark, Workers for Platforms géré) au profit d'un déploiement Cloudflare Pages standard sur le compte `Contact@soteli.fr`, domaine final `repairdesk.fr`.

**Pourquoi** : ne plus dépendre de Genspark (approbation UI manuelle à chaque déploiement, plateforme tierce).

### Sous-décisions (validées en brainstorming, 2026-07-09)

| Sujet | Décision | Justification |
|---|---|---|
| Données | **Pas de migration de données.** Nouvelle base D1 (`1e5c6e26-...`) vide, migrations schéma seulement. | Genspark n'a servi qu'au dev/staging — aucune donnée client réelle à transférer. |
| Pages vs Workers | **Pages maintenant, Workers plus tard** (projet séparé futur). | `wrangler.jsonc` déjà configuré pour Pages — sortir de Genspark vite. Migration Workers = chantier distinct une fois stabilisé. |
| Compte Cloudflare | Zone DNS `repairdesk.fr` et compte D1 sont **le même compte** (`Contact@soteli.fr`). | Confirmé par l'utilisateur — simplifie l'attachement du custom domain. |
| R2 / Photos tickets | **Activé maintenant** dans le cadre de cette migration (créer bucket `izigsm-photos`, décommenter binding `wrangler.jsonc`, réactiver la feature Sprint 2.36/2.41-E). | "Autant tout faire d'un coup" — évite un second chantier. |
| Secrets | `JWT_SECRET` et `RESEND_API_KEY` **régénérés à neuf** (pas de réutilisation des valeurs Genspark). `JWT_SECRET` généré côté outillage ; `RESEND_API_KEY` à récupérer par l'utilisateur sur le dashboard Resend. | Nouvelle base, nouveau départ — pas de raison de garder les anciens secrets. |
| Bascule DNS | **Séquence en 2 temps** : (1) déployer et valider intégralement sur le sous-domaine `*.pages.dev` fourni par Cloudflare ; (2) une fois validé, attacher `repairdesk.fr` en custom domain. | `repairdesk.fr` a des enregistrements MX/SPF/webmail actifs (mail Gandi) — la bascule ne doit toucher que l'enregistrement A/CNAME racine, jamais les records mail. Tester avant de bouger le DNS de prod réduit le risque. |

### Point de vigilance DNS (ne pas oublier)
`repairdesk.fr.txt` (export DNS du 2026-07-08) montre :
- MX → `spool.mail.gandi.net` / `fb.mail.gandi.net`
- SPF (`TXT`) → `v=spf1 include:_mailcust.gandi.net ?all`
- CNAME `webmail.repairdesk.fr` → `webmail.gandi.net`
- CNAME `www.repairdesk.fr` → `webredir.vip.gandi.net`

**Aucun de ces records ne doit être modifié** lors de l'attachement du custom domain Cloudflare Pages — seul le record A racine (`repairdesk.fr` → actuellement `217.70.184.38`, IP Gandi) sera remplacé.

### Décisions prises pendant l'exécution (plan `docs/superpowers/plans/2026-07-09-migration-cloudflare.md`)

| Sujet | Décision | Justification |
|---|---|---|
| Nom du bucket R2 | `izigsm-photos` (pas de nom générique type "medias"/"backups") | L'utilisateur a proposé un nom générique — refusé : le code (`photosService.ts`, binding `PHOTOS`) et la doc (`TODO.md` Sprint 2.36) référencent déjà `izigsm-photos`, et mélanger photos/backups dans un seul bucket mélangerait des besoins de rétention différents. |
| Domaine d'envoi Resend | Sous-domaine **`mail.repairdesk.fr`** (pas la racine `repairdesk.fr`) | Évite tout conflit avec les enregistrements MX/SPF/webmail Gandi déjà actifs sur la racine — cohérent avec la contrainte DNS ci-dessus. Vérifié après coup : les 3 enregistrements DNS requis (MX, TXT SPF, TXT DKIM) existaient déjà dans la zone au moment de la config Resend — posés lors du travail du 08/07, réutilisés tels quels. |
| Mode d'exécution du plan | **Hybride** : agent pilote directement les tâches d'infra en session (D1, déploiement, secrets, DNS) — pas de worktree, pas de subagent-driven pour ces étapes. Seule Task 4 (édition `wrangler.jsonc`, seul vrai diff de code) est passée par le cycle subagent-driven (implémenteur + reviewer). | Le skill `subagent-driven-development` suppose des tâches de code isolables dans un worktree ; ici la majorité des tâches touchent le même compte Cloudflare de production qu'on soit dans un worktree ou non (aucune protection apportée), et plusieurs étapes nécessitent une action humaine directe (R2 dashboard, clé Resend, confirmation DNS) — incompatible avec le mode "exécution continue sans interruption" du skill. Décision proposée par l'agent, validée par l'utilisateur. |

## État de la décision
Design approuvé, spec écrite et commitée, plan d'implémentation écrit et commité. Exécution terminée (mode hybride ci-dessus) — Tasks 1-9 toutes terminées le 2026-07-10. `repairdesk.fr` sert l'app iziGSM en production sur Cloudflare Pages (commit `6f26a51`, déploiement `885cc1e3`), DNS mail Gandi intact (vérifié). **Migration Cloudflare terminée.**

### Écart au plan initial — Task 8 (2026-07-10)
Le plan prévoyait que Cloudflare auto-provisionne le CNAME racine après attachement du domaine (la zone étant sur le même compte). En pratique, l'A record préexistant (`repairdesk.fr → 217.70.184.38`, Gandi) a bloqué cette auto-création (`"CNAME record not set"`) même après suppression de l'A record. Le CNAME (`repairdesk.fr → izigsm.pages.dev`, proxied) a dû être créé manuellement — confirmation explicite utilisateur obtenue avant chaque mutation DNS (suppression A record, attachement domaine). Résultat identique à celui prévu, juste une étape manuelle en plus.

---

## 2026-07-10 (suite) — Décisions post-migration

### Positionnement produit confirmé
**Décision** : iziGSM est une plateforme SaaS multi-boutiques pour centres de réparation indépendants et divers (comparables cités par l'utilisateur : repairdesk.co, monatelier.net), **ET** doit supporter le multi-sites géré (un client possédant plusieurs boutiques, dashboard consolidé, transferts stock/personnel). Les deux modèles cohabitent — ce n'est pas contradictoire.

**Pourquoi** : l'agent avait initialement classé le multi-sites (MOD-16 CDC) comme hors scope/non pertinent vu le positionnement "boutiques indépendantes". L'utilisateur a corrigé : cas d'usage réel (propriétaire de plusieurs magasins), à garder en roadmap.

**Comment appliquer** : ne jamais reclasser le multi-sites comme hors scope. C'est un chantier d'architecture confirmé (le modèle actuel est strictement 1 user = 1 boutique_id), à scoper en session dédiée — pas encore fait. Détail dans `todo.md` et mémoire projet `project_izigsm_product_vision.md`.

### Fallback email plateforme (pas de clé Resend obligatoire par boutique)
**Décision** : quand une boutique n'a pas configuré sa propre clé Resend (`boutique_settings.email_api_key`), le système utilise automatiquement la clé Resend globale de la plateforme (`RESEND_API_KEY`, même secret que l'OTP), avec un expéditeur forcé sur le domaine vérifié `mail.repairdesk.fr` (format `"{Nom boutique} via iziGSM <noreply@mail.repairdesk.fr>"`).

**Pourquoi** : découvert que `email_api_key` n'a jamais été configurée pour aucune boutique — sans ce fallback, aucun email n'aurait jamais fonctionné pour un client réel sans qu'il configure d'abord son propre compte Resend (friction de mise en route disproportionnée pour un petit atelier). Alternative écartée : forcer chaque boutique à configurer sa clé avant de pouvoir écrire à ses clients.

**Comment appliquer** : chaque boutique garde la possibilité de configurer sa propre clé plus tard (white-label, expéditeur personnalisé) — le fallback n'est qu'un défaut, pas une contrainte. Exception : `POST /api/notifications/test` n'utilise jamais le fallback (doit tester la config propre de la boutique).

### Feature "Accord" ticket — réutilise le flow devis existant
**Décision** : l'étape "Accord" de la timeline de suivi ticket (double validation boutique→client, couleurs gris/orange/vert) réutilisera `devis.ticket_id` + `devis.statut` + `devis-public.html` + `POST /api/public/devis/:token/repondre` — pas de nouveau système de token/approbation dédié au ticket.

**Pourquoi** : le mécanisme demandé (lien envoyé au client, clic = preuve d'acceptation) existe déjà quasi à l'identique pour les devis. Dupliquer serait un doublon inutile.

**Comment appliquer** : SMS explicitement différé (nécessite un choix de fournisseur type Twilio, non fait) — email uniquement pour la v1, via le mécanisme Resend déjà fiabilisé. Spec complète dans `todo.md`.
