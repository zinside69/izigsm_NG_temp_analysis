# Création manuelle de facture — design

_2026-07-30 — chantier issu de `project-docs/audit-persistance-2026-07-30.md` § « Niveau 1 — Fonctionnalités entières hors service »_

## Problème

`POST /api/factures` n'existe pas côté backend. Le modal « Nouvelle facture » de
`public/factures.html` poste vers cet endpoint depuis sa création : toute soumission
tombe en 404, aucune facture n'est jamais enregistrée. Le commentaire de routage
`src/index.tsx:50` (« CRUD factures + paiements ») est trompeur — seuls
`GET /factures`, `GET /factures/:id`, `POST /factures/:id/paiement` et
`POST /factures/:id/emettre` existent.

Les factures ne peuvent donc être créées aujourd'hui que par conversion d'un devis
accepté (`PUT /api/devis/:id/convertir`) ou par la caisse.

Trois défauts annexes du même formulaire, indépendants de l'endpoint manquant :

- le select « Statut » n'est jamais lu — le statut réel vient du bouton cliqué ;
- la signature électronique est triplement morte : endpoint inexistant, canvas jamais
  lu (`.toDataURL()` n'est jamais appelé sur `f-sig-canvas`), colonne
  `factures.signature_client` inexistante ;
- le mode de paiement est envoyé sous la clé `mode_paiement_prefere`, qui ne
  correspond à aucun champ du service (le vrai champ `mode_paiement` vit sur la table
  `paiements`).

## Objectif

Rendre la création manuelle de facture réellement fonctionnelle, en réutilisant le
socle métier existant, et supprimer du formulaire tout élément qui ment à
l'utilisateur.

## Décisions de cadrage

| Sujet | Décision | Justification |
|---|---|---|
| Périmètre | Facture libre, rattachable à un ticket **et** convertible depuis un devis | Le modal expose déjà les trois cas ; un `devis_id` délègue au chemin existant plutôt que d'en dupliquer la logique |
| Statut | 3 boutons : Brouillon · Émettre · Émettre & encaisser | Le select « Statut » est muet et contredit les boutons ; un verrouillage NF525 irréversible doit être déclenché par une action explicite |
| Signature | Retirée du modal | Une facture est opposable par son hash NF525 ; c'est le devis qui porte l'accord signé et le ticket la prise en charge. Aucune migration pour un besoin non avéré |
| Fallback hors-ligne | Supprimé | `saveFactureFallback()` fabrique un numéro `FAC-2026-…` côté client : document légalement faux et collision de numérotation garantie. Un document comptable n'a pas de mode dégradé local |
| TVA | Taux par défaut au niveau du document + taux modifiable par ligne | Patron du modal devis, et `lignes_document.tva_taux` est déjà par ligne |

## Approche retenue

Nouvelle fonction `createFacture()` dans `factureService.ts`, qui réutilise le socle
existant (`nextNumero()`, `calculLignes()`, `ajouterPaiement()`, `emettreFacture()`).
La route délègue à `convertirDevis()` quand un `devis_id` est fourni.

Deux approches ont été écartées :

- **Fonction générique unique** absorbant `createFacture`, `createFactureAcompte` et
  `convertirDevis` : plus DRY sur le papier, mais touche deux chemins en production
  déjà validés (spec acompte du 2026-07-16) pour un gain marginal — risque de
  régression NF525 disproportionné.
- **Endpoint minimal + orchestration frontend** (`POST /factures` puis `/paiement`
  puis `/emettre` en trois requêtes) : un échec au milieu laisse une facture orpheline
  non émise avec un numéro consommé. Une transaction comptable ne se pilote pas depuis
  le navigateur.

## Contrat API

`POST /api/factures` — `src/routes/facturation.ts`, section FACTURES,
`requireRole('admin', 'manager')` (aligné sur `/factures/:id/paiement` et
`/factures/:id/emettre`).

```jsonc
{
  "client_id": 12,                    // obligatoire
  "ticket_id": 45,                    // optionnel
  "devis_id":  null,                  // si présent → délégation convertirDevis()
  "lignes": [                         // ≥ 1 si devis_id absent
    { "description": "…", "quantite": 1, "prix_unitaire_ht": 89.90, "tva_taux": 20 }
  ],
  "notes": "…",
  "conditions": "…",
  "action": "brouillon" | "emettre" | "emettre_encaisser",
  "mode_paiement": "Carte bancaire",  // requis si et seulement si action = emettre_encaisser
  "reference": "…"                    // optionnel — n° de chèque, transaction CB…
}
```

**Invariant d'isolation** : `boutique_id` n'est jamais lu du body comme valeur de
confiance — la route calcule `getBoutiqueId(user, body.boutique_id?.toString())`, même
patron que `POST /devis` (`facturation.ts:88`). Ce repo a un historique de failles
d'isolation multi-tenant réelles (voir `project-docs/bugs.md`) : toute écriture doit
dériver la boutique du JWT.

Réponses :

| Code | Cas |
|---|---|
| `201` | `{ success, facture_id, facture_numero, statut }` |
| `400` | Validation du body (lignes, action, mode de paiement manquant) |
| `403` | Rôle insuffisant |
| `422` | Erreur métier remontée par le service (message tel quel) |

**Délégation devis** : si `devis_id` est fourni, la route appelle `convertirDevis()`
— chemin existant qui porte déjà ses garanties (refus si le devis est refusé, annulé
ou déjà converti ; déduction automatique d'une facture d'acompte antérieure) — puis
`ajouterPaiement()` / `emettreFacture()` selon `action`. Les lignes du body sont alors
ignorées ; le frontend doit donc les afficher en lecture seule dès qu'un devis est
sélectionné.

## Service

```ts
export interface CreateFactureInput {
  boutique_id: number
  client_id:   number
  ticket_id?:  number | null
  lignes: Array<{
    description:      string
    quantite:         number
    prix_unitaire_ht: number
    tva_taux:         number
  }>
  notes?:      string
  conditions?: string
  action: 'brouillon' | 'emettre' | 'emettre_encaisser'
  /** Requis si action = 'emettre_encaisser'. */
  mode_paiement?: string
  reference?:     string
}

export async function createFacture(
  db: D1Database, userId: number, input: CreateFactureInput
): Promise<{ facture_id: number; facture_numero: string; statut: StatutFacture }>
```

Séquence — **toute la validation précède `nextNumero()`**, pour ne jamais consommer un
numéro séquentiel de boutique sur une saisie invalide :

1. Valider les lignes : au moins une, `quantite > 0`, `prix_unitaire_ht ≥ 0`,
   `tva_taux ∈ {0, 5.5, 10, 20}`. Valider `mode_paiement` si
   `action = 'emettre_encaisser'`.
2. Vérifier que `client_id` — et `ticket_id` s'il est fourni — appartient bien à
   `boutique_id`, sinon `throw`. Isolation à l'écriture, pas seulement à la lecture.
3. `calculLignes()` (`src/lib/db.ts:210`, helper déjà partagé) → totaux HT / TVA / TTC.
4. `nextNumero(db, boutique_id, 'facture')`.
5. `INSERT INTO factures` avec `type_facture = 'normale'` (défaut de la migration
   `0036`) et `statut = 'brouillon'` — `ajouterPaiement()` et `emettreFacture()`
   exigent toutes deux `locked = 0`, la facture doit donc démarrer éditable.
6. `INSERT INTO lignes_document` (`document_type = 'facture'`) via `db.batch`.
7. Si `action = 'emettre_encaisser'` → `ajouterPaiement()` (avant l'émission).
8. Si `action ≠ 'brouillon'` → `emettreFacture()` : hash NF525, `tracking_token`,
   `locked = 1`, statut `brouillon` → `en_attente`.
9. `auditLog('CREATE_FACTURE')`.

La fonction reste sur `D1Database` brut : elle dépend de `nextNumero()`,
`auditLog()`, `ajouterPaiement()` et `emettreFacture()`, aucune n'étant migrée vers le
port `Database` (chantier Ports & Adapters — voir `CLAUDE.md`). Aucun code à
contre-courant n'est introduit.

Statut final attendu : `brouillon` → `brouillon` · `emettre` → `en_attente` ·
`emettre_encaisser` → `payee` (via `ajouterPaiement()`, qui passe à `payee` dès que le
montant réglé couvre le TTC).

## Frontend

### `public/factures.html`

| Élément | Action | Raison |
|---|---|---|
| Bloc « Signature électronique » (`f-sig-area`, `f-sig-canvas`) | Supprimé | Décision de cadrage |
| Select « Statut » (`f-status`) | Supprimé | Jamais lu ; les boutons portent l'intention |
| Champ « Description » (`f-description`) | Supprimé | Doublon des lignes ; aujourd'hui concaténé dans `notes`, ce qui salit les notes |
| Select « TVA par défaut » (20 / 10 / 5,5 / 0 %) | Ajouté | Patron du modal devis, appliqué aux nouvelles lignes |
| Colonne « TVA » par ligne | Ajoutée | `lignes_document.tva_taux` est par ligne |
| Footer | 3 boutons : `💾 Brouillon`, `📄 Émettre`, `💶 Émettre & encaisser` | Le libellé « Envoyer » disparaît tant qu'aucun email de facture n'existe |
| Select « Mode de paiement » (`f-payment`) | Conservé, envoyé sous `mode_paiement`, activé seulement pour l'encaissement | La clé `mode_paiement_prefere` ne correspondait à rien |

### `public/static/js/factures.js`

- `saveFacture(action)` remplace `saveFacture(statusLabel)` ; la table
  `STATUT_LABEL_TO_API` disparaît.
- `saveFactureFallback()` est supprimée intégralement, avec l'appel
  `generateNumber('FAC-2026-', …)` côté client.
- En cas d'échec API : message d'erreur explicite, modal maintenu ouvert avec la
  saisie intacte, rien n'est présenté comme enregistré.
- Sélection d'un devis : lignes préremplies **en lecture seule**, avec un bandeau
  « lignes reprises du devis DEV-… ».
- Confirmation navigateur avant `Émettre` et `Émettre & encaisser` : l'émission est
  irréversible (`locked = 1`, CGI art. 289) et consomme un numéro.
- Les appels API utilisent `r.data.success` / `r.data.data` — jamais `r.success` /
  `r.data`, classe de bug récurrente sur ce repo (`CLAUDE.md`, `bugs.md`).

### `public/sw.js`

`CACHE_VERSION` v2.79 → v2.80, sur la dernière tâche frontend du chantier
(règle `CLAUDE.md`).

## Cas limites

| Cas | Comportement attendu |
|---|---|
| Aucune ligne, ou toutes vides | `400`, aucun numéro consommé |
| `action = 'emettre_encaisser'` sans `mode_paiement` | `400` |
| `client_id` (ou `ticket_id`) d'une autre boutique | `422` — refus du service |
| `devis_id` déjà converti, refusé ou annulé | `422`, message existant de `convertirDevis()` |
| Total TTC égal à 0 | `422` — refus du service, sans objet comptable et l'encaissement échouerait plus loin |
| Rôle `technicien` | `403` |

## Tests

- `tests/services/factureService.test.ts` (mocks D1 de `tests/helpers/`) : les trois
  actions et leur statut final, validation exécutée avant `nextNumero()`, écriture des
  lignes avec le bon `document_type`, refus d'un client hors boutique.
- Tests de route : matrice des rôles, `boutique_id` du body ignoré au profit du JWT,
  délégation `devis_id` → `convertirDevis()` appelée et lignes du body ignorées.
- `npx vitest run` vert avant chaque tâche suivante. Baseline actuelle : 833/835, les
  2 échecs de fuseau horaire étant pré-existants — ne pas les confondre avec une
  régression.
- Validation en local live (`wrangler pages dev --local --port 3000`) : les trois
  boutons, vérification en base D1 (`numero`, `locked`, `hash_nf525`,
  `lignes_document`, `paiements`), plus un rejet volontaire pour confirmer que la
  saisie n'est pas perdue.

## Amendement 2026-07-30 — socle de données de la facture électronique

Ajouté après la rédaction initiale, sur demande utilisateur : la réforme française de
la facturation électronique s'impose à toutes les entreprises et doit être prise en
compte dès ce chantier.

**Sources** : `frenchinvoice.fr/reforme-2026/donnees-reglementaires` ·
`impots.gouv.fr/specifications-externes-b2b` (spécifications externes DGFiP v3.1,
normes AFNOR XP Z12-012 / 013 / 014).

**Ce que la réforme exige** : un socle initial de données réglementaires dès le
**1er septembre 2026**, au format sémantique **EN 16931** enrichi des extensions
françaises **EXT-FR-FE**, transmis en **UBL 2.1** ou **CII D22B**. Le PPF rejette les
flux non conformes (`REJ_SEMAN` format sémantique, `REJ_UNI` unicité du triplet
*numéro + SIREN vendeur + année*, `REJ_COH` cohérence avec les référentiels).
Le calendrier par taille d'entreprise n'est pas couvert par ces deux sources — à
confirmer avant toute communication client.

### Écart constaté et décision

| Donnée du socle | Avant amendement | Décision |
|---|---|---|
| Numéro unique séquentiel | ✅ `nextNumero()`, séquence par boutique et par année | Rien à faire — compatible avec le contrôle d'unicité PPF |
| Date d'émission | ✅ `date_emission` / `issued_at` | Rien à faire |
| Date de livraison ou d'exécution | ❌ absente | **Ajoutée** — colonne `factures.date_execution` + champ au formulaire |
| Identité vendeur (SIREN, adresse) | ⚠️ lue par jointure vivante sur `boutiques` | **Figée à l'émission** |
| Identité acheteur (SIREN, adresse, TVA intracom) | ⚠️ lue par jointure vivante sur `clients` | **Figée à l'émission** |
| Total HT ventilé par taux de TVA | ❌ absent | **Ajoutée** au document imprimé (dérivée des lignes) |
| Mention franchise TVA (art. 293 B CGI) | ❌ absente du document | **Ajoutée** — sans nouvelle colonne : le régime se déduit de `boutique_settings.tva_taux_defaut = 0` et le texte vient de `boutique_settings.mention_facture`, tous deux déjà paramétrables |
| Pénalités de retard + indemnité forfaitaire 40 € | ❌ absentes | **Ajoutées** au document (texte statutaire, voir ci-dessous) |
| Format structuré UBL 2.1 / CII D22B | ❌ inexistant | **Hors périmètre** — chantier dédié |
| Transmission PDP / PPF, e-reporting | ❌ inexistante | **Hors périmètre** — chantier dédié |

### Pourquoi maintenant plutôt qu'après

Deux raisons, dont une qui ne dépend pas de la réforme :

1. **Le snapshot corrige un défaut déjà présent.** Une facture émise est verrouillée
   (`locked = 1`, CGI art. 289) et censée être inaltérable, or son rendu lit
   aujourd'hui la fiche client et la fiche boutique *vivantes* par jointure : modifier
   une adresse client réécrit rétroactivement une facture déjà émise. La réforme rend
   ce défaut bloquant, elle ne le crée pas.
2. **Le coût est asymétrique.** Toute facture émise avant l'ajout de ces colonnes en
   sera définitivement dépourvue — le verrouillage NF525 interdit le rattrapage.
   Ajouter les colonnes avant la mise en service coûte une migration ; les ajouter
   après coûte la même migration plus un stock de factures non conformes.

### Point de conception : où figer le snapshot

Dans `emettreFacture()`, pas dans `createFacture()`. C'est le moment exact où le
document devient inaltérable, et c'est le point de passage **unique** des trois
chemins de création (facture manuelle, conversion de devis, facture d'acompte) — les
trois héritent donc du snapshot sans code dupliqué. Une facture restée en brouillon
n'a pas de snapshot et continue de lire les fiches vivantes, ce qui est le
comportement voulu tant qu'elle reste modifiable.

### Mentions légales — validées le 2026-07-30

Le workspace interdit d'inventer un texte légal (`todo.md` : « ne pas inventer le
texte »). Les formulations ci-dessous sont statutaires, citées avec leur article, et
ont été **validées par l'utilisateur** :

- Retard, **toujours affichée en pied de facture, à titre informatif** : « En cas de
  retard de paiement, une pénalité égale à trois fois le taux d'intérêt légal sera
  exigible (art. L441-10 du code de commerce), ainsi qu'une indemnité forfaitaire pour
  frais de recouvrement de 40 € (art. D441-5 du code de commerce). »
- Escompte, toujours affichée : « Pas d'escompte pour paiement anticipé. »
- Franchise, **conditionnelle** : « TVA non applicable, article 293 B du CGI. »

### Régime de TVA — piloté par le paramétrage existant, pas par une nouvelle colonne

La mention de franchise ne concerne que les auto-entrepreneurs et micro-entreprises.
Le paramétrage nécessaire existe déjà et est déjà multi-tenant — la colonne
`boutiques.franchise_tva` initialement envisagée est abandonnée :

| Besoin | Source existante |
|---|---|
| Boutique en franchise ? | `boutique_settings.tva_taux_defaut === 0` (migration `0002`, réglé dans `settings.html:238`) |
| Texte de la mention | `boutique_settings.mention_facture` (migration `0018`, `settings.html:255`) |

Règle de rendu : la `mention_facture` saisie par la boutique prime toujours et n'est
jamais réécrite ; à défaut, et seulement si `tva_taux_defaut === 0`, la mention
statutaire 293 B s'affiche ; sinon rien.

`mention_facture` est aujourd'hui saisie, stockée et rechargée mais **jamais affichée**
sur aucun document — même famille de défaut que l'audit du 2026-07-30. Ce chantier la
branche sur la facture ; devis et avoir restent à traiter séparément.

Le taux de TVA proposé par défaut dans le modal de création suit lui aussi
`tva_taux_defaut` au lieu d'un 20 % codé en dur, tout en restant modifiable ligne par
ligne (une réparation facture couramment une pièce à 20 % et une prestation à 10 %).

Les CGV/CGR complètes restent l'item distinct de `todo.md` (à récupérer sur
`telnet-beynost.fr`, hors de ce chantier).

## Hors périmètre

Tracé, non traité ici :

- Email de facture au client — aucun template n'existe dans `emailService.ts`,
  contrairement aux devis.
- Workflow de facturation automatique ticket terminé → facture brouillon
  (`project-docs/todo.md`).
- Configuration d'affichage HT/TTC par boutique (`project-docs/todo.md`).
- Les quatre autres fichiers au pattern `r.success` / `r.data`
  (`reconditionnement.js`, `fournisseurs.js`, `caisse.js`, `services.js`).
- **Facturation électronique — format et transmission** : génération UBL 2.1 / CII
  D22B (ou Factur-X), raccordement à une plateforme agréée (PDP), cycle de vie des
  statuts normalisés, e-reporting des opérations B2C et internationales. Chantier
  dédié, à cadrer par son propre `superpowers:brainstorming`. Le présent chantier se
  limite à **capturer et figer les données** que ce format exigera.
