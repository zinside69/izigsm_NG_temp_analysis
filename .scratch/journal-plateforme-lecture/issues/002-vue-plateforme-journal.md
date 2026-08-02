---
id: 002
titre: Vue plateforme du journal + endpoint de lecture
statut: ready-for-agent
bloque-par: []
---

## Contexte

`journal_actions_plateforme` se remplit depuis le ticket 04 & **⊥ interface ne le lit**.
Seul recours actuel : console D1 du tableau de bord Cloudflare (requête de dépannage dans
`todo.md`).

Ce ticket porte le socle de lecture : service de requête, endpoint admin plateforme, table
de libellés métier, page. Le ticket 003 (vue manager) le réutilise.

⊥ bloqué par 001 : la vue fonctionne sur des lignes à cible nulle — elle les affiche
comme telles.

## Critères d'acceptation

- [ ] api: `GET /api/journal-plateforme` → `{ success, data, pagination }`, query `boutique_id?`, `user_id?`, `date_debut?`, `date_fin?`, `page?`, `limit?`
- [ ] Réservée à l'admin plateforme (`role === 'admin'` & `boutique_id` absent) → 403 pour un manager, testé
- [ ] ∀ jointure en `LEFT JOIN` : compte supprimé | boutique désactivée gardent leur ligne, affichée `compte #<id>` | `boutique #<id>`
- [ ] Ligne à cible nulle → « (non résolue) » explicite, ⊥ rattachée à la boutique filtrée
- [ ] Filtres boutique | auteur | période, croisables
- [ ] Défaut : 30 derniers jours, paginé
- [ ] Libellé métier avec **repli** sur `METHODE /chemin` brut si le chemin est absent de la table
- [ ] Colonnes affichées : quand, qui, chez qui, quoi, statut HTTP, corps expurgé, IP
- [ ] Page atteinte depuis la console des boutiques
- [ ] Barre latérale du socle + `main.css` (règle cp75) ; si entrée de menu → ajout à `MENU_GAUCHE` **et** `PAGES_AVEC_SOCLE`
- [ ] ∀ donnée d'API rendue passe par `echapperHtml()` — le corps expurgé est une saisie utilisateur réinjectée
- [ ] ∀ appel : `const res = (await apiGet(…)).data`
- [ ] Test E2E : la page affiche une ligne réellement écrite (rendu, ⊥ requête)
- [ ] ∀ test vu rouge avant correctif
- [ ] `npx vitest run` 893 verts · `npx tsc --noEmit` ≤ 32 · `npx playwright test` vert
- [ ] ⊥ migration dans ce ticket

## Notes

- Prior art tests : `console-boutiques.spec.ts`, `isolation-routes.spec.ts`.
- Requête de dépannage (`todo.md` § P1) donne les jointures & les libellés de repli.
- Index existant `(boutique_id, created_at)` — la pagination s'appuie dessus.
- Garde-fou `frontend-enveloppe-api-conformite` fait rouge la suite sur un `res.success`.
- Lecture ⊥ journalisée : le middleware ne prend que les méthodes mutantes. ⊥ « corriger ».
