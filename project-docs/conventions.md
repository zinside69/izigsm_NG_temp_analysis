# iziGSM — Conventions

- Commits en français, format `type(scope): description — Sprint X.XX` (ex: `feat(D09): photos tickets R2 — Sprint 2.41-E v2.45.0`)
- Version bumpée dans `src/index.tsx` (`@version` + champ `version` du `/api/health`) à chaque sprint fonctionnel
- Doc à jour à chaque sprint : `docs/TODO.md` (suivi sprints), `docs/JOURNAL_MODIFICATIONS.md` (traçabilité fichier par fichier), `docs/GAP_ANALYSIS_ENRICHI.md` (couverture CDC), `docs/ARCHITECTURE_MODULES.md` (architecture + endpoints)
- P1 MVC strict : 0 SQL dans `src/routes/`, tout dans `src/services/`
- P2 : 0 axios, 0 ApiService côté frontend — uniquement les helpers `app.js` (`apiGet/apiPost/...`)
- Tests Vitest par service dans `tests/*.test.ts`, mock D1 via `tests/helpers/mockD1.ts`
- Ne jamais écraser une ligne d'historique de version dans `docs/TODO.md` — toujours ajouter en dessous (règle globale CLAUDE.md)
- Toujours proposer avant de modifier/supprimer un fichier existant (règle globale CLAUDE.md)
