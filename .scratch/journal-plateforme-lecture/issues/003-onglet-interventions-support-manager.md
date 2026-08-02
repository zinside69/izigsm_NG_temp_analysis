---
id: 003
titre: Onglet « Interventions du support » pour le manager
statut: ready-for-agent
bloque-par: [001, 002]
---

## Contexte

ADR 0001 justifie le registre par : *le client doit pouvoir savoir ce qui a été fait sur
ses données, en particulier sur une facture en cas de litige*. Tant que seul l'admin
plateforme lit le journal, cette promesse reste théorique.

Bloqué par **001** : sans la résolution des routes `/:id`, le manager verrait un registre
muet sur ses factures — exactement le cas de litige — sans rien qui l'en avertisse.
Bloqué par **002** : réutilise son service de requête & sa table de libellés.

## Critères d'acceptation

- [ ] api: `GET /api/journal-plateforme/ma-boutique` → `{ success, data, pagination }`
- [ ] Boutique dérivée du **jeton**, ⊥ de la query : un manager qui pose `?boutique_id=<autre>` reste sur la sienne. Testé
- [ ] `ip_address` retirée **côté service**, ⊥ côté page — une colonne masquée en CSS reste dans la réponse
- [ ] Test E2E asserte l'absence d'`ip_address` dans le **corps** de la réponse, ⊥ à l'écran
- [ ] Onglet « Interventions du support » dans les réglages
- [ ] Colonnes : quand, qui (nom de l'intervenant), quoi (libellé métier), statut, corps expurgé
- [ ] Boutique sans intervention → état vide explicite (« aucune intervention du support »), distinct d'un écran cassé
- [ ] Défaut 30 jours, paginé, sélecteur de période
- [ ] Un admin plateforme ayant sélectionné une boutique voit ce même onglet cohérent avec la boutique consultée
- [ ] ∀ donnée rendue → `echapperHtml()` ; ∀ appel déballé `(await apiGet(…)).data`
- [ ] `CACHE_VERSION` (`public/sw.js`) incrémenté — dernière tâche frontend du chantier
- [ ] ∀ test vu rouge avant correctif
- [ ] `npx vitest run` 893 verts · `npx tsc --noEmit` ≤ 32 · `npx playwright test` vert

## Notes

- Isolation : prior art `isolation-routes.spec.ts` — un manager de A ⊥ obtient les lignes de B, par l'écran comme par l'API.
- ⊥ exposer l'IP d'un salarié de la plateforme à un client (minimisation RGPD). Décision du cadrage, ⊥ rouvrir sans motif.
- Leçon ticket 04 : une garantie confiée à l'appelant finit oubliée → l'expurgation vit dans le service.
- Déploiement ⊥ automatique : ! confirmation explicite utilisateur, migrations distantes avant Worker (⊥ migration ici).
