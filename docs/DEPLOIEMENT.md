# Mode opératoire — Déploiement iziGSM sur Cloudflare Pages

> Version : Sprint 2.27+ · Stack : Hono + TypeScript + Cloudflare D1 · Pages

---

## Prérequis

| Outil | Version min | Vérification |
|---|---|---|
| Node.js | 18+ | `node -v` |
| npm | 9+ | `npm -v` |
| Wrangler | 3.78+ | `npx wrangler --version` |
| Compte Cloudflare | actif | dashboard.cloudflare.com |
| Domaine (optionnel) | — | CF DNS ou externe |

---

## Étape 1 — Préparation locale

```bash
# 1.1 — Cloner le repo (ou partir du sandbox)
git clone https://github.com/OWNER/izigsm.git
cd izigsm

# 1.2 — Installer les dépendances
npm install

# 1.3 — Vérifier que le build passe
npm run build
# Attendu : ✓ 71 modules / ~248 kB
```

---

## Étape 2 — Authentification Cloudflare

```bash
# Option A — Via API Token (recommandé CI/CD)
export CLOUDFLARE_API_TOKEN="votre_token_ici"
npx wrangler whoami   # doit afficher votre email

# Option B — Via navigateur (interactive)
npx wrangler login
# OU
npx wrangler auth   # selon la version
```

> **Token requis** : `Zone:Edit`, `Workers:Edit`, `Pages:Edit`, `D1:Edit`
> Créer sur : https://dash.cloudflare.com/profile/api-tokens

---

## Étape 3 — Création du projet Cloudflare Pages

```bash
# 3.1 — Créer le projet Pages (une seule fois)
npx wrangler pages project create izigsm --production-branch main

# 3.2 — Récupérer votre account_id Cloudflare
npx wrangler whoami
# → "Your account ID is: XXXXXXXXXXXXXXXX"
```

---

## Étape 4 — Création de la base D1

```bash
# 4.1 — Créer la base de production
npx wrangler d1 create izigsm-production
# → Copier le "database_id" affiché

# 4.2 — Mettre à jour wrangler.jsonc avec l'ID réel
# Modifier le champ "database_id" :
# "database_id": "VOTRE-UUID-ICI"
```

---

## Étape 5 — Application des migrations D1

```bash
# 5.1 — Tester en local d'abord (mode --local)
npx wrangler d1 migrations apply izigsm-production --local
# Doit appliquer les 24 migrations sans erreur

# 5.2 — Appliquer en production (ATTENTION — irréversible)
npx wrangler d1 migrations apply izigsm-production
# Attendu : migrations 0001 à 0024 applied ✓
```

> ⚠️ En cas d'erreur sur une migration : corriger le SQL, re-tenter.
> Les migrations D1 utilisent `IF NOT EXISTS` — elles sont idempotentes.

---

## Étape 6 — Configuration des secrets

```bash
# Chaque secret est interactif (saisie masquée)

# 6.1 — JWT Secret (OBLIGATOIRE — min 32 chars)
npx wrangler pages secret put JWT_SECRET --project-name izigsm
# Saisir : une chaîne aléatoire forte, ex: openssl rand -hex 32

# 6.2 — Email Resend (optionnel — mode simulé si absent)
npx wrangler pages secret put RESEND_API_KEY --project-name izigsm
# Saisir : re_XXXXXXXXXXXXXXXXXXXXXXXXXX (depuis resend.com)

# 6.3 — Vérifier les secrets configurés
npx wrangler pages secret list --project-name izigsm
```

> **Mode simulé email** : si `RESEND_API_KEY` absent, `emailService.ts` logue en DB avec `statut='simule'` — aucune erreur bloquante.

---

## Étape 7 — Premier déploiement

```bash
# 7.1 — Build de production
npm run build
# Vérifie : dist/_worker.js ~ 248 kB

# 7.2 — Déployer vers Cloudflare Pages
npx wrangler pages deploy dist --project-name izigsm --branch main

# Sortie attendue :
# ✓ Uploading... (71 files)
# ✓ Deployment complete!
# → https://izigsm.pages.dev
```

---

## Étape 8 — Vérifications post-déploiement

```bash
# 8.1 — Health check API
curl https://izigsm.pages.dev/api/health
# Attendu : {"status":"ok","db":"connected"}

# 8.2 — Test auth
curl -X POST https://izigsm.pages.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"VOTRE_MDP"}'
# Attendu : {"success":true,"token":"eyJ...","session":{...}}

# 8.3 — Test D1
curl https://izigsm.pages.dev/api/boutiques \
  -H "Authorization: Bearer VOTRE_TOKEN"
# Attendu : {"success":true,"data":[...]}
```

---

## Étape 9 — Domaine personnalisé (optionnel)

```bash
# Via wrangler CLI
npx wrangler pages domain add izigsm.votredomaine.com --project-name izigsm

# OU via le Dashboard Cloudflare :
# Pages → izigsm → Custom domains → Set up a custom domain
```

**Configuration DNS** :
```
CNAME  izigsm  izigsm.pages.dev  (proxied)
```

---

## Étape 10 — Déploiements suivants (CI/CD)

```bash
# Workflow standard après chaque push main :
npm run build
npx wrangler pages deploy dist --project-name izigsm --branch main

# Si nouvelles migrations :
npx wrangler d1 migrations apply izigsm-production
npm run build
npx wrangler pages deploy dist --project-name izigsm --branch main
```

### GitHub Actions (exemple `.github/workflows/deploy.yml`)

```yaml
name: Deploy iziGSM
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run build
      - name: Apply D1 migrations
        run: npx wrangler d1 migrations apply izigsm-production
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
      - name: Deploy Pages
        run: npx wrangler pages deploy dist --project-name izigsm
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
```

> Secrets GitHub à configurer : `CF_API_TOKEN`, `CF_ACCOUNT_ID`

---

## Référence rapide — Variables d'environnement

| Variable | Obligatoire | Description | Valeur exemple |
|---|---|---|---|
| `JWT_SECRET` | ✅ OUI | Signature JWT sessions | `openssl rand -hex 32` |
| `RESEND_API_KEY` | ❌ NON | Envoi emails Resend | `re_XXXXXXXX` |
| `CLOUDFLARE_API_TOKEN` | CI/CD | Token API CF | `cf_...` |
| `CLOUDFLARE_ACCOUNT_ID` | CI/CD | ID compte CF | UUID |

---

## Rollback

```bash
# Lister les déploiements
npx wrangler pages deployment list --project-name izigsm

# Rollback vers un déploiement précédent
npx wrangler pages deployment rollback DEPLOYMENT_ID --project-name izigsm
```

---

## Diagnostic courant

| Symptôme | Cause probable | Solution |
|---|---|---|
| 500 sur `/api/auth/login` | `JWT_SECRET` absent | `wrangler pages secret put JWT_SECRET` |
| 500 sur toute route DB | D1 non lié ou migrations absentes | Vérifier `wrangler.jsonc` + re-run migrations |
| Page blanche sans console error | Build non déployé | Re-run `npm run build && wrangler pages deploy` |
| Emails non envoyés | `RESEND_API_KEY` absent | Mode simulé actif — normal, vérifier DB `email_logs` |
| `authHeaders is not defined` | Ancien JS non migré | Vérifier les fichiers JS — cf. Sprint 2.27 |
| Statuts tickets incohérents | Anciens statuts EN_MAJUSCULE | Vérifier migrations + constantes `STATUT_LABELS` |

---

## Structure des fichiers de déploiement

```
webapp/
├── dist/              ← build Vite (généré — NE PAS committer)
│   ├── _worker.js     ← bundle Hono Edge Worker (~248 kB)
│   ├── _routes.json   ← routing CF Pages
│   └── static/        ← assets statiques copiés de public/
├── migrations/        ← 24 fichiers SQL (0001 → 0024)
├── wrangler.jsonc     ← config CF Pages + D1 bindings
└── package.json       ← scripts build/deploy
```

---

*Dernière mise à jour : Sprint 2.27 — Juillet 2026*
