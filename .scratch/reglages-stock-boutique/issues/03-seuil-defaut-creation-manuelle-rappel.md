# 03 — Seuil par défaut à la création manuelle + rappel sur la page Stock

**What to build:** le formulaire de création d'un produit propose le seuil d'alerte par défaut de
la boutique (au lieu de 2) et laisse la quantité à 0 ; un produit créé sans seuil explicite prend
ce réglage (au lieu de 5). Tant que la boutique n'a jamais enregistré de seuil par défaut, la page
Stock affiche un rappel discret menant à Réglages › Stock — il disparaît dès qu'une valeur est
enregistrée, même 0. Spec : stories 14, 15, 17, 29-33.

**Blocked by:** 01 — Onglet Réglages › Stock

**Status:** ready-for-agent

- [ ] Création sans seuil dans la requête → seuil par défaut de la boutique (0 si non réglé) ; le
      repli 5 codé en dur disparaît
- [ ] Formulaire de création : seuil pré-rempli par la valeur effective, quantité à 0
- [ ] Rappel affiché si le seuil par défaut n'a jamais été enregistré, lien vers l'onglet Stock ;
      absent dès qu'une valeur (même 0) est enregistrée
- [ ] Aucun produit existant modifié par un changement de réglage
- [ ] La règle « à commander » est inchangée et ne lit aucun réglage
- [ ] Vocabulaire d'écran : « seuil d'alerte », « non surveillé » — ⊥ « stock minimum »,
      « stock bas »
- [ ] E2E sur D1 locale : création API sans seuil (avec et sans réglage), formulaire pré-rempli,
      rappel qui apparaît puis disparaît — vus rouges avant le correctif
- [ ] `npx vitest run` vert (baseline), tsc ≤ 32, balayage du menu vert

⚠ Changement de comportement : sans réglage, un produit saisi à la main n'est plus surveillé.
Ne pas déployer ce ticket sans le 04 (même changement pour le CSV) — idéalement tout le chantier
en un bloc.
