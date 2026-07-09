# iziGSM — TODO (project-docs, distinct de docs/TODO.md qui suit les sprints produit)

## Migration Cloudflare — PAUSE au 2026-07-09, reprendre à Task 7

Plan complet : `docs/superpowers/plans/2026-07-09-migration-cloudflare.md` (9 tâches).
Spec : `docs/superpowers/specs/2026-07-09-migration-cloudflare-design.md`.

- [x] Task 1 : npm install + vérif tooling
- [x] Task 2 : R2 activé sur le compte Cloudflare
- [x] Task 3 : migrations D1 (déjà appliquées avant cette session — vérifié 48 tables réelles)
- [x] Task 4 : bucket R2 `izigsm-photos` + binding `PHOTOS` (commits `e1b1c58`, `6f26a51`)
- [x] Task 5 : secret `RESEND_API_KEY` posé (sous-domaine `mail.repairdesk.fr` déjà vérifié Resend)
- [x] Task 6 : build + déploiement HEAD (`885cc1e3`, commit `6f26a51`)
- [ ] **Task 7 — EN COURS, reprendre ici** : validation fonctionnelle sur `izigsm.pages.dev`
  - [x] `/api/health` → v2.45.0 ✓
  - [x] `/register`, `/login` se chargent ✓
  - [ ] Connexion avec `admin@izigsm.fr` / `Admin@2026!` (contournement — voir bugs.md, `/register` cassé)
  - [ ] Vérifier arrivée sur `/dashboard`
  - [ ] Créer un client + un ticket
  - [ ] Uploader une photo sur le ticket (valide R2)
  - [ ] Relancer l'écoute logs pendant le test (`wrangler pages deployment tail 885cc1e3-... --project-name izigsm --format json --status error`)
- [ ] Task 8 : attacher `repairdesk.fr` en custom domain — **confirmation explicite utilisateur requise avant d'exécuter**
- [ ] Task 9 : vérifier MX/SPF/webmail intacts + clôturer les docs

## Dette technique découverte pendant la migration (voir bugs.md pour le détail)
- [ ] `/register` cassé — mauvais chemin API, bloque tout onboarding réel (BLOQUANT, hors scope migration)
- [ ] `docs/ARCHITECTURE_MODULES.md` §2 obsolète (noms de tables)
- [ ] 3 tests unitaires sensibles au fuseau horaire (non-bloquant)

## Dette technique héritée (préexistante, voir bugs.md)
- [ ] `tests/phoneCatalogService.test.ts` à créer
- [ ] Investiguer `/robots.txt` 500 sur Genspark (sans objet une fois Genspark abandonné)
