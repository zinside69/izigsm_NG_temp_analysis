# 01 — Onglet Réglages › Stock : régler et relire les deux valeurs par défaut

**What to build:** dans les Réglages de sa boutique, le manager ouvre un nouvel onglet « Stock »,
saisit un **seuil d'alerte par défaut** et un **stock initial par défaut**, enregistre, et les
retrouve à la réouverture. Un champ laissé vide est enregistré « non réglé » (distinct de 0). Ce
ticket ne change encore aucun produit : il pose les réglages que les tickets 03 à 05 appliqueront.
Spec : `.scratch/reglages-stock-boutique/spec.md` (stories 1-13, 34).

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Migration (numéro suivant `0046`) : deux entiers nullables sans défaut sur les réglages de
      boutique ; `NULL` = jamais réglé
- [ ] Fonction pure de résolution des valeurs effectives (`NULL` → 0), sur le modèle de la
      résolution des taux de marge ; aucun repli codé chez un appelant
- [ ] Route d'écriture dédiée, remplacement complet des deux valeurs (absent/vide → `NULL`) ;
      entier ≥ 0 sinon 422 sans rien écrire ; **jamais** par la route des réglages généraux
- [ ] Droits comme les marges : admin et manager de la boutique ; admin plateforme pour une
      boutique cliente (visible au journal des actions de plateforme) ; autre boutique → 403
- [ ] Les valeurs sortent avec les réglages déjà renvoyés par la lecture d'une boutique
- [ ] Onglet « Stock » : deux champs, texte d'aide (0 = non surveillé, 1 = alerte à la rupture,
      vide = réglage d'usine, rien de rétroactif), chargement et enregistrement
- [ ] Enregistrer l'onglet Stock laisse intacts TVA, paiements et marges
- [ ] E2E sur D1 locale (boutique neuve) : enregistrer/relire, 422, 403 autre boutique, onglets
      voisins intacts, onglet à l'écran — vus rouges avant le correctif
- [ ] `npx vitest run` vert (baseline), tsc ≤ 32, balayage du menu vert
