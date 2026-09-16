# Tarification par boutique — matière de grilling

_Écrit le 2026-09-16. Mesures de cette session, décisions déjà prises par l'exploitant, et ce
qui reste ouvert. Ce document n'est pas une spec : il sert d'entrée au grilling._

## 1. Le problème, dans les mots de l'exploitant

> « Sur les marges, dans la téléphonie, on applique plus des coefficients que des %. »

Les Réglages › Marges d'aujourd'hui proposent **cinq taux en pourcentage** (défaut + 4 familles,
migration `0042`), appliqués comme `prix de vente = prix d'achat × (1 + taux / 100)`. Deux
pratiques réelles n'entrent pas dans ce modèle :

- **Accessoires** — vendus à des **prix ronds** fixés d'avance : housse 34,90 € TTC, coque
  silicone 29,90 € TTC, film/verre trempé 20–25 € TTC. Une housse de luxe se vend plus cher
  (39,90 €) sans que rien, dans le prix d'achat, ne l'impose.
- **Pièces détachées** — rarement vendues seules : intégrées à une réparation, à laquelle on
  ajoute **50 à 120 € HT** selon le modèle et la technicité.

## 2. Mesures — prix d'achat réels chez Mobilax (préproduction, 2026-09-16)

Médiane sur les 100 premiers résultats de `GET /products?search=` :

| Article | Achat HT (min → max) | Médiane | Prix de vente exploitant | Coefficient réel (HT) |
|---|---|---|---|---|
| Housse | 1,46 → 10,65 € | **3,80 €** | 34,90 € TTC (29,08 HT) | **≈ ×7,7** |
| Verre trempé / film | 0,18 → 6,65 € | **1,08 €** | 20–25 € TTC (16,67–20,83 HT) | **≈ ×15 à ×19** |
| Coque silicone | 0,78 → 2,43 € | **1,46 €** | 29,90 € TTC (24,92 HT) | **≈ ×17** |
| Écran iPhone 12 | 4,65 → 376,15 € | **33,35 €** (37,78 € pour le 12/12 Pro) | intégré à une réparation | — |
| Batterie iPhone 12 | 0,38 → 74,40 € | **5,80 €** | intégré à une réparation | — |

**Ce que ça démontre** : aucun coefficient unique ne reproduit ces prix. À ×8, la coque sortirait
à 14,60 € (vendue 29,90) et la housse haut de gamme à 85 € (vendue 34,90). Ce qui est stable,
c'est le **prix de sortie**, pas le rapport au coût d'achat.

## 3. Mesures — l'arbre des catégories Mobilax

`GET /catalog/categories` : **1 570 catégories, 9 racines**. La famille iziGSM est déduite du
**début du nom de la racine** (`familleDepuisCategorie()`, `mobilaxService.ts`) :

| Racine Mobilax | Catégories | Famille déduite | Juste ? |
|---|---|---|---|
| Pièces Détachées | 421 | `piece` | oui |
| Accessoires test permission | 392 | `accessoire` | oui |
| Équipement | 372 | `consommable` | **non** |
| E-Mobility (trottinettes) | 265 | `consommable` | **non** |
| Informatique | 106 | `consommable` | **non** |
| Mobile | 10 | `appareil` | oui |
| Tablette d'écriture | 1 | `appareil` | oui |
| `fr`, `nfr` | 2 | `consommable` | données de test |
| `lorem ipsum indolor namen set francais` | 1 | `consommable` | données de test |

**743 catégories sur 1 570 tombent dans `consommable`**, la famille fourre-tout : un contrôleur
de trottinette et une clé USB y reçoivent le taux « Consommables ».

⚠ **Tout ceci est mesuré en PRÉPRODUCTION** (`MOBILAX_API_BASE` pointe la préprod). Les noms de
test (`Accessoires test permission`, `lorem ipsum…`) montrent que cet arbre n'est pas celui de la
production. On ignore si les identifiants et les libellés y sont identiques — question ouverte
n° 6 ci-dessous.

## 4. Mesures — comment monatelier.net tarife

Relevé dans leur bundle applicatif (`/blog/calculer-marge-reparation-smartphone`) :

- **Formule** : `Prix de vente HT = (Coût pièce HT × Coefficient) + Main d'œuvre`
- **Coefficient recommandé : 2,5 à 4** sur le coût de la pièce
- Écran iPhone 13 : pièce 45 € HT, 30 min, MO 25 € (50 €/h), coef 2,8 → **151 € HT**, marge
  brute 106 € (taux 70 %)
- Batterie Samsung S21 : pièce 18 € HT, 20 min, MO 17 €, coef 3 → **71 € HT** (85,20 TTC)
- Le coefficient est là pour absorber les charges fixes : leur exemple, 5 065 €/mois ÷ 100
  réparations = 50,65 € de charge par réparation

Leur aide sépare **Prestation** (réparation, service, main d'œuvre) et **Produit** (pièce,
accessoire, logiciel, consommable) — le ticket portant les deux.

**Rapprochement** : sur l'écran iPhone 12 Pro mesuré à 37,78 € HT, leur méthode donne
(37,78 × 2,8) + 25 = **131 € HT**, soit un supplément de 93 € sur la pièce — dans la fourchette
« 50 à 120 € » de l'exploitant. Les deux pratiques se rejoignent ; elles ne se paramètrent pas
pareil.

## 5. Décisions déjà prises par l'exploitant (2026-09-16)

1. **Accessoires** : coefficient **et** prix plancher.
2. **Réparations** : les **trois méthodes** doivent être offertes au choix du tenant — « chaque
   magasin a sa propre politique de vente » : pièce + forfait MO · (pièce × coef) + MO horaire ·
   forfait tout compris.
3. **Familles** : créer de **nouvelles familles** (outillage, mobilité électrique, informatique)
   plutôt que de forcer les 743 catégories dans `consommable`.
4. **Prix saisis en TTC.** Une boutique en franchise de TVA saisit ses prix TTC avec un taux à 0
   — TTC = HT, sans traitement particulier.
5. **Le plancher est un prix minimal de vente**, équivalent d'une **remise maximale** — pas un
   rattrapage de calcul.
6. **Aucun plafond** : on doit pouvoir vendre plus cher que le prix par défaut.
7. **Les prix par défaut restent des prix réels saisis** : housse 34,90 € TTC, housse de luxe
   39,90 € TTC.
8. **Grille par catégorie Mobilax**, l'intitulé du produit servant ensuite à choisir la variante
   (« housse » → 34,90 par défaut ; « housse de luxe » → 39,90).
9. **Hors grille** : repli sur le **coefficient de la famille**.
10. **Remise maximale exprimée en pourcentage.**
11. **Dérogation au plancher : manager et admin seulement.**
12. **Les valeurs** (coefficients, planchers, barème des forfaits, taux horaire) se saisissent
    **à la configuration de la boutique**, et restent **modifiables au moment d'une vente ou
    d'une prise en charge**.
13. Les 5 colonnes de taux actuelles (`0042`) deviennent un **sous-cas** du nouveau modèle.

## 6. Ouvert — frontière du grilling, premier jet

_Cette liste a été établie **avant** l'exploration du code. Les sections 8 et 9 la corrigent :
la question 4 (remise maximale) reposait sur un support qui n'existe pas._

1. **Vocabulaire** : `CONTEXT.md` définit **Service** = « prestation facturable **sans stock** ».
   Or une réparation consomme une pièce. Faut-il un terme pour le couple pièce + main d'œuvre, ou
   reste-ce deux lignes sur un ticket ?
2. **Périmètre** : le modèle vaut-il pour tout produit (manuel, CSV, fournisseur) ou pour les
   seuls imports ?
3. **Mode de tarification des réparations** : un mode par boutique, par type de réparation, ou
   choisi à chaque devis ?
4. **Remise maximale** : porte-t-elle aussi sur les services ? se contrôle-t-elle à la ligne ou
   sur le total du document ?
5. **« L'IA analyse l'intitulé »** : mots-clés paramétrables, appel à un modèle de langage à
   l'import, ou tranches de prix d'achat ?
6. **Sur quel catalogue bâtir la grille** : arbre de production (clé à obtenir), remappage par
   nom, ou ancrage sur les catégories iziGSM ?

## 7. Contraintes du dépôt à respecter

- `resoudreTauxMarge()` (`boutiqueService.ts`) est **le seul point de résolution** d'un taux, et
  rend `null` quand rien n'est réglé — « aucune marge imposée à une boutique qui n'a rien
  saisi » (`decisions.md`). Le nouveau modèle doit garder cette propriété.
- Les taux s'écrivent par `PUT /api/boutiques/:id/marges` **seule** ; `PUT /:id/settings` reçoit
  toujours un corps partiel et chaque colonne y est sous `COALESCE`.
- `createProduit()` est le passage obligé de **tout** chemin de création (manuel, CSV,
  fournisseur) — règle du chantier `reglages-stock-boutique`.
- Le prix de vente d'une pièce importée est calculé aujourd'hui par `importerProduitMobilax()`
  à partir de la marge résolue sur la famille déduite.

## 8. Faits mesurés dans le code (2026-09-16, deux explorations)

### Ce qui existe

| Fait | Emplacement |
|---|---|
| **Tout est stocké HT.** `produits.prix_achat_ht`, `prix_vente_ht`, `prix_achat_cump`, plus un `tva_taux` **par produit** (défaut 20). `services.prix_ht` + `tva_taux`. Le TTC est **calculé à la volée**, jamais stocké. | `0005_stocks.sql:24-27`, `0013_services.sql:32-33`, `servicesService.ts:22-23` |
| `resoudreTauxMarge()` rend `taux famille ?? défaut ?? null` — pur, sans SQL. | `boutiqueService.ts:326-332` |
| Les 5 colonnes de `0042` sont **nullables et sans DEFAULT** : `marge_taux_defaut`, `_piece`, `_accessoire`, `_appareil`, `_consommable`. | `0042_boutique_settings_taux_marge.sql:19-23` |
| `produits.famille` porte un **CHECK** sur les 4 valeurs. | `0026_produits_famille.sql:6-9` |
| Un prix de service peut être **surchargé par modèle d'appareil** : `service_modeles.prix_ht_specifique`, résolu par `COALESCE(sm.prix_ht_specifique, s.prix_ht)`. | `0030`, `servicesService.ts:646-648` |
| Permissions `discount`, `modifier_prix`, `voir_prix_achat` **déclarées**. | `userService.ts:20-29`, `0012_pin_permissions.sql` |

### Ce qui n'existe pas — et qui conditionne ce chantier

1. **`resoudreTauxMarge()` n'a qu'un seul appelant** : `mobilaxService.ts:354`. Caisse, devis et
   factures ne connaissent **aucune** marge. L'import fournisseur est le **seul** chemin où un
   prix de vente est calculé ; création manuelle (`stockService.ts:398`) et CSV
   (`stockService.ts:789`) reçoivent un prix **saisi**, `0` par défaut.
2. **Sans taux réglé, le prix de vente importé vaut `0`** (`mobilaxService.ts:357`) — décision
   assumée du 2026-09-10 (« aucune marge inventée »), mais l'article est invendable en l'état.
3. **Aucune colonne de remise nulle part** : ni `lignes_document`, ni `devis`, ni `factures`, ni
   `avoirs`. Un « plancher = remise maximale » n'a rien à plafonner.
4. **La seule remise du produit est cassée.** `caisseService.ts:357-373` insère
   `prix_unitaire_ht` **brut** alors que `total_ht`/`total_tva`/`total_ttc` sont **nets de
   remise** : la ligne stockée est incohérente (`quantité × prix ≠ total`) et le taux est
   irrécupérable. Déjà répertorié (`audit-persistance-2026-07-30.md`, `todo.md`), marqué
   « impact NF525-adjacent ».
5. **La vente ne lit pas le catalogue.** `caisse.js:363-371` crée une ligne avec
   `designation: ''` et `prix_unitaire_ht: 0`, tout est retapé à la main ; aucun sélecteur de
   produit ni de service. Idem pour les devis (`devis.js:620-649`). **Conséquence : un prix
   calculé dans le catalogue n'atteint jamais une vente.**
6. **Aucun contrôle de prix minimum ni de marge minimale.** Seule validation : `prix ≥ 0`.
7. **Les permissions fines ne sont branchées nulle part** : `hasPermission()`
   (`middleware.ts:173`) n'a **aucun appelant** dans `src/`, `requirePin` n'est posé sur aucune
   route, et `POST /devis` n'a même pas de `requireRole`.
8. **`categories` ne conserve aucun identifiant Mobilax** — seulement le **nom**, à plat
   (`stockService.ts:483-491`). Deux catégories Mobilax homonymes fusionnent ; un renommage
   chez Mobilax crée une catégorie locale de plus.
9. **Aucun appel d'IA côté serveur.** Dépendance de production unique : `hono`. Aucun binding
   `ai`, aucun SDK. Une classification par modèle de langage serait une première ici.

### Ce que ça implique pour le chantier

- La grille seule ne changerait **rien à ce que voit un client** : sans lecture du catalogue en
  vente, le prix reste retapé à la main. C'est le prérequis n° 1.
- Un « plancher-remise » suppose d'abord qu'une remise **existe et soit persistée**. Un **prix
  minimum de vente** contrôlé à la saisie ne l'exige pas — c'est le contournement à considérer.
- Ajouter des familles (outillage, mobilité électrique, informatique) exige une migration **avec
  recréation de table** (CHECK sur `produits.famille`, patron de `0040`).
- « Saisir en TTC » est une mécanique de **saisie** (conversion à l'entrée, stockage HT), pas un
  changement de schéma. Une boutique en franchise (`tva_taux_defaut = 0`) a TTC = HT.

## 9. Frontière du grilling au 2026-09-16

**Round 1 — posé, sans réponse à ce jour**

1. **Vocabulaire** : `Service` est défini « sans stock » ; une réparation consomme une pièce.
   Nouveau terme, élargissement, ou rien (deux lignes sur le ticket) ?
2. **Périmètre** : le calcul vaut-il pour tout produit, ou pour les seuls imports fournisseur ?
3. **Mode de tarification des réparations** : par boutique, par type de réparation, ou par devis ?
4. **Mécanique de variante** (« housse » vs « housse de luxe ») : mots-clés paramétrables, modèle
   de langage à l'import, ou tranches de prix d'achat ?
5. **Ancrage de la grille** : catégories Mobilax (lien à créer), catégories iziGSM, ou famille ?

**Round 2 — ouvert par les mesures ci-dessus**

6. **La vente doit-elle lire le catalogue ?** Sélecteur produit/service en caisse et en devis,
   simple référence consultable, ou catalogue obligatoire ? *Sans réponse « oui », le reste du
   chantier n'a aucun effet au comptoir.*
7. **La remise : la fait-on exister ?** Réparer d'abord la remise de caisse, la créer partout, ou
   s'en passer et poser un **prix minimum de vente** contrôlé à la saisie ?
8. **Où le plancher est-il contrôlé ?** Serveur (mais les lignes de vente ne portent aucun
   `produit_id` en pratique), écran seulement, ou les deux ?

_La question « qui déroge au plancher » est repoussée : elle dépend de 7 et 8, et son socle
(`hasPermission()`) n'est branché nulle part._
