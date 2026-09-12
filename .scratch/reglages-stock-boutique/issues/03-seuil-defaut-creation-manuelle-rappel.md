# 03 — Seuil par défaut à la création manuelle + rappel sur la page Stock

**What to build:** le formulaire de création d'un produit propose le seuil d'alerte par défaut de
la boutique (au lieu de 2) et laisse la quantité à 0 ; un produit créé sans seuil explicite prend
ce réglage (au lieu de 5). Tant que la boutique n'a jamais enregistré de seuil par défaut, la page
Stock affiche un rappel discret menant à Réglages › Stock — il disparaît dès qu'une valeur est
enregistrée, même 0. Spec : stories 14, 15, 17, 29-33.

**Blocked by:** 01 — Onglet Réglages › Stock

**Status:** done (2026-09-12)

- [x] Création sans seuil dans la requête → seuil par défaut de la boutique (0 si non réglé) ; le
      repli 5 codé en dur disparaît
- [x] Formulaire de création : seuil pré-rempli par la valeur effective, quantité à 0
- [x] Rappel affiché si le seuil par défaut n'a jamais été enregistré, lien vers l'onglet Stock ;
      absent dès qu'une valeur (même 0) est enregistrée
- [x] Aucun produit existant modifié par un changement de réglage
- [x] La règle « à commander » est inchangée et ne lit aucun réglage
- [x] Vocabulaire d'écran : « seuil d'alerte », « non surveillé » — ⊥ « stock minimum »,
      « stock bas » (textes neufs ; les libellés antérieurs de la page, voir plus bas)
- [x] E2E sur D1 locale : création API sans seuil (avec et sans réglage), formulaire pré-rempli,
      rappel qui apparaît puis disparaît — vus rouges avant le correctif
- [x] `npx vitest run` vert (baseline), tsc ≤ 32, balayage du menu vert

**Réalisation** : `createProduit()` lit le seuil par défaut (`resoudreDefautsStock()`) **seulement**
quand le corps n'en porte pas ; un seuil explicite, même 0, l'emporte. Page Stock :
`chargerDefautsStock()` lit les réglages (`GET /api/boutiques/:id`), pré-remplit le formulaire,
affiche `#rappel-seuil-defaut` aux seuls admin/manager tant que le seuil est `NULL` ; lien
`/settings#stock`, `settings.html` ouvre l'onglet nommé par le fragment. **Un seuil vide n'est pas
envoyé** (création : le serveur applique le réglage ; modification : seuil gardé) — le formulaire
ouvert avant la lecture des réglages, ou une lecture en échec, ne peut donc plus imposer un 0.
`CACHE_VERSION` non incrémenté : dernière tâche d'écran du chantier = 04/05.

**Preuves** : E2E `stock-seuil-defaut-creation.spec.ts` vu rouge (seuil 5 au lieu de 0, rappel
absent, puis — après revue — seuil vidé enregistré à 0 au lieu du réglage) et vert ; E2E stock,
réglages, Mobilax réel, balayage du menu 31/31 ; vitest baseline, tsc 32. ⚠ Les tests unitaires
« seuil 0 sans réglage » et « réglage 3 » n'ont **pas** été lancés seuls en rouge avant le correctif
(l'E2E l'a été sur les mêmes comportements) ; « seuil explicite » est un garde-fou de
non-régression, il ne pouvait pas être rouge.

**Revue à deux axes** — corrigés avant commit : course au chargement (0 explicite envoyé avant la
lecture des réglages), assertion E2E « rappel masqué » qui passait avant la lecture, test unitaire
qui vérifiait l'absence d'une requête SQL, `catch {}` muet. Relevés, non traités :
- `createProduit()` relit `boutique_settings` par sa propre requête (D1 brut) au lieu de
  `getBoutiqueSettings()` (port) — deux lecteurs d'une même table ;
- la page Stock charge tous les réglages, dont `email_api_key` en clair (P2 déjà ouvert — pas
  d'accès nouveau : l'API la renvoie déjà à tout compte de la boutique) ;
- `stock_minimum: ""` envoyé directement à l'API est inséré tel quel (défaut antérieur) ;
- boutique sans ligne `boutique_settings` : rappel affiché, `PUT /stock` en 404, il ne disparaît
  jamais (cas rare) ;
- libellés antérieurs de la page Stock hors vocabulaire : « Alertes seuil bas », filtre et badge
  « Stock bas » — à renommer par décision de l'exploitant ;
- `importCatalogueCsv()` écrit encore un seuil 5 en dur — ticket 04.

⚠ Changement de comportement : sans réglage, un produit saisi à la main n'est plus surveillé.
Ne pas déployer ce ticket sans le 04 (même changement pour le CSV) — idéalement tout le chantier
en un bloc.
