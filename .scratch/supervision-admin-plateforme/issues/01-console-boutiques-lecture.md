---
id: 001
titre: Console des boutiques — l'admin plateforme voit ses clients à la connexion
statut: done
bloque-par: []
---

# 01 — Console des boutiques (lecture seule)

**Blocked by :** rien — démarrable immédiatement.

## Contexte

L'admin plateforme se connecte et n'arrive nulle part d'utile : le tableau de bord travaille
sur *sa* boutique, or il n'en a pas (`boutique_id` NULL, par conception — c'est ce qui lui
permet de traverser). Il ne peut donc pas choisir le client à dépanner.

Décision du grilling : le point d'entrée à la connexion est la **console des boutiques**, pas
un tableau de bord agrégé — pour ne pas introduire de requête inter-tenant dès l'écran
d'accueil. Spec : `.scratch/supervision-admin-plateforme/spec.md`.

## What to build

L'admin plateforme se connecte et arrive sur une console listant les boutiques clientes
actives. Pour chacune : son **nom**, son **slug**, son **nombre de comptes**. Il peut chercher
par nom. S'il n'existe aucune boutique cliente, l'écran le dit explicitement.

Un manager ne voit pas cet écran : s'il en atteint l'URL, il repart vers son tableau de bord.
Son propre appel de liste continue de ne renvoyer que sa boutique, inchangé.

Cette étape est en **lecture seule** : cliquer une boutique ne fait encore rien (ticket 02).

## Critères d'acceptation

- [x] Une connexion en admin plateforme aboutit sur la console, pas sur le tableau de bord
- [x] La console liste toutes les boutiques actives du seed, chacune avec nom, slug et nombre de comptes
- [x] Le nombre de comptes est exact (vérifié contre les données du seed)
- [x] Une recherche par nom filtre la liste
- [x] Sans aucune boutique active, un message explicite s'affiche — pas une liste vide muette, pas de bouton de création
- [x] Un manager atteignant l'URL de la console est renvoyé vers son tableau de bord
- [x] La liste renvoyée à un manager reste limitée à sa boutique, au même format qu'avant ce ticket
- [x] Une connexion en manager aboutit toujours sur le tableau de bord
- [x] `npx vitest run` ≥ 873/875 (les 2 échecs de fuseau `agendaService` sont permanents)
- [x] `npx tsc --noEmit` ≤ 32 erreurs
- [x] Validation en local live (`wrangler pages dev` + données réelles), pas seulement par relecture

## Réalisation (2026-08-01)

- URL retenue : `/console-boutiques` (`public/console-boutiques.html` +
  `public/static/js/console-boutiques.js`).
- `listAllBoutiques()` enrichi de `nb_comptes` (agrégat sur `users`) et de l'alias
  `b.id AS boutique_id` ; `listBoutiqueForUser()` intact.
- Redirection de connexion factorisée dans `landingPageFor()` / `isAdminPlateforme()`
  (`app.js`), appliquée aux trois chemins de `login.html`.
- **Retiré** : l'auto-sélection de la première boutique venue à la connexion d'un compte
  sans boutique — elle faisait travailler l'exploitant sur un client tiré au sort.
- Vérifications : `vitest` 875/877, `tsc` 32 erreurs, Playwright 145/145 (deux runs
  complets consécutifs), plus un contrôle visuel de la console et de l'état vide.

Reste à traiter dans les tickets suivants : l'en-tête « Console plateforme » et le
libellé « MyDesk » (ticket 02), le bandeau permanent (ticket 03).

**Point signalé, non traité** (hors périmètre) : la console charge et rend la liste
entière sans pagination. Sans effet en production (peu de boutiques) ; visible en local
où les runs E2E ont accumulé ~1 300 boutiques. La recherche est le mécanisme prévu par
la spec ; une pagination relèverait du chantier 2 si le volume le justifie.

## Notes

- L'API de liste renvoie **déjà** toutes les boutiques actives à ce rôle. Le seul manque est le
  nombre de comptes : n'enrichir que le chemin admin plateforme, laisser le chemin manager
  intact — toute modification y serait une prise de risque sur le chemin tenant.
- Vocabulaire imposé (`CONTEXT.md` § Multi-tenant) : « admin plateforme » / « manager », jamais
  « admin » seul, ni dans le code ni à l'écran.
- La redirection de connexion existe en dur à plusieurs endroits de la page de connexion — les
  traiter tous, sous peine d'un comportement dépendant du chemin d'authentification emprunté
  (mot de passe, OTP, Google).
- Piège : après `npm run build`, tuer et relancer `wrangler pages dev` — il ne recharge pas
  `dist/`, sinon les tests visent l'ancien bundle.
