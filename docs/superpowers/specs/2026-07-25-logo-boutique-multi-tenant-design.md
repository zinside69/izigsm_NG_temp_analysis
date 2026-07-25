# Logo boutique multi-tenant + impression devis — Design

_Version 1.0 — 2026-07-25_

## Contexte

Chantier identifié le 2026-07-25 pendant la refonte de la fiche A4 ticket (`docs/superpowers/specs/2026-07-25-refonte-fiche-a4-design.md`), tracé dans `project-docs/todo.md` § "Logo boutique multi-tenant". La colonne `boutiques.logo_url` existe déjà en base (migration `0002_boutiques.sql`) mais est totalement morte : aucune UI dans `settings.html` pour la renseigner, non exposée par aucune route avant aujourd'hui, non rendue côté `devis.js`. Le template A4 ticket (chantier du matin) lit déjà `d.boutique.logoUrl` et sait afficher un `<img class="print-logo-img">` si présent, sinon le nom de la boutique en texte — prêt à consommer ce chantier sans modification.

Correction apportée par l'utilisateur en cours de session : l'impression doit aussi être possible pour un devis, « au même titre que les factures ». Vérifié : `devis.js` n'a aujourd'hui **aucune** fonction d'impression admin (contrairement aux tickets et factures) — ce chantier construit donc `_buildDevisHTML()` en plus de brancher le logo.

## Décisions actées pendant le brainstorming

| Sujet | Décision | Justification |
|---|---|---|
| Mode de service du logo | URL publique stable, sans authentification (`GET /api/public/logo/:boutiqueId`) | Un logo doit s'afficher de façon fiable dans un `<img src>` sur des documents imprimés, sans notion d'expiration — contrairement aux photos de tickets (données privées, tokens signés 5 min) |
| Stockage | Réutilise le bucket R2 `PHOTOS` existant (binding déjà configuré), préfixe de clé `logos/` | Aucun nouveau binding wrangler, aucune nouvelle config Cloudflare |
| Formats acceptés | jpeg/png/webp, 2 Mo max | Plus strict que les photos (5 Mo, +gif) — un logo n'a jamais besoin d'être lourd ni animé ; pas de SVG (risque XSS, un SVG peut contenir du JS) |
| Traitement à l'upload | Aucun redimensionnement/compression serveur | Cohérent avec le pattern photos existant, évite une dépendance de traitement d'image sur Cloudflare Workers ; `.print-logo-img` (CSS, chantier du matin) plafonne déjà l'affichage à 36px/60mm |
| Cache-busting | `logo_url` stocké avec un paramètre `?v={timestamp}`, régénéré à chaque upload | Permet un cache navigateur/CDN long (`immutable`) sans risque de logo périmé affiché après changement — même logique que le chantier cache-busting du 2026-07-24 |
| Périmètre devis | Construire `_buildDevisHTML()` à partir de la structure `_buildFactureHTML()` (même système visuel sans aplat), pas de branchement sur `devis-public.html` (périmètre différent — page publique de suivi, pas impression admin) | `devis-public.html` sélectionne déjà `boutique_logo` en SQL pour un usage distinct, hors périmètre ici |
| Emplacement bouton impression devis | Footer de la fiche détail devis (`openDevisDetail()`), même convention que factures (`🖨`, `btn btn-ghost btn-sm`, title "Imprimer / PDF") | Cohérence UI, aucun nouvel emplacement à justifier |

## Architecture

### Backend

1. **`POST /api/boutiques/:id/logo`** (`src/routes/boutiques.ts`, authentifié — admin ou manager de sa propre boutique, même garde que les autres routes settings existantes)
   - Multipart, champ `logo` (File)
   - Valide `MIME` (jpeg/png/webp) et taille (≤ 2 Mo) — nouvelles constantes dans `photosService.ts` ou un petit module dédié, à trancher en écrivant le plan (réutiliser `MIME_AUTORISES`/`TAILLE_MAX` n'est pas approprié, ce sont des valeurs différentes)
   - Upload R2 (binding `PHOTOS`) à la clé `logos/{boutiqueId}.{ext}` — écrase l'ancien fichier si présent (même boutique = même clé, pas d'accumulation)
   - `UPDATE boutiques SET logo_url = '/api/public/logo/' || id || '?v=' || <timestamp>`
   - Retourne `{ success, data: { logo_url } }`

2. **`DELETE /api/boutiques/:id/logo`** (même garde d'accès)
   - Supprime l'objet R2 (clé connue : `logos/{boutiqueId}.*` — nécessite de retrouver l'extension stockée, ou de normaliser le stockage sur une extension fixe après validation MIME pour simplifier la suppression)
   - `UPDATE boutiques SET logo_url = NULL`

3. **`GET /api/public/logo/:boutiqueId`** (`src/routes/public.ts`, monté sans authentification — pattern déjà établi, voir `GET /api/public/boutique/:slug` dans le même fichier)
   - Stream le binaire R2 (`Content-Type` depuis les métadonnées R2, pas depuis une table de mapping)
   - `Cache-Control: public, max-age=31536000, immutable` — sûr car l'URL change à chaque upload grâce au `?v=`
   - 404 si boutique/logo introuvable

4. **`_fetchDevisPrintData(id)` + `_buildDevisHTML(d, printCssHref)`** (`public/static/js/devis.js`, nouveau)
   - Consomme `GET /api/devis/:id` (route authentifiée déjà existante, utilisée par `openDevisDetail()`)
   - Structure visuelle reprise de `_buildFactureHTML()` : même en-tête logo-ready, mêmes classes `.print-header`/`.print-table`/`.print-totaux-table`
   - Champs propres au devis : date de validité (`date_validite`), conditions (`conditions`) — au lieu de la section "Règlements enregistrés" de la facture (un devis n'est pas payé)
   - Utilise `_resolveStaticHref('static/css/print.css')` et le garde-fou `.print-compact` de `_triggerPrint()` (chantier du jour, déjà partagé/centralisé dans `app.js`) — aucune modification nécessaire côté `app.js` pour ce chantier

5. **`printDevis(id)`** (`devis.js`, miroir de `printFacture(id)`) — appelle `_fetchDevisPrintData` → `_buildDevisHTML` → `_triggerPrint`

### Frontend — `settings.html` onglet Boutique

- Nouveau bloc "Logo" : aperçu de l'image actuelle (`<img>` si `logo_url` présent, placeholder texte sinon) + `<input type="file" accept="image/jpeg,image/png,image/webp">` déclenchant l'upload + bouton "Retirer le logo" (visible seulement si un logo existe)
- Validation cliente (taille/format) avant envoi, message d'erreur clair si rejeté par le serveur (422)
- Bouton d'impression devis : ajouté dans `footerBtns` de `openDevisDetail()` (`devis.js`), toujours visible quel que soit le statut du devis (contrairement aux autres boutons qui dépendent du statut)

### Fichiers touchés

- `src/routes/boutiques.ts` — 2 nouvelles routes (upload/delete logo)
- `src/routes/public.ts` — 1 nouvelle route (serve logo)
- `src/services/boutiqueService.ts` ou nouveau petit module — validation format/taille logo (à trancher : réutiliser le style de `photosService.ts` ou fonctions dédiées)
- `public/settings.html` — bloc UI Logo, onglet Boutique
- `public/static/js/settings.js` (ou fichier équivalent gérant l'onglet Boutique — à confirmer en explorant le code au moment du plan) — logique upload/suppression/aperçu
- `public/static/js/devis.js` — `_fetchDevisPrintData()`, `_buildDevisHTML()`, `printDevis()`, bouton footer
- `public/static/js/factures.js` — en-tête logo-ready (même traitement que `tickets.js` ce matin : retrait du mark "i"/"iziGSM" en dur, remplacé par `<img>` conditionnel ou nom texte)
- `public/static/css/print.css` — probablement aucune modification (les classes `.print-logo-img` etc. existent déjà, génériques)

## Hors périmètre (décidé explicitement)

- Branchement sur `devis-public.html` (page publique de suivi client) — chantier distinct si souhaité plus tard
- Redimensionnement/compression serveur du logo
- Formats SVG et GIF
- Toute modification du garde-fou "1 page A4" (`_triggerPrint()`) — déjà livré et partagé, ce chantier en hérite sans y toucher

## Tests

- `npx vitest run` — nouveaux tests pour les 2 routes boutiques (upload valide/invalide format/invalide taille/suppression) et la route publique (200 avec vrai logo, 404 sans)
- `npx tsc --noEmit` — aucune nouvelle erreur attendue
- Validation visuelle réelle en navigateur obligatoire (pattern déjà établi sur ce projet) : upload d'un logo réel, impression ticket A4 + facture + devis avec logo affiché, puis sans logo (fallback texte), avec un nom de boutique long (risque déjà noté en revue finale du chantier A4 du matin)

## Déploiement

Comme toujours : jamais automatique, confirmation explicite utilisateur requise (`npm run deploy`). Bump `CACHE_VERSION` requis (fichiers `devis.js`/`factures.js`/`settings.html` modifiés).
