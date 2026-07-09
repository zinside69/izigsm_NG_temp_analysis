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

## État de la décision
Brainstorming en cours (skill `superpowers:brainstorming`) — design pas encore formellement rédigé/approuvé au moment de la création de ce fichier. Voir `recovery-prompt.md` pour reprendre.
