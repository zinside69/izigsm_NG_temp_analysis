# iziGSM — Onboarding rapide

## C'est quoi
SaaS de gestion de boutique de réparation téléphone/GSM (tickets, stock, facturation NF525, caisse, CRM, RDV). Stack Hono + Cloudflare Workers/Pages + D1 + R2. Détail : `architecture.md`.

## Où est le code
Dépôt git : `izigsm/webapp/` (renommé le 2026-07-09, remote GitHub `zinside69/izigsm_NG_temp_analysis`). Le reste de `izigsm/` à la racine n'est que des archives de sauvegarde (tar/zip), pas du code actif.

## Commandes essentielles
```bash
npm install          # requis, node_modules absent par défaut
npm run dev           # vite dev local
npm run build          # build production (dist/)
npm test               # vitest — 18 suites, ~705 tests
npx wrangler pages deploy   # déploiement Cloudflare Pages
```

## État actuel (2026-07-09)
Migration en cours de l'hébergement Genspark (dev/staging) vers Cloudflare direct (compte Contact@soteli.fr, domaine `repairdesk.fr`). Voir `decisions.md` + `recovery-prompt.md` pour le détail et où on en est.

## Par où commencer une reprise de session
Lire `recovery-prompt.md` en premier.
