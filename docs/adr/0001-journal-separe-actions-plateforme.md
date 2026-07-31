---
status: accepted
---

# Journal séparé pour les actions de l'admin plateforme

L'admin plateforme (`roles.id = 1`, `boutique_id` NULL) traverse toutes les boutiques pour
superviser et dépanner ses clients, avec un accès complet en lecture et en écriture. Ses
actions sur une boutique cliente sont enregistrées dans un **journal dédié**, distinct de
l'`audit_logs` de cette boutique, et alimenté par un **middleware Hono** qui intercepte
toute requête mutante dont le `boutique_id` visé n'est pas celui de l'appelant.

## Considered Options

**Déduction sans écriture supplémentaire** (recommandée, écartée). `audit_logs` porte déjà
`user_id` et `boutique_id`, et l'admin plateforme est le seul rôle sans boutique : une
action de plateforme est donc identifiable par jointure — une ligne dont l'auteur n'a pas
de boutique alors que la ligne en vise une. Coût nul, aucune migration, aucun code de
journalisation modifié. Écartée parce qu'elle ne produit pas de registre de supervision
consultable pour lui-même, et parce que la déduction tombe si un admin plateforme se voit
un jour attribuer une boutique.

**Colonne dédiée sur `audit_logs`.** Lisible sans jointure ni raisonnement, et robuste à un
changement de modèle de rôles. Écartée pour son coût : une migration **plus** la
modification des 77 appels à `auditLog()` dispersés dans les services et les routes, ou
l'introduction d'un point de passage unique qu'aucun service ne contourne.

## Consequences

**Reconstituer l'historique complet d'un document exige de croiser deux journaux.** C'est
le prix assumé de cette décision, et il se paie précisément dans le cas qui compte : un
litige sur une facture, où l'on veut savoir qui a fait quoi. À prévoir dans toute
fonctionnalité d'export ou de consultation d'historique.

**Le middleware est le seul garant de complétude.** Les 77 appels à `auditLog()` ne passent
par aucun point unique : une journalisation qui reposerait sur eux, ou sur la discipline du
développeur, aurait des trous. C'est la leçon directe des trois campagnes successives de
correction d'isolation (2026-07-19, 07-30, 07-31), dont chacune a laissé des routes
ouvertes derrière elle — voir `project-docs/audit-isolation-2026-07-31.md`. Le middleware
couvre par construction toute route écrite ultérieurement, sans que personne n'y pense.

**Ne jamais attribuer de boutique à un compte admin plateforme.** Le middleware distingue
une action de supervision d'une action ordinaire en comparant le `boutique_id` visé à celui
de l'appelant. Un admin plateforme rattaché à une boutique produirait des actions
indistinguables de celles d'un client sur cette boutique-là.
