# 02 — Cocher et importer une sélection sur la page affichée

**What to build:** dans les résultats de la recherche fournisseur (mode « Par article »), le manager ou
l'admin de boutique coche des articles de la page affichée ; une barre « N sélectionnés · durée
estimée » apparaît avec « Importer la sélection ». L'import passe par la boucle commune (ticket 01),
chaque article avec la « Qté en rayon » de sa ligne, et se termine par le bilan habituel — lien vers le
stock du fournisseur compris. Pendant l'import, les cases sont figées et les boutons « Importer » des
lignes désactivés ; après, restent cochés les échecs et les restants, prêts à être relancés. Spec :
`.scratch/import-d-une-selection/spec.md` (stories 1, 8-9, 11-12, 15-24, 30-40).

**Blocked by:** 01 — Boucle d'import commune et bouton « Interrompre ».

**Status:** done (2026-09-15)

- [x] Une case par article de la page affichée ; cases, barre de sélection et boutons « Importer » des
      lignes affichés seulement pour un manager ou un admin de boutique (technicien : ni cases ni
      boutons d'import)
- [x] Barre de sélection : nombre sélectionné, durée estimée (× 3 s, arrondie à la minute),
      « Importer la sélection » ; masquée tant que rien n'est coché
- [x] Chaque article part avec la « Qté en rayon » de sa ligne, en nombre ; vide → non envoyée (stock
      initial par défaut) ; une ligne cochée à quantité invalide (autre qu'un entier ≥ 0) empêche le
      lancement et est signalée
- [x] Import par la boucle commune : rythme, quota, arrêts, confirmation > 200, « Interrompre », bilan
      (importés, déjà en stock via `deja_importe`, échecs nommés, répartition par famille)
      — **sauf la confirmation > 200, reportée au ticket 03** (case ajoutée là-bas) : une page compte
      au plus 100 articles, le seuil n'est pas atteignable dans ce ticket
- [x] La réponse de la recherche porte la fiche fournisseur de la boutique (`fournisseur_id`) — lien du
      bilan vers `/stock?fournisseur_id=` ; test de route vu rouge
- [x] Pendant l'import : recherche libre, cases figées, « Importer la sélection », boutons « Importer »
      des lignes et nouvelle génération désactivés
- [x] Après l'import (fin, arrêt ou interruption) : importés et déjà en stock décochés, échecs et
      restants restés cochés — la barre relance exactement ce qui manque
- [x] E2E écran (réponses et horloge simulées) : sélection et import, quantités envoyées, quantité
      invalide bloquante, bilan et lien, cases figées pendant l'import, restants restés cochés et
      relance, rôles — vus rouges
- [x] `npx vitest run` vert (baseline), tsc ≤ 32, balayage du menu vert

Notes de réalisation :
- Sélection lue sur la page affichée : changer de page ou relancer une recherche la vide (garde
  multi-pages au ticket 03). La case est dans la cellule « Pièce », sans colonne ajoutée.
- « Qté en rayon » pré-remplie avec le stock initial par défaut (précédent de l'import unitaire) : une
  ligne n'est « vide » que si l'opérateur l'efface. Validation : entier ≥ 0 ou vide, texte non
  numérique compris (`validity.badInput`, que `value` rend vide).
- Technicien : ni case, ni « Qté en rayon », ni « Importer ». Rôles couverts par E2E : manager (boutique
  neuve — l'inscription crée un `role_id` 2 — et manager du seed), technicien du seed. **Admin de
  boutique non couvert** : aucune fixture n'en crée ; même branche de code que le manager.
- `importerArticles()` rend `bilan.idsTraites` (importés + déjà en stock) ; `relance` accepte une
  fonction lue au moment du bilan. Revue : une recherche relancée pendant l'import remplaçait les lignes
  et le bilan affirmait pourtant « ils restent cochés » → la sélection garde ses cases lancées et vérifie
  qu'elles sont encore dans la page. Message « quantité invalide » effacé au lancement valide.
- `basculerSaisieImport(true)` rend au bouton de la génération l'état de l'aperçu (`recalculerApercu()`)
  au lieu de le réactiver : sinon actif sur un aperçu vide après un import d'une sélection.
- Vus rouges : 6 E2E avant le code (cases absentes, technicien voyait 2 boutons), test de route
  (`fournisseur_id` absent), puis les correctifs de revue par mutation — bilan, message, rôle manager,
  `badInput`. « Génération refusée pendant l'import » décrit un comportement antérieur au ticket :
  aucune mutation du ticket ne le fait rougir.
