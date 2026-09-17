# 03 — Services et dossiers SAV dans la recherche, lien du service conservé

**What to build:** la recherche de la caisse devient **unifiée** : elle rend aussi les services du
catalogue et les dossiers SAV, chaque résultat affichant sa nature. Choisir un service ajoute sa
ligne ; la facture de la vente **garde le lien vers le service** du catalogue, pour pouvoir compter
plus tard les prestations vendues même après un renommage. Choisir un dossier SAV l'ouvre, sans rien
ajouter au panier.
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 1, 3, 7, 20 ; décisions « Recherche et
scan », « Vente en caisse »).

**Blocked by:** 02 — Sélecteur de produits en caisse.

**Status:** ready-for-agent

- [ ] Nouvelle colonne `service_id` sur les lignes de document (ajout de colonne, sans recréation) —
      migration testée contre un vrai SQLite
- [ ] La vente écrit le `service_id` de chaque ligne venue d'un service (la route l'acceptait déjà
      sans l'écrire) — prouvé sur la vraie base locale
- [ ] La recherche unifiée rend des résultats typés `produit`, `service`, `sav` : services par nom,
      référence ; dossiers SAV par nom du client et par numéro de dossier
- [ ] À l'écran, chaque résultat affiche sa nature ; un service ajoute une ligne préremplie et
      modifiable ; un dossier SAV s'ouvre, le panier reste inchangé
- [ ] Isolation : un service ou un dossier d'une autre boutique n'est jamais rendu (test de route)
- [ ] E2E : vendre un service et relire le lien sur la ligne de facture ; ouvrir un dossier SAV depuis
      la recherche ; tests vus rouges d'abord
- [ ] `npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées
