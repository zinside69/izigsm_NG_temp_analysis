# iziGSM — Guide d'installation locale

> Version : v2.31.0  
> Repo : https://github.com/zinside69/izigsm_NG_temp_analysis

---

## Prérequis

Ces outils doivent être installés **une seule fois** sur votre machine.

### 1. Node.js (v18 minimum)

- Télécharger sur **https://nodejs.org** → choisir la version **LTS**
- Vérifier l'installation :

```bash
node -v   # doit afficher v18.x.x ou supérieur
npm -v    # doit afficher 9.x.x ou supérieur
```

### 2. Git

- Télécharger sur **https://git-scm.com**
- Vérifier l'installation :

```bash
git --version   # doit afficher git version 2.x.x
```

### 3. Wrangler (CLI Cloudflare)

```bash
npm install -g wrangler
wrangler --version   # doit afficher wrangler x.x.x
```

---

## Installation du projet

### Étape 1 — Cloner le repository

```bash
git clone https://github.com/zinside69/izigsm_NG_temp_analysis.git
cd izigsm_NG_temp_analysis
```

### Étape 2 — Installer les dépendances

```bash
npm install
```

### Étape 3 — Créer le fichier de variables d'environnement

Créer un fichier `.dev.vars` à la racine du projet (il ne sera jamais commité) :

```bash
# .dev.vars
JWT_SECRET=dev-secret-local-minimum-32-caracteres
RESEND_API_KEY=re_xxxxxxxxxxxx
```

> **JWT_SECRET** : chaîne aléatoire d'au moins 32 caractères — utilisée pour signer les tokens d'authentification.  
> **RESEND_API_KEY** : clé API Resend pour l'envoi d'emails (optionnel en développement local — les emails ne seront simplement pas envoyés).

### Étape 4 — Initialiser la base de données locale

```bash
npx wrangler d1 migrations apply DB --local
```

Cette commande crée une base SQLite locale dans `.wrangler/state/v3/d1/` et applique les 25 migrations dans l'ordre.

### Étape 5 — Compiler le projet

```bash
npm run build
```

### Étape 6 — Lancer le serveur de développement

```bash
npx wrangler pages dev dist --local --port 3000
```

Ouvrir dans le navigateur : **http://localhost:3000**

> **Ne pas ajouter `--d1=DB` à `wrangler pages dev`** : ce flag crée une base D1 locale
> distincte (persistance indexée par le nom du flag, pas par `database_id`), différente
> de celle utilisée par `wrangler d1 migrations apply`/`wrangler d1 execute` — symptôme :
> `no such table: users` alors que les migrations viennent d'être appliquées avec succès.
> `wrangler.jsonc` déclare déjà le binding `DB`, `wrangler pages dev` le lit automatiquement
> sans qu'il soit nécessaire de le repasser en CLI. Vérifié le 2026-07-19 en mettant en
> place le gate Playwright de la loop-engineering (`.claude/skills/loop-engineering/`).

---

## Séquence complète (copier-coller)

```bash
git clone https://github.com/zinside69/izigsm_NG_temp_analysis.git
cd izigsm_NG_temp_analysis
npm install
echo 'JWT_SECRET=dev-secret-local-minimum-32-caracteres' > .dev.vars
echo 'RESEND_API_KEY=' >> .dev.vars
npx wrangler d1 migrations apply DB --local
npm run build
npx wrangler pages dev dist --local --port 3000
```

---

## Mettre à jour le projet (après un `git pull`)

```bash
git pull origin main
npm install                                                    # si nouvelles dépendances
npx wrangler d1 migrations apply DB --local    # si nouvelles migrations
npm run build
npx wrangler pages dev dist --local --port 3000
```

---

## Créer un compte administrateur

Au premier lancement, aucun utilisateur n'existe en base. Utiliser le endpoint d'inscription :

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@monentreprise.fr",
    "password": "MotDePasse123!",
    "nom": "Admin",
    "prenom": "Principal",
    "boutique_nom": "Ma Boutique",
    "boutique_ville": "Paris"
  }'
```

Ou directement depuis la page **http://localhost:3000/register.html**.

---

## Structure des URLs principales

| URL | Description |
|---|---|
| `/` | Page d'accueil |
| `/login.html` | Connexion |
| `/register.html` | Création de compte |
| `/dashboard.html` | Tableau de bord |
| `/tickets.html` | Gestion des tickets SAV |
| `/clients.html` | CRM clients |
| `/stock.html` | Gestion du stock |
| `/agenda.html` | Agenda / Rendez-vous |
| `/caisse.html` | Caisse POS |
| `/suivi.html` | Suivi réparation (public) |
| `/rdv-public.html?slug=SLUG` | Prise de RDV en ligne (public) |
| `/api/health` | Health check API |

---

## Commandes utiles

```bash
# Lancer les tests
npm test

# Voir les logs wrangler
npx wrangler pages dev dist --local --port 3000

# Réinitialiser la base de données locale
rm -rf .wrangler/state/v3/d1
npx wrangler d1 migrations apply DB --local

# Consulter la base locale en ligne de commande
npx wrangler d1 execute DB --local --command="SELECT * FROM boutiques"

# Builder sans lancer
npm run build
```

---

## Problèmes fréquents

### Port 3000 déjà utilisé

```bash
# macOS / Linux
lsof -ti:3000 | xargs kill -9

# Windows (PowerShell)
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### Erreur "No such table"

Les migrations n'ont pas été appliquées. Relancer :

```bash
npx wrangler d1 migrations apply DB --local
```

### Erreur JWT / 401 Unauthorized

Vérifier que le fichier `.dev.vars` existe et contient `JWT_SECRET`.

### Wrangler demande une connexion Cloudflare

En mode `--local`, aucune connexion Cloudflare n'est requise. Si la commande demande une auth, ajouter le flag `--local` explicitement.

---

## Architecture technique (rappel)

| Composant | Technologie |
|---|---|
| Backend | Hono (TypeScript) — Cloudflare Workers |
| Base de données | Cloudflare D1 (SQLite) — local via `--local` |
| Frontend | HTML / CSS / JS vanilla + Tailwind CDN |
| Build | Vite + `@hono/vite-cloudflare-pages` |
| Tests | Vitest — 607 tests (15 suites) |
| Déploiement prod | Cloudflare Workers for Platform |

---

*Dernière mise à jour : 5 juillet 2026 — v2.31.0*
