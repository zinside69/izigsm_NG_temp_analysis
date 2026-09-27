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

**10. Le stock Mobilax affiché est vérifié en préproduction** (relecture de la PR #7, T-002,
2026-09-27). La partie serveur revalide par `GET /products/:id/full` (identité `mobilax_id`) et non
par le `lookup` mesuré le 2026-09-12 ; le champ `quantity` de `/full` n'a pas été vérifié : s'il
manque, la route rend `stock: 0` et la fiche afficherait « Chez Mobilax : 0 en stock » à tort.
- [ ] L'E2E en préproduction (point 7) vérifie que le stock Mobilax affiché après « Actualiser »
      est celui de Mobilax (non nul pour une pièce disponible), ou, si `/full` ne porte pas le
      stock, que la fiche n'affiche **aucun** stock Mobilax plutôt qu'un 0 inventé ; le compte
      rendu dit ce que `/full` renvoie réellement pour le stock.

**11. Le serveur expose la capacité de rafraîchir ; l'écran ne fait que l'afficher** (relecture de
conception de T-003, 2026-09-27 ; précise les points 1, 5 et 8). `listProduits()` et la lecture
d'un produit ne transmettent aujourd'hui rien de `fournisseurs.api_plateforme` au navigateur :
l'écran devrait sinon deviner (bouton dès que `mobilax_id` existe — faux dans le cas (a) du point 8)
ou recopier la règle d'identité (jamais prouvée).
- [ ] La lecture produit (liste et fiche) renvoie un champ générique, par exemple
      `rafraichissable_par` (nom du fournisseur, `'Mobilax'` aujourd'hui, ou `null`), calculé par la
      **même jointure** que `resoudreAdaptateurProduit()` (T-002) — jamais une seconde règle.
- [ ] Prouvé sur SQLite réel, cas (a) à (d) du point 8 : `null` pour (a), (b), (c), `'Mobilax'`
      pour (d).
- [ ] L'écran affiche « Actualiser » si et seulement si ce champ est présent, et nomme ce
      fournisseur dans ses messages. E2E : produit portant `mobilax_id` mais lié à une fiche non
      Mobilax → aucun bouton.

**12. Le formulaire est prouvé sans clé ni réseau** (même relecture ; précise les points 4 et 7).
Dans une spec sautée sans `MOBILAX_API_KEY` (`test.skip(!cle)`), le seul test du point 4 passerait
vert sans rien vérifier.
- [ ] E2E sans clé : `page.route()` sur `POST /api/mobilax/produits/:id/rafraichir` renvoie
      `{ success: true, data: { prix_achat_ht: X, stock: N } }` ; « Enregistrer » part vers la
      vraie D1 locale ; la fiche est relue depuis le serveur et affiche X ; la marge est vérifiée.
      Test vu rouge sur une version qui ne réécrit pas le champ du formulaire.
- [ ] La spec de préproduction (clé réelle) reste en plus, pour le point 10.

**13. Le bouton suit les mêmes rôles que l'import** (même relecture). La route refuse le technicien
et l'admin plateforme (403) ; un bouton visible pour eux serait un piège.
- [ ] « Actualiser » n'apparaît que pour les rôles autorisés à importer (`peutImporterMobilax()` ou
      son équivalent générique) ; jamais pour l'admin plateforme.
- [ ] E2E : compte TECHNICIEN du seed (`fixtures/comptes.ts`) sur un produit rafraîchissable →
      aucun bouton.

**14. Jamais de bouton pour l'admin plateforme** (relecture de conception de T-004, 2026-09-27 ;
précise le point 13). `peutImporterMobilax()` (`public/static/js/stock.js`) renvoie vrai pour tout
rôle `admin`, or l'admin plateforme a le rôle `admin` avec un `boutique_id` NULL : consultant une
boutique, il verrait « Actualiser » et recevrait un 403.
- [ ] Condition du bouton : rôle manager ou admin **et** pas admin plateforme
      (`!isAdminPlateforme(session)` ou équivalent) ; ne pas reprendre `peutImporterMobilax()` telle
      quelle.
- [ ] E2E : admin plateforme avec une boutique sélectionnée, produit rafraîchissable → aucun bouton ;
      vu rouge avec `peutImporterMobilax()`.

**15. Les E2E sans clé travaillent sur la vraie D1 locale** (même relecture ; précise les points 11
et 12). Rien ne pose `produits.mobilax_id` en local sans passer par Mobilax : simuler aussi la
lecture des produits ferait relire un stub, et un enregistrement qui n'écrit rien passerait vert.
- [ ] Fixture qui prépare la vraie D1 locale : fournisseur `api_plateforme = 'mobilax'` de la
      boutique, `mobilax_id` posé sur le produit par SQL local (`wrangler d1 execute --local` ou
      fixture SQL équivalente), sans appel à Mobilax.
- [ ] Dans ces specs, **seul** `POST /api/mobilax/produits/:id/rafraichir` peut être simulé
      (`page.route()`) ; interdit de simuler `GET /api/produits*`. La relecture finale est un `GET`
      non intercepté qui montre que la base porte bien X.

**16. Une seule règle SQL pour la capacité** (même relecture ; précise les points 8 et 11). Calculer
`rafraichissable_par` dans une liste paginée pousserait à réécrire en SQL une condition qui existe en
TypeScript (`mobilaxService`) : deux règles qui peuvent diverger (par exemple sur `f.actif = 1`).
- [ ] Un seul fragment SQL exporté par `stockService.ts` (jointure + condition d'adaptateur, sur le
      modèle de `sqlSousSeuil()`), utilisé par `resoudreAdaptateurProduit()`, `listProduits()` et
      `getProduitById()`.
- [ ] Le test SQLite réel des cas (a) à (d) passe par ces trois fonctions, sur la même base.
