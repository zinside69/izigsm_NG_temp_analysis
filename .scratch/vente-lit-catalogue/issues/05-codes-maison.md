# 05 — Codes maison

**What to build:** tout produit créé hors import fournisseur reçoit automatiquement un **code
maison**, visible et cherchable dans sa fiche ; un bouton permet d'en générer un pour un produit qui
n'en a pas. Les services peuvent en recevoir un aussi, pour la planche de codes du comptoir, et un
service scanné s'ajoute à la vente. Un article qui porte déjà l'EAN de son fournisseur n'en reçoit
jamais.
Spec : `.scratch/vente-lit-catalogue/spec.md` (stories 24 à 29 ; décision « Codes maison ») ;
vocabulaire `CONTEXT.md` (Code maison).

**Blocked by:** 01 — Doublon signalé ; 03 — Services dans la recherche.

**Status:** ready-for-agent

- [ ] Fonction pure : `2` + type (1 produit, 2 service) + identifiant sur 10 chiffres + clé EAN13
      calculée ; tests unitaires (clé juste, longueur 13, types) vus rouges
- [ ] Nouvelle colonne code-barres sur les services, avec index unique partiel par boutique —
      migration testée contre un vrai SQLite
- [ ] Création d'un produit hors import fournisseur (manuelle, CSV sans code) → code maison écrit,
      par le passage obligé de création de produit ; l'import fournisseur n'en pose jamais
- [ ] Action « générer » dans la fiche produit et dans la fiche service, refusée si un code existe
      déjà
- [ ] La recherche unifiée trouve un service par son code-barres ; le scan d'un code de service
      ajoute sa ligne en caisse
- [ ] Le code maison est affiché dans la fiche et modifiable comme tout code-barres
- [ ] E2E : créer un produit à la main, lire son code, le scanner en caisse ; générer le code d'un
      service et le scanner ; vus rouges d'abord
- [ ] `npx vitest run` vert (hors les 2 échecs permanents) ; erreurs tsc inchangées
