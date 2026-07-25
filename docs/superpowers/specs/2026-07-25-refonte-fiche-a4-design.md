# Refonte visuelle fiche A4 iziGSM — Design

_Version 1.0 — 2026-07-25_

## Contexte

`todo.md` § Chantier impression ticket A4/thermique liste plusieurs items pour le format A4. `todo.md:7` (audit contenu vs liste attendue) a été traité au checkpoint 54 par la loop-engineering : tous les champs "prise en charge client" attendus (description, client, réparateur, état du matériel, acompte) sont déjà présents dans `_buildTicketA4HTML()` (`public/static/js/tickets.js:673-837`) — le vrai gap restant est visuel (`todo.md:10`) et un manque de mention légale, pas un manque de contenu.

`todo.md:10` a été escaladé deux fois par la loop-engineering (checkpoint 55, run du 2026-07-25) comme décision de branding à trancher par un humain — ce document tranche cette décision.

Deux documents de référence ont été utilisés (présents sur disque dans `docs/`, invisibles à `git status` car exclus par la règle générique `*.pdf` du `.gitignore`) :
- `docs/bon de réparation.pdf` — maquette cible initiale (bandeau bleu marine, encart acompte ambre)
- `docs/Prises en charge — iziGSM.pdf` — export réel de la fiche actuelle (indigo `#6366f1`)
- `docs/modele-facture.pdf` — facture SOTELI réelle, référence retenue pour le système visuel final : aucun aplat de couleur de marque, uniquement filets fins, gris clair et typographie pour la hiérarchie

## Décision de branding

Ni l'indigo actuel ni le bleu marine/ambre de la maquette initiale ne sont retenus. Contrainte explicite de l'utilisateur : pas de noir, pas d'indigo, pas de bleu, aucun bandeau plein — objectif économie d'encre à l'impression. Référence retenue : `modele-facture.pdf` (déjà en production, déjà imprimé par de vrais clients SOTELI).

## Scope

### Dans le périmètre

1. **Système visuel** (`public/static/css/print.css`)
   - Suppression des aplats de couleur sur la fiche A4 : bandeau d'en-tête (`.print-header`, bordure 2px indigo → filet fin gris), entête du tableau `.print-table thead` (fond indigo/texte blanc → texte gras + filet inférieur), règle `.print-totaux-table .total-ttc td` (fond indigo → fond gris clair, partagée avec devis/factures mais non exercée par la fiche A4 elle-même)
   - Nouvel accent unique : gris ardoise `#334155`, utilisé uniquement en texte/bordure, jamais en fond plein (remplace `#6366f1`/`#1e1b4b` dans `.print-logo-name`, `.print-doc-type`, `.print-party-name`)
   - `.print-logo-mark` : carré indigo plein → cadre avec bordure fine `#334155`, fond blanc
   - Boîtes `.print-party-box` (Client/Appareil) : gris très clair `#f9f9f9` déjà en place, inchangé
   - Encart `.print-acompte-box` (Acompte versé) : **inchangé** (crème/ambre `#fffbf0`/`#ffe0a1`) — hors périmètre de la contrainte noir/indigo/bleu, signal financier fonctionnel déjà cohérent avec le reste de l'application (fiche détail écran, `renderEtatSecuriteDetail`)

2. **En-tête prêt pour logo multi-tenant** (`_buildTicketA4HTML()`, `_fetchTicketPrintData()`)
   - `_fetchTicketPrintData()` : ajout de `logoUrl: b.logo_url || null` au mapping de l'objet `boutique` (colonne `boutiques.logo_url` déjà en base depuis la migration `0002_boutiques.sql`, mais jamais exposée côté route `GET /api/boutiques/:id` à ce jour — un ajout minimal de ce champ au SELECT de la route sera nécessaire, sans autre effet)
   - En-tête : si `d.boutique.logoUrl` présent → `<img>` (hauteur max ~36px, alignement identique à l'actuel `.print-logo-mark`) ; sinon → nom de la boutique seul en texte gras gris ardoise, **sans** mark "i" ni branding "iziGSM" par défaut (toutes les boutiques actuelles sont dans ce cas, colonne vide partout)
   - Le mécanisme de renseignement du logo (upload, stockage R2, UI settings) est **hors périmètre** de cette spec — voir "Chantier séparé" ci-dessous. Tant qu'aucune boutique n'a de logo, ce point n'a aucun effet visible.

3. **Contenu ajouté**
   - Ligne CGV générique en pied de page (`.print-footer-legal`) : *« En signant, le client accepte les conditions générales de service de l'atelier. »* — texte non engageant, à remplacer par le texte définitif quand le chantier légal dédié (`todo.md` § Facturation, texte à récupérer sur www.telnet-beynost.fr) sera traité. Ne pas inventer de texte CGV définitif ici.
   - Fallback "Non renseigné" sur le bloc "État à l'entrée" (`etatHTML`) quand `d.etatAppareil` est vide — aujourd'hui le bloc entier est absent si vide, incohérent avec "Panne déclarée" qui affiche déjà ce fallback (`_buildTicketA4HTML()` ligne ~704-708 vs ~769-772)

### Hors périmètre (décidé explicitement pendant le brainstorming)

- Codes de sécurité (déverrouillage/PIN, code SIM) : **jamais imprimés** sur le A4, restent consultables uniquement en fiche détail écran (`renderEtatSecuriteDetail`) — un document papier archivé exposant un code de déverrouillage est jugé plus risqué qu'un accès applicatif authentifié
- Titre et référence du document : **inchangés** (« FICHE DE PRISE EN CHARGE » + numéro de ticket `TKT-2026-XXXXX`) — le numéro de ticket sert déjà de référence unique traçable dans tout le système (recherche, deep-link, suivi client), une seconde référence type `REP-XXXXXXXX-XXXX` dupliquerait sans bénéfice
- Reformulation des libellés (« Montant estimé » → « Estimation indicative (sous réserve de diagnostic) », etc.) : reportée, pas dans le périmètre de cette itération
- Mécanisme de renseignement du logo boutique (upload R2, champ settings.html, branchement devis/factures) : chantier séparé, voir ci-dessous

## Chantier séparé (à ajouter au backlog, pas traité ici)

**Logo boutique multi-tenant** — upload de fichier vers R2 (même pattern que les photos de tickets), nouveau champ dans l'onglet Boutique de `settings.html`, branchement sur les 3 documents imprimables (fiche A4 ticket — en-tête déjà prêt côté template par cette spec —, devis, factures). Backend partiellement en place côté devis (`devisService.ts` sélectionne déjà `logo_url AS boutique_logo` mais ne l'expose/rend nulle part) ; rien côté factures ni côté route `GET /api/boutiques/:id`. Nécessite son propre `superpowers:brainstorming` (décisions : validation format/taille d'image, cadrage/redimensionnement, endpoint d'upload dédié ou réutilisation du pattern photos).

## Fichiers touchés

- `public/static/css/print.css` — suppression des aplats de couleur, nouvel accent gris ardoise
- `public/static/js/tickets.js` — `_fetchTicketPrintData()` (ajout `logoUrl`), `_buildTicketA4HTML()` (en-tête conditionnel logo/texte, fallback état à l'entrée, ligne CGV footer)
- `src/routes/boutiques.ts` — ajout de `logo_url` au SELECT de `GET /api/boutiques/:id` (nécessaire pour que `logoUrl` ne soit jamais `null` par construction même une fois une boutique équipée d'un logo — sans ce champ, le point 2 ci-dessus resterait mort malgré le chantier séparé)

Aucune migration de schéma (colonne déjà existante). Aucun changement de route pour les autres items (CSS, fallback état, ligne CGV sont purement frontend/template).

## Tests

- `npx vitest run` — aucun test JS ne couvre le HTML généré par `_buildTicketA4HTML()`, delta attendu nul (826/826 ou baseline courante inchangée)
- `npx tsc --noEmit` — `boutiques.ts` est TypeScript, vérifier delta nul après l'ajout du champ SELECT
- Validation visuelle réelle obligatoire avant tout commit (pas de gate automatisée sur du rendu visuel) : `wrangler pages dev` + impression/aperçu navigateur (Ctrl+P → aperçu) d'au moins 3 cas — ticket sans acompte/sans état renseigné (vérifier le nouveau fallback), ticket avec acompte, ticket avec état à l'entrée rempli. Comparaison visuelle avec `modele-facture.pdf` pour valider l'absence d'aplat de couleur.

## Déploiement

Comme toujours sur ce projet : jamais automatique, confirmation explicite utilisateur requise (`npm run deploy`). Bump `CACHE_VERSION` (`public/sw.js`) requis (fichiers `public/static/js/tickets.js` et `public/static/css/print.css` modifiés).
