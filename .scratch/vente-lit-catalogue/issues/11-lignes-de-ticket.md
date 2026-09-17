# 11 — Lignes de ticket

**What to build:** un ticket de réparation porte enfin des **lignes** : le technicien y ajoute, avec
le même sélecteur qu'en caisse, une réparation du catalogue (au prix prévu pour ce modèle), une
pièce du stock ou une ligne libre. Les réparations cochées à la prise en charge deviennent des lignes
au lieu d'être oubliées. Le prix du ticket est la **somme de ses lignes** ; les anciens tickets
gardent le prix saisi à la main. Aucun mouvement de stock à ce stade : la pièce sort à la pose
(ticket 12).
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 48 à 54 ; décision « Lignes de ticket ») ;
vocabulaire `CONTEXT.md` (Ligne de ticket).

**Blocked by:** 03 — Services et SAV dans la recherche.

**Status:** ready-for-agent

- [ ] Nouvelle table des lignes, rattachée **à un ticket ou à un dossier SAV** : nature (service,
      pièce, libre), produit ou service visé, désignation, quantité, prix unitaire HT, TVA, coût
      unitaire, état de la pièce, date et auteur de pose — migration testée contre un vrai SQLite
- [ ] Ajouter, modifier, retirer une ligne ; routes par identifiant gardées par l'appartenance à la
      boutique (garde-fou statique vert)
- [ ] Une ligne de service prend le prix prévu pour le modèle de l'appareil, sinon le prix du service
- [ ] Les réparations cochées à la prise en charge sont **envoyées** et créent des lignes de service
      (fin des cases jamais relues)
- [ ] Prix du ticket calculé depuis les lignes ; un ticket sans ligne garde ses prix saisis
- [ ] L'écran du ticket réutilise le sélecteur de la caisse (une seule recherche)
- [ ] Ajouter une pièce ne touche pas au stock
- [ ] E2E sur la vraie base locale : cocher une réparation à la prise en charge et la retrouver en
      ligne ; ajouter une pièce et une ligne libre ; lire le total ; vus rouges d'abord
- [ ] `npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées
