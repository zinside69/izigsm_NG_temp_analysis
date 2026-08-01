---
id: 003
titre: Bandeau permanent « Vous consultez la boutique X » + retour console
statut: done
bloque-par: [002]
---

# 03 — Bandeau permanent et retour à la console

**Blocked by :** 02 — il n'y a de boutique consultée à annoncer qu'une fois la sélection en place.

## Contexte

L'admin plateforme conserve un accès complet, lecture **et** écriture, sur la boutique qu'il
consulte. Le bandeau est la contrepartie explicitement posée au grilling : à tout instant, il
doit savoir chez qui il agit, et ne pas pouvoir l'ignorer.

## What to build

Une bannière haute, pleine largeur, affiche en permanence « Vous consultez la boutique **X** »
sur **toute** page, avec une action qui ramène à la console pour changer de boutique. Elle ne
peut être ni masquée ni refermée.

Elle n'apparaît que pour un admin plateforme ayant sélectionné une boutique — jamais pour un
manager, jamais avant la sélection.

Après déconnexion puis reconnexion, aucune boutique n'est présélectionnée : la session repart
d'un choix explicite.

## Critères d'acceptation

- [x] Le bandeau nomme la boutique consultée et reste visible après navigation vers une autre page
- [x] Il est présent sur toutes les pages qui construisent leur interface avec le socle partagé
- [x] Aucune interaction ne permet de le masquer ou de le refermer
- [x] Son action ramène à la console, et changer de boutique met le bandeau à jour
- [x] Un manager ne voit aucun bandeau, sur aucune page
- [x] Un admin plateforme sans sélection ne voit aucun bandeau
- [x] Après déconnexion puis reconnexion en admin plateforme, aucune boutique n'est présélectionnée
- [x] Le bandeau ne masque ni ne décale un contenu utile des pages existantes (vérifié à l'écran, pas déduit du CSS)
- [x] `CACHE_VERSION` incrémenté — dernière tâche frontend du chantier
- [x] `npx vitest run` ≥ 873/875 · `npx tsc --noEmit` ≤ 32
- [x] Validation en local live, y compris la persistance du bandeau au fil de la navigation

## Notes

- Rendu par le **socle partagé** qui construit déjà la navigation commune : aucune page ne doit
  être touchée individuellement.
- La purge à la déconnexion doit être automatique si le ticket 02 a bien stocké la sélection
  dans l'objet de session existant. Si un nettoyage explicite s'avère nécessaire, c'est que le
  stockage a dévié de la décision — le corriger plutôt que d'ajouter le nettoyage.
- Sans incrément de `CACHE_VERSION`, les navigateurs déjà venus continueront de servir l'ancien
  socle : le bandeau ne s'affichera pas, et l'on conclura à tort à un bug de code.

## Réalisation (2026-08-01)

`renderBandeauPlateforme()` dans `public/static/js/app.js`, appelé par `buildSidebar()`. Styles
et décalage du socle dans `public/static/css/main.css`. `CACHE_VERSION` → `izigsm-v2.84`.
Tests : `tests/e2e/bandeau-plateforme.spec.ts` (10 cas), helpers partagés extraits dans
`tests/e2e/fixtures/console-plateforme.ts`.

Trois points décidés en cours de route, non prévus par le ticket :

- **Le bandeau passe au-dessus des modals** (`z-index: 900`, au-delà des 500 de `.modal-overlay`).
  Un modal de saisie est justement l'écran où l'on écrit chez le client : l'y laisser recouvrir
  le bandeau l'aurait rendu masquable par le premier geste d'écriture venu.
- **Masqué à l'impression** (`@media print`). Le bandeau est enfant direct de `body`, or
  `_triggerPrint()` ne masque que `body > .app-layout` : sans cette règle il volait ~44 mm au
  budget d'une page A4, garanti par ailleurs.
- **Le bandeau ne couvre que les 10 pages qui appellent `buildSidebar()`.** Le critère du ticket
  est tenu, l'intention « toute page » ne l'est pas : 10 autres pages internes portent leur
  propre mise en page **et lisent `session.boutique_id` en direct**, donc ignorent déjà la
  boutique sélectionnée. Leur poser le bandeau les ferait mentir sur la boutique réellement
  visée — c'est le défaut sous-jacent qu'il faut traiter d'abord. Tracé dans
  `project-docs/todo.md` § « Pages hors socle partagé ».
