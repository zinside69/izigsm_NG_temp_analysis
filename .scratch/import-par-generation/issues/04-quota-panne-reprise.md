# 04 — Quota, panne du fournisseur et reprise

**What to build:** pendant un import par génération, si le quota du fournisseur est atteint,
l'import se met en pause avec un compte à rebours (« quota fournisseur atteint — reprise dans
34 s ») puis reprend l'article en cours tout seul. Si le fournisseur ne répond plus, l'import
s'arrête et affiche son bilan. Relancer la même génération n'importe que ce qui manque.
Spec : stories 15-17, 19.

**Blocked by:** 03 — Importer la génération : boucle, progression, bilan

**Status:** done (2026-09-14)

- [x] Quota atteint : pause, compte à rebours du délai rendu par le serveur (`ratelimit-reset`),
      reprise de l'article interrompu — jamais de nouvelle tentative sans délai connu
- [x] Fournisseur indisponible : arrêt, bilan partiel (importés jusque-là, restants)
- [x] Relance de la même génération : l'aperçu compte les produits déjà importés « déjà en stock »,
      seul le reste est importé (anti-doublon `0046`)
- [x] E2E écran avec l'API d'iziGSM simulée et l'horloge simulée : pause + compte à rebours +
      reprise, arrêt sur indisponibilité, relance qui n'importe que le manquant — vus rouges
- [x] `CACHE_VERSION` incrémenté (dernière tâche d'écran du chantier)
- [x] `npx vitest run` vert (baseline), tsc ≤ 32, balayage du menu vert

**Livré (2026-09-14)** — boucle de `lancerImportGeneration()` (`stock.js`) :
- **quota avec délai** (`reessayer_dans_s`) : ligne « ⏸ » au journal, `compteARebours()` affiche
  « Quota fournisseur atteint — reprise dans N s » seconde par seconde (`#mobilax-import-pause`),
  puis le **même** article repart — aucune nouvelle tentative avant la fin du compte à rebours ;
- **quota sans délai connu** : arrêt (lecture de « jamais de nouvelle tentative sans délai connu ») ;
- **`indisponible`** (Mobilax en panne) : arrêt ;
- **rejet de `fetch`** (connexion à iziGSM perdue) : arrêt, motif distinct « Connexion perdue avec
  iziGSM » — continuer ferait échouer tous les articles suivants ;
- **bilan partiel** : « Import arrêté », motif, « N articles restants » (article en cours + suivants),
  « relancez la même génération, seul le manquant sera importé » ;
- **relance** : l'aperçu (ticket 02) recompte les importés « déjà en stock » par l'anti-doublon ; une
  nouvelle recherche est possible dès l'arrêt.
`CACHE_VERSION` `izigsm-v3.03` → **`izigsm-v3.04`**. Aucune route, aucune migration, aucun code
serveur modifié. E2E : 4 tests (horloge simulée), vus rouges sur le build du ticket 03.

**Décision prise en implémentation, à confirmer par l'exploitant** : la connexion perdue **arrête**
l'import (spec amendée) — contrairement à la note du ticket 03 (« seul `indisponible` doit
arrêter »). Motif : continuer compterait chaque article restant en échec.

Relevés en revue, non traités : le verdict sur le quota est pris en deux endroits de la boucle (une
fonction de classement de réponse les réunirait) ; « restant(s) » accordé à la main à côté de
`compter()` ; `IMPORT_OK()`/`QUOTA()` (E2E) sont des fabriques nommées en constantes ; deux couleurs
codées en dur de plus (`#b45309`) ; aucun bouton pour interrompre un import (une suite de quotas
répétés ne s'arrête qu'en fermant l'onglet, avec avertissement) ; `CLAUDE.md` § Service Mobilax ne
mentionne pas encore cette seule reprise automatique sur 429 (à faire au checkpoint).

**Déploiement du chantier** : les tickets 01-04 partent en un bloc (`izigsm-v3.04`), **aucune
migration**. Dépendance (ticket 05 de `reglages-stock-boutique`) déjà en production depuis le
2026-09-12.

⚠ Même dépendance de déploiement que le ticket 03 (ticket 05 de `reglages-stock-boutique`).
