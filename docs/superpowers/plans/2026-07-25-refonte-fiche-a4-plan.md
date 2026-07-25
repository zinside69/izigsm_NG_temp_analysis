# Refonte visuelle fiche A4 iziGSM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retirer tous les aplats de couleur noir/indigo/bleu de la fiche A4 imprimée (`_buildTicketA4HTML()`), les remplacer par un système à filets fins + accent gris ardoise unique inspiré de `docs/modele-facture.pdf`, préparer l'en-tête à afficher un logo boutique multi-tenant, et ajouter 2 contenus manquants (fallback "Non renseigné" sur l'état à l'entrée, mention CGV générique en pied de page).

**Architecture:** Changements purement frontend (CSS + template JS vanilla), un seul champ de mapping ajouté côté frontend (`logoUrl`, déjà retourné par l'API sans changement backend — `getBoutiqueById`/`listAllBoutiques`/`listBoutiqueForUser` font toutes `SELECT *`), aucune migration, aucune nouvelle route.

**Tech Stack:** Hono/TypeScript (type uniquement, aucune logique), HTML/CSS/JS vanilla (`public/static/js/tickets.js`, `public/static/css/print.css`), Cloudflare Pages/D1.

## Global Constraints

- Aucun code de sécurité (déverrouillage/PIN, code SIM) ne doit apparaître dans `_buildTicketA4HTML()` — spec § Hors périmètre
- Titre du document (« FICHE DE PRISE EN CHARGE ») et référence (numéro de ticket) inchangés
- `.print-badge-*` (badges de statut fonctionnels, utilisés par devis/factures) restent inchangés — ce ne sont pas des éléments de branding
- `CACHE_VERSION` (`public/sw.js`) doit être incrémentée car `public/static/js/tickets.js` et `public/static/css/print.css` sont modifiés (règle CLAUDE.md du projet)
- Aucun déploiement automatique — `npm run deploy` reste un geste humain explicite hors de ce plan

---

### Task 1 : Complétude du type `Boutique` (`logo_url`)

**Contexte découvert pendant la planification (corrige la spec)** : la spec supposait qu'il fallait exposer `logo_url` sur la route `GET /api/boutiques/:id`. Vérification du code réel : `getBoutiqueById()`, `listAllBoutiques()` et `listBoutiqueForUser()` (`src/services/boutiqueService.ts`) font toutes `SELECT * FROM boutiques ...` — `logo_url` (colonne existante depuis `migrations/0002_boutiques.sql`) est donc **déjà** présente dans la réponse JSON de ces 3 routes, sans aucun changement de route nécessaire. Seule l'interface TypeScript `Boutique` (lignes 43-57) ne déclare pas ce champ — sans impact runtime (le frontend qui consomme ces routes est en JS vanilla, pas TS), mais un futur code `.ts` lisant `boutique.logo_url` échouerait à la compilation sans cette correction.

**Files:**
- Modify: `src/services/boutiqueService.ts:43-57`

**Interfaces:**
- Produces: `Boutique.logo_url: string | null` — consommé en lecture par tout futur code TypeScript qui a besoin du logo (aucun consommateur TS dans ce plan, le frontend `tickets.js` lit le JSON brut sans passer par ce type)

- [ ] **Step 1: Lire l'interface actuelle pour confirmer les lignes exactes**

Le bloc actuel (`src/services/boutiqueService.ts:43-57`) :
```typescript
export interface Boutique {
  id:           number
  nom:          string
  slug:         string | null
  siret:        string | null
  tva_numero:   string | null
  adresse:      string | null
  code_postal:  string | null
  ville:        string | null
  telephone:    string | null
  email:        string | null
  site_web:     string | null
  description:  string | null
  actif:        number
}
```

- [ ] **Step 2: Ajouter le champ `logo_url`**

Remplacer le bloc ci-dessus par :
```typescript
export interface Boutique {
  id:           number
  nom:          string
  slug:         string | null
  siret:        string | null
  tva_numero:   string | null
  adresse:      string | null
  code_postal:  string | null
  ville:        string | null
  telephone:    string | null
  email:        string | null
  site_web:     string | null
  description:  string | null
  logo_url:     string | null
  actif:        number
}
```

- [ ] **Step 3: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune nouvelle erreur (baseline actuelle inchangée — ce champ est additif, aucun code existant ne référence `Boutique` de façon exhaustive/stricte)

- [ ] **Step 4: Commit**

```bash
git add src/services/boutiqueService.ts
git commit -m "fix(boutiques): expose logo_url sur le type Boutique (deja renvoye par SELECT *)"
```

---

### Task 2 : Système visuel — suppression des aplats de couleur (`print.css`)

**Files:**
- Modify: `public/static/css/print.css`

**Interfaces:**
- Consumes: aucune dépendance sur les tasks précédentes
- Produces: classe CSS `.print-logo-img` (nouvelle) — consommée par Task 4

- [ ] **Step 1: `.print-header` — bordure indigo → filet gris ardoise**

Remplacer (lignes 63-70) :
```css
.print-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8mm;
  padding-bottom: 5mm;
  border-bottom: 2px solid #6366f1;
}
```
Par :
```css
.print-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8mm;
  padding-bottom: 5mm;
  border-bottom: 1.5px solid #334155;
}
```

- [ ] **Step 2: `.print-logo-mark` — carré indigo plein → cadre gris ardoise sur fond blanc**

Remplacer (lignes 78-89) :
```css
.print-logo-mark {
  width: 36px;
  height: 36px;
  background: #6366f1;
  color: #fff;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18pt;
  font-weight: 900;
}
```
Par :
```css
.print-logo-mark {
  width: 36px;
  height: 36px;
  background: #fff;
  color: #334155;
  border: 1.5px solid #334155;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18pt;
  font-weight: 900;
}
```

Note : cette classe reste utilisée telle quelle par `public/static/js/factures.js:1074` (hors périmètre de ce plan) — recolorée par cohérence (suppression globale de l'indigo décorative), aucun changement fonctionnel, aucun fichier `factures.js` à toucher.

- [ ] **Step 3: `.print-logo-name` — couleur texte**

Remplacer (lignes 91-95) :
```css
.print-logo-name {
  font-size: 18pt;
  font-weight: 800;
  color: #1e1b4b;
}
```
Par :
```css
.print-logo-name {
  font-size: 18pt;
  font-weight: 800;
  color: #334155;
}
```

- [ ] **Step 4: Ajouter la nouvelle règle `.print-logo-img`**

Juste après le bloc `.print-logo-name` (donc avant le commentaire `/* ─── Titre document ─── */` ligne 109), ajouter :
```css
.print-logo-img {
  max-height: 36px;
  max-width: 60mm;
  object-fit: contain;
}
```

- [ ] **Step 5: `.print-doc-type` — couleur texte**

Remplacer (lignes 117-123) :
```css
.print-doc-type {
  font-size: 20pt;
  font-weight: 800;
  color: #6366f1;
  text-transform: uppercase;
  letter-spacing: 1px;
}
```
Par :
```css
.print-doc-type {
  font-size: 20pt;
  font-weight: 800;
  color: #334155;
  text-transform: uppercase;
  letter-spacing: 1px;
}
```

- [ ] **Step 6: `.print-party-name` — couleur texte**

Remplacer (lignes 166-170) :
```css
.print-party-name {
  font-size: 11pt;
  font-weight: 700;
  color: #1e1b4b;
}
```
Par :
```css
.print-party-name {
  font-size: 11pt;
  font-weight: 700;
  color: #334155;
}
```

- [ ] **Step 7: `.print-table thead tr` — fond indigo plein → texte gras + filet inférieur**

Remplacer (lignes 187-190) :
```css
.print-table thead tr {
  background: #6366f1;
  color: #fff;
}
```
Par :
```css
.print-table thead tr {
  background: #fff;
  color: #334155;
  border-bottom: 1.5px solid #334155;
}
```

- [ ] **Step 8: `.print-totaux-table .total-ttc td` — fond indigo plein → fond gris clair**

Remplacer (lignes 255-261) :
```css
.print-totaux-table .total-ttc td {
  background: #6366f1;
  color: #fff;
  font-size: 11pt;
  font-weight: 800;
  border-radius: 4px;
}
```
Par :
```css
.print-totaux-table .total-ttc td {
  background: #f1f5f9;
  color: #334155;
  font-size: 11pt;
  font-weight: 800;
  border-radius: 4px;
}
```

- [ ] **Step 9: Vérifier que le build ne casse pas**

Run: `npm run build`
Expected: build réussi (`vite build`), aucune erreur — c'est un fichier CSS statique, aucune logique à casser, cette étape vérifie juste l'absence d'erreur de syntaxe CSS qui bloquerait le hash d'assets (`scripts/build-hash-assets.mjs`)

- [ ] **Step 10: Commit**

```bash
git add public/static/css/print.css
git commit -m "style(print): retire les aplats indigo/noir/bleu, accent gris ardoise unique"
```

---

### Task 3 : `_fetchTicketPrintData()` — exposer `logoUrl`

**Files:**
- Modify: `public/static/js/tickets.js:559-573`

**Interfaces:**
- Consumes: `b.logo_url` (déjà présent dans la réponse JSON de `GET /api/boutiques/:id` et `GET /api/boutiques`, voir Task 1)
- Produces: `d.boutique.logoUrl: string | null` — consommé par Task 4 (`_buildTicketA4HTML()`)

- [ ] **Step 1: Modifier le mapping boutique**

Remplacer (lignes 559-573) :
```javascript
  let boutique = { nom: 'iziGSM', adresse: '', telephone: '', email: '' };
  try {
    const bs = t.boutique_id
      ? await apiGet(`/api/boutiques/${t.boutique_id}`)
      : await apiGet('/api/boutiques');
    const b  = t.boutique_id
      ? (bs.data?.data || bs.data || {})
      : (bs.data?.data || bs.data || [])[0] || {};
    boutique = {
      nom:       b.nom       || b.name || 'iziGSM',
      adresse:   b.adresse   || '',
      telephone: b.telephone || '',
      email:     b.email     || '',
    };
  } catch {}
```
Par :
```javascript
  let boutique = { nom: 'iziGSM', adresse: '', telephone: '', email: '', logoUrl: null };
  try {
    const bs = t.boutique_id
      ? await apiGet(`/api/boutiques/${t.boutique_id}`)
      : await apiGet('/api/boutiques');
    const b  = t.boutique_id
      ? (bs.data?.data || bs.data || {})
      : (bs.data?.data || bs.data || [])[0] || {};
    boutique = {
      nom:       b.nom       || b.name || 'iziGSM',
      adresse:   b.adresse   || '',
      telephone: b.telephone || '',
      email:     b.email     || '',
      logoUrl:   b.logo_url  || null,
    };
  } catch {}
```

- [ ] **Step 2: Vérifier qu'aucun test ne régresse**

Run: `npx vitest run`
Expected: même résultat qu'avant modification (826/826 ou baseline courante — ce fichier n'a aucun test dédié, cette étape vérifie l'absence de régression ailleurs)

- [ ] **Step 3: Commit**

```bash
git add public/static/js/tickets.js
git commit -m "feat(tickets): expose logoUrl boutique dans _fetchTicketPrintData"
```

---

### Task 4 : `_buildTicketA4HTML()` — en-tête logo, fallback état, mention CGV

**Files:**
- Modify: `public/static/js/tickets.js:673-837` (fonction `_buildTicketA4HTML`)

**Interfaces:**
- Consumes: `d.boutique.logoUrl` (Task 3), `d.boutique.nom`, `d.etatAppareil` (déjà existant), `esc()` (helper existant du fichier)
- Produces: aucun nouveau symbole exporté — modifie uniquement le HTML généré par `_buildTicketA4HTML(d)`

- [ ] **Step 1: En-tête — logo boutique si présent, sinon nom en texte (plus de mark "i"/"iziGSM" par défaut)**

Remplacer (lignes 723-734) :
```javascript
      <div class="print-header print-no-break">
        <div class="print-logo">
          <div class="print-logo-mark">i</div>
          <div class="print-logo-name">iziGSM</div>
        </div>
        <div class="print-boutique-info">
          <strong>${esc(d.boutique.nom)}</strong><br>
          ${d.boutique.adresse   ? esc(d.boutique.adresse)   + '<br>' : ''}
          ${d.boutique.telephone ? esc(d.boutique.telephone) + '<br>' : ''}
          ${d.boutique.email     ? esc(d.boutique.email)             : ''}
        </div>
      </div>
```
Par :
```javascript
      <div class="print-header print-no-break">
        <div class="print-logo">
          ${d.boutique.logoUrl
            ? `<img src="${esc(d.boutique.logoUrl)}" alt="${esc(d.boutique.nom)}" class="print-logo-img">`
            : `<div class="print-logo-name">${esc(d.boutique.nom)}</div>`}
        </div>
        <div class="print-boutique-info">
          ${d.boutique.adresse   ? esc(d.boutique.adresse)   + '<br>' : ''}
          ${d.boutique.telephone ? esc(d.boutique.telephone) + '<br>' : ''}
          ${d.boutique.email     ? esc(d.boutique.email)             : ''}
        </div>
      </div>
```

Note : le nom de la boutique n'apparaît plus qu'une seule fois (zone logo) au lieu de deux (zone logo générique "iziGSM" + `<strong>` dans `print-boutique-info`) — élimine la duplication tout en réglant le problème multi-tenant.

- [ ] **Step 2: État à l'entrée — fallback "Non renseigné" (cohérence avec le bloc "Panne déclarée")**

Remplacer (lignes 701-708) :
```javascript
  let etatParsed = {};
  try { etatParsed = d.etatAppareil ? JSON.parse(d.etatAppareil) : {}; } catch {}
  const etatLines = [...(etatParsed.items || []).map(k => ETAT_LABELS[k] || k), etatParsed.autre].filter(Boolean);
  const etatHTML = etatLines.length ? `
      <div style="margin-bottom:6mm;" class="print-no-break">
        <div class="print-notes-label" style="margin-bottom:2mm;">État constaté au dépôt</div>
        <div class="print-notes">${etatLines.map(esc).join(' · ')}</div>
      </div>` : '';
```
Par :
```javascript
  let etatParsed = {};
  try { etatParsed = d.etatAppareil ? JSON.parse(d.etatAppareil) : {}; } catch {}
  const etatLines = [...(etatParsed.items || []).map(k => ETAT_LABELS[k] || k), etatParsed.autre].filter(Boolean);
  const etatHTML = `
      <div style="margin-bottom:6mm;" class="print-no-break">
        <div class="print-notes-label" style="margin-bottom:2mm;">État constaté au dépôt</div>
        <div class="print-notes">${etatLines.length ? etatLines.map(esc).join(' · ') : '<em style="color:#aaa;">Non renseigné</em>'}</div>
      </div>`;
```

- [ ] **Step 3: Pied de page — ajouter la mention CGV générique**

Remplacer (lignes 831-835) :
```javascript
      <div class="print-footer">
        <div>${esc(d.boutique.nom)}</div>
        <div class="print-footer-legal">Fiche générée par iziGSM le ${new Date().toLocaleDateString('fr-FR')}</div>
        <div>${esc(d.numero)}</div>
      </div>
```
Par :
```javascript
      <div class="print-footer">
        <div>${esc(d.boutique.nom)}</div>
        <div class="print-footer-legal">
          En signant, le client accepte les conditions générales de service de l'atelier.<br>
          Fiche générée par iziGSM le ${new Date().toLocaleDateString('fr-FR')}
        </div>
        <div>${esc(d.numero)}</div>
      </div>
```

- [ ] **Step 4: Vérifier qu'aucun test ne régresse**

Run: `npx vitest run`
Expected: même résultat qu'avant modification (aucun test ne couvre `_buildTicketA4HTML`, cette étape vérifie l'absence de régression ailleurs)

- [ ] **Step 5: Commit**

```bash
git add public/static/js/tickets.js
git commit -m "feat(tickets): en-tete logo-ready multi-tenant, fallback etat a l'entree, mention CGV A4"
```

---

### Task 5 : Bump `CACHE_VERSION`, validation visuelle réelle, vérification finale

**Files:**
- Modify: `public/sw.js:13`

**Interfaces:**
- Consumes: aucune (dernière tâche du plan)

- [ ] **Step 1: Bump `CACHE_VERSION`**

Remplacer (`public/sw.js:13`) :
```javascript
const CACHE_VERSION  = 'izigsm-v2.70'
```
Par :
```javascript
const CACHE_VERSION  = 'izigsm-v2.71'
```

- [ ] **Step 2: Build complet**

Run: `npm run build`
Expected: succès, `dist/static/manifest.json` régénéré avec de nouveaux hash pour `print.css`/`tickets.js` (chantier cache-busting checkpoint 53 — automatique, aucune action manuelle)

- [ ] **Step 3: Vérification finale des gates**

Run: `npx vitest run`
Expected: identique à la baseline avant ce plan (aucune régression introduite par ces changements purement visuels)

Run: `npx tsc --noEmit`
Expected: identique à la baseline avant ce plan (Task 1 est additif, ne doit générer aucune nouvelle erreur)

- [ ] **Step 4: Validation visuelle réelle en local (obligatoire — aucun gate automatisé sur le rendu visuel)**

```bash
npx wrangler d1 migrations apply DB --local
npx wrangler pages dev dist --local --port 3000
```

Se connecter (`admin@izigsm.fr` / `Admin@2026!`), ouvrir la fiche détail d'un ticket existant, imprimer (Ctrl+P → aperçu, ne pas imprimer réellement) et vérifier les 3 scénarios suivants :

1. **Ticket sans acompte, sans état à l'entrée renseigné** — vérifier que le bloc "État constaté au dépôt" affiche désormais "Non renseigné" en italique gris (au lieu d'être totalement absent) ; vérifier l'absence de tout aplat indigo/noir/bleu sur toute la page ; vérifier que la zone logo affiche le nom de la boutique en texte gris ardoise (aucune boutique actuelle n'a de `logo_url`) ; vérifier la présence de la ligne CGV en pied de page
2. **Ticket avec un acompte versé** — vérifier que l'encart "Acompte versé" reste bien en ambre/crème (volontairement inchangé) et que le reste de la page (en-tête, tableau intervention) est bien neutralisé
3. **Ticket avec un état à l'entrée rempli** (checklist cochée dans l'onglet État & Sécurité) — vérifier que les items s'affichent normalement (comportement inchangé pour le cas non-vide)

Comparer visuellement le rendu global avec `docs/modele-facture.pdf` (ouvert en parallèle) — confirmer l'absence de tout aplat de couleur de marque, cohérent avec la référence.

- [ ] **Step 5: Commit**

```bash
git add public/sw.js
git commit -m "chore(sw): bump CACHE_VERSION v2.70 -> v2.71 (refonte visuelle fiche A4)"
```

- [ ] **Step 6: Cocher la tâche dans le backlog et documenter la décision**

Dans `project-docs/todo.md`, cocher la case `todo.md:10` ("Revoir la mise en page sur le modèle...") avec une note de renvoi vers ce plan et la spec.

Dans `project-docs/decisions.md`, ajouter une entrée datée 2026-07-25 documentant la décision de branding (accent gris ardoise unique, pas d'indigo/noir/bleu, inspiration `modele-facture.pdf`) — objectif explicite : empêcher un futur run de la loop-engineering de ré-escalader `todo.md:10` comme c'est arrivé au checkpoint 55.

```bash
git add project-docs/todo.md project-docs/decisions.md
git commit -m "docs: cloture todo.md:10, decision de branding fiche A4 actee"
```

---

## Note de portée — hors de ce plan

Le mécanisme permettant à une boutique de réellement renseigner `logo_url` (upload fichier vers R2, UI dans `settings.html`, branchement `devis.js`/`factures.js`) est un chantier séparé, déjà consigné dans `project-docs/todo.md` § "Logo boutique multi-tenant". Tant qu'il n'est pas livré, `d.boutique.logoUrl` vaut toujours `null` en production et l'en-tête affiche systématiquement le nom de la boutique en texte (chemin déjà testé au Step 4 du Task 5, scénario 1).
