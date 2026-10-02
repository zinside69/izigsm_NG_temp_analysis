---
id: 001
titre: Export comptable Excel — onglet « Mensuel » des encaissements par jour et par mode
statut: in-progress
bloque-par: []
---

# 001 — Export comptable Excel : onglet « Mensuel »

## Contexte

Demande de l'exploitant du 2026-10-02, à partir de son export de septembre (`ca_2026-09-01_2026-09-30.csv`,
une ligne par facture payée) et d'un exemple de brouillard de caisse (`ca_month_06-2026.xls`, une ligne
par jour : chèques, espèces, CB, virement, total, remises en banque, soldes). Il veut, dans l'export
comptable, un onglet **« Mensuel »** : le chiffre d'affaires **de chaque journée**, ventilé entre
**espèces, CB, chèque et virement**, et les sommes du mois — « un document simple de lecture ».

**Codé dans `izigsm/webapp` avec l'exploitant** (lit les encaissements de caisse, document comptable —
règle de répartition du 2026-09-30). **Aucune migration.**

### Constats du cadrage (2026-10-02)

- L'export actuel (`exportCsvCa()`, `statsService.ts`) liste les **factures** `payee` à leur **date
  d'émission** ; le mode est un `GROUP_CONCAT` des paiements. Un paiement mixte ou différé y tombe au
  mauvais jour ou au mauvais mode.
- Les encaissements vivent dans **`paiements`** (`montant`, `mode_paiement`, `date_paiement`,
  `boutique_id`, `facture_id`). `date_paiement` est en **UTC** (`CURRENT_TIMESTAMP`).
- **Casse incohérente mesurée en production** : `CB` (1) et `cb` (1) coexistent. Modes connus :
  `especes`, `cb`, `cheque`, `virement`, `stripe` (schéma), `mixte` (caisse).
- **Défaut trouvé** : un paiement **mixte** en caisse est écrit en **une** ligne `mixte` pour tout le
  montant (`createVente()`, étape 5) — la part espèces / CB **n'est stockée nulle part**
  (`bugs.md`). Il ne peut pas être ventilé ; il a sa propre colonne.
- Un paiement ne porte ni HT ni TVA : ils viennent de sa facture.
- Le brouillard de l'exemple (soldes, remises en banque, sorties d'espèces) suppose un **fond de
  caisse** qu'iziGSM ne suit pas : hors périmètre (décision 1).
- Aucune librairie Excel dans le dépôt (`dependencies` : `hono` seul).

### Décisions de l'exploitant du 2026-10-02

1. **Contenu : encaissements du jour**, pas de brouillard de caisse (soldes / remises = chantier
   distinct, non ouvert).
2. **Base : date de l'encaissement**, dans son mode réel (`paiements`), jour **en heure de Paris**.
3. **Format : un fichier Excel `.xlsx` à deux onglets**, « Mensuel » (mis en forme) et « Détail »
   (le contenu du CSV actuel), généré par le serveur, **sans nouvelle dépendance**.
4. **Codé ici.**
5. **Trois onglets** (précision du même jour, remplace « deux onglets » de la décision 3) :
   **« Mensuel »**, **« Encaissements »** (une ligne par paiement — date et heure de Paris, n° de
   facture, client, mode, TTC, HT, TVA — dont la somme égale le total du Mensuel) et **« Factures
   payées »** (le contenu du CSV actuel, base différente : date d'émission). Le CSV reste disponible.

### Conception

- **Agrégation** (`statsService.ts`, nouvelle fonction pure + lecture) : lire les paiements de la
  boutique dont `date_paiement` tombe dans la période **convertie en bornes UTC** (± 1 jour de marge,
  puis filtre exact en heure de Paris), avec la facture jointe (`total_ht`, `total_tva`,
  `total_ttc`, lignes pour les taux). Regrouper **en JavaScript** par jour de Paris
  (`src/lib/timezone.ts`) et par mode normalisé (`LOWER(TRIM())` : `especes`, `cb`, `cheque`,
  `virement`, `mixte` ; tout autre → « Autre »).
- **HT et TVA d'un encaissement** = prorata de sa facture : `montant × total_ht / total_ttc`
  (TVA = montant − HT), arrondi au centime **par jour** ; facture à 0 € → 0. **TVA collectée par
  taux** : même prorata, réparti selon les lignes de la facture par `tva_taux`.
- **Onglet « Mensuel »** : en-tête (nom et ville de la boutique, période en clair « Septembre
  2026 ») ; **une ligne par jour de la période**, jours sans encaissement compris (montants vides,
  ligne grisée) ; colonnes **Date (jour en toutes lettres) · Espèces · CB · Chèque · Virement ·
  Mixte · Autre · TOTAL TTC · HT · TVA · Nb encaissements** ; colonnes Mixte et Autre **présentes
  seulement si non vides sur la période** ; ligne **TOTAL** en gras ; sous le tableau, **TVA
  collectée par taux**, et une note si la colonne Mixte existe (« part espèces / CB non
  enregistrée »). Montants au format monétaire €.
- **Onglet « Détail »** : les colonnes du CSV actuel, inchangées.
- **Fichier** : `src/lib/xlsx.ts`, écrivain minimal **SpreadsheetML** + archive ZIP **sans
  compression** (CRC-32 calculé), styles fixes (en-tête, gras, gris, format `#,##0.00 €`). Fonction
  pure, testable sans réseau.
- **Route** : `GET /api/stats/export/xlsx?from&to` (`requireRole('admin', 'manager')`, boutique par
  `getBoutiqueId()`), `Content-Type`
  `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, nom
  `export-comptable_<boutique>_<AAAA-MM>.xlsx`. Le CSV actuel reste disponible.
- **Écran** (`stats.html`, Synthèse comptable) : bouton **« Export comptable (Excel) »** à côté de
  « Exporter CA (CSV) », même période.

## Critères d'acceptation

- [ ] Agrégation : un jour par date de Paris (un paiement à 23 h 30 heure de Paris le 30/09 compte le
      30/09) ; `CB` et `cb` dans la même colonne ; `mixte` dans sa colonne ; jours vides présents ;
      totaux = somme des jours ; HT + TVA = TTC au centime par jour
- [ ] Isolation : une autre boutique n'apparaît jamais (vrai SQLite)
- [ ] `.xlsx` lisible par Excel / LibreOffice : deux onglets nommés, ligne TOTAL, montants numériques
      (pas du texte) — relu par `openpyxl` sur le fichier produit par la route réelle
- [ ] Route : manager et admin plateforme ; technicien 403 ; sans jeton 401 ; période invalide 400
- [ ] Écran : bouton dans la Synthèse comptable, période de la page, fichier téléchargé
- [ ] `bugs.md` : paiement mixte non ventilé (défaut ouvert, correctif = caisse, hors ticket)
- [ ] ∀ test vu rouge avant correctif ; vitest sans nouvel échec ; tsc ≤ 32 ; `CACHE_VERSION` +1

## Coutures à tester

- **Agrégation** — vitest sur fonction pure (dates en UTC → jour de Paris, normalisation des modes,
  prorata HT/TVA, jours vides) et vitest contre un **vrai SQLite** (`d1Sqlite.ts`) pour la lecture
  (bornes, isolation).
- **Écrivain xlsx** — vitest : archive ZIP valide (signature, CRC), feuilles nommées, cellules
  numériques ; relecture `openpyxl` du fichier réel en E2E.
- **Route** — vitest par `app.request()` : rôles, période, en-têtes.
- **Écran** — E2E `tests/e2e/export-comptable-xlsx.spec.ts` : vente encaissée en caisse sur la vraie
  base locale, téléchargement depuis Statistiques, onglet « Mensuel » relu (ligne du jour, colonne
  du mode, TOTAL).

## Notes

- Hors périmètre : fond de caisse, remises en banque, soldes (exemple de l'exploitant) ; FEC ;
  factures émises non payées ; avoirs. À cadrer si le besoin se confirme.
- Le défaut « mixte » se corrige en caisse (un paiement par mode) : ticket à part, NF525 (codé ici).
