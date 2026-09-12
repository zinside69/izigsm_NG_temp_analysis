# 05 — Rafraîchissement manuel d'un produit importé

**What to build:** sur la fiche d'un produit importé de Mobilax, un bouton « Actualiser »
revalide le prix et le stock auprès de Mobilax via le lien conservé à l'import, et met à jour le
produit local.

**Blocked by:** 04 — Import d'une pièce trouvée dans l'inventaire (Stock)

**Status:** ready-for-agent

- [ ] Un bouton « Actualiser » apparaît sur la fiche d'un produit importé (porteur de
      `reference_fournisseur` vers Mobilax) — absent sur un produit non importé
- [ ] Cliquer dessus revalide prix et stock auprès de Mobilax via le lien conservé
- [ ] Le produit local est mis à jour avec la valeur revalidée
- [ ] Mobilax indisponible ou quota atteint lors d'un rafraîchissement produit un message clair,
      sans casser l'affichage de la valeur locale existante
- [ ] Test Playwright : actualiser change une valeur affichée sur la fiche produit
- [ ] Test vu rouge avant le correctif

## Cadrage du 2026-09-12 (décisions de l'exploitant, `decisions.md`)

- **Stock Mobilax = affiché, jamais écrit.** La fiche montre « Chez Mobilax : N en stock
  (vérifié à HH:MM) » ; le stock local ne bouge que par mouvement tracé (`CLAUDE.md` § Stock).
  Le critère « le produit local est mis à jour » ne vaut donc que pour le prix.
- **Prix : achat mis à jour, vente gardée.** `prix_achat_ht` prend la valeur Mobilax ; le prix
  de vente fixé par la boutique n'est jamais réécrit, la nouvelle marge s'affiche.
  `prix_achat_cump` (coût des réceptions réelles) n'est pas touché.
- **Coutures de test** : service `rafraichirProduitImporte()` (Mobilax simulé à sa frontière
  HTTP) · route `POST /api/mobilax/produits/:id/rafraichir` (isolation, admin plateforme
  refusé, codes d'erreur) · E2E en préproduction réelle (import, prix d'achat modifié à la main,
  « Actualiser » → la valeur Mobilax revient à l'écran).

**Mesure du 2026-09-12** — `GET /products/lookup?reference=ECRTAREAPPIPHNE12MNO` : 200,
`{ status, data: { id, reference, ean13, gs1_ean13, name, short_name, quantity, price } }`,
`data` est un **objet** (pas un tableau) ; `quantity: 112`, `price: 44.25` (= prix de l'import).
**Un seul appel** (quota 30/min) donne prix et disponibilité : pas besoin de `/:id/full`.
