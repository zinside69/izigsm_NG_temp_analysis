---
id: 08c
titre: Requalification SAV ↔ ticket payant par un technicien, tracée
statut: ready-for-agent
bloque-par: [08b]
---

# 08c — Requalification SAV ↔ ticket payant

## Contexte

Découpé du ticket 08 le 2026-09-30. Après examen, le technicien peut corriger le jugement du
comptoir (story 42) : un dossier **SAV** se révèle hors garantie (casse, oxydation…), ou un ticket
**payant** ouvert pour « autre panne » se révèle couvert. La requalification est **tracée**.
Spec : story 42 ; décision « Parcours IMEI ».

Bloqué par 08b (motif hors garantie sur le ticket, SAV créé depuis le parcours).

**Ne touche ni la caisse ni le NF525** → **confié au socle.** Aucune migration.

### Choix proposés par Claude le 2026-09-30 (à confirmer à la relecture)

- **SAV → payant** : le dossier SAV passe `refuse` avec la résolution « Requalifié en ticket payant
  — <motif> » ; son ticket SAV reçoit le `motif_hors_garantie` choisi ; **la garantie consommée par
  `createSav()` redevient `active`** si sa date de fin n'est pas passée — une panne jugée non
  couverte ne doit pas coûter sa garantie au client.
- **Payant → SAV** : exige une garantie **active** de l'appareil (même règle que le 08b) ; un dossier
  SAV est créé **sur le ticket existant** (`ticket_sav_id` = ce ticket, aucun second ticket), la
  garantie est consommée, le motif du ticket est effacé.
- **Trace** : une ligne `auditLog()` par requalification (avant, après, motif, auteur) ; aucun
  nouveau registre.
- **Rôles** : technicien, manager, admin de boutique.

## Critères d'acceptation

- [ ] `POST /api/sav/:id/requalifier { motif_hors_garantie }` : SAV → payant selon le choix ci-dessus ; dossier déjà `refuse`/`clos` → 409 ; motif hors liste → 400
- [ ] `POST /api/tickets/:id/requalifier-sav` : payant → SAV selon le choix ci-dessus ; aucune garantie active → 409 explicite ; ticket déjà rattaché à un SAV → 409
- [ ] Les deux routes : `assertBoutiqueOwnership()`, `requireRole('admin', 'manager', 'technicien')` ; `tests/routes-isolation-conformite.test.ts` vert
- [ ] Chaque requalification écrit **une** ligne `auditLog()` (entité, avant, après, motif, auteur)
- [ ] Écritures du SQL dans les services, jamais dans le controller ; un échec au milieu ne laisse pas une garantie consommée sans SAV ni un SAV sans garantie (ordre des écritures documenté et testé)
- [ ] Écrans : fiche du dossier SAV (`sav.js`) → « Requalifier en ticket payant » (choix du motif) ; fiche ticket à motif (`tickets.js`) → « Requalifier en SAV » ; la fiche affiche ensuite le nouvel état
- [ ] Appels déballés `(await apiX(…)).data` ; données rendues échappées
- [ ] `CACHE_VERSION` (`public/sw.js`) incrémenté
- [ ] ∀ test vu rouge avant correctif
- [ ] `npx vitest run` sans nouvel échec par rapport à la baseline mesurée avant le ticket
- [ ] Erreurs tsc ≤ baseline mesurée avant le ticket (`npx tsc --noEmit --pretty false | grep -cE "error TS[0-9]+"`)
- [ ] ⊥ migration ; ⊥ caisse ; ⊥ NF525

## Coutures à tester

- **Services de requalification** — vitest contre un **vrai SQLite** (règles portées par plusieurs écritures) : SAV → payant rend la garantie active (et pas si sa date est passée) ; payant → SAV consomme la garantie et crée un seul SAV sur le ticket existant ; 409 sans garantie active ; une ligne d'audit par geste ; échec simulé entre deux écritures → état cohérent.
- **Routes** — vitest par `app.request()` : 403 hors rôle, 404 autre boutique, 409, 400.
- **Écran** — E2E Playwright `tests/e2e/requalification-sav.spec.ts`, vraie D1 locale : SAV requalifié en payant (motif affiché, garantie redevenue active) ; ticket à motif requalifié en SAV. L'E2E est joué par le socle dans le bac à sable (contrôle e2e de gates.json, à déclarer dans la tâche d'écran) ; un E2E hors de sa portée (préproduction, production) se demande dans le compte rendu (P16).

## Notes

- Périmètre : `src/services/garantiesService.ts`, `src/services/ticketService.ts`, `src/routes/sav.ts`, `src/routes/tickets.ts`, `public/static/js/sav.js`, `public/static/js/tickets.js`, `public/sw.js`, tests correspondants.
- D1 n'a pas de transaction interactive : l'« état cohérent » passe par l'ordre des écritures et, si besoin, `db.batch()` (atomique) — à choisir et justifier dans le code.
