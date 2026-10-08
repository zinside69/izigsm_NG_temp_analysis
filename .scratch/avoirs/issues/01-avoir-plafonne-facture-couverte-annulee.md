---
id: 01
titre: Avoir plafonné, facture couverte « annulée » (migration 0068)
statut: done
bloque-par: []
migration: 0068
qui-code: exploitant (NF525) — jamais au socle
---

## Contexte
Spec stories 19-22, 24, 29-33. Un avoir n'a aujourd'hui aucun plafond (1 000 € d'avoir passent sur une
facture de 70 €) et ne change rien à la facture qu'il annule : `FAC-2026-00009`, couverte par
`AV-2026-00001`, reste « Émise, 70,52 € ». Décisions Q5, Q6, Q10, Q12, Q15 (`decisions.md` § 2026-10-06).

## Critères d'acceptation
- [x] Migration `0068` : `lignes_avoir` + `prix_unitaire_ttc` (REAL) et `mode_calcul` (`ttc` | `ht`, défaut
      `ht`) ; `clotures_journalieres` + `avoirs_ht`, `avoirs_tva`, `avoirs_ttc` (défaut 0) ; **reprise** : toute
      facture dont la somme des avoirs atteint son total TTC passe `annulee`
- [x] Une seule requête « somme des avoirs d'une facture », en centimes entiers
- [x] Émission d'un avoir : plafond contrôlé **avant** l'attribution du numéro — somme des avoirs existants +
      total TTC du nouvel avoir > total TTC de la facture → refus `plafond_depasse` (400) avec le montant encore
      annulable ; aucun numéro consommé
- [x] Avoir exactement égal au reste annulable → accepté
- [x] **Après** l'écriture au journal NF525 : cumul = total TTC → la facture passe `annulee` (payée ou non) ;
      seul l'état change, contenu / numéro / instantanés / chaînage intacts
- [x] Avoir partiel → état de la facture inchangé ; deux partiels qui couvrent → `annulee` au second
- [x] Ligne d'avoir saisie en TTC → `prix_unitaire_ttc` et `mode_calcul = 'ttc'` écrits ; ancien format HT
      accepté, écrit `ht` ; par les fonctions communes « colonnes de prix d'une ligne » / « ligne en TTC »
- [x] Écran Factures : une facture `annulee` s'affiche « Annulée » ; le refus `plafond_depasse` s'affiche dans la
      fenêtre d'avoir avec son montant
- [x] Garde-fous verts (écrivains NF525, isolation des routes, enveloppe d'API) ; vitest vert, tsc ≤ 32
- [x] E2E « avoir trop grand refusé, avoir total → facture Annulée » vu rouge puis vert

## Coutures à tester
- **Service sur vrai SQLite** (`d1Sqlite`) : plafond (avoir unique, cumul), compteur de numéros d'avoir
  inchangé après refus, `annulee` (en attente, payée), partiel, deux partiels, `verifierIntegriteChaine()` intègre
- **Migration `0068` sur vrai SQLite** : colonnes ajoutées ; facture couverte → `annulee` ; facture partiellement
  couverte et facture sans avoir intactes ; clôtures existantes inchangées
- **E2E** : refus affiché, facture couverte affichée « Annulée »

## Notes
- Numéro de migration `0068` **réservé** à ce chantier : le reprendre dans la déclaration de la tâche.
- Ordre de déploiement : `0068` à distance **avant** le code ; relire `d1_migrations` **et** l'état de
  `FAC-2026-00009` (attendu `annulee`) avant `npm run deploy`. Point Time Travel relevé et consigné
  (`journal-migrations.md`).
- Relire la conception avant de coder : l'état `annulee` s'écrit **après** le journal (comme le figeage d'une
  vente) — un échec du journal ne doit pas laisser une facture annulée sans avoir chaîné.

## Réalisation (2026-10-08)
- Plafond dans `createAvoir()` par `couvertureDeLaFacture()` + `sommeDesAvoirsEnCentimes()`, refus typé
  `ErreurPlafondAvoir` (400, `code: plafond_depasse`, `encore_annulable`, jamais négatif) ; empreinte de l'avoir
  et état `annulee` écrits en un lot `batch()` après le journal ; `enCentimes()` / `formaterCentimesEnEuros()`
  mis en commun dans `src/lib/montants.ts`.
- Refus affiché par le message flash (au-dessus de la fenêtre) ; **dans** la fenêtre : ticket 06.
- Revue : bouton « Émettre l'avoir » figé pendant l'envoi (double-clic) ; annulation d'un ticket dont
  l'acompte est déjà couvert : aboutit au lieu de bloquer sur le plafond (`tickets.js`). Garantie serveur
  contre deux avoirs simultanés : non posée (même absence de verrou que la caisse) — `todo.md`.
- Tests : `avoirs-plafond-sqlite`, `migration-0068-avoirs-sqlite`, E2E `avoirs-plafond`,
  `tickets-annulation-acompte-couvert` (vus rouges). Vitest 1 542 + 2 permanents, tsc 31, E2E complets verts
  (3 échecs de charge rejoués seuls verts — base locale à 11 860 boutiques). `CACHE_VERSION` v3.36.
