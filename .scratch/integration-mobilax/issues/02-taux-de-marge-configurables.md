# 02 — Taux de marge configurables (défaut boutique + par famille)

**What to build:** l'exploitant fixe un taux de marge par défaut pour sa boutique, et
optionnellement un taux différent par `famille` de produit (pièce, accessoire, appareil,
consommable), depuis les réglages boutique. Une famille sans taux propre retombe sur le taux par
défaut. Indépendant de Mobilax — sert de base à l'application de la marge dans les tickets 06-09.

**Blocked by:** None — peut démarrer immédiatement, en parallèle du ticket 01.

**Status:** done (2026-09-10)

- [x] L'exploitant peut fixer un taux de marge par défaut pour sa boutique dans les réglages
      existants (même niveau que le taux de TVA par défaut déjà présent)
- [x] L'exploitant peut fixer, optionnellement, un taux différent pour chacune des quatre
      familles existantes (`piece`, `accessoire`, `appareil`, `consommable`)
- [x] La résolution du taux applicable suit l'ordre : taux de la famille s'il est défini, sinon
      taux par défaut de la boutique
- [x] Tests couvrant les trois cas : taux par défaut seul, famille surchargée, famille sans
      taux propre (repli sur le défaut)
- [x] Isolation : le taux d'une boutique n'affecte jamais la résolution d'une autre boutique
- [x] Test vu rouge avant le correctif

**Réalisation** — décisions prises en cours de ticket, avec l'exploitant :

- Stockage : 5 colonnes nullables sans DEFAULT sur `boutique_settings` (migration `0042`).
  `resoudreTauxMarge(settings, famille)` (`boutiqueService.ts`, pure) renvoie le taux de la
  famille, sinon le défaut, sinon **`null`** — une boutique sans taux ne se voit imposer aucune
  marge. Le ticket 06 doit donc gérer `null` (prix à saisir). Un taux de famille à `0` l'emporte
  sur le défaut (`??`, pas `||`).
- Écriture par une **route dédiée** `PUT /api/boutiques/:id/marges` → `updateTauxMarge()`, et
  non par `PUT /:id/settings` : cette dernière réécrit la TVA et les paiements à chaque appel
  (défaut mesuré en local, consigné dans `bugs.md`, non corrigé ici). Remplacement complet des
  cinq taux ; 422 sur une valeur ni `null` ni nombre ≥ 0 ; 404 sur une boutique absente ou
  inactive (ajouté après revue : sans ce contrôle, l'UPDATE ne touchait rien et la route
  annonçait « mis à jour »). Complété le 2026-09-11 après une seconde revue : 404 aussi quand
  la boutique existe sans ligne `boutique_settings` (même faux succès, cas rare).
- Garde plus stricte que `/settings` : un compte rattaché à une boutique n'écrit que chez lui,
  rôle `admin` compris ; seul l'admin plateforme vise ailleurs.
- Écran : onglet **Marges** de `/settings`.
- Tests : `tests/boutiqueService.test.ts` (résolution + écriture), `tests/boutiques-marges-route.test.ts`
  (route, isolation, validation), `tests/e2e/reglages-taux-marge.spec.ts` (relecture après
  rechargement, et non-effacement par l'onglet Paiements).
