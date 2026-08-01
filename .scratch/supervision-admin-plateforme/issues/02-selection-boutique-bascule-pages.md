---
id: 002
titre: Sélection d'une boutique — les 29 pages existantes basculent sur elle
statut: done
bloque-par: [001]
---

# 02 — Sélection d'une boutique et bascule des pages existantes

**Blocked by :** 01 — sans la console, il n'y a rien à sélectionner.

## Contexte

Le backend est prêt : le résolveur de boutique accepte déjà un `boutique_id` explicite **pour
le rôle admin plateforme uniquement**, et les 36 routes gardées laissent passer ce rôle.
Aucune garde d'isolation n'est à modifier.

C'est le frontend qui bloque : il injecte le `boutique_id` **depuis la session**, or l'admin
plateforme n'en a pas. D'où des listes vides et des `400 boutique_id requis`.

## What to build

Cliquer une boutique dans la console fait entrer l'admin plateforme dans son contexte : les
pages métier existantes affichent les données **de cette boutique**, et les écrans qui
répondaient `400` faute de `boutique_id` fonctionnent. Le choix tient pendant toute la session
et survit à la navigation entre pages.

L'en-tête cesse d'afficher « MyDesk » à un compte sans boutique : il indique **« Console
plateforme »** tant qu'aucune boutique n'est choisie, puis le **nom de la boutique consultée**.

Rien ne change pour un manager.

## Critères d'acceptation

- [x] Sélectionner une boutique depuis la console mène à une page métier peuplée des données de cette boutique
- [x] Le choix persiste en naviguant vers une autre page, sans nouvelle sélection
- [x] Une page qui répondait `400` faute de `boutique_id` répond `200` une fois une boutique choisie
- [x] Changer de boutique depuis la console rebascule les pages sur la nouvelle
- [x] L'en-tête affiche « Console plateforme » avant toute sélection, puis le nom de la boutique consultée
- [x] Un manager voit toujours le nom de sa boutique (ou « MyDesk » si elle n'a pas de nom configuré) — comportement inchangé
- [x] Aucune des pages métier existantes n'a été modifiée pour obtenir ce résultat — **une
  exception assumée** : `agenda.js` redéfinissait `getBoutiqueId()` et écrasait le résolveur
  partagé, la figeant sur la boutique 1 en dur. Traité comme le défaut que la note ci-dessous
  prévoit : 6 lignes supprimées (aucune adaptation ajoutée), consigné dans `bugs.md`, couvert par
  un test. Décision utilisateur du 2026-08-01.
- [x] `npx vitest run` ≥ 873/875 · `npx tsc --noEmit` ≤ 32
- [x] Validation en local live sur au moins trois pages métier différentes, pas seulement par
  relecture — **4 pages** (`/dashboard`, `/clients`, `/tickets`, `/agenda`) dans un Chromium réel
  contre `wrangler pages dev` + D1 local, sur deux boutiques aux données distinctes créées pour
  l'occasion. `npx playwright test` → 157/157, trois exécutions complètes consécutives.

## Notes

- **Point de passage unique** : la bascule doit se faire dans le résolveur de `boutique_id`
  partagé, jamais page par page. Si une page nécessite une retouche, c'est le signe qu'elle
  n'emprunte pas les helpers d'appel API partagés — le traiter comme un défaut à signaler, pas
  comme un cas à contourner.
- **Stockage** : mémoriser la boutique choisie **dans l'objet de session déjà existant**, pas
  dans une nouvelle clé. Elle hérite ainsi du bon support (« se souvenir de moi » ou non) et
  surtout de la purge à la déconnexion, sans code de nettoyage à écrire ni à oublier.
- Priorité de résolution : boutique sélectionnée, puis boutique de la session. Aucune sélection
  → aucun `boutique_id` injecté, comportement actuel strictement inchangé.
- Ce ticket donne l'accès en écriture à toute boutique **avant** que le bandeau du ticket 03 ne
  l'affiche. Découpage assumé (décision utilisateur du 2026-08-01) : le déploiement est manuel
  et groupé, l'écart n'atteint jamais la production.
