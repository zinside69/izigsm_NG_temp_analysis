# Recherche documentaire — API externe Mobilax (2026-09-09)

Objectif : décider du **schéma de cache** d'une future intégration catalogue Mobilax dans
iziGSM. **Recherche en lecture seule, aucun appel authentifié, aucun secret manipulé.**

## Méthode et fiabilité des sources

`https://developers.mobilax.fr/` est une **SPA Vite/React** : le HTML servi fait 2 086 octets
et ne contient qu'un `<div id="root">`. Trois constats de méthode :

1. **Aucun descripteur OpenAPI/Swagger n'existe.** Testé sans succès : `/openapi.json`,
   `/swagger.json`, `/api-docs`, `/v3/api-docs`, `/spec.json`, `/docs.json`, `.yaml`,
   `/.well-known/openapi.json`, `/docs|static|assets|data/openapi.json`. Et le relevé réseau
   du chargement de la page (Playwright, `browser_network_requests`) ne montre **aucune**
   requête vers une spécification distante — seulement les assets statiques et un script
   Cloudflare. La documentation est **entièrement figée dans le bundle**.
2. **Source primaire réelle utilisée** : `https://developers.mobilax.fr/assets/index-D8nDrXby.js`
   (337 536 octets, `last-modified: 2026-08-13`), le bundle qui *est* la documentation. Tout ce
   qui suit en est extrait — c'est la source primaire, lue plus fidèlement qu'un DOM rendu
   (le bundle contient aussi ce que la page n'affiche qu'après interaction).
3. **Contre-vérification par rendu** : page ouverte au navigateur (Playwright), `body.innerText`
   = 64 477 caractères, 12 titres `<h2>` — tout ce qui est cité ci-dessous y figure, sauf
   mention contraire explicite.

`robots.txt` = `Disallow: /`, et la page porte `noindex, nofollow, noarchive` avec le
commentaire « Documentation reservee aux integrateurs ». **La doc est publique mais non
indexable** — à considérer avant d'en recopier de larges extraits ailleurs.

Un seul appel réseau a été fait vers l'API elle-même : un `GET` **sans aucun en-tête
d'autorisation** sur `/external/products`, pour observer les en-têtes de réponse. Aucun secret
n'a été lu, cherché ni transmis.

---

## 0. Base URLs et enveloppe (préalable)

| Environnement | Base URL |
|---|---|
| Production | `https://apiv2.mobilax.fr/v1.0/external` |
| Preprod | `https://apiv2.mobilax.pro/v1.0/external` |

Source : section « Introduction », `#introduction`. « Toutes les requêtes sont en HTTPS,
sécurisées par SSL (port 443). »

Enveloppe nominale : `{ "status": "OK", "data": { … } }` ; erreur :
`{ "status": "ERROR_CODE", "message": "…" }`.

> ⚠️ **L'enveloppe n'est pas uniforme, et la doc le dit explicitement** (section « Produits ») :
> `/products`, `/products/:id`, `/products/search` et `/products/b2c` renvoient `{ "data": … }`
> **sans champ `status`**, contrairement à `/lookup`, `/:id/full` et `/:id/compatibilities`.
> Les réponses de `POST /auth` et `POST /auth/refresh-token` n'ont **ni `status` ni `data`** :
> `{ token, refreshToken, expireIn }` à plat.
>
> C'est exactement la classe de bug que ce dépôt paie déjà cher côté frontend
> (`CLAUDE.md` § Enveloppe des réponses API). Un client Mobilax dans iziGSM ne doit **pas**
> supposer une enveloppe unique : il faut un déballage par famille de routes.

Mesure directe (non authentifiée, 2026-09-09) : les deux hôtes répondent
`401 {"status":"UNAUTHORIZED","message":"No authorization token was found"}`, en-tête
`x-powered-by: Express`. Les deux environnements sont donc vivants.

---

## 1. Authentification

**Clé API statique échangée contre un JWT.** Ni OAuth, ni login/mot de passe.

| Point | Valeur | Source |
|---|---|---|
| Obtention | `POST /auth`, body `{ "apiKey": "<clé>" }` | section `#authentication` |
| Origine de la clé | « votre clé API Mobilax (**fournie par votre contact commercial**) » | description du paramètre `apiKey` |
| En-tête sur toutes les autres routes | `Authorization: Bearer <token>` | section `#authentication` |
| Réponse `POST /auth` | `{ "token": "eyJ…", "refreshToken": "eyJ…", "expireIn": "120m" }` | exemple de la doc |
| Renouvellement | `POST /auth/refresh-token`, body `{ "refreshToken": … }` → `{ "token", "expireIn" }` | section `#authentication` |

**Durée de vie — point important.** La doc affiche `"expireIn": "120m"` mais l'annote
`// valeur variable selon l'environnement`, et le texte est catégorique :

> « Sa durée de vie est indiquée par le champ `expireIn` de la réponse et **dépend de
> l'environnement** — ne la codez pas en dur : lisez `expireIn`, ou renouvelez sur réception
> d'un 401. »

Donc : **120 minutes est une valeur d'exemple, pas un contrat.** Un client iziGSM doit lire
`expireIn` et traiter le `401 UNAUTHORIZED` comme signal de renouvellement. La doc précise que
`/auth/refresh-token` est « à utiliser dès qu'une requête renvoie 401 UNAUTHORIZED pour cause
de token expiré ». **Le format de `expireIn` (chaîne `"120m"`) devra être parsé** — ce n'est
pas un nombre de secondes.

Erreurs d'authentification, toutes en `401 UNAUTHORIZED` : clé inexistante ou invalide, clé
désactivée, client introuvable/supprimé/inactif. **Non trouvé dans la doc publique** : durée
de vie du `refreshToken` lui-même, et procédure si *lui* expire.

---

## 2. Endpoints du catalogue

### Produits

| Méthode | Chemin | Rôle |
|---|---|---|
| `GET` | `/products` | Liste paginée + recherche texte simple |
| `GET` | `/products/search` | **Recherche avancée à filtres combinables** |
| `GET` | `/products/:id` | Détail léger (nom, prix, stock) |
| `GET` | `/products/:id/full` | Fiche complète (description, dimensions, caractéristiques, images, compatibilités) |
| `GET` | `/products/lookup` | Résolution par identifiant exact — `reference`, `ean13` ou `gs1_ean13` |
| `GET` | `/products/:id/compatibilities` | Appareils/séries compatibles seuls |
| `POST` | `/products/check-stock` | Vérification de stock multi-produits |
| `GET` | `/products/b2c` | Cité dans la note sur l'enveloppe, **jamais documenté** (voir § Questions) |

Paramètres de `GET /products` : `search`, `id_lang` (1=FR défaut, 2=EN, 3=ES, 4=IT, 5=DE),
`page`, `limit`, `offset`.

Paramètres de `GET /products/search` : `search`, `brandId`, `deviceId`, `rangeId`, `seriesId`,
`categoryId`, `qualityId`, `colorId`, `manufacturerBrandId`, `caracteristicIds` (ids enfants
séparés par des virgules), `inStock` (`"true"|"1"` — « filtre actif uniquement si `true` ou
`1` », défaut `false`), `priceMin`, `priceMax`, `sort` (`name|price|quantity|id`, défaut `id`),
`order` (`asc|desc`), `page`, `limit`, `id_lang`.

`POST /products/check-stock` — body `products: [{id_product, quantity}]`. Réponse par produit :
`available_quantity`, `accepted_quantity`, `price`, `status` ∈ `OK | INSUFFICIENT_QUANTITY |
NO_STOCK` ; statut global `OK` ou `NOTHING_TO_ORDER`. **C'est la route de revalidation avant
commande**, et elle est explicitement **exemptée de rate limiting** (§ 7).

### Référentiels — `/catalog/*` (la clé du modèle de données)

Neuf routes `GET`, toutes authentifiées, toutes acceptant `id_lang` :
`/catalog/brands` (marques d'appareils → `brandId`), `/catalog/devices` (→ `deviceId`, filtrable
par `brandId`), `/catalog/categories` (arbre via `id_parent` → `categoryId`), `/catalog/colors`
(→ `colorId`), `/catalog/qualities` (gammes Mobilax : Premium, Origine… → `qualityId`),
`/catalog/ranges` (→ `rangeId`, filtrable par `brandId`/`deviceId`), `/catalog/series`
(modèles précis, ex. « iPhone 7 » → `seriesId`, filtrable par `rangeId`),
`/catalog/manufacturer-brands` (→ `manufacturerBrandId`), `/catalog/caracteristics`
(arbre parent/enfant, ex. « Capacité » → « 128 Go » → `caracteristicIds`).

Ces référentiels renvoient l'enveloppe complète `{"status":"OK","data":[…]}` et **ne sont pas
paginés dans les exemples** — ce sont des tables courtes, candidates naturelles à un cache long.

### Images

Servies hors `/external`, sur `/v1.0/assets/images/products/id-image/<image_id>?size=th|sm|bg`,
exposées dans les réponses sous `thumbnail_url` / `url` / `hd_url`.

> ⚠️ Dans l'exemple `GET /products/:id/full` de la doc, ces trois URL pointent vers
> **`http://localhost:3080`** — fuite d'environnement de développement dans la documentation
> publique. Ne pas supposer que l'hôte des images est stable : le **reconstruire** depuis la base
> URL, ou au minimum le valider, plutôt que consommer l'URL telle quelle.

---

## 3. Pagination

**Numéro de page, avec `offset` en alternative.** Un seul style sur toute l'API, pas de curseur.

Requête : `page` (défaut 1), `limit`, `offset` (« décalage de pagination (alternative à `page`) »
— uniquement sur `/products`, absent de `/products/search`).

Réponse : `{ "currentPage", "limit", "offset", "total", "totalPage", "products": [...] }`.
Noter `totalPage` **au singulier**, et `currentPage` en camelCase alors que le reste des champs
produit est en `snake_case`.

| Route | `limit` par défaut | `limit` max | Source |
|---|---|---|---|
| `GET /products` | 10 | **100** | « résultats par page, max 100 (défaut: 10) » |
| `GET /products/search` | 20 | **100** | « borné entre 1 et 100 ; **toute valeur supérieure est silencieusement ramenée à 100** » |
| `GET /addresses` | 10 | 100 | « borné entre 1 et 100 (défaut: 10) » |
| `GET /orders` | 10 | 100 | « résultats par page (max 100, défaut: 10) » |
| `GET /webhooks/deliveries` | 20 | non précisé | « taille de page. Défaut 20 » |

Le dépassement de `limit` est **silencieux** sur `/products/search` (ramené à 100, pas d'erreur) :
un client qui demande 500 et boucle sur `totalPage` calculé côté client se désynchroniserait.
Toujours relire `limit` et `totalPage` **dans la réponse**.

---

## 4. Taille du catalogue — le chiffre qui décide du schéma de cache

> **`"total": 184716`** avec `"totalPage": 18472`, dans l'exemple de réponse de `GET /products`
> (section « Produits »). Présent dans le DOM rendu, donc affiché tel quel aux intégrateurs.

Cohérence interne : 184 716 / 10 = 18 471,6 → 18 472 pages, exact pour `limit: 10` (la valeur
que porte le corps de l'exemple).

**Réserve honnête** : le `curl` associé à cet exemple porte `?search=ecran&…&limit=20`, alors
que le corps affiche `"limit": 10`. L'exemple est donc **incohérent avec sa propre requête** —
le corps a visiblement été collé depuis un appel *non filtré*. 184 716 écrans étant invraisemblable,
c'est presque certainement la **taille totale du catalogue**, mais ce n'est pas prouvé.

Point de comparaison dans la même doc : `GET /products/search?deviceId=123&qualityId=2&colorId=8&inStock=true`
donne `"total": 183` — un filtrage à trois critères ramène le catalogue à ~180 références.

**Conséquences pour le cache, à taille égale à ce chiffre :**

- ~184 700 références à `limit=100` = **1 848 requêtes** pour un balayage complet.
- Sous la limite de **30 req/min** sur `/products*` (§ 7), un balayage complet coûte
  **≈ 62 minutes** de fenêtre incompressible. Un rafraîchissement intégral quotidien est
  possible ; un rafraîchissement à la demande ne l'est pas.
- Un miroir complet est donc un **objet de fond de tâche planifiée**, pas un chargement
  synchrone. Et le rafraîchissement **incrémental** devient la vraie question — voir
  `updatedSince` et les webhooks ci-dessous.

**Deux mécanismes existent pour éviter le balayage complet, et c'est là qu'est le levier :**

1. **`updatedSince`** — paramètre de type `string`, placeholder `« ISO 8601, ex:
   2026-07-01T00:00:00Z »`, déclaré sur `GET /products` dans la définition d'endpoint du
   *playground* du bundle. **Il n'apparaît nulle part dans la section de référence** de
   `GET /products` (qui ne documente que `search`, `id_lang`, `page`, `limit`, `offset`) et
   **n'est pas dans le texte rendu de la page** — vérifié : `body.innerText` ne contient pas
   la chaîne `updatedSince`. Le playground l'envoie pourtant réellement à l'API.
   → **Paramètre réel mais non documenté.** S'il fonctionne, il transforme le problème de
   cache : delta au lieu de balayage. **À mesurer par un appel réel, en priorité absolue.**
2. Le champ **`updated_at`** (`"2026-07-31T09:02:33.451Z"`) est présent sur chaque produit de
   la réponse `GET /products` — ce qui rend `updatedSince` cohérent et donne, à défaut, un
   critère de fraîcheur par ligne.

---

## 5. Format des prix

**Hors taxes, sans devise explicite, et le tarif est propre au compte.**

- **HT** : les seules mentions fiscales de toute la doc sont `priceMin` / `priceMax` =
  « prix minimum (HT) » / « prix maximum (HT) ». **La chaîne « TTC » n'apparaît nulle part
  dans la page rendue** en tant que mot ; seuls des *champs* suffixés `_ttc` existent.
- **Convention observée** : champ nu = HT, champ suffixé `_ttc` = TTC.
  - Produits (`/products`, `/products/:id`, `/lookup`, `/full`) : **`price` seul — aucun TTC**.
  - Panier (`GET /cart`) : `total_ht` seul, lignes en `price` / `line_total`.
  - Livraison (`POST /shipping/estimate`) : `price: 8.90` **et** `price_ttc: 10.68`
    (rapport 1,2 = TVA 20 %).
  - Commandes : `amount` / `amount_ttc`, `shipping_cost` / `shipping_cost_ttc`,
    `reductions_amount` / `reductions_amount_ttc`, `amount_paid`, `amount_to_pay`.
- **Devise** : **non trouvée dans la doc publique.** Aucun champ `currency`, aucune occurrence
  de « EUR », « € » ou « devise ». L'euro est implicite (fournisseur français, livraison
  France/Europe/DOM-TOM). À ne pas coder comme une certitude.
- **Types mélangés** : `price` est un **nombre** (`7.9`, `40`) dans les réponses produit, mais
  `amount` est une **chaîne** (`"255.59"`) dans la liste des commandes, et `customer_price` /
  `mbx_price` / `recommended_price` / `discount_amount` sont des chaînes (`"0.00"`, `"100.00"`).
  Un parseur unique ne suffira pas.

**Tarifs négociés par compte — oui, indirectement mais clairement.** La doc ne dit jamais
« tarif négocié », mais trois éléments l'établissent :

1. L'erreur `409 PRODUCT_UNAVAILABLE` a pour motif possible `PRODUCT_NOT_SELLABLE` =
   « **actif mais sans offre pour votre compte** ». Il existe donc une notion d'offre par compte.
2. `GET /payments/methods` renvoie les méthodes « **actifs pour votre compte** (l'encours
   n'apparaît que si votre compte dispose d'un encours) ».
3. L'erreur `409 PRICE_MISMATCH` (`updated_items[]` avec `old_price` / `new_price`) impose
   que le serveur **revalide les prix à la commande**.

→ **Conséquence de cache dure : un cache de prix ne peut pas être partagé entre comptes
Mobilax.** Si plusieurs boutiques iziGSM utilisent chacune leur propre clé API Mobilax, le
cache de prix (et de commandabilité) doit être **cloisonné par compte**, comme le reste des
données par `boutique_id`. Un cache global ne serait juste que pour les référentiels
`/catalog/*` et les libellés/images produit.

**Champs de prix supplémentaires** exposés par `/products/:id` et `/products/:id/full` :
`b2c_enabled`, `b2c_percentage`, `b2c_price`, `customer_price`, `mbx_price`,
`recommended_price`, `discount_amount`. **Aucun n'est décrit en texte dans la doc** — ils
n'apparaissent que dans les exemples JSON. ⚠ **Correction du 2026-09-10** : la parenthèse
« prix de revente au client final du revendeur » ci-dessus dans la v1.0 n'était **pas une
citation de la doc** — les chaînes « revendeur » et « client final » sont absentes du bundle
(0 occurrence, vérifié). C'était une glose du chercheur, présentée sans le dire comme telle.
Voir la mesure du 2026-09-10 ci-dessous pour la répartition réelle, sourcée, de ces champs
entre deux endpoints distincts.

---

## 6. Stock

**Exposé, en clair, sur toutes les routes produit.**

| Champ | Où | Contenu |
|---|---|---|
| `quantity` | `/products`, `/products/:id`, `/lookup`, `/:id/full` | entier — quantité disponible (ex. `36`, `106`, `0`) |
| `available_quantity` | `POST /products/check-stock` | quantité réellement disponible |
| `accepted_quantity` | `POST /products/check-stock` | quantité que la commande retiendrait |
| `current_stock` | lignes de `GET /cart` | stock à l'instant du panier |
| `inStock` | filtre de `/products/search` | ne filtre que si `"true"` ou `"1"` |

**Temps réel ou différé : non tranché par la doc.** Aucune phrase ne qualifie la fraîcheur du
`quantity` renvoyé par les listes. Trois indices convergent pourtant vers « la liste n'est pas
faisant foi » :

- `POST /products/check-stock` existe et la doc dit de l'appeler « **juste avant**
  `POST /payments/orders` pour éviter une erreur `409 STOCK_ISSUE` » ;
- cette route est la **seule exemptée de rate limiting** dans la famille `/products*` — signe
  qu'elle est conçue pour être appelée souvent et au dernier moment ;
- `POST /payments/orders` **re-vérifie stock et prix côté serveur** et peut répondre
  `409 STOCK_ISSUE` avec `unavailable_items[] {id_product, requested, available}`.

→ **Règle de conception pour iziGSM** : le `quantity` d'une liste est une **indication
d'affichage**, jamais une promesse. Toute décision d'achat passe par `check-stock`, puis
la commande peut *encore* échouer en 409. Un cache de stock est donc légitime pour l'écran,
et illégitime pour l'engagement.

Le webhook `stock.updated` (§ 8) est l'autre voie de fraîcheur.

---

## 7. Limites de débit

Table « Rate Limiting » de la section Introduction (présente dans le DOM rendu) :

| Périmètre | Limite |
|---|---|
| `/auth` | **10 req/min** |
| `/payments` | **20 req/min** |
| `/products*` | **30 req/min — sauf `/check-stock`** |
| Autres routes | **Aucune limite** |

Dépassement → `429 RATE_LIMITED`, corps
`{ "status": "RATE_LIMITED", "message": "Limite atteinte sur /auth : maximum 10 requêtes par
minute. Réessayez dans quelques instants." }`. La table des codes d'erreur redit la même chose :
« Limite de requêtes dépassée — /auth: 10/min, /payments: 20/min, /products: 30/min ».

**En-têtes de quota : aucun documenté.** Ni `X-RateLimit-*`, ni `Retry-After` — vérifié dans le
bundle **et** dans le texte rendu (`X-RateLimit` absent des deux). Et la réponse `401` observée
en direct sur les deux hôtes ne porte aucun en-tête de quota (seulement `x-powered-by: Express`).
Il reste possible que de tels en-têtes n'apparaissent que sur une réponse authentifiée ou sur
le `429` lui-même : **non vérifiable sans appel authentifié**.

→ Le client devra donc **compter lui-même** ses appels et gérer le back-off sur le code `429`
seul, sans indication de délai. Noter que `/catalog/*` tombe dans « autres routes » — les
référentiels sont, sur le papier, **sans limite**.

---

## 8. Compatibilités appareils

**Oui, l'API dit à quels modèles une pièce correspond, et de deux façons.**

`GET /products/:id/compatibilities` renvoie un tableau plat, chaque entrée portant les
**quatre niveaux de la hiérarchie**, dénormalisés :

```json
{ "status": "OK",
  "data": { "id_product": 17,
    "compatibilities": [
      { "serie_id": 30, "serie_name": "iPhone 7",     // le modèle
        "range_id": 10, "range_name": "iPhone",       // la gamme
        "brand_id": 1,  "brand_name": "Apple",        // la marque
        "device_id": 2, "device_name": "Smartphone" } // le type d'appareil
    ] } }
```

La hiérarchie est donc **appareil → marque → gamme → série(modèle)**, et chaque niveau a son
référentiel `/catalog/*` correspondant (`devices`, `brands`, `ranges`, `series`).

`GET /products/:id/full` porte la même information sous la clé `models`
(`id_serie`, `range_name`, `device_name`, `brand_name`, `id_range`, `id_device`, `id_brand`)
plus une clé nommée **`compabilities`** — orthographe fautive dans la charge utile elle-même,
à reproduire telle quelle si on la consomme.

Usage documenté : « utile pour afficher "compatible avec : iPhone 7, iPhone 8…" sans charger
toute la fiche `/full` ». Et en sens inverse, `GET /products/search?seriesId=…` liste les
pièces d'un modèle — **c'est le chemin qui intéresse iziGSM** (partir du modèle du client
pour proposer la pièce).

**Non trouvé dans la doc publique** : la cardinalité typique (combien de séries par pièce),
et s'il existe une route listant les pièces d'une série autrement que par `/products/search`.

---

## 9. Commandes (hors périmètre immédiat)

**Oui, l'API commande de bout en bout.** `POST /payments/orders` est décrit comme « **LE**
point d'entrée » ; un `POST /orders` existe mais correspond au « flux B2C historique » et ne
gère « ni adresse, ni transporteur, ni paiement ».

Flux en trois étapes : choisir les produits → `POST /shipping/estimate` (renvoie les
transporteurs avec leur `carrier_id`, `price`, `price_ttc`, `delay`) → `POST /payments/orders`
avec `address_id`, `carrier_id`, `payment_method`, et `items` **ou** `id_cart`.

Trois méthodes de paiement : `encours` (crédit sur le compte pro — instantané, `402
INSUFFICIENT_ENCOURS` avec `available_amount`/`required_amount` si insuffisant), `virement`
(via **Linxo**, `callback_url` obligatoire, polling sur `GET /payments/status/:reference`),
`website` (redirection vers un `checkout_url` sur mobilax.fr).

Une **clé d'idempotence** est prévue : `idempotency_key` (max 64 caractères) — « évite de créer
2 fois la même commande en cas de retry ». Également `notes` (max 500 caractères).

Autres routes : `GET /orders` (liste paginée, recherche par référence), `GET /orders/:reference`
(détail complet : produits, `tracking_numbers`, `tracking_url`, `delivery_note_url`,
`invoice_url`, `invoice_reference`, `has_imeis`, `imei_required`), `GET /payments/methods`,
`GET /payments/status/:reference`, `GET /payments/linxo/status/:resource_id`, et le panier
complet (`GET/POST/PUT/PATCH/DELETE /cart…`).

**Les URL de bon de livraison et de facture** (`/v1.0/assets/invoices/<ref>?type=orders-delivery&download=true`)
sont exposées — potentiellement intéressant pour le rapprochement comptable, mais à traiter
avec prudence : ce sont des documents du **fournisseur**, sans rapport avec la chaîne NF525
d'iziGSM, qui ne concerne que les documents *émis par la boutique*.

### Webhooks — le complément du cache

`POST /webhooks` (body `url` HTTPS + `events`), `GET /webhooks`, `PATCH /webhooks/:id`
(`active: false` suspend), `DELETE /webhooks/:id`, `GET /webhooks/deliveries`
(historique, `status` ∈ `pending | success | failed | abandoned`).

Quatre évènements : **`product.updated`, `stock.updated`, `price.updated`, `order.updated`**.
Abonnements « isolés par client ».

Charge utile et en-têtes :

```
X-Mobilax-Event: product.updated
X-Mobilax-Timestamp: 1785189664204
X-Mobilax-Signature: sha256=<hmac>

{ "event": "product.updated", "created_at": "2026-07-27T22:01:04Z",
  "data": { "id_product": 12345, "quantity": 7, "price": 19.9 } }
```

Signature vérifiée par `HMAC-SHA256(secret, timestamp + '.' + rawBody)`. Le `secret` est
renvoyé **une seule fois** à la création de l'abonnement et « n'est jamais renvoyé » ensuite.
Réessais automatiques en cas de non-2xx ou timeout, jusqu'à un maximum de tentatives, puis
`abandoned`.

→ **Pour le schéma de cache, c'est le mécanisme décisif** : `stock.updated` et `price.updated`
portent directement `id_product`, `quantity` et `price` — de quoi maintenir un cache à jour
**sans aucune requête**, et sans consommer le quota de 30 req/min. Cloudflare Workers est bien
placé pour recevoir ces webhooks. Réserves : le nombre maximal de tentatives et l'intervalle
ne sont **pas chiffrés** dans la doc, et rien n'indique si un `stock.updated` est émis pour
*chaque* mouvement ou de façon agrégée — un catalogue de 184 000 références pourrait générer
un volume considérable.

---

## Questions que la doc ne tranche pas — à mesurer par un appel réel

Par ordre d'impact sur le schéma de cache.

| # | Question | Pourquoi ça décide | Comment mesurer |
|---|---|---|---|
| 1 | **`updatedSince` fonctionne-t-il vraiment sur `GET /products` ?** Format accepté, et le filtre porte-t-il sur `updated_at` ? | C'est la différence entre 1 848 requêtes/jour et quelques dizaines. Non documenté en référence, présent dans le playground seulement. | `GET /products?updatedSince=<hier>&limit=1` puis comparer `total` au `total` sans le paramètre. Si identiques → paramètre ignoré. |
| 2 | **184 716 est-il bien la taille du catalogue ?** | Dimensionne le stockage et la fenêtre de balayage. | `GET /products?limit=1` sans `search` → lire `total`. |
| 3 | **Le catalogue est-il le même pour tous les comptes ?** (`PRODUCT_NOT_SELLABLE` suggère que non) | Décide si le cache *produit* est partageable entre boutiques ou doit être cloisonné comme les prix. | Comparer `total` et un échantillon d'`id` entre deux clés API distinctes. |
| 4 | **Les prix produit sont-ils propres au compte ?** | Un cache de prix mutualisé serait faux. Fortement suggéré, jamais affirmé. | Comparer le `price` d'un même `id` entre deux comptes. |
| 5 | **La devise.** Aucun champ, aucune mention. | Un montant sans devise est un montant faux dès qu'un client est hors zone euro. | Inspecter une réponse complète à la recherche d'un champ non documenté ; sinon, demander à Mobilax. |
| 6 | **Existe-t-il des en-têtes `X-RateLimit-*` / `Retry-After` sur un `429` ?** | Sans eux, le back-off est aveugle. Absents de la doc et du `401`. | Provoquer un `429` sur `/auth` en preprod (11 appels/min) et lire les en-têtes. |
| 7 | **Fraîcheur réelle du `quantity` de liste** vs `check-stock`. | Détermine le TTL d'un cache de stock, et s'il peut servir à autre chose qu'un affichage indicatif. | Comparer `quantity` (liste) et `available_quantity` (`check-stock`) sur le même produit, à quelques secondes d'intervalle. |
| 8 | **Volumétrie des webhooks `stock.updated`** : un évènement par mouvement, ou agrégé ? Quel débit sur 184 000 références ? | Décide si un Worker peut absorber le flux, et si le cache se maintient par webhook ou par balayage. | S'abonner en preprod et compter les livraisons sur 24 h via `GET /webhooks/deliveries`. |
| 9 | **Politique de réessai des webhooks** : nombre max de tentatives, intervalle, avant `abandoned`. | Dimensionne la fenêtre de rattrapage après une indisponibilité du Worker. | `GET /webhooks/deliveries?status=failed` après avoir laissé un endpoint tomber. |
| 10 | **`GET /products/b2c`** : signature, paramètres, sémantique. Cité une fois, jamais documenté. | Pourrait porter les prix de revente au client final (cf. `b2c_price`). | Appel direct, comparaison avec `/products`. |
| 11 | **Sémantique de `customer_price`, `mbx_price`, `recommended_price`, `discount_amount`, `b2c_percentage`.** Présents en JSON, décrits nulle part, tous à `"0.00"` dans l'exemple. | Choisir le bon champ de prix d'achat est la décision la plus lourde de l'intégration. | Lire ces champs sur un produit réellement tarifé ; à défaut, demander à Mobilax. |
| 12 | **Durée de vie du `refreshToken`**, et conduite à tenir s'il expire. | Un job de fond doit savoir s'il peut vivre des semaines sans re-présenter la clé API. | Observer ; sinon, demander. |
| 13 | **Taille réelle des référentiels `/catalog/*`** (surtout `series` et `caracteristics`) et **pagination éventuelle**. | Ils sont hors quota et probablement petits → cache long. Mais s'ils sont paginés sans qu'on le sache, on n'en cachera qu'une page. | `GET /catalog/series` et compter ; chercher un `total` dans la réponse. |
| 14 | **Hôte réel des images** (la doc montre `localhost:3080` en production). | Une URL d'image cassée est visible par l'exploitant. | Lire `thumbnail_url` sur une vraie réponse de production. |
| 15 | **Existe-t-il un environnement de test avec un jeu de données stable ?** La preprod (`apiv2.mobilax.pro`) répond, mais rien ne dit qu'elle est ouverte à tous les comptes. | Conditionne toute la stratégie de test de l'intégration. | Demander à Mobilax. |

### Ce qui est certain sans mesure

- La doc **ne mentionne aucun endpoint de dump ou d'export en masse** (pas de CSV, pas de flux
  produit). Le seul chemin de peuplement initial est la pagination de `/products`.
- Il n'y a **aucune spécification machine** (OpenAPI/Swagger) : tout client TypeScript devra
  être **typé à la main**, et ces types dériveront d'exemples de doc, pas d'un contrat. Les
  incohérences relevées ici (enveloppe variable, `price` nombre vs `amount` chaîne, `compabilities`
  mal orthographié, `localhost` en production) suggèrent que **la validation des réponses à
  l'exécution — Zod ou équivalent — n'est pas optionnelle**.

---

## Esquisse de schéma de cache (déduite, à confirmer par les mesures 1-4)

Non demandée mais directement impliquée par les chiffres ci-dessus, et notée ici pour éviter
qu'elle soit reconstruite de mémoire plus tard :

| Donnée | Portée | Renouvellement plausible |
|---|---|---|
| `/catalog/*` (9 référentiels) | **Globale** — sans `boutique_id` | Hebdomadaire ; hors quota |
| Identité produit (nom, `ean13`, `reference`, images, compatibilités) | Globale **si** la mesure #3 confirme un catalogue commun | Balayage complet nocturne + `updatedSince` si #1 confirme |
| **Prix** et **commandabilité** | **Par compte Mobilax** (donc par boutique, si chaque boutique a sa clé) | Webhook `price.updated` + revalidation à la commande |
| **Stock** | Par compte, indicatif uniquement | Webhook `stock.updated` ; `check-stock` avant tout engagement |

Le cloisonnement par compte des prix et du stock rejoint l'invariant d'isolation multi-tenant
déjà en vigueur dans ce dépôt (`CLAUDE.md` § Isolation multi-tenant) : **une table de cache
Mobilax portant des prix devra porter un `boutique_id`**, sous peine de faire fuiter le tarif
négocié d'une boutique vers une autre.

## Mesure réelle du 2026-09-09 — l'authentification échoue, le compte n'est pas provisionné

Première tentative d'appel authentifié, avec `MOBILAX_API_KEY` lu depuis `.dev.vars`
(**64 caractères**, valeur jamais affichée ni journalisée). Deux requêtes, aucune écriture.

| Environnement | Requête | Réponse |
|---|---|---|
| Préproduction — `https://apiv2.mobilax.pro/v1.0/external` | `POST /auth` `{apiKey}` | **401** `{"message":"Customer not found"}` |
| Production — `https://apiv2.mobilax.fr/v1.0/external` | `POST /auth` `{apiKey}` | **401** `{"message":"Invalid API key"}` |

**Ce que l'écart entre les deux messages apprend.** La production répond « Invalid API key » : elle
ne connaît pas cette clé. La préproduction répond « Customer **not found** » : elle la reconnaît,
mais **aucun compte client ne lui est rattaché**. La clé appartient donc bien à l'univers de
préproduction — c'est le compte qui manque, pas la clé.

⚠ **Ce n'est ni un défaut de code ni une erreur de configuration de notre côté.** La doc ne
prévoit aucun second paramètre : `POST /auth` prend `{ "apiKey": … }` seul (§ Authentification).
Le déblocage est chez Mobilax : provisionner ou réactiver le compte de préproduction ouvert le
2026-09-07.

**À vérifier avant de les contacter** : que la clé fournie fasse bien 64 caractères — au-delà,
elle a été tronquée à la copie dans `.dev.vars`.

**Ce que ce blocage laisse en suspens** — les quatre questions bloquantes de la section
précédente exigent toutes un appel authentifié, ainsi que la **sémantique des cinq champs de
prix** (`customer_price`, `mbx_price`, `recommended_price`, `discount_amount`,
`b2c_percentage`), présents dans le JSON, décrits nulle part, et tous à `"0.00"` dans l'exemple
de la doc. C'est la décision la plus lourde de l'intégration : savoir lequel porte le prix
d'achat réel.

**Le script de mesure n'est pas versionné**, délibérément : il lit `.dev.vars`. Il vit dans le
répertoire temporaire de session et se réécrit en quelques lignes — deux `fetch`, aucun état.


## Mesure réelle du 2026-09-10 — le compte répond, plusieurs points corrigés

Le blocage du 2026-09-09 est levé : Mobilax a provisionné le compte de préproduction entre le 09
et le 10. `POST /auth` (`apiv2.mobilax.pro`) avec `MOBILAX_API_KEY` (`.dev.vars`, 64 caractères,
jamais affiché) → **200**. Quatre requêtes de lecture au total, aucune écriture, largement sous
les quotas documentés (`/auth` 10/min, `/products*` 30/min).

### Correction d'une affirmation de la version 1.0

**« Aucun en-tête de quota documenté ni observé »** (§ Limites de débit) était **faux** sur le
volet observé. Les deux réponses portent des en-têtes de quota standard :

```
ratelimit-limit:     10
ratelimit-policy:    10;w=60
ratelimit-remaining: 9
ratelimit-reset:     60
```

Présents sur `POST /auth` et `GET /products`. La question 6 de la section précédente
(« Existe-t-il des en-têtes `X-RateLimit-*` / `Retry-After` sur un `429` ? ») reste partiellement
ouverte — ces en-têtes n'ont été vus que sur des réponses `200`, pas sur un `429` provoqué — mais
un back-off n'est plus aveugle : `ratelimit-remaining` et `ratelimit-reset` sont lisibles à
chaque appel, sans attendre l'erreur.

### Ce que la mesure confirme

| Point | Résultat |
|---|---|
| `expireIn` | `"1h"` en préproduction (l'exemple de la doc montrait `"120m"`) — confirme qu'il ne faut jamais le coder en dur (§ Authentification) |
| Taille du catalogue | `total: 184716` — coïncide **exactement** avec l'exemple de la doc. Coïncidence troublante : à vérifier avec un second compte avant de le tenir pour la taille réelle du catalogue de ce tenant |
| `updatedSince` hors playground | **Semble fonctionner** : `total` passe de 184716 à 7 avec `updatedSince=<24h>`. Question 1 de la section précédente en partie levée — à confirmer sur une fenêtre de dates connue, pas seulement « il y a 24 h » |
| `/products/:id/compatibilities` | Répond `200` |

### Forme réelle de l'enveloppe `/products` — plus précise que ce que la doc laissait deviner

```json
{
  "data": {
    "currentPage": 1, "limit": 5, "offset": 0, "total": 184716, "totalPage": 36944,
    "products": [ { "id": 17, "ean13": "…", "name": "…", "short_name": "…",
                     "quantity": 10, "price": 8.68, "updated_at": "2026-08-26T14:11:26.600Z",
                     "main_image": { … } } ]
  }
}
```

Un produit réel de la liste porte **un seul champ de prix (`price`)**, pas les cinq champs
(`customer_price`, `mbx_price`, `recommended_price`, `discount_amount`, `b2c_percentage`) décrits
comme présents « sur un produit » dans la section précédente. **Hypothèse à vérifier** : ces cinq
champs vivent peut-être sur un endpoint de détail produit (`GET /products/:id`), non encore
appelé, et non sur l'endpoint de liste. Aucun champ de devise dans les deux cas.

### Ce qui reste bloquant

- **La sémantique des cinq champs de prix** — question la plus lourde de l'intégration — n'a pas
  pu être tranchée : ils n'apparaissent pas sur l'endpoint appelé.
- **184716 = catalogue entier ou catalogue de ce compte ?** La coïncidence avec l'exemple de la
  doc est un signal à ne pas ignorer, dans un sens ou dans l'autre.
- Aucun test encore mené avec un **second compte tenant** — la décision du 2026-09-07 (un compte
  API par boutique) implique que le catalogue ou les prix diffèrent peut-être d'un compte à
  l'autre ; rien ne le confirme ni ne l'infirme à ce stade.

**Cadrage inchangé** (`decisions.md` § 2026-09-09, `todo.md`) : aucun stockage local pour
l'instant. Cette mesure reste un test de lecture directe, pas un chantier de cache.


## Approfondissement du 2026-09-10 — répartition réelle des champs de prix entre deux endpoints

Recherche documentaire complémentaire, bundle inchangé (`index-D8nDrXby.js`, 337 536 octets,
même version qu'au 2026-09-09). Aucun appel API, documentation publique uniquement.

**Ce qui était confus dans la v1.0 est maintenant établi : ces 7 champs ne sont jamais tous
sur le même produit.** Ils se répartissent sur deux endpoints distincts, chacun cité une
seule fois dans tout le bundle :

| Endpoint | Champs de prix dans l'exemple documenté | Type |
|---|---|---|
| `GET /products/:id` (détail léger) | `price`, `b2c_enabled`, `b2c_percentage`, `b2c_price` | nombres |
| `GET /products/:id/full` (fiche complète) | `price`, `customer_price`, `mbx_price`, `discount_amount`, `recommended_price` | chaînes |

Exemple documenté de `/products/:id/full` (produit `id: 33159`) — et ce n'est **pas** « tous à
`0.00` » comme l'affirmait la v1.0 :

```json
"price": 40,
"recommended_price": "100.00",
"customer_price": "0.00",
"mbx_price": "0.00",
"discount_amount": "0.00"
```

Seuls trois des quatre champs sont à zéro. `recommended_price` vaut `"100.00"`, 2,5× le
`price`. **Indice, pas confirmation** : pourrait être un prix de revente conseillé distinct
du prix d'achat — mais aucun texte du bundle (recherché : « recommand », « conseill »,
« remise », « marge », « réduction », « wholesale », « retail », « achat », « revendeur »,
« client final » — **zéro occurrence pour chacun**) ne le confirme. Pas de changelog, pas de
FAQ dans le bundle.

**Toujours introuvable** : la sémantique de `customer_price`, `mbx_price`, `recommended_price`,
`discount_amount` — aucun texte ne les explique. `GET /products/b2c` reste une citation isolée,
sans section ni exemple. Aucun champ de devise nulle part (`currency`/`devise`/`€` : 0
occurrence ; `EUR` : 1 occurrence, faux positif — substring de `CODE_ERREUR`).

**Ce que ça débloque** : le compte de préproduction étant désormais provisionné, la prochaine
mesure utile est un appel authentifié réel sur `GET /products/:id/full`, pour voir des valeurs
non nulles en conditions réelles plutôt que dans l'exemple de la doc.

---

_Version 1.0 — 2026-09-09 — première recherche documentaire, source primaire = bundle JS de
`developers.mobilax.fr` (`index-D8nDrXby.js`, `last-modified` 2026-08-13) + rendu Playwright.
Aucun appel authentifié, aucun secret manipulé._

_Version 1.1 — 2026-09-09 — mesure réelle ajoutée : `POST /auth` refusé sur les deux
environnements, compte de préproduction non provisionné. Aucune des questions bloquantes n'a
pu être tranchée._

_Version 1.2 — 2026-09-10 — le compte de préproduction répond, mesure réelle menée.
Corrige la version 1.0 : les en-têtes de quota existent. Confirme le total du catalogue,
suggère qu'`updatedSince` fonctionne hors playground. La sémantique des 5 champs de prix
reste non tranchée._

_Version 1.3 — 2026-09-10 — approfondissement documentaire : les champs de prix se
répartissent sur deux endpoints distincts (`/products/:id` vs `/products/:id/full`), jamais
tous ensemble. Corrige une glose non sourcée de la v1.0 sur `b2c_price` (« prix de revente au
client final du revendeur » n'est pas dans la doc). Corrige aussi « tous à 0.00 » :
`recommended_price` vaut `"100.00"` dans l'exemple documenté. Sémantique toujours non
tranchée — nécessite un appel authentifié réel sur `/products/:id/full`._

## Mesure réelle du 2026-09-10 (bis) — `GET /products/:id/full`, un vrai produit

Appel authentifié sur `GET /products/17/full` (préproduction), le même produit vu la veille
sur la liste (`price: 8.68`, cohérent entre les deux endpoints — bon signe de fiabilité du
champ). 2 requêtes, aucune écriture.

```
price              = 8.68   (nombre)
recommended_price  = "8.90" (chaîne)
customer_price     = "0.00" (chaîne)
mbx_price          = "0.00" (chaîne)
discount_amount    = "0.00" (chaîne)
```

**Ce que ça change par rapport à l'exemple de la doc** :

- `recommended_price` n'est **pas** un multiplicateur fixe. Dans l'exemple de la doc, il valait
  2,5× le `price` (100 vs 40) ; ici, seulement **+2,5 %** (8,90 vs 8,68). Varie donc par
  produit — cohérent avec un usage de type « prix de vente conseillé », mais toujours pas
  confirmé par un texte.
- `customer_price` et `mbx_price` sont à **`"0.00"` sur les deux produits réels observés** (celui
  de l'exemple de doc, et celui-ci). Ce n'est plus un artefact d'exemple : deux mesures
  indépendantes convergent. Hypothèse renforcée, toujours pas confirmée en texte : **ces deux
  champs ne sont pas activés pour ce compte** (pas de tarif négocié configuré en
  préproduction), plutôt qu'une valeur métier à zéro.

**Conclusion pratique, pour armer une décision de schéma** : `price` (nombre, cohérent entre
`/products` et `/products/:id/full`) est le candidat le plus solide comme prix d'achat de base
utilisable dès maintenant. `customer_price`/`mbx_price` restent à vérifier — soit avec un
compte de préproduction portant un tarif négocié actif, soit en écrivant directement à
Mobilax pour leur sémantique.

_Version 1.4 — 2026-09-10 — mesure réelle sur `GET /products/17/full`. `recommended_price`
n'est pas un multiplicateur fixe (+2,5 % ici, contre ×2,5 dans l'exemple de la doc).
`customer_price`/`mbx_price` à `"0.00"` sur les deux produits réels observés : hypothèse
renforcée qu'ils ne sont pas activés pour ce compte. `price` retenu comme candidat le plus
solide pour le prix d'achat de base._

## Mesures réelles du 2026-09-12 — `lookup`, séries, gammes, recherche par série

Faites en préproduction pour cadrer le ticket 05 (rafraîchissement) et l'import par génération.
7 appels au total (3 `/auth`, 2 `/catalog/*`, 1 `/products/lookup`, 1 `/products/search`) ; clé
jamais imprimée.

**`GET /products/lookup?reference=ECRTAREAPPIPHNE12MNO`** → 200,
`{ status, data: { id, reference, ean13, gs1_ean13, name, short_name, quantity, price } }` —
`data` est un **objet**. Un seul appel donne prix (`44.25`, = import) et disponibilité
(`quantity: 112`) : suffit au rafraîchissement, sans `/:id/full`.

**`GET /catalog/series`** → 200, `{ status: "OK", data: [...] }`, **2 316 séries**, 268 ko, sans
en-tête de quota. Champs : `id`, `id_range`, `name`, `short_name`, `abbreviation`, `position`
— **aucun** champ marque, appareil ni génération.

**`GET /catalog/ranges`** → 200, même enveloppe, **201 gammes**, 19 ko. Champs : `id`, `id_brand`,
`id_device`, `name`, `short_name`, `position`. Anomalies : 40 séries pointent un `id_range`
absent, 28 gammes vides, noms en double (`Pad Series` ×3…), noms trompeurs (« Series 4/4S » ne
contient que le 3GS ; « Serie 18 » existe déjà, vide).

**Une gamme n'est pas une génération** : Apple regroupe plusieurs générations (« Séries 17/16/15 »
= 13 séries, « Series 12/11/X » = 11) ; Samsung et Xiaomi une ligne entière (« Galaxy S » =
55 séries du S3 au S25, « Galaxy A » = 99, « Redmi Note Series » = 45). `position` n'est pas
chronologique. Une génération ne se lit que dans le **nom** des séries — et une recherche par
simple préfixe déborde (« Galaxy S2 » capte S20–S25 ; « iPhone 1 » capte 11 à 17) : il faut un
préfixe suivi d'un espace ou la fin du nom.

**`GET /products/search?seriesId=2358&limit=100`** (iPhone 17) → 200,
`{ data: { currentPage, limit, total, totalPage, products: [...] } }` — la liste est sous
**`data.products`**, pas sous `data` comme `GET /products`. 17 produits, **9 champs** : `id`,
`reference`, `ean13`, `name`, `short_name`, `quantity`, `price`, `main_image`. **`reference` et
`ean13` présents** (17/17, aucun doublon ; EAN en `3000000…`, apparemment internes à Mobilax).
**Ni catégorie, ni série, ni modèle** : la famille d'un article exige `/:id/full`. En
préproduction, les 17 articles de l'iPhone 17 sont tous des accessoires (aucune pièce).

_Version 1.5 — 2026-09-12 — mesures `lookup`, `/catalog/series`, `/catalog/ranges`,
`/products/search?seriesId=`. Une gamme Mobilax ≠ une génération ; la liste par série porte la
référence (anti-doublon sans fiche) mais pas la catégorie._
