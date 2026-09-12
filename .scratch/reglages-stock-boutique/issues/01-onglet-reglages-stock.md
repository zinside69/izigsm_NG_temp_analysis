# 01 — Onglet Réglages › Stock : régler et relire les deux valeurs par défaut

**What to build:** dans les Réglages de sa boutique, le manager ouvre un nouvel onglet « Stock »,
saisit un **seuil d'alerte par défaut** et un **stock initial par défaut**, enregistre, et les
retrouve à la réouverture. Un champ laissé vide est enregistré « non réglé » (distinct de 0). Ce
ticket ne change encore aucun produit : il pose les réglages que les tickets 03 à 05 appliqueront.
Spec : `.scratch/reglages-stock-boutique/spec.md` (stories 1-13, 34).

**Blocked by:** None — can start immediately.

**Status:** done (2026-09-12)

- [x] Migration (numéro suivant `0046`) : deux entiers nullables sans défaut sur les réglages de
      boutique ; `NULL` = jamais réglé — `0047`
- [x] Fonction pure de résolution des valeurs effectives (`NULL` → 0), sur le modèle de la
      résolution des taux de marge ; aucun repli codé chez un appelant — `resoudreDefautsStock()`
- [x] Route d'écriture dédiée, remplacement complet des deux valeurs (absent/vide → `NULL`) ;
      entier ≥ 0 sinon 422 sans rien écrire ; **jamais** par la route des réglages généraux —
      `PUT /api/boutiques/:id/stock`
- [x] Droits comme les marges : admin et manager de la boutique ; admin plateforme pour une
      boutique cliente (visible au journal des actions de plateforme) ; autre boutique → 403
- [x] Les valeurs sortent avec les réglages déjà renvoyés par la lecture d'une boutique
- [x] Onglet « Stock » : deux champs, texte d'aide (0 = non surveillé, 1 = alerte à la rupture,
      vide = réglage d'usine, rien de rétroactif), chargement et enregistrement
- [x] Enregistrer l'onglet Stock laisse intacts TVA, paiements et marges
- [x] E2E sur D1 locale (boutique neuve) : enregistrer/relire, 422, 403 autre boutique, onglets
      voisins intacts, onglet à l'écran — vus rouges avant le correctif
      (`tests/e2e/reglages-stock-defauts.spec.ts`)
- [x] `npx vitest run` vert (baseline), tsc ≤ 32, balayage du menu vert

**Revue à deux axes** : aucun défaut bloquant. Corrigés avant commit : texte d'aide qui étendait le
stock initial à toute création (il ne vaut que pour l'import fournisseur), `""` refusé en 422
alors que la spec le veut `NULL` (vu rouge), assertions E2E manquantes (paiements, stock initial
après refus). Laissées volontairement : les duplications `saveStock`/`saveMarges` et des listes de
champs, sur le modèle des marges. ⚠ `0047` à appliquer en distant **avant** tout déploiement.
