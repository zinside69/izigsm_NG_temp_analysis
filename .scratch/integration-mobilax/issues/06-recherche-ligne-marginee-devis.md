---
id: 06
titre: Recherche Mobilax et ligne marginée dans un devis (module de recherche partagé)
statut: ready-for-agent
bloque-par: [02, 03]
---

# 06 — Recherche Mobilax + ligne marginée dans un devis

## Contexte

Un opérateur créant un devis cherche une pièce Mobilax et l'insère comme ligne, prix calculé
automatiquement via la marge résolue (famille, sinon défaut boutique) sur le prix Mobilax —
modifiable avant validation. **Ce ticket construit le module de recherche frontend partagé**,
sans logique propre à l'écran devis, que les tickets 07 (facture), 08 (caisse) et 09 (prise en
charge) rechargent tel quel sur leurs écrans.

Bloqué par 02 (taux de marge) et 03 (recherche Mobilax) — **done** tous deux : prenable.

_Mis au format du modèle le 2026-09-30 (`docs/agents/issue-tracker.md`). Ancien en-tête :
`**Status:** ready-for-agent`, `**Blocked by:** 03, 02`._

**Décision de l'exploitant du 2026-09-30 — marge de la famille réelle.** La liste de recherche
Mobilax ne porte ni catégorie ni famille. Le prix de la ligne est donc calculé **par le serveur**,
qui relit la fiche comme à l'import : un accessoire prend le taux des accessoires, une pièce celui
des pièces — le même prix de vente que si la pièce avait été importée. Coût assumé : un appel au
quota `/products*` (30/min) par pièce insérée. Écartés : « toujours pièce » (faux sur un
accessoire) et « taux par défaut seul » (contraire au critère d'origine).

## Critères d'acceptation

Serveur :

- [ ] `prixVenteMobilax()` (`mobilaxService.ts`) : relit `/products/:id/full`, déduit la famille par `familleDepuisCategorie()`, résout le taux par `resoudreTauxMarge()` et rend `{ mobilax_id, nom, prix_achat_ht, famille, taux, prix_vente_ht }`
- [ ] **Une seule formule de prix de vente** : le calcul `prix d'achat × (1 + taux / 100)` arrondi au centime est extrait de `importerProduitMobilax()` dans une fonction partagée par les deux chemins. ⊥ seconde copie de la formule
- [ ] Taux `null` (boutique sans marge saisie) → `prix_vente_ht` = prix d'achat et `taux: null`, jamais un taux inventé (`decisions.md` 2026-09-10)
- [ ] **Aucune écriture** : ni produit, ni catégorie, ni rattachement, ni mouvement. Vérifié par un test qui échoue si le service écrit en base
- [ ] Route `GET /api/mobilax/prix-vente?mobilax_id=` (lecture, donc hors journal de plateforme) : boutique du **jeton** seulement, `?boutique_id=` ignoré ; admin plateforme → 403 ; `mobilax_id` absent ou non entier → 400 **sans appel Mobilax** ; pièce inconnue chez Mobilax → 404
- [ ] Quota (429) → délai `reessayer_dans_s` rendu s'il est connu ; Mobilax indisponible → `indisponible` ; clé absente ou refusée → message dédié. Aucune nouvelle tentative automatique

Module partagé (`public/static/js/mobilax-recherche.js`, nouveau) :

- [ ] Point d'entrée unique `monterRechercheMobilax(conteneur, { surSelection })` : champ de recherche, résultats paginés (`GET /api/mobilax/produits`), clic sur un résultat → `GET /api/mobilax/prix-vente` → `surSelection({ description, prix_unitaire_ht, prix_achat_ht, famille, taux, mobilax_id })`
- [ ] **Aucune référence à l'écran devis** dans le module (ni `devis`, ni `addLine`, ni identifiant d'élément de `devis.html`) : c'est l'appelant qui insère la ligne
- [ ] Erreurs (quota, indisponible, clé) affichées **dans le conteneur**, sans `alert()` ; un rejet de `fetch` (réseau coupé) remplace l'état « Recherche en cours… » par un message (`CLAUDE.md` § Enveloppe des réponses API)
- [ ] Appels déballés `(await apiGet(…)).data` ; toute donnée Mobilax rendue par `textContent` ou `echapperHtml()`
- [ ] Un clic sur un résultat pendant qu'un prix est en cours de calcul n'insère pas deux lignes

Écran devis (`devis.html`, `devis.js`) :

- [ ] Bouton « Chercher chez Mobilax » dans le formulaire de devis, qui monte le module
- [ ] Sélection → `addLine({ description, prix_unitaire_ht, quantite: 1 })` : ligne pré-remplie, **prix modifiable** avant enregistrement ; le devis enregistré porte le prix saisi en dernier, pas le prix calculé
- [ ] `mobilax-recherche.js` chargé par `devis.html` après `app.js` et avant `devis.js` (`devis.js` n'est pas dans la liste de précache de `sw.js`, mesuré le 2026-09-30 : le module n'y va pas non plus)
- [ ] `CACHE_VERSION` (`public/sw.js`) incrémenté

Commun :

- [ ] ∀ test vu rouge avant correctif
- [ ] `npx vitest run` sans nouvel échec par rapport à la baseline mesurée avant le ticket
- [ ] Erreurs tsc ≤ baseline mesurée avant le ticket (`npx tsc --noEmit --pretty false | grep -cE "error TS[0-9]+"`)
- [ ] ⊥ migration

## Coutures à tester

- **Service** `prixVenteMobilax()` — vitest, Mobilax simulé par `vi.stubGlobal('fetch', …)` comme `tests/mobilaxService.test.ts` : pièce → taux pièce, accessoire → taux accessoire, taux `null` → prix d'achat, 404, 429, aucune écriture en base.
- **Fonction partagée** de prix de vente — vitest direct : arrondi au centime, taux 0, taux `null` ; et `importerProduitMobilax()` garde ses tests verts (même prix qu'avant).
- **Route** `GET /api/mobilax/prix-vente` — vitest par `app.request()`, dans `tests/mobilax-route.test.ts` : 403 admin plateforme, 400 sans appel, `?boutique_id=` d'une autre boutique ignoré.
- **Écran devis** — E2E Playwright `tests/e2e/devis-mobilax.spec.ts`, routes `/api/mobilax/*` stubées par `page.route()` (`serviceWorkers: 'block'` déjà posé) : recherche → clic → ligne insérée au prix marginé attendu → prix modifié à la main → devis enregistré avec le prix modifié, relu par l'API. L'E2E est joué par le socle dans le bac à sable (contrôle e2e de gates.json, à déclarer dans la tâche d'écran) ; un E2E hors de sa portée (préproduction, production) se demande dans le compte rendu (P16).

## Notes

- Périmètre : `src/services/mobilaxService.ts`, `src/routes/mobilax.ts`, `public/static/js/mobilax-recherche.js` (nouveau), `public/static/js/devis.js`, `public/devis.html`, `public/sw.js`, tests correspondants. ⊥ `stock.js` : la recherche de la page Stock (sélection, import) reste la sienne, sa migration vers le module n'est pas demandée.
- Prior art : `importerProduitMobilax()` (lecture de `/full`, `versFicheMobilax()`, `familleDepuisCategorie()`), gardes de `GET /api/mobilax/produits` (`mobilax.ts`), `addLine(prefill)` (`devis.js`, échappe déjà la description par `esc()`).
- `/catalog/categories` ne relève d'aucun quota (mesuré) : seul `/products/:id/full` compte.
- ⊥ `GET /api/mobilax/prix-vente` qui accepterait un prix venu du navigateur : le prix d'achat est toujours relu chez Mobilax.
- Nom de route neutre (`prix-vente`, pas `prix-devis`) : facture, caisse et prise en charge l'appelleront aussi.
- Les routes `/api/devis` lisent la boutique dans le **corps** (`CLAUDE.md` § checkpoint 73) : l'enregistrement du devis n'est pas modifié par ce ticket.

## Critères d'origine (avant le 2026-09-30, repris ci-dessus)

- ~~Le module de recherche Mobilax (construit ici, partagé) est chargé sur l'écran devis~~
- ~~Sélectionner un résultat insère une ligne pré-remplie — description Mobilax, prix calculé
  = prix Mobilax × marge résolue (famille du produit, sinon taux par défaut de la boutique)~~
- ~~L'opérateur peut modifier le prix inséré avant d'enregistrer le devis — jamais un montant
  figé~~
- ~~Le module ne porte aucune logique spécifique à l'écran devis — sa surface d'appel doit
  permettre aux tickets 07-09 de le recharger sans le modifier~~
- ~~Test Playwright : recherche → ligne insérée avec le prix marginé attendu → modification
  manuelle du prix possible avant validation~~
- ~~Test vu rouge avant le correctif~~
