# Labels de triage — iziGSM

_Config lue par le skill `triage`._

Le tracker étant en markdown local (voir `issue-tracker.md`), les labels sont portés
par le champ `statut:` du frontmatter de chaque ticket — pas par un système de labels
externe. Une seule valeur à la fois.

| Valeur | Signification |
|---|---|
| `needs-triage` | Arrivé brut, pas encore instruit. État par défaut de toute demande entrante. |
| `needs-info` | Instruit mais bloqué : il manque une info que seul un humain peut donner. |
| `ready-for-agent` | Cadré, critères d'acceptation vérifiables → `/implement` peut le prendre. |
| `ready-for-human` | Cadré mais exige un jugement, un accès ou une action hors agent (déploiement, DNS, décision produit). |
| `wontfix` | Écarté. Garder le fichier avec la raison, ne pas le supprimer. |
| `done` | Terminé et vérifié. Débloque les tickets qui le listent en `bloque-par`. |

## Périmètre du triage

`/triage` ne s'applique qu'aux demandes **que tu n'as pas créées** : bug remonté par un
utilisateur d'une boutique, demande d'évolution, anomalie constatée en production.

Les tickets produits par `/to-tickets` sont déjà `ready-for-agent` par construction —
**ne pas les faire passer par `/triage`**.
