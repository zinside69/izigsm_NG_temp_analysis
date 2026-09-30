---
id: 05
titre: Rafraîchissement manuel d'un produit importé de Mobilax
statut: done
bloque-par: [04]
---

# 05 — Rafraîchissement manuel d'un produit importé

> **Livré par le socle dans le bac à sable** (`izigsm-mobilax`, branche `integration`, PR #7 et
> #12) — **pas encore reporté sur `main`** : report en production par cherry-pick des seuls
> commits du ticket, depuis `izigsm/webapp`. Statut corrigé le 2026-09-30 : ce fichier avait été
> remis à `ready-for-agent` par erreur le même jour (`9000ffc`).

## Contexte

Sur la fiche d'un produit importé de Mobilax, un bouton « Actualiser » revalide le prix et la
disponibilité auprès de Mobilax via le lien conservé à l'import (`reference_fournisseur`), met à
jour le **prix d'achat** local et **affiche** la disponibilité chez Mobilax.

Bloqué par 04 (import d'une pièce) — **done** le 2026-09-11 : le ticket est prenable.

_Mis au format du modèle le 2026-09-30 (`docs/agents/issue-tracker.md`). Ancien en-tête :
`**Status:** ready-for-agent`, `**Blocked by:** 04`. Les critères d'origine sont repris
ci-dessous, précisés par le cadrage du 2026-09-12._

## Critères d'acceptation

Serveur :

- [ ] `rafraichirProduitImporte()` (`mobilaxService.ts`) lit le produit **par `id` et `boutique_id`** ; produit d'une autre boutique ou inexistant → introuvable
- [ ] Produit sans `reference_fournisseur`, ou dont la fiche fournisseur n'a pas `api_plateforme = 'mobilax'` → refus explicite (`non_mobilax`), **aucun appel Mobilax**
- [ ] **Un seul** appel Mobilax : `GET /products/lookup?reference=<reference_fournisseur>` (mesure du 2026-09-12 ci-dessous), jeton via le mécanisme existant (KV chiffré, reconnexion unique sur 401)
- [ ] `prix_achat_ht` ← `data.price` ; `prix_vente_ht`, `prix_achat_cump` et `stock_actuel` **inchangés** (vérifié en relisant la ligne après l'appel)
- [ ] Réponse : ancien et nouveau prix d'achat, prix de vente, `quantite_mobilax` (`data.quantity`), heure de vérification
- [ ] Route `POST /api/mobilax/produits/:id/rafraichir`, `requireRole('admin', 'manager')`, même garde que `…/ajout-stock` : admin plateforme → 403, produit d'une autre boutique → 404, technicien → 403
- [ ] Quota (429) → message avec le délai `reessayer_dans_s` si Mobilax le donne ; Mobilax indisponible → `indisponible` ; clé refusée → message dédié. **Aucune nouvelle tentative automatique**, et le produit local n'est pas modifié

Écran (fiche produit, `stock.js` / `stock.html`) :

- [ ] Bouton « Actualiser » visible dans la fiche **seulement** quand la ligne « Réf. … » (`#stock-ref-mobilax`) l'est, et pour un manager ou un admin de boutique (`peutImporterMobilax()`) ; absent sur un produit sans référence fournisseur et pour un technicien. Posé dans une enveloppe sans classe pour que `hidden` le masque (piège `bugs.md` du 2026-09-15)
- [ ] Au succès : le champ prix d'achat (`#stock-price-buy`) affiche la nouvelle valeur, et la fiche affiche « Chez Mobilax : N en stock (vérifié à HH:MM) »
- [ ] En erreur : message clair dans la fiche, **valeurs locales affichées intactes**
- [ ] Appel déballé `(await apiPost(…)).data` ; donnée d'API rendue par `textContent` ou `echapperHtml()`
- [ ] `CACHE_VERSION` (`public/sw.js`) incrémenté

Commun :

- [ ] ∀ test vu rouge avant correctif
- [ ] `npx vitest run` sans nouvel échec par rapport à la baseline mesurée avant le ticket
- [ ] Erreurs tsc ≤ baseline mesurée avant le ticket (`npx tsc --noEmit --pretty false | grep -cE "error TS[0-9]+"`)
- [ ] ⊥ migration

## Coutures à tester

- **Service** `rafraichirProduitImporte()` — vitest, Mobilax simulé à sa frontière HTTP (`vi.stubGlobal('fetch', …)`, comme `tests/mobilaxService.test.ts`) : prix d'achat réécrit, prix de vente et stock intacts, refus `non_mobilax` sans appel, 429/indisponible sans écriture.
- **Route** `POST /api/mobilax/produits/:id/rafraichir` — vitest par `app.request()` : 403 admin plateforme, 403 technicien, 404 autre boutique, codes d'erreur.
- **Écran** fiche produit — E2E Playwright `tests/e2e/mobilax-actualiser.spec.ts` en **préproduction réelle** (clé de `.dev.vars`, sauté sans clé) : import, prix d'achat modifié à la main, « Actualiser » → la valeur Mobilax revient dans `#stock-price-buy`. ⚠ Le socle ne joue aucun E2E (O28) : rejoué par l'humain avant tout report.

## Notes

- Périmètre : `src/services/mobilaxService.ts`, `src/routes/mobilax.ts`, `public/static/js/stock.js`, `public/stock.html`, `public/sw.js`, tests correspondants.
- Prior art : route `…/ajout-stock` (`mobilax.ts`, gardes et rôles), `importerProduitMobilax()` (jeton, erreurs `ErreurMobilax`), E2E `mobilax-import-deja-en-stock-ajout.spec.ts`.
- Quota `/products*` : 30/min partagé par la boutique. Un clic = un appel ; ⊥ rafraîchir à l'ouverture de la fiche.
- Ne se fie **pas** à `produits.mobilax_id` (migration `0050`) : les pièces importées avant elle ne l'ont pas. La référence fournisseur suffit.

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
