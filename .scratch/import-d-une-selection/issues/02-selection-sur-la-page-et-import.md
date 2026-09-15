# 02 — Cocher et importer une sélection sur la page affichée

**What to build:** dans les résultats de la recherche fournisseur (mode « Par article »), le manager ou
l'admin de boutique coche des articles de la page affichée ; une barre « N sélectionnés · durée
estimée » apparaît avec « Importer la sélection ». L'import passe par la boucle commune (ticket 01),
chaque article avec la « Qté en rayon » de sa ligne, et se termine par le bilan habituel — lien vers le
stock du fournisseur compris. Pendant l'import, les cases sont figées et les boutons « Importer » des
lignes désactivés ; après, restent cochés les échecs et les restants, prêts à être relancés. Spec :
`.scratch/import-d-une-selection/spec.md` (stories 1, 8-9, 11-12, 15-24, 30-40).

**Blocked by:** 01 — Boucle d'import commune et bouton « Interrompre ».

**Status:** ready-for-agent

- [ ] Une case par article de la page affichée ; cases, barre de sélection et boutons « Importer » des
      lignes affichés seulement pour un manager ou un admin de boutique (technicien : ni cases ni
      boutons d'import)
- [ ] Barre de sélection : nombre sélectionné, durée estimée (× 3 s, arrondie à la minute),
      « Importer la sélection » ; masquée tant que rien n'est coché
- [ ] Chaque article part avec la « Qté en rayon » de sa ligne, en nombre ; vide → non envoyée (stock
      initial par défaut) ; une ligne cochée à quantité invalide (autre qu'un entier ≥ 0) empêche le
      lancement et est signalée
- [ ] Import par la boucle commune : rythme, quota, arrêts, confirmation > 200, « Interrompre », bilan
      (importés, déjà en stock via `deja_importe`, échecs nommés, répartition par famille)
- [ ] La réponse de la recherche porte la fiche fournisseur de la boutique (`fournisseur_id`) — lien du
      bilan vers `/stock?fournisseur_id=` ; test de route vu rouge
- [ ] Pendant l'import : recherche libre, cases figées, « Importer la sélection », boutons « Importer »
      des lignes et nouvelle génération désactivés
- [ ] Après l'import (fin, arrêt ou interruption) : importés et déjà en stock décochés, échecs et
      restants restés cochés — la barre relance exactement ce qui manque
- [ ] E2E écran (réponses et horloge simulées) : sélection et import, quantités envoyées, quantité
      invalide bloquante, bilan et lien, cases figées pendant l'import, restants restés cochés et
      relance, rôles — vus rouges
- [ ] `npx vitest run` vert (baseline), tsc ≤ 32, balayage du menu vert
