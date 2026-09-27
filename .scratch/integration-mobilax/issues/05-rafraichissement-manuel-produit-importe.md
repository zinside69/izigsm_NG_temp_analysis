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

## Amendement du 2026-09-27 (relecture de conception, décision de l'exploitant)

La relecture de conception du socle (T-001, verdict « doute ») a relevé quatre manques ; ils
complètent les critères ci-dessus, qui restent valables.

**1. Identité de la pièce : `mobilax_id`, pas `reference_fournisseur`.**
`reference_fournisseur` n'est pas propre à Mobilax (autre fournisseur, saisie manuelle).
- [ ] Le bouton « Actualiser » n'apparaît, et la route n'accepte la demande, que si le produit est
      lié à la fiche fournisseur Mobilax de la boutique (`fournisseurs.api_plateforme = 'mobilax'`)
      **et** porte un `mobilax_id` (migration 0050). Sinon : bouton absent, route 409, rien écrit.
- [ ] La route refuse d'écrire (409, rien écrit) si le lookup renvoie un `data.id` différent du
      `mobilax_id` du produit, un 404, ou un prix absent ou négatif.
- [ ] Un test par cas : produit non Mobilax portant une référence ; identifiant discordant ;
      404 ; prix absent ou négatif.

**2. Les règles d'écriture se prouvent sur la vraie D1 locale, pas sur les mocks.**
« Prix de vente jamais réécrit », « `prix_achat_cump` intact », « stock jamais écrit » et le
filtre `boutique_id` tiennent dans l'`UPDATE` ; un mock D1 accepte n'importe quelle requête
(`CLAUDE.md` : une règle portée par le SQL se prouve contre la vraie D1 locale).
- [ ] Un test sur la vraie D1 locale (E2E ou SQLite réel) relit avant puis après « Actualiser »
      `prix_vente`, `prix_achat_cump` et `stock_actuel` : inchangés ; seul `prix_achat_ht` bouge.
- [ ] Aucun mouvement de stock créé ; un produit d'une autre boutique n'est pas modifié.

**3. Les erreurs se vérifient à l'écran, pas seulement au code HTTP.**
- [ ] E2E avec `page.route()` : réponse 429 (avec `reessayer_dans_s`), réponse « indisponible »,
      puis `route.abort()` (coupure réseau). Pour chacun : le message apparaît, le prix d'achat
      d'avant reste affiché, le bouton redevient utilisable (jamais figé sur « en cours… »).

**4. Le formulaire ouvert ne doit pas écraser la valeur revalidée.**
La fiche s'enregistre par `PUT /produits/:id` : si « Actualiser » ne met à jour que la base ou un
texte, un « Enregistrer » renvoie l'ancien prix d'achat.
- [ ] La réponse de la route réécrit le champ prix d'achat du formulaire ouvert, et la marge est
      recalculée à l'écran.
- [ ] E2E : Actualiser → Enregistrer → relecture de la fiche : la valeur Mobilax a survécu.

**5. Plusieurs fournisseurs à venir : rien de propre à Mobilax hors de son adaptateur** (précision de
l'exploitant, 2026-09-27). Mobilax est aujourd'hui le seul fournisseur relié, mais iziGSM devra
accepter des pièces d'autres fournisseurs, par import CSV ou par API.
- [ ] Le rafraîchissement passe par le fournisseur du produit : la route et le service choisissent
      l'adaptateur d'après `fournisseurs.api_plateforme` ; Mobilax est le seul adaptateur
      aujourd'hui (`mobilaxService.ts` reste le seul lecteur de Mobilax). Ajouter un fournisseur à
      API = ajouter un adaptateur, sans toucher à la fiche produit ni à la route.
- [ ] La fiche produit ne porte aucune logique Mobilax : elle affiche « Actualiser » quand le
      fournisseur du produit sait rafraîchir, et nomme ce fournisseur dans ses messages
      (« Chez Mobilax : N en stock… »).
- [ ] Un produit d'un fournisseur sans API (saisie manuelle, futur import CSV) n'a pas de bouton ;
      un test le prouve.
- Hors périmètre (tickets à venir) : une identité externe générique par fournisseur en place de
  `mobilax_id` (migration de schéma), l'import de pièces par CSV, un second adaptateur.

**6. Un prix nul ou non numérique ne s'écrit pas** (seconde relecture de conception, 2026-09-27).
Mobilax peut renvoyer `price: 0` (pièce retirée, sans tarif) : écrit tel quel, il écraserait le vrai
prix d'achat en silence. Même règle qu'ailleurs dans le dépôt (`prixManquant()` bloque un 0 € venu
du catalogue).
- [ ] La route refuse d'écrire (409, rien écrit) si le prix est absent, non numérique, négatif
      **ou nul**. Tests : `price: 0` ; `price: "44.25"` (chaîne) ; en plus des cas du point 1.

**7. Les règles d'écriture se prouvent sans clé ni réseau** (seconde relecture, 2026-09-27 ; précise
le point 2). En E2E, la preuve dépendrait de `MOBILAX_API_KEY` et du quota de préproduction : les
specs Mobilax font `test.skip(!cle)`, le contrôle `e2e` passerait vert sans rien vérifier, et
l'isolation entre boutiques ne se prouve pas avec une seule clé.
- [ ] Les règles du point 2 (`prix_vente`, `prix_achat_cump`, `stock_actuel` inchangés, aucun
      mouvement de stock, filtre `boutique_id`) se prouvent par un test sur **SQLite réel**
      (`node:sqlite`, comme `tests/email-logs-types-migration.test.ts`) qui appelle la fonction
      d'écriture avec un prix fourni, sur **deux boutiques**.
- [ ] L'E2E en préproduction ne garde que le geste d'écran (actualiser, enregistrer, relire).
- [ ] Le compte rendu de l'agent dit si un test Mobilax a été sauté (clé absente, quota).

**8. La règle d'identité se prouve aussi sur SQLite réel** (relecture de conception de T-002,
2026-09-27 ; précise les points 1 et 7). Savoir si un produit est un produit Mobilax de *cette*
boutique tient dans une jointure SQL (`produits.fournisseur_id` → `fournisseurs`,
`api_plateforme = 'mobilax'`, `fournisseurs.boutique_id = produits.boutique_id`, `mobilax_id` non
nul) : sur un mock D1, le test passerait même si la requête oubliait un filtre. Le cas existe :
`rattacherProduitMobilax()` pose `mobilax_id` sans écraser un `fournisseur_id` déjà rempli.
- [ ] Le test SQLite réel couvre aussi la fonction de **lecture** qui résout le produit et son
      adaptateur, même base, deux boutiques : (a) `mobilax_id` posé mais fiche fournisseur non
      Mobilax → aucun adaptateur ; (b) produit de la boutique B demandé par la boutique A → rien ;
      (c) fiche Mobilax d'une autre boutique → rien ; (d) produit Mobilax conforme → adaptateur
      `mobilax`.
- [ ] Les tests de route sur mock ne vérifient que le passage du résultat au code HTTP.

**9. L'écriture revérifie l'identité** (même relecture). Entre la vérification, l'appel réseau à
Mobilax et l'écriture, le produit peut changer (désactivé, fournisseur ou `mobilax_id` modifié), et
un futur adaptateur pourrait appeler la fonction d'écriture sans vérifier.
- [ ] La fonction d'écriture reçoit aussi le `mobilax_id` vérifié ; l'`UPDATE` est conditionné
      `WHERE id = ? AND boutique_id = ? AND mobilax_id = ? AND actif = 1` et renvoie le nombre de
      lignes modifiées ; 0 ⇒ la route répond 409, rien écrit.
- [ ] Test SQLite réel : même produit, `mobilax_id` différent de celui passé → 0 ligne modifiée,
      prix inchangé.
