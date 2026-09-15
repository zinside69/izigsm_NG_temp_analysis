# 01 — Boucle d'import commune et bouton « Interrompre »

**What to build:** pendant un import par génération, l'opérateur dispose d'un bouton « Interrompre » :
l'article en cours finit son import, puis l'import s'arrête avec un bilan « Import interrompu » qui
dit combien d'articles restent à importer. Pour y parvenir, la boucle d'import de l'import par
génération devient commune — elle reçoit une liste d'articles à importer (identifiant, nom, quantité
éventuelle), la fiche fournisseur du bilan et le « déjà en stock » connu d'avance — et sa zone
(progression, journal, pause, confirmation, bilan) devient visible dans les deux modes de la fenêtre
fournisseur. Rien ne change pour l'opérateur de l'import par génération, hormis le nouveau bouton.
Spec : `.scratch/import-d-une-selection/spec.md` (stories 25-29, décisions « Une seule boucle
d'import » et « Interrompre »).

**Blocked by:** None — can start immediately.

**Status:** done (2026-09-15)

- [x] Boucle d'import commune : liste d'articles (identifiant, nom, quantité éventuelle), fiche
      fournisseur du bilan, « déjà en stock » connu d'avance — l'import par génération l'appelle avec
      les articles de l'aperçu, sans quantité
- [x] Comportement de l'import par génération inchangé : rythme ≥ 3 s, pause et reprise sur quota avec
      délai, arrêts (quota sans délai, indisponible, connexion perdue), confirmation > 200, bilan,
      avertissement de fermeture — les E2E existants restent verts
- [x] Zone d'import commune aux deux modes de la fenêtre fournisseur (un seul import à la fois)
- [x] « Interrompre » visible pendant tout import : l'article en cours finit puis arrêt ; pendant une
      pause de quota, arrêt immédiat ; bilan « Import interrompu » avec les restants, distinct
      d'« Import arrêté »
- [x] E2E écran (réponses et horloge simulées) : interruption entre deux articles, interruption pendant
      une pause de quota — vus rouges
- [x] `npx vitest run` vert (baseline), tsc ≤ 32, balayage du menu vert

Notes de réalisation :
- Trois E2E d'interruption : article en vol (il finit, compté), entre deux départs, pendant une pause
  de quota. Les deux derniers vus rouges une seconde fois par mutation (réveil de l'attente retiré).
- Interrompre pendant le **dernier** article en vol : la boucle finit d'elle-même, mais le bilan dit
  « Import interrompu » — « rien ne reste à importer » (décision de l'exploitant le 2026-09-15, plus
  explicite qu'« Import terminé » ; E2E « pendant le dernier article », vu rouge).
- `importerArticles()` rend la main **sans** recharger le stock : l'appelant range son état (aperçu,
  sélection) puis appelle `loadStock()` — sinon « Importer N articles » redevenait cliquable sur un
  aperçu périmé pendant le rechargement (défaut vu en revue, corrigé avant commit).
- `basculerSaisieGeneration()` ne fige que les séries et le bouton de la génération : le ticket 02 y
  ajoute les cases de la sélection. Les ids `btn-generation-lancer`/`-annuler` de la confirmation
  (désormais dans la zone commune) restent à nommer quand la sélection s'en servira.
