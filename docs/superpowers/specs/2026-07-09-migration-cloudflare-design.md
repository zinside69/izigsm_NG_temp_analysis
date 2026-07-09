# Migration hébergement Genspark → Cloudflare direct (repairdesk.fr)

_Date : 2026-07-09 — Statut : approuvé par l'utilisateur, en attente d'implémentation_

## Contexte

iziGSM (SaaS gestion boutique réparation GSM — Hono/TypeScript, Cloudflare Workers/Pages, D1, R2) est hébergé en dev/staging sur un sandbox Genspark (`8096d010-efde-413e-a481-72226566aa0b.vip.gensparksite.com`), déployé via l'outil propriétaire `gsk hosted deploy` qui nécessite une approbation manuelle dans l'UI Genspark à chaque déploiement.

Objectif : sortir de cette dépendance et héberger l'application directement sur Cloudflare (compte `Contact@soteli.fr`), avec le domaine final `repairdesk.fr`.

Genspark n'a jamais servi qu'au dev/staging — aucune donnée de production réelle n'existe côté Genspark. Le lancement sur `repairdesk.fr` démarre donc avec une base neuve.

## État constaté au moment de l'écriture de cette spec

Investigation menée le 2026-07-09 via l'API Cloudflare (MCP `cloudflare-api`, compte `88cfb31e7023ac0740536222bda8a8ae`) a révélé qu'une partie du travail de setup a déjà été effectuée le 2026-07-08 (9 déploiements ad-hoc `wrangler pages deploy` en local, hors CI GitHub) :

| Élément | État constaté |
|---|---|
| Projet Cloudflare Pages `izigsm` | Existe, accessible sur `izigsm.pages.dev` |
| Liaison D1 | Bindée à `izigsm-production` (uuid `1e5c6e26-6b55-4b00-bf83-72ba26b6b112`, créée 2026-07-08) |
| Secret `JWT_SECRET` | Déjà configuré en production |
| Secret `RESEND_API_KEY` | Absent |
| Schéma D1 | **0 tables** — les 31 migrations n'ont jamais été appliquées sur cette base. L'application est actuellement cassée sur toute route qui touche la DB. |
| R2 | Désactivé au niveau du compte Cloudflare entier (API renvoie l'erreur 10042 "Please enable R2 through the Cloudflare Dashboard") — action manuelle dashboard requise, aucun endpoint API ne permet de l'activer à distance |
| Dernier déploiement Pages | Commit `eddd3af` (2026-07-08 17:50, "dataset statique exhaustif catalogue"). Les commits `f578781` (SEO noindex) et `23f007a` (rattrapage doc) ne sont pas déployés. |
| Custom domain | Non attaché — seul `izigsm.pages.dev` est actif |
| Zone DNS `repairdesk.fr` | Confirmée présente sur le même compte Cloudflare (`88cfb31e7023ac0740536222bda8a8ae`), NS déjà `grant.ns.cloudflare.com` / `rosalie.ns.cloudflare.com` |
| Enregistrements DNS existants | MX (`spool.mail.gandi.net`, `fb.mail.gandi.net`), SPF (TXT `v=spf1 include:_mailcust.gandi.net ?all`), CNAME `webmail.repairdesk.fr` → `webmail.gandi.net`, CNAME `www.repairdesk.fr` → `webredir.vip.gandi.net`, A racine → `217.70.184.38` (IP Gandi) |

`wrangler.jsonc` local reflète déjà cette configuration Pages+D1 (commit `5fd3ddf`), avec le binding R2 commenté en attendant l'activation compte.

## Décisions de cadrage (validées avec l'utilisateur, 2026-07-09)

| Sujet | Décision | Justification |
|---|---|---|
| Données | Pas de migration de données. Nouvelle base D1 vide, migrations schéma uniquement. | Genspark = dev/staging seulement, aucune donnée réelle. |
| Pages vs Workers | Pages maintenant, Workers plus tard (projet séparé futur). | Config déjà en place, sortir de Genspark vite ; migration Workers = chantier distinct. |
| Compte Cloudflare | Zone DNS `repairdesk.fr` et compte D1/Pages sont le même compte (`Contact@soteli.fr`). | Confirmé par l'utilisateur, simplifie l'attachement du custom domain. |
| R2 / Photos tickets | Activé dans le cadre de cette migration (bucket `izigsm-photos`, binding décommenté, feature Sprint 2.36/2.41-E réactivée). | Éviter un second chantier séparé. |
| Secrets | `JWT_SECRET` et `RESEND_API_KEY` régénérés à neuf (pas de réutilisation Genspark). | Nouvelle base, nouveau départ. |
| Bascule DNS | Séquence en 2 temps : validation complète sur `izigsm.pages.dev`, puis attachement `repairdesk.fr` en custom domain. | Ne jamais risquer les enregistrements MX/SPF/webmail de messagerie Gandi actifs sur le domaine ; valider avant de toucher au DNS de production. |

## Design — séquence d'exécution

L'ordre respecte la contrainte de validation avant bascule DNS.

| # | Étape | Responsable | Détail |
|---|---|---|---|
| 1 | `npm install` | agent | `node_modules/` absent localement |
| 2 | Activer R2 sur le compte Cloudflare | **utilisateur** | Dashboard Cloudflare → R2 → Enable. Bloqué côté API (erreur 10042). |
| 3 | Récupérer `RESEND_API_KEY` | **utilisateur** | Dashboard Resend (compte externe, création/récupération hors périmètre agent) |
| 4 | Appliquer les 31 migrations sur D1 | agent | `npx wrangler d1 migrations apply izigsm-production --remote` |
| 5 | Créer bucket R2 `izigsm-photos`, décommenter le binding `wrangler.jsonc`, committer | agent | Dépend de l'étape 2 |
| 6 | Poser le secret `RESEND_API_KEY` en production | agent (une fois la clé transmise de façon sécurisée, jamais en clair dans le chat) | `wrangler pages secret put RESEND_API_KEY --project-name izigsm`, ou l'utilisateur le fait lui-même |
| 7 | Build + déploiement du code à jour | agent | `npm run build && wrangler pages deploy` — aligne le déployé sur HEAD (commit `23f007a` et suivants) |
| 8 | Validation fonctionnelle sur `izigsm.pages.dev` | **utilisateur** (assisté par l'agent) | Health check, login, un flux métier complet (ex: création ticket). Les requêtes automatisées de l'agent sont bloquées en 403 (Bot Fight Mode Cloudflare) — validation depuis un vrai navigateur nécessaire. |
| 9 | Attacher `repairdesk.fr` en custom domain sur le projet Pages | agent, avec confirmation explicite de l'utilisateur juste avant (action DNS de production) | Ne modifie que l'enregistrement A/CNAME racine |
| 10 | Vérifier que MX/SPF/webmail sont intacts après bascule | agent | Contrôle DNS post-bascule |

## Rollback

- **Avant l'étape 9** : aucun risque — `repairdesk.fr` continue de pointer vers l'IP Gandi actuelle, rien n'est modifié côté DNS de production.
- **Après l'étape 9** : rollback = retirer le custom domain côté configuration Cloudflare Pages ; le DNS revient à l'état précédent en quelques minutes (propagation Cloudflare rapide, contrairement à un changement de NS classique).

## Hors scope (explicitement exclu)

- Migration de données depuis Genspark (aucune donnée réelle à transférer)
- Migration Pages → Workers (chantier futur séparé)
- Désactivation active du sandbox Genspark (laissé tel quel, non prioritaire)
- Correction de la dette technique préexistante (tests `phoneCatalogService.ts` manquants, RGPD Art.5.1.e — trackés dans `project-docs/bugs.md`, sans lien avec cette migration)

## Contraintes

- Ne jamais modifier les enregistrements MX, SPF (TXT), ou le CNAME `webmail.repairdesk.fr` lors de l'attachement du custom domain
- Ne jamais faire transiter `RESEND_API_KEY` ou tout autre secret en clair dans la conversation
- Confirmation explicite de l'utilisateur requise avant l'étape 9 (bascule DNS de production)
