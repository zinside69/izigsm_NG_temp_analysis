---
id: 003
titre: Bandeau permanent « Vous consultez la boutique X » + retour console
statut: ready-for-agent
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

- [ ] Le bandeau nomme la boutique consultée et reste visible après navigation vers une autre page
- [ ] Il est présent sur toutes les pages qui construisent leur interface avec le socle partagé
- [ ] Aucune interaction ne permet de le masquer ou de le refermer
- [ ] Son action ramène à la console, et changer de boutique met le bandeau à jour
- [ ] Un manager ne voit aucun bandeau, sur aucune page
- [ ] Un admin plateforme sans sélection ne voit aucun bandeau
- [ ] Après déconnexion puis reconnexion en admin plateforme, aucune boutique n'est présélectionnée
- [ ] Le bandeau ne masque ni ne décale un contenu utile des pages existantes (vérifié à l'écran, pas déduit du CSS)
- [ ] `CACHE_VERSION` incrémenté — dernière tâche frontend du chantier
- [ ] `npx vitest run` ≥ 873/875 · `npx tsc --noEmit` ≤ 32
- [ ] Validation en local live, y compris la persistance du bandeau au fil de la navigation

## Notes

- Rendu par le **socle partagé** qui construit déjà la navigation commune : aucune page ne doit
  être touchée individuellement.
- La purge à la déconnexion doit être automatique si le ticket 02 a bien stocké la sélection
  dans l'objet de session existant. Si un nettoyage explicite s'avère nécessaire, c'est que le
  stockage a dévié de la décision — le corriger plutôt que d'ajouter le nettoyage.
- Sans incrément de `CACHE_VERSION`, les navigateurs déjà venus continueront de servir l'ancien
  socle : le bandeau ne s'affichera pas, et l'on conclura à tort à un bug de code.
