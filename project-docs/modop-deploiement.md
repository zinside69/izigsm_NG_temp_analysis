# Mode opératoire — mise en production iziGSM

> Écrit le 2026-09-25 pour le lot 1 `vente-lit-catalogue`, valable pour tout déploiement.
> Chaque étape a un **critère d'arrêt** : s'il n'est pas rempli, on s'arrête là, rien n'est rattrapé
> « après coup ». Règles sources : `CLAUDE.md` § Déploiement et § Dépôt git.

## 1. Préconditions — le lot est prêt
- Tous les tickets du lot `done`, critères cochés.
- `npx vitest run` vert (hors les 2 échecs permanents), tsc ≤ baseline (32).
- E2E **complets** sur la vraie base locale, migrations du lot appliquées en local, serveur relancé
  après le dernier build, sans aucune autre charge en parallèle.
- `CACHE_VERSION` (`public/sw.js`) incrémenté si le lot touche `public/`.
- `git fetch origin && git log --oneline origin/main..HEAD` **vide** juste avant de commencer.
**Arrêt si** : un seul de ces points manque.

## 2. Arbre figé
`npm run deploy` et `migrations apply --remote` partent de l'arbre local : **aucun fichier touché**,
aucune session parallèle sur ce dépôt, jusqu'à la fin de l'étape 8.

## 3. Shell propre, bon compte
- `CLOUDFLARE_API_TOKEN` absent du shell (sinon erreur `7403` : c'est le jeton du Worker).
- `npx wrangler whoami` → session OAuth `contact@soteli.fr`, droit `d1 (write)`.
**Arrêt si** : autre compte, ou droit D1 absent.

## 4. Lire la base distante AVANT
- Dernière ligne de `d1_migrations` distant = celle attendue avant le lot.
- Prérequis de données propres au lot (ex. `0048` : 0 doublon de code-barres/SKU actif ;
  recréation de table : `SELECT COUNT(*) FROM pragma_foreign_key_check` = **0**, lu par un chiffre).
**Arrêt si** : écart avec l'état attendu.

## 5. Migrations à distance
`npx wrangler d1 migrations apply DB --remote` — la sortie doit dire **`Resource location: remote`**.
« No migrations to apply » sans cette ligne = faux succès sur la base locale.

## 6. Relire la base distante APRÈS — avant tout code
Dernière ligne de `d1_migrations` distant = dernière migration du lot ; colonnes et tables nouvelles
présentes (`pragma_table_info`, `sqlite_master`).
**Arrêt si** : il en manque une. C'est le seul contrôle qui empêche un Worker de partir sans son schéma.

## 7. Déployer, vérifier l'aperçu d'abord
- `npm run deploy` (par l'exploitant si le mode automatique le refuse) ; relever l'URL d'aperçu.
- **Ne pas ouvrir `repairdesk.fr`** avant la fin de cette étape.
- Sur l'aperçu : `sw.js` porte le nouveau `CACHE_VERSION` ; l'asset hashé **lu dans
  `dist/static/manifest.json`** est servi en `application/javascript` et contient le code du lot ;
  `/api/health` 200 ; chaque nouvelle route sans jeton → 401.
**Arrêt si** : un contrôle échoue — rien n'a encore touché l'apex.

## 8. Vérifier l'apex
Mêmes contrôles sur `repairdesk.fr`. Un asset hashé servi en HTML : **ne pas réessayer**, forcer
un nouveau nom de fichier (empreinte de build en tête d'`app.js`) puis redéployer.

## 9. Preuve métier en production, puis consigner
- Compte de recette : **`telnet@bbox.fr`** (manager, boutique 2) — pas de boutique de recette dédiée
  (`decisions.md` 2026-09-25).
- Lot 1 : import Mobilax (fournisseur de **préproduction** tant que `MOBILAX_API_BASE` n'est pas
  basculé) d'une **pièce de test identifiable**, déjà en stock → « Ajouter 1 au stock » ; relire le
  stock et **un seul** mouvement « Import fournisseur — déjà en stock ». Chaque lot suivant ajoute
  ici son geste de recette.
- Consigner : checkpoint `current-state.md`, ligne « État au … » de `CLAUDE.md` § Déploiement
  (version, dernière migration distante, relus — jamais recopiés).
