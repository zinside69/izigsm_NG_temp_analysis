# Design — Acompte structuré (sous-projet A : encaissement manuel)

**Date** : 2026-07-16
**Statut** : validé par l'utilisateur, en attente de relecture finale avant plan d'implémentation

## Contexte et objectif

Aujourd'hui, l'acompte à la prise en charge est une convention informelle en notes libres (identifié dans `docs/ANALYSE_COMPARATIVE_MONATELIER.md` §1.6). Objectif : permettre à la boutique de demander et enregistrer un acompte, qui vient en déduction de la facture finale à la livraison.

Demandé le 2026-07-16 en même temps que la feature "Accord" (checkpoint 25), mais volontairement séquencé à part — ce chantier combine en réalité deux sous-systèmes indépendants :

- **(A) Acompte encaissé manuellement** — traité par ce design. Aucune dépendance externe.
- **(B) Paiement en ligne** — nécessite un prestataire (Stripe pressenti), clés API, webhooks. Devient sa propre session dédiée, hors scope ici.

L'enum `paiements.mode_paiement` inclut déjà `'stripe'` (jamais utilisé) — l'interface de (A) reste compatible pour que (B) puisse s'y brancher plus tard sans re-design.

## Décisions validées avec l'utilisateur

| Sujet | Décision | Alternative écartée / raison |
|---|---|---|
| Cardinalité | Un seul acompte par dossier (ticket ou devis) | Cumul de plusieurs acomptes — plus de logique, pas nécessaire pour le MVP |
| Montant | Libre, saisi par la boutique | % configurable du devis/estimé — cohérent avec `prix_estime` déjà saisi librement aujourd'hui |
| Modèle de données | **Facture d'acompte** — l'acompte génère une vraie ligne dans `factures`, émise et verrouillée immédiatement | Table `acomptes` séparée — écartée car `createAvoir()` exige une facture verrouillée existante ; comme l'annulation doit produire un avoir (pas un remboursement), l'acompte doit être une vraie facture dès sa perception |
| Traçabilité NF525 | Entrée dans la chaîne au moment de l'émission de la facture d'acompte (immédiat) | Différée à la facture finale — découle directement de la décision précédente, aucune extension de la chaîne NF525 nécessaire (`enregistrerTransaction()` type `'facture'` déjà supporté) |
| Numérotation | **Même séquence `FAC-` que les factures normales**, pas de préfixe dédié | Séquence dédiée (`ACO-`) — rejetée : une facture d'acompte est légalement une "facture" (même catégorie juridique qu'une facture normale), pas une catégorie distincte comme un devis ou un avoir. Deux séquences indépendantes pour la même catégorie de document créerait une chaîne de facturation parallèle, contraire au principe même de NF525 (empêcher les séquences dissimulables) |
| Double comptage CA | **La facture finale ne facture QUE le solde restant** (total − acompte déjà facturé), via une ligne négative "Acompte déjà facturé (FAC-XXXX)" ajoutée automatiquement à ses lignes | Facture finale = montant total avec acompte affiché comme paiement déjà reçu — écartée : obligerait à exclure les factures d'acompte du calcul de CA pour ne pas compter deux fois le même argent, alors que l'acompte doit compter dans le CA de son propre jour (exigence explicite de l'utilisateur) |
| Affichage rapports caisse | Facture d'acompte fondue avec les autres factures, aucune ligne distincte | Ligne dédiée "acomptes" dans les rapports — écartée pour le MVP, ajoute du travail sur `caisseService.ts`/`statsService.ts` sans nécessité immédiate |
| Annulation avec acompte perçu | `createAvoir()` existant réutilisé tel quel, avec un motif fixe pré-rempli ("Annulation de la prise en charge #TKT-XXXX") et `date_expiration` = +2 mois | Remboursement — explicitement écarté par l'utilisateur. Motif libre via formulaire dédié — écarté pour le MVP, confirmation simple suffit |
| `date_expiration` sur `avoirs` | Nouvelle colonne nullable, **passée explicitement à la création**, pas un défaut universel | Défaut 2 mois pour tous les avoirs — écarté : un avoir `bon_achat` a des règles de validité légale différentes (souvent 1 an minimum) d'un avoir sur acompte annulé ; seul le flow annulation-avec-acompte fixe +2 mois |
| Rôles autorisés | **Admin/manager uniquement** pour créer un acompte (cohérent avec le reste de la gestion financière — création devis, encaissement facture) | Étendre à technicien (comme l'override "Accord") — écarté, la gestion financière reste un périmètre admin/manager dans tout le reste du code |
| Confirmation à l'annulation | `confirm()` JS avec texte pré-rempli explicite ("Ce ticket a un acompte facturé de 50€ — annuler générera un avoir de 50€ valable 2 mois."), pas de formulaire dédié | Mini-formulaire avec motif libre — écarté pour le MVP |

## Modèle de données

- **`factures.type_facture`** (nouvelle colonne, `TEXT NOT NULL DEFAULT 'normale'`, valeurs `normale` \| `acompte`) — même pattern que `avoirs.type` déjà en place. Migration additive, aucun impact sur les factures existantes.
- **Rattachement** : réutilise `factures.ticket_id`/`factures.devis_id` existants tels quels — aucune nouvelle colonne. Un acompte demandé depuis un ticket sans devis lie `ticket_id` seul ; un acompte demandé depuis un devis lie `devis_id` (et `ticket_id` si le devis en a un).
- **Contrainte "un seul acompte par dossier"** : validée en code à la création (`SELECT ... WHERE type_facture='acompte' AND (ticket_id = ? OR devis_id = ?)`), pas une contrainte SQL — un dossier peut légitimement changer de devis (refusé puis revu), la vérification applicative reste plus flexible qu'une contrainte UNIQUE stricte.
- **`avoirs.date_expiration`** (nouvelle colonne, `DATETIME`, nullable) — migration additive.

## Mécanisme de déduction à la facture finale

Quand la facture finale est créée (conversion devis via `convertirDevis()`, ou facturation directe d'un ticket) :

1. Rechercher une facture `type_facture='acompte'` liée au même `ticket_id`/`devis_id`.
2. Si trouvée, ajouter automatiquement une ligne négative aux lignes de la facture finale : description "Acompte déjà facturé (FAC-2026-NNNNN)", montant = −(total TTC de l'acompte).
3. Le calcul existant (`calculLignes()`) produit alors naturellement le solde restant comme `total_ht`/`total_tva`/`total_ttc` de la facture finale — aucune logique de double-comptage à gérer ailleurs, le CA de chaque jour reste la somme normale des factures émises ce jour-là.

## API & endpoints

- `POST /api/tickets/:id/acompte` et `POST /api/devis/:id/acompte` — body `{ montant, mode_paiement, reference? }`, réservé `admin`/`manager`. Valide l'absence d'acompte existant pour ce dossier, crée + émet + verrouille la facture d'acompte (hash NF525 immédiat, comme une facture normale).
- Lecture : `getTicketById()`/`getDevis()` exposent la facture d'acompte liée (numéro, montant, statut) — même pattern que `devis_id`/`devis_statut` déjà ajoutés pour la feature Accord (checkpoint 25), pas de nouvel endpoint dédié.
- Annulation : pas de nouvel endpoint — le flow d'annulation de ticket existant (`changeStatus(id, 'annule')`) déclenche, côté client, une confirmation explicite si un acompte existe, puis appelle `createAvoir()` existant avec motif fixe + `date_expiration` +2 mois.

## UI

- Bouton "Demander un acompte" sur la fiche ticket (`tickets.js`, à côté du bloc "Accord devis" du checkpoint 25) et sur la fiche devis — petit formulaire montant/mode paiement/référence, même pattern que l'encaissement existant sur facture.
- Affichage une fois créé : badge "Acompte facturé : 50€ (FAC-2026-00042)" sur la fiche ticket/devis.
- `suivi.html` (page client) : si un acompte existe, afficher "Acompte versé : 50€ · Solde restant : X€" dans le bloc Devis/Tarif déjà présent.
- Annulation avec acompte : `confirm()` avant d'appliquer la transition `annule`, texte "Ce ticket a un acompte facturé de {montant}€ — annuler générera un avoir de {montant}€ valable 2 mois." Un ticket qui se termine normalement (terminé → livré) ne génère jamais d'avoir — l'acompte est simplement déduit via la ligne négative décrite plus haut. Dans le cas normal, `TRANSITIONS_TICKET` (`livre: []`, aucune transition sortante) empêche d'annuler un ticket déjà livré, donc les deux chemins ne se rencontrent pas. **Edge case non couvert par la machine à états** : `convertirDevis()` (facture finale) est une action manuelle indépendante du statut du ticket — rien n'empêche techniquement de facturer le solde final puis d'annuler quand même le ticket ensuite (statut encore à `en_reparation` par exemple). Ce cas n'est pas géré par ce MVP (la vérification "un seul acompte par dossier" empêcherait de toute façon un deuxième avoir, mais un avoir pourrait alors porter sur un dossier déjà soldé) — à traiter si ça se présente en usage réel, pas bloquant pour le lancement.

## Tests

- Validation "un seul acompte par dossier" (409 si doublon).
- Génération correcte de la ligne négative de déduction à la facture finale (montants HT/TVA/TTC).
- Création de l'avoir avec `date_expiration` sur annulation.
- Mêmes conventions que les tests déjà écrits dans ce projet (`mockDatabase`/`mockD1` selon dépendance `auditLog`/`nextNumero`).

## Ce qui ne change PAS

- Le chantier Ports & Adapters (les nouvelles fonctions utilisent directement le port `Database` sauf dépendance `auditLog()`/`nextNumero()`, comme toute nouvelle fonctionnalité depuis le 2026-07-12).
- La chaîne NF525 existante (`journal_nf525`, `enregistrerTransaction()`) — aucune extension de type_transaction.
- Les séquences de numérotation existantes (`DEV-`, `AV-`, `FAC-`) — l'acompte rejoint `FAC-`, pas de nouvelle séquence.
- Le contrat API REST/JSON des endpoints existants (`createAvoir()`, `convertirDevis()`, etc.) — extensions additives uniquement.

## Hors scope (sous-projet B, session future)

- Paiement en ligne (choix du prestataire, clés API par boutique, webhooks de confirmation).
- Ligne dédiée "acomptes" dans les rapports de caisse (`caisseService.ts`/`statsService.ts`).
- Formulaire de motif libre à l'annulation (le motif fixe suffit pour le MVP).
