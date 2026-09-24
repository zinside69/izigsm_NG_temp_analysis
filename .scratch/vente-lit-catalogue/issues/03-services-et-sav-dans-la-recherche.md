# 03 — Services et dossiers SAV dans la recherche, lien du service conservé

**What to build:** la recherche de la caisse devient **unifiée** : elle rend aussi les services du
catalogue et les dossiers SAV, chaque résultat affichant sa nature. Choisir un service ajoute sa
ligne ; la facture de la vente **garde le lien vers le service** du catalogue, pour pouvoir compter
plus tard les prestations vendues même après un renommage. Choisir un dossier SAV l'ouvre, sans rien
ajouter au panier.
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 1, 3, 7, 20 ; décisions « Recherche et
scan », « Vente en caisse »).

**Blocked by:** 02 — Sélecteur de produits en caisse.

**Status:** done (2026-09-24)

- [x] Nouvelle colonne `service_id` sur les lignes de document (ajout de colonne, sans recréation) —
      migration testée contre un vrai SQLite
- [x] La vente écrit le `service_id` de chaque ligne venue d'un service (la route l'acceptait déjà
      sans l'écrire) — prouvé sur la vraie base locale
- [x] La recherche unifiée rend des résultats typés `produit`, `service`, `sav` : services par nom,
      référence ; dossiers SAV par nom du client et par numéro de dossier
- [x] À l'écran, chaque résultat affiche sa nature ; un service ajoute une ligne préremplie et
      modifiable ; un dossier SAV s'ouvre, le panier reste inchangé
- [x] Isolation : un service ou un dossier d'une autre boutique n'est jamais rendu (test de route)
- [x] E2E : vendre un service et relire le lien sur la ligne de facture ; ouvrir un dossier SAV depuis
      la recherche ; tests vus rouges d'abord
- [x] `npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées — tsc jugé par différentiel sur le Mac (+0 dans `src/`), baseline 32 à relire sur Windows

**Avancement (2026-09-18, checkpoint 125, `c8c16c7`)** : code, migration `0049` et E2E écrits sur le
Mac, où `workerd` ne tourne pas (macOS 12). Restent **non cochées** les cases qui exigent la vraie
base locale : écriture de `service_id` prouvée sur D1, écran, isolation par route, E2E vus rouges
puis verts. À jouer sur Windows (`caisse-catalogue-api`, `caisse-catalogue-ecran`, balayage du
menu), le « vu rouge » par mutation puisque le code existe déjà. Le ticket reste ouvert jusque-là.

**Clôture (2026-09-24, Windows)** : `0049` appliquée en local ; page servie contrôlée
(`caisse.f42f1676.js` contient `data-service-id`). E2E `caisse-catalogue-api` + `-ecran` 19/19,
balayage du menu + `xss-gabarits` + `plateforme-ne-vend-pas` 22/22. Rouge prouvé par mutation, une
à la fois, fichier restauré : `service_id` non écrit (2 rouges), appartenance du service non
contrôlée (1), services non rendus (2), dossier SAV non ouvert (1). **Trou trouvé** : la mutation
« `prixManquant()` ignore `service_id` » restait verte — la décision du 2026-09-18 n'était gardée par
rien. E2E ajouté (« un service à 0 € bloque la validation »), vu rouge sous la mutation, vert sans.
vitest 1155/1157 (2 permanents `agendaService`), tsc 32 (baseline).
