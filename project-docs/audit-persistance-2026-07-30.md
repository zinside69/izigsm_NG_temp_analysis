# Audit persistance des champs — 2026-07-30

> Déclenché suite à la découverte du bug `t-imei` (prise en charge) : le champ existe dans le formulaire, est envoyé par le frontend, mais n'est persisté nulle part (ni interface TS, ni colonne SQL). Audit complet de toutes les pages de repairdesk.fr, en lecture seule, réalisé par 3 subagents en parallèle. Aucun code modifié — ce document est un rapport de constat, les corrections restent à décider et prioriser.

**Méthode** : pour chaque champ de formulaire, vérification de la chaîne complète frontend (JS envoie le champ ?) → route backend (destructure et transmet ?) → interface TypeScript service (champ déclaré ?) → SQL INSERT/UPDATE (colonne réellement écrite ?) → migration (colonne existe en base ?). Les bugs déjà documentés dans `bugs.md` ne sont pas re-listés ici.

---

## 🔴🔴🔴 Niveau 1 — Fonctionnalités entières hors service

### 1. `factures.html` — création manuelle de facture 100% non fonctionnelle
**`POST /api/factures` n'existe pas dans le backend.** Le commentaire de routage (`src/index.tsx:50`) prétend un CRUD complet, mais seules existent `GET /factures`, `GET /factures/:id`, `POST /factures/:id/paiement`, `POST /factures/:id/emettre`. Toute soumission du modal "+ Nouvelle facture" tombe sur un 404 — toast d'erreur visible, mais **rien n'est jamais enregistré**. Les 8 champs du formulaire (client, devis source, description, lignes, mode de paiement, statut, notes, signature) sont donc tous cassés par construction.

Découvertes annexes dans le même formulaire (indépendantes du bug d'endpoint, à corriger si l'endpoint est un jour créé) :
- Le sélecteur "Statut" n'est jamais lu — le statut réel vient du bouton cliqué (`saveFacture('Brouillon')`/`saveFacture('Envoyée')`), donc choisir "Payée" dans le menu déroulant n'a aucun effet.
- La signature électronique est **triplement morte** : endpoint inexistant, jamais lue depuis le canvas côté JS (`f-sig-canvas` n'est utilisé que pour dessiner/effacer, jamais `.toDataURL()`), et la table `factures` n'a même pas de colonne `signature_client`.
- Le champ "Mode de paiement" est envoyé sous la clé `mode_paiement_prefere`, qui ne correspond à aucun champ réel du service (le vrai champ `mode_paiement` vit sur la table `paiements`, pas `factures`).

**Chemin de contournement actuel** : les factures ne peuvent être créées aujourd'hui que via conversion d'un devis accepté (`PUT /api/devis/:id/convertir`) ou via la caisse — jamais via ce modal dédié.

### 2. `personnel.html` — page entière hors service
**`app.js` n'est chargé sur aucun script de cette page** — la seule page du site dans ce cas (les 21 autres l'incluent). Résultat : `apiGet`/`apiPost`/`apiPut` sont `undefined`, `ReferenceError` à la moindre action. En plus, le pattern `r.success`/`r.data` (déjà connu ailleurs) est aussi cassé dans `personnel.js`. **Aucune donnée RH/pointage ne peut être créée actuellement** : création employé, note de pointage, tout est inatteignable. Édition employé et gestion PIN/permissions sont absentes de l'UI alors que le backend les supporte déjà.

---

## 🔴🔴 Niveau 2 — Perte de données silencieuse (pas d'erreur visible, mais rien n'est enregistré)

| Page | Champ | Impact |
|---|---|---|
| `tickets.html` | `t-imei` (IMEI/N° série) | Perdu à chaque prise en charge, aucune colonne `imei` sur `tickets`. **Découverte initiale de cet audit.** |
| `tickets.html` | `t-priority` **en création uniquement** | Tout nouveau ticket reçoit la priorité par défaut `'normale'`, quel que soit le choix Basse/Moyenne/Haute du technicien. Fonctionne correctement en édition. |
| `stock.html` | `stock-notes` | Absent de l'interface TS et de la colonne SQL — jamais persisté en création ni en édition. |
| `stock.html` | `stock-qty` **en édition** | Créé correctement, mais modifier la quantité d'un produit existant est silencieusement ignoré (`stock_actuel` absent de `UpdateProduitData`) — **risque d'erreurs d'inventaire réel**. |
| `services.html` | `modele-marque-id` **en édition** | Changer la marque d'un modèle existant est silencieusement ignoré (`updateModele()` n'a pas ce champ dans sa signature). |
| `caisse.html` | `remise_pct` (remise ligne de vente) | Le total net est correct, mais le taux de remise saisi est perdu — facture non réimprimable avec le détail réel de la remise (impact NF525-adjacent). |
| `settings.html` | `monnaie` | Figée à `'EUR'` quoi que sélectionne l'utilisateur — absent des deux côtés backend. Mineur sauf besoin multi-devise. |
| `agenda.html` | `rdv-description`, `rdv-nom-client`, `rdv-tel-client`, `rdv-client-id`, `rdv-ticket-id` (les 5, en édition) | Impossible de **vider** un de ces champs une fois rempli — `body.xxx ?? ancienneValeur` retombe sur l'ancienne valeur quand le frontend envoie explicitement `null`. Toast "mis à jour" trompeur. Création (POST) saine. |

---

## 🟠 Niveau 3 — Bug d'affichage transversal (les données s'enregistrent, mais l'utilisateur ne le voit jamais)

Le pattern `res.success`/`res.data` au lieu de `res.data.success`/`res.data.data` (déjà connu et corrigé sur `agenda.js`/`sav.js`/`stats.html`/`devis.js`/`settings.html` en 2026-07-16/17) est présent sur **3 fichiers non encore traités** :

| Fichier | Fonctions touchées | Conséquence concrète |
|---|---|---|
| `reconditionnement.js` | 11 fonctions | **Les modals "Modifier un ordre" et "Terminer un ordre" ne s'ouvrent jamais.** Vérification de bon d'achat en caisse toujours signalée en échec. KPIs/listes jamais affichés. |
| `fournisseurs.js` | 12 fonctions | Listes/KPIs jamais affichés, sauvegardes réussies affichées comme échecs — **risque de doublons** si l'utilisateur re-soumet en croyant avoir échoué. |
| `caisse.js` | 9 fonctions | KPIs et journal du jour jamais affichés, recherche client/facture sans résultat visible, **ventes/encaissements réels affichés comme des échecs**. |
| `services.js` | marques/modèles/liaisons (`loadMarques`, `loadModeles`, `openModalLiaison`, `saveMarque`, `saveModele`, `addLiaison`, `startSync`...) | Listes toujours vides à l'écran malgré des données réelles en base. |

---

## 🟡 Niveau 4 — Suspects mineurs (comportement trompeur, pas de perte de donnée)

- `services.html` : `svc-duree` et `liaison-prix-specifique` — une saisie `0` est transformée en `null` par `parseFloat(...) || null` (falsy trap classique).
- `rachats.html` : `r-prix` — même défaut, bloque à tort un rachat à prix nul avec un message d'erreur (visible, pas silencieux).
- `stock.html` : `stock-category` — impossible de **retirer** une catégorie déjà assignée (COALESCE conserve l'ancienne valeur).
- `devis.html` : `d-tva` (taux TVA par défaut) — ne s'applique qu'au moment d'ajouter une ligne, ne met pas à jour les lignes déjà présentes si changé après coup. Comportement UX trompeur, pas de perte de donnée.

---

## ⚠️ À trancher avec l'utilisateur (pas un bug de persistance au sens strict)

**`qualirepar.html`** — confirmé : simulation UI **100% locale** (`localStorage` via `getDB`/`addToDB`/`updateInDB`), zéro appel API, zéro route, zéro table backend. Si ce n'est pas un choix assumé et documenté, c'est un risque réel : les dossiers QualiRépar (dispositif de subvention réglementaire, remboursements réels déjà perçus par l'utilisateur d'après la mémoire projet) semblent enregistrés dans l'app mais sont **perdus au changement d'appareil ou au vidage du cache navigateur**, contrairement à toutes les autres pages du SaaS.

---

## Pages sans problème trouvé
`clients.html` (13 champs), `sav.html` (6 champs) — chaîne complète saine, aucune correction nécessaire.

---

## Ordre de priorité recommandé

1. **`factures.html`** — endpoint `POST /api/factures` manquant (fonctionnalité entière hors service)
2. **`personnel.html`** — `app.js` non chargé + pattern r.success/r.data (page entière hors service, fix probablement rapide : 1 balise `<script>` + pattern déjà connu)
3. **`t-imei` (tickets.html)** — déjà scopé plus tôt dans la session (migration + validation Luhn en attente)
4. **`t-priority` en création (tickets.html)** — fix probablement très rapide (1-2 lignes, route + interface)
5. **`reconditionnement.js` / `fournisseurs.js` / `caisse.js`** — pattern r.success/r.data (3 fichiers, mécanique déjà connue et déjà appliquée ailleurs, fix répétitif mais rapide par fichier)
6. **`stock-qty` en édition** — risque d'erreurs d'inventaire réel
7. **`caisse.js` `remise_pct`** — perte de traçabilité NF525-adjacente
8. **`agenda.html`** — impossibilité de vider 5 champs en édition
9. **`qualirepar.html`** — décision produit à prendre (accepter la simulation locale ou construire un vrai backend)
10. Reste (niveau 4, mineurs) — best-effort
