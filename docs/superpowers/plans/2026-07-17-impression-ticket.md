# Impression ticket — 3 formats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter 2 nouveaux formats d'impression ticket (ticket client thermique 72mm, étiquette technicien thermique) en plus de la fiche A4 existante (corrigée pour retirer les notes internes), avec QR code (lien de suivi/interne) et code-barre EAN-13 (ID ticket) sur les 3 formats, plus une recherche interne capable de résoudre un scan.

**Architecture:** Extension pure frontend du pattern existant `printTicket()` → `_buildXxxHTML()` → `_triggerPrint()` (`window.print()` natif, aucun agent d'impression externe) — 2 nouveaux générateurs HTML string réutilisant les classes CSS `.print-ticket*` déjà présentes mais jamais câblées dans `print.css`. QR/EAN-13 générés côté client via 2 libs CDN, rendus en data-URI (`<img>`) directement dans le HTML string, jamais de manipulation DOM post-injection. Un seul changement backend : extension de la recherche `listTickets()` pour reconnaître un token/URL scanné ou un ID EAN-13, réutilisé à la fois par la recherche manuelle et par le nouveau deep-link technicien.

**Tech Stack:** Hono/TypeScript (backend inchangé sauf 1 fonction), HTML/JS vanilla frontend (`public/static/js/tickets.js`), `qrcode-generator` + `JsBarcode` via CDN jsdelivr, Vitest pour le backend.

## Global Constraints

- Aucun agent d'impression externe (QZ Tray ou équivalent) — `window.print()` natif uniquement, comme l'existant.
- `notes_internes` ne doit apparaître sur AUCUN des 3 formats imprimés — c'était une fuite sur la fiche A4 actuelle, à corriger, jamais à reproduire sur les nouveaux formats.
- Échec de génération QR/code-barre (CDN indisponible) → l'impression continue quand même, sans bloquer, avec fallback lien texte déjà en place sur l'A4.
- Le champ de recherche existant (`listTickets`, `opts.search`) doit garder son comportement actuel (LIKE sur numero/marque/modele) en toutes circonstances — les nouveaux critères token/ID s'ajoutent en OR, jamais en remplacement exclusif.
- Commenter le code ajouté — expliquer le POURQUOI des choix non évidents (ex. extraction du chiffre de contrôle EAN-13, raison de la duplication de builders), pas ce que fait déjà le code lisible. Convention explicite de ce projet, rappelée plusieurs fois par l'utilisateur.
- Ne jamais ajouter `Co-Authored-By: Claude` dans les commits.
- Pas de suite de tests automatisés sur `public/static/js/*` dans ce projet — toute tâche frontend se termine par une validation en local live (`wrangler pages dev`), pas par une commande de test.
- Chaque tâche backend se termine par `npx vitest run` vert avant de passer à la suivante.
- Libs CDN épinglées à une version exacte (`@x.y.z`), même convention que Tailwind/Chart.js/axios déjà utilisés dans ce projet (`agenda.html`, `dashboard.html`, `caisse.html`).

---

### Task 1: `_fetchTicketPrintData()` expose l'ID numérique brut

**Files:**
- Modify: `public/static/js/tickets.js:513-557` (`_fetchTicketPrintData()`)

**Interfaces:**
- Consumes: rien de nouveau.
- Produces: l'objet retourné par `_fetchTicketPrintData()` contient désormais `id` (ID numérique brut du ticket, ex. `42`) — consommé par les Tasks 4, 5, 6 (génération du code-barre EAN-13, qui a besoin de l'ID, pas juste du numéro texte `TKT-2026-00042`).

- [ ] **Step 1: Ajouter `id` à l'objet retourné**

Dans `public/static/js/tickets.js`, fonction `_fetchTicketPrintData()`, repérer le `return` final (actuellement il commence par `boutique,` puis `numero:`) et ajouter `id` juste avant `boutique` :

```javascript
  return {
    id:         t.id || id,
    boutique,
    numero:     t.numero    || ('#' + id),
```

(Le reste du `return` — de `statut:` jusqu'à `signatureClient:` — ne change pas.)

- [ ] **Step 2: Valider en local live**

```bash
npm run build
npx wrangler pages dev dist --port 8788 --local
```

Ouvrir `tickets.html`, ouvrir la fiche détail d'un ticket réel, cliquer "🖨 Imprimer" (bouton actuel, encore inchangé à ce stade), vérifier dans la console navigateur (`console.log(data)` temporaire dans `printTicket()`, à retirer après vérification) que `data.id` est bien un nombre correspondant au ticket ouvert. Retirer le `console.log` de debug avant de commit.

- [ ] **Step 3: Commit**

```bash
git add public/static/js/tickets.js
git commit -m "feat(tickets): _fetchTicketPrintData() expose l'ID numérique brut"
```

---

### Task 2: Recherche `listTickets()` reconnaît un token scanné ou un ID EAN-13

**Files:**
- Modify: `src/services/ticketService.ts:248-252` (bloc `if (opts.search)` dans `listTickets()`)
- Test: `tests/ticketService.test.ts`

**Interfaces:**
- Consumes: rien de nouveau.
- Produces: `listTickets(db, boutiqueId, { search })` reconnaît désormais, en plus du texte libre existant (LIKE sur numero/marque/modele, inchangé) : un token de 32 caractères hex ou une URL contenant `/suivi/<token>` (→ `tracking_token = ?`), ou une chaîne de 13 chiffres (scan EAN-13 complet, chiffre de contrôle ignoré) ou un nombre plus court (ID tapé à la main) (→ `id = ?`). Tous ces critères s'ajoutent en OR aux critères existants. Consommé par la Task 8 (deep-link technicien) et par la recherche manuelle de tickets (page `tickets.html`, déjà câblée sur `opts.search`, aucun changement UI nécessaire).

- [ ] **Step 1: Écrire les tests (échouent — comportement pas encore implémenté)**

Dans `tests/ticketService.test.ts`, à l'intérieur du `describe('listTickets()', ...)` existant (après le test `'retourne tableau vide si aucun ticket'`, juste avant l'accolade fermante de ce `describe`), ajouter :

```typescript
  describe('recherche par scan (token / EAN-13)', () => {
    const SQL_COUNT_TOKEN = "SELECT COUNT(*) AS cnt FROM tickets t WHERE t.boutique_id = ? AND t.actif = 1 AND t.archived_at IS NULL AND (t.numero LIKE ? OR t.appareil_marque LIKE ? OR t.appareil_modele LIKE ? OR t.tracking_token = ?)"
    const SQL_LIST_TOKEN  = `SELECT t.id, t.numero, t.statut, t.priorite, t.description_panne, t.appareil_marque, t.appareil_modele, t.prix_estime, t.prix_final, t.date_reception, t.date_promesse, t.technicien_id, c.prenom || ' ' || c.nom AS client_nom, c.telephone AS client_telephone, u.prenom || ' ' || u.nom AS technicien_nom FROM tickets t JOIN clients c ON c.id = t.client_id LEFT JOIN users u ON u.id = t.technicien_id WHERE t.boutique_id = ? AND t.actif = 1 AND t.archived_at IS NULL AND (t.numero LIKE ? OR t.appareil_marque LIKE ? OR t.appareil_modele LIKE ? OR t.tracking_token = ?) ORDER BY t.created_at DESC LIMIT ? OFFSET ?`

    const SQL_COUNT_ID = "SELECT COUNT(*) AS cnt FROM tickets t WHERE t.boutique_id = ? AND t.actif = 1 AND t.archived_at IS NULL AND (t.numero LIKE ? OR t.appareil_marque LIKE ? OR t.appareil_modele LIKE ? OR t.id = ?)"
    const SQL_LIST_ID   = `SELECT t.id, t.numero, t.statut, t.priorite, t.description_panne, t.appareil_marque, t.appareil_modele, t.prix_estime, t.prix_final, t.date_reception, t.date_promesse, t.technicien_id, c.prenom || ' ' || c.nom AS client_nom, c.telephone AS client_telephone, u.prenom || ' ' || u.nom AS technicien_nom FROM tickets t JOIN clients c ON c.id = t.client_id LEFT JOIN users u ON u.id = t.technicien_id WHERE t.boutique_id = ? AND t.actif = 1 AND t.archived_at IS NULL AND (t.numero LIKE ? OR t.appareil_marque LIKE ? OR t.appareil_modele LIKE ? OR t.id = ?) ORDER BY t.created_at DESC LIMIT ? OFFSET ?`

    it('recherche par token complet (32 hex, scan QR direct)', async () => {
      db.__setResponse(SQL_COUNT_TOKEN, { cnt: 1 })
      db.__setListResponse(SQL_LIST_TOKEN, [TICKET_WITH_CLIENT])

      const res = await listTickets(db, 1, { search: 'abc123def456abc123def456abc123de' })

      expect(res.data).toHaveLength(1)
      const calls = db.__getCalls()
      const countCall = calls.find(c => c.sql === SQL_COUNT_TOKEN)
      expect(countCall).toBeDefined()
      expect(countCall!.params).toContain('abc123def456abc123def456abc123de')
    })

    it('recherche par URL de suivi complète (scan QR, extrait le token)', async () => {
      db.__setResponse(SQL_COUNT_TOKEN, { cnt: 1 })
      db.__setListResponse(SQL_LIST_TOKEN, [TICKET_WITH_CLIENT])

      const res = await listTickets(db, 1, { search: 'https://repairdesk.fr/suivi/abc123def456abc123def456abc123de' })

      expect(res.data).toHaveLength(1)
      const calls = db.__getCalls()
      const countCall = calls.find(c => c.sql === SQL_COUNT_TOKEN)
      expect(countCall).toBeDefined()
      // Le token est extrait de l'URL, pas l'URL entière liée en paramètre
      expect(countCall!.params).toContain('abc123def456abc123def456abc123de')
    })

    it('recherche par EAN-13 complet (13 chiffres, retire le chiffre de contrôle)', async () => {
      db.__setResponse(SQL_COUNT_ID, { cnt: 1 })
      db.__setListResponse(SQL_LIST_ID, [TICKET_WITH_CLIENT])

      // ID 42 encodé sur 12 chiffres (000000000042) + chiffre de contrôle fictif 9
      const res = await listTickets(db, 1, { search: '0000000000429' })

      expect(res.data).toHaveLength(1)
      const calls = db.__getCalls()
      const countCall = calls.find(c => c.sql === SQL_COUNT_ID)
      expect(countCall).toBeDefined()
      expect(countCall!.params).toContain(42)
    })

    it('recherche par ID tapé à la main (numérique court, pas un scan EAN-13)', async () => {
      db.__setResponse(SQL_COUNT_ID, { cnt: 1 })
      db.__setListResponse(SQL_LIST_ID, [TICKET_WITH_CLIENT])

      const res = await listTickets(db, 1, { search: '42' })

      expect(res.data).toHaveLength(1)
      const calls = db.__getCalls()
      const countCall = calls.find(c => c.sql === SQL_COUNT_ID)
      expect(countCall).toBeDefined()
      expect(countCall!.params).toContain(42)
    })

    it('recherche texte classique reste inchangée (non-régression)', async () => {
      db.__setResponse(SQL_COUNT, { cnt: 1 })
      db.__setListResponse(SQL_LIST, [TICKET_WITH_CLIENT])

      const res = await listTickets(db, 1, { search: 'iPhone' })

      expect(res.data).toHaveLength(1)
      const calls = db.__getCalls()
      const countCall = calls.find(c => c.sql === SQL_COUNT)
      expect(countCall).toBeDefined()
    })
  })
```

Note : le test `'recherche texte classique reste inchangée'` utilise les constantes `SQL_COUNT`/`SQL_LIST` du `describe` parent (déjà définies, avec un OR à 3 branches seulement `(t.numero LIKE ? OR t.appareil_marque LIKE ? OR t.appareil_modele LIKE ?)` — pas 4) : elles doivent matcher exactement la requête produite quand aucun pattern token/numérique n'est détecté.

- [ ] **Step 2: Lancer les tests, vérifier qu'ils échouent**

Run: `npx vitest run tests/ticketService.test.ts -t "recherche par scan"`
Expected: FAIL — les 5 nouveaux tests échouent (aucune réponse mock enregistrée ne correspond au SQL réellement produit, la logique de détection token/ID n'existe pas encore).

- [ ] **Step 3: Implémenter la détection token/ID dans `listTickets()`**

Dans `src/services/ticketService.ts`, remplacer le bloc :

```typescript
  if (opts.search) {
    conditions.push('(t.numero LIKE ? OR t.appareil_marque LIKE ? OR t.appareil_modele LIKE ?)')
    const s = `%${opts.search}%`
    bindings.push(s, s, s)
  }
```

par :

```typescript
  if (opts.search) {
    // Recherche unifiée : texte libre (numero/marque/modele, comportement existant,
    // TOUJOURS actif) OR token de suivi scanné (QR — 32 hex, ou URL contenant
    // /suivi/<token>) OR ID numérique (EAN-13 scanné — 13 chiffres, le 13e est le
    // chiffre de contrôle à ignorer, pas signifiant pour l'ID — ou ID tapé à la
    // main). Un seul champ de recherche gère les 3 cas. Impression ticket, voir
    // docs/superpowers/specs/2026-07-17-impression-ticket-design.md.
    const orParts: string[] = ['t.numero LIKE ?', 't.appareil_marque LIKE ?', 't.appareil_modele LIKE ?']
    const s = `%${opts.search}%`
    const orBindings: any[] = [s, s, s]

    const tokenInUrl = opts.search.match(/\/suivi\/([0-9a-f]{32})/i)
    const tokenSeul  = opts.search.match(/^[0-9a-f]{32}$/i)
    if (tokenInUrl || tokenSeul) {
      const token = (tokenInUrl ? tokenInUrl[1] : opts.search).toLowerCase()
      orParts.push('t.tracking_token = ?')
      orBindings.push(token)
    } else if (/^\d{13}$/.test(opts.search)) {
      // Scan EAN-13 complet : 12 chiffres d'ID zéro-paddé + 1 chiffre de contrôle
      // (non stocké, non signifiant côté recherche — seul l'ID compte).
      orParts.push('t.id = ?')
      orBindings.push(parseInt(opts.search.slice(0, 12), 10))
    } else if (/^\d+$/.test(opts.search)) {
      // ID tapé à la main (numérique, mais pas 13 chiffres donc pas un scan EAN-13).
      orParts.push('t.id = ?')
      orBindings.push(parseInt(opts.search, 10))
    }

    conditions.push('(' + orParts.join(' OR ') + ')')
    bindings.push(...orBindings)
  }
```

- [ ] **Step 4: Lancer les tests, vérifier qu'ils passent**

Run: `npx vitest run tests/ticketService.test.ts -t "recherche par scan"`
Expected: PASS — 5 tests verts.

- [ ] **Step 5: Lancer la suite complète**

Run: `npx vitest run`
Expected: tous les tests `ticketService.test.ts` verts (dont les 3 tests `listTickets()` existants, non affectés), mêmes 2 échecs pré-existants `agendaService.test.ts`/fuseau horaire sans lien.

- [ ] **Step 6: Commit**

```bash
git add src/services/ticketService.ts tests/ticketService.test.ts
git commit -m "feat(tickets): listTickets() reconnaît un token scanné ou un ID EAN-13 dans la recherche"
```

---

### Task 3: Helpers QR code / code-barre EAN-13 + libs CDN

**Files:**
- Modify: `public/tickets.html` (ajout de 2 balises `<script>` CDN)
- Modify: `public/static/js/tickets.js` (2 nouvelles fonctions helper, juste avant `_buildTicketHTML` — qui sera renommée en Task 4)

**Interfaces:**
- Consumes: globals `qrcode` (lib `qrcode-generator`) et `JsBarcode` (lib `JsBarcode`), chargés via CDN.
- Produces: `_renderQrDataUrl(text)` → `string | null` (data-URI PNG/GIF prêt pour `<img src="...">`, ou `null` si la lib CDN n'a pas chargé) et `_renderEan13DataUrl(ticketId)` → `string | null` (idem) — consommées par les Tasks 4, 5, 6.

- [ ] **Step 1: Ajouter les 2 libs CDN**

Dans `public/tickets.html`, repérer le bloc de scripts en fin de fichier :

```html
  <script src="/static/js/app.js"></script>
  <script src="/static/js/tickets.js"></script>
  <script src="/static/js/pwa.js"></script>
```

Ajouter les 2 libs CDN juste avant, dans le même ordre (dépendances avant le code applicatif). `integrity`/`crossorigin` ajoutés (Subresource Integrity — hash sha384 calculé sur le contenu réel des fichiers CDN épinglés ci-dessous, protège contre une compromission du CDN) — écart volontaire par rapport aux scripts CDN déjà présents ailleurs dans ce projet (Tailwind/FontAwesome/Chart.js/axios, sans SRI), à ne pas répliquer sur ceux-là dans le cadre de ce chantier (hors périmètre) :

```html
  <script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js" integrity="sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k" crossorigin="anonymous"></script>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js" integrity="sha384-Kk5SjBOKprEnGfyBWfD2zROFd1Cu8kwOXxG2GIhYPcoDL2rBJS9P8Ud1ZMy4412a" crossorigin="anonymous"></script>
  <script src="/static/js/app.js"></script>
  <script src="/static/js/tickets.js"></script>
  <script src="/static/js/pwa.js"></script>
```

- [ ] **Step 2: Écrire les 2 fonctions helper**

Dans `public/static/js/tickets.js`, juste avant la ligne `function _buildTicketHTML(d) {` (repérer avec `grep -n "^function _buildTicketHTML" public/static/js/tickets.js`), ajouter :

```javascript
/**
 * Génère un QR code encodant `text`, en data-URI prêt à injecter dans un
 * <img src="...">. Retourne null si la lib CDN qrcode-generator n'a pas
 * chargé (réseau coupé, CDN indisponible) — l'appelant doit gérer ce cas
 * sans jamais bloquer l'impression (fallback lien texte).
 * @param {string} text - Contenu à encoder (URL complète, cliquable/scannable)
 * @param {number} [cellSize=4] - Taille en pixels de chaque module du QR
 * @returns {string|null} Data-URI (image/gif) ou null
 */
function _renderQrDataUrl(text, cellSize) {
  if (typeof qrcode === 'undefined') return null;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createDataURL(cellSize || 4, 2);
  } catch (e) {
    console.error('[QR]', e);
    return null;
  }
}

/**
 * Génère un code-barre EAN-13 encodant l'ID numérique du ticket, en data-URI
 * prêt à injecter dans un <img src="...">. L'ID est zéro-paddé sur 12
 * chiffres, JsBarcode calcule et affiche automatiquement le 13e chiffre de
 * contrôle (pas de calcul manuel nécessaire, comportement natif du format
 * 'EAN13' de cette lib). Retourne null si la lib CDN JsBarcode n'a pas
 * chargé — mêmes règles de fallback que _renderQrDataUrl().
 * @param {number|string} ticketId - ID numérique brut du ticket (pas le numero texte)
 * @returns {string|null} Data-URI (image/png) ou null
 */
function _renderEan13DataUrl(ticketId) {
  if (typeof JsBarcode === 'undefined') return null;
  try {
    const code12 = String(ticketId).padStart(12, '0').slice(-12);
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, code12, {
      format: 'EAN13', width: 2, height: 45, displayValue: true, fontSize: 11, margin: 4,
    });
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.error('[EAN13]', e);
    return null;
  }
}

```

- [ ] **Step 3: Valider en local live**

```bash
npm run build
npx wrangler pages dev dist --port 8788 --local
```

Ouvrir `tickets.html` dans le navigateur, ouvrir la console développeur, vérifier l'absence d'erreur `Failed to find a valid digest... integrity` (échec SRI — indiquerait un hash incorrect, à recalculer) ou de blocage réseau sur les 2 scripts CDN (onglet Network), puis exécuter directement :

```javascript
_renderQrDataUrl('https://repairdesk.fr/suivi/test')
_renderEan13DataUrl(42)
```

Expected : les deux appels retournent une chaîne commençant par `data:image/` (pas `null`, pas d'exception). Coller la data-URI QR dans un nouvel onglet du navigateur pour vérifier visuellement que l'image s'affiche.

- [ ] **Step 4: Commit**

```bash
git add public/tickets.html public/static/js/tickets.js
git commit -m "feat(tickets): helpers QR code / EAN-13 (qrcode-generator + JsBarcode, CDN)"
```

---

### Task 4: Fiche A4 — retrait notes internes, ajout QR + EAN-13

**Files:**
- Modify: `public/static/js/tickets.js:566-706` (`_buildTicketHTML` → renommée `_buildTicketA4HTML`)
- Modify: `public/static/js/tickets.js:492-503` (`printTicket()`, appel à mettre à jour)

**Interfaces:**
- Consumes: `_renderQrDataUrl(text)`, `_renderEan13DataUrl(ticketId)` (Task 3) ; `id` sur l'objet de données (Task 1).
- Produces: `_buildTicketA4HTML(d)` — remplace `_buildTicketHTML(d)`, même signature, consommée par `printTicket()` (Task 7 la fera dispatcher selon le format, cette tâche garde `printTicket()` fonctionnel avec l'A4 comme seul format pour l'instant).

- [ ] **Step 1: Renommer la fonction et retirer le bloc Notes internes**

Dans `public/static/js/tickets.js`, fonction `_buildTicketHTML(d)` (ligne ~566), renommer en `_buildTicketA4HTML(d)` :

```javascript
function _buildTicketA4HTML(d) {
```

Puis, dans le corps de la fonction, repérer et **supprimer entièrement** ce bloc (fuite de confidentialité — notes internes ne doivent jamais apparaître sur un document remis au client) :

```javascript
      ${d.notes ? `
      <div style="margin-bottom:6mm;" class="print-no-break">
        <div class="print-notes-label" style="margin-bottom:2mm;">Notes internes</div>
        <div class="print-notes" style="background:#fff9ec;border-color:#ffe0a1;">${esc(d.notes)}</div>
      </div>` : ''}
```

- [ ] **Step 2: Ajouter QR + EAN-13 à côté du lien de suivi**

Toujours dans `_buildTicketA4HTML(d)`, repérer le bloc :

```javascript
      ${d.tracking ? `
      <div style="margin-top:6mm;text-align:center;font-size:8pt;color:#aaa;" class="print-no-break">
        Suivi en ligne : ${window.location.origin}/suivi/${esc(d.tracking)}
      </div>` : ''}
```

Le remplacer par (calcul des data-URI juste avant le `return`, réutilisation dans ce bloc) :

```javascript
      ${d.tracking ? `
      <div style="margin-top:6mm;display:flex;align-items:center;justify-content:center;gap:8mm;" class="print-no-break">
        ${qrDataUrl ? `<img src="${qrDataUrl}" alt="QR suivi" style="width:24mm;height:24mm;">` : ''}
        ${eanDataUrl ? `<img src="${eanDataUrl}" alt="Code-barre" style="width:38mm;">` : ''}
        <div style="font-size:8pt;color:#aaa;text-align:left;">
          Suivi en ligne :<br>${window.location.origin}/suivi/${esc(d.tracking)}
        </div>
      </div>` : ''}
```

Puis, juste avant le `return` de la fonction (repérer la ligne `return \`` qui commence le template HTML), ajouter le calcul des 2 data-URI :

```javascript
  const qrDataUrl  = d.tracking ? _renderQrDataUrl(window.location.origin + '/suivi/' + d.tracking) : null;
  const eanDataUrl = _renderEan13DataUrl(d.id);

  return `
```

- [ ] **Step 3: Mettre à jour l'appel dans `printTicket()`**

Dans `public/static/js/tickets.js`, fonction `printTicket(id)` (ligne ~492), remplacer :

```javascript
    const html = _buildTicketHTML(data);
```

par :

```javascript
    const html = _buildTicketA4HTML(data);
```

- [ ] **Step 4: Valider en local live**

```bash
npm run build
npx wrangler pages dev dist --port 8788 --local
```

Ouvrir la fiche détail d'un ticket réel ayant des notes internes renseignées (en créer/éditer un si besoin via l'onglet Notes internes existant), cliquer "🖨 Imprimer", vérifier dans l'aperçu d'impression (`Ctrl+P` puis annuler, ou laisser `window.print()` ouvrir l'aperçu) :
- Aucun bloc "Notes internes" visible
- QR code + code-barre visibles à côté du lien de suivi, tous deux nets (pas flous/coupés)
- Scanner le QR avec un téléphone → doit ouvrir `/suivi/<token>` et afficher la page de suivi client existante

- [ ] **Step 5: Commit**

```bash
git add public/static/js/tickets.js
git commit -m "fix(tickets): fiche A4 — retrait notes internes (fuite confidentialité), ajout QR + EAN-13"
```

---

### Task 5: Ticket client thermique (72mm)

**Files:**
- Modify: `public/static/js/tickets.js` (nouvelle fonction `_buildTicketThermiqueHTML`, juste après `_buildTicketA4HTML`)

**Interfaces:**
- Consumes: `_renderQrDataUrl`, `_renderEan13DataUrl` (Task 3) ; classes CSS `.print-ticket*` (déjà présentes dans `public/static/css/print.css`, jamais utilisées jusqu'ici).
- Produces: `_buildTicketThermiqueHTML(d)` — consommée par `printTicket()` (Task 7).

- [ ] **Step 1: Écrire la fonction**

Dans `public/static/js/tickets.js`, juste après la fin de `_buildTicketA4HTML(d)` (repérer l'accolade fermante suivie de `}` puis la ligne `window.printTicket = printTicket;`), ajouter :

```javascript
/**
 * Construit le HTML du ticket client au format thermique 72mm (à emporter par
 * le client à la prise en charge) — réutilise les classes .print-ticket* de
 * print.css, présentes depuis longtemps mais jamais câblées à une fonction JS
 * avant ce chantier. Contenu volontairement réduit par rapport à la fiche A4
 * (pas d'état constaté, pas de signature — format papier trop étroit) — voir
 * docs/superpowers/specs/2026-07-17-impression-ticket-design.md.
 * @param {object} d - Données normalisées retournées par _fetchTicketPrintData
 * @returns {string} HTML complet prêt à être injecté dans #print-root
 */
function _buildTicketThermiqueHTML(d) {
  const prixHTML = d.prix > 0 ? _money(d.prix) : 'Sur devis';
  const qrDataUrl  = d.tracking ? _renderQrDataUrl(window.location.origin + '/suivi/' + d.tracking) : null;
  const eanDataUrl = _renderEan13DataUrl(d.id);

  return `
    <div id="print-root">
      <link rel="stylesheet" href="/static/css/print.css">
      <div class="print-ticket">
        <div class="print-ticket-header">
          <div class="shop-name">${esc(d.boutique.nom)}</div>
          ${d.boutique.telephone ? `<div class="shop-sub">${esc(d.boutique.telephone)}</div>` : ''}
        </div>

        <table class="print-ticket-lines">
          <tr><td>N° ticket</td><td class="txt-right"><strong>${esc(d.numero)}</strong></td></tr>
          <tr><td>Date</td><td class="txt-right">${_fmtDateTime(d.dateEm)}</td></tr>
          <tr><td>Client</td><td class="txt-right">${esc(d.client)}</td></tr>
          <tr><td>Appareil</td><td class="txt-right">${esc(d.marque)} ${esc(d.modele)}</td></tr>
        </table>

        <hr class="print-ticket-sep">

        <div class="print-ticket-total">
          <span>Montant estimé</span><span>${prixHTML}</span>
        </div>

        <hr class="print-ticket-sep">

        <div style="text-align:center;">
          ${qrDataUrl  ? `<img src="${qrDataUrl}" alt="QR suivi" style="width:26mm;height:26mm;">` : ''}
          ${eanDataUrl ? `<img src="${eanDataUrl}" alt="Code-barre" style="width:60mm;margin-top:2mm;">` : ''}
        </div>

        <div class="print-ticket-footer">
          ${d.tracking ? `Suivi : ${window.location.origin}/suivi/${esc(d.tracking)}<br>` : ''}
          Merci de votre confiance !
        </div>
      </div>
    </div>`;
}

```

- [ ] **Step 2: Câbler temporairement pour tester (retiré en Task 7)**

Pour valider ce format avant que les 3 boutons n'existent (Task 7), modifier temporairement `printTicket()` :

```javascript
    const html = _buildTicketThermiqueHTML(data);  // TEMPORAIRE — Task 7 remet le dispatch propre
```

- [ ] **Step 3: Valider en local live**

```bash
npm run build
npx wrangler pages dev dist --port 8788 --local
```

Ouvrir la fiche détail d'un ticket réel, cliquer "🖨 Imprimer", vérifier dans l'aperçu d'impression :
- Largeur visuellement cohérente avec un rouleau 72mm (comparer avec l'aperçu A4 précédent, nettement plus étroit)
- Police monospace (Courier New, héritée de `.print-ticket`)
- QR + EAN-13 lisibles, pas coupés par les marges
- Aucune note interne, aucun état constaté, aucune signature (contenu volontairement réduit)

- [ ] **Step 4: Retirer le câblage temporaire**

Annuler la modification du Step 2 (remettre `const html = _buildTicketA4HTML(data);` — l'état exact avant Task 7, qui posera le vrai dispatch par paramètre).

- [ ] **Step 5: Commit**

```bash
git add public/static/js/tickets.js
git commit -m "feat(tickets): _buildTicketThermiqueHTML() — ticket client format 72mm"
```

---

### Task 6: Étiquette technicien thermique (72mm)

**Files:**
- Modify: `public/static/js/tickets.js` (nouvelle fonction `_buildEtiquetteTechnicienHTML`, juste après `_buildTicketThermiqueHTML`)

**Interfaces:**
- Consumes: `_renderQrDataUrl`, `_renderEan13DataUrl` (Task 3).
- Produces: `_buildEtiquetteTechnicienHTML(d)` — consommée par `printTicket()` (Task 7). Le QR pointe vers `tickets.html?open=<token>` (lien interne, PAS le lien client `/suivi/<token>`) — résolu par la Task 8.

- [ ] **Step 1: Écrire la fonction**

Dans `public/static/js/tickets.js`, juste après la fin de `_buildTicketThermiqueHTML(d)`, ajouter :

```javascript
/**
 * Construit le HTML de l'étiquette technicien au format thermique 72mm — à
 * coller sur l'appareil en réparation, JAMAIS vue par le client (contenu
 * complet, contrairement au ticket client). Le QR pointe vers un lien
 * INTERNE (tickets.html?open=<token>, résolu par _checkOpenDeepLink()) et non
 * vers le lien de suivi client en lecture seule — un technicien qui scanne
 * cette étiquette avec la douchette du poste doit pouvoir reprendre/mettre à
 * jour le ticket directement, pas atterrir sur la page publique. Voir
 * docs/superpowers/specs/2026-07-17-impression-ticket-design.md.
 * @param {object} d - Données normalisées retournées par _fetchTicketPrintData
 * @returns {string} HTML complet prêt à être injecté dans #print-root
 */
function _buildEtiquetteTechnicienHTML(d) {
  const lienInterne = d.tracking ? (window.location.origin + '/tickets.html?open=' + d.tracking) : null;
  const qrDataUrl  = lienInterne ? _renderQrDataUrl(lienInterne) : null;
  const eanDataUrl = _renderEan13DataUrl(d.id);

  return `
    <div id="print-root">
      <link rel="stylesheet" href="/static/css/print.css">
      <div class="print-ticket">
        <div class="print-ticket-header">
          <div class="shop-name">${esc(d.boutique.nom)}</div>
          <div class="shop-sub">Étiquette technicien — interne</div>
        </div>

        <table class="print-ticket-lines">
          <tr><td>N° ticket</td><td class="txt-right"><strong>${esc(d.numero)}</strong></td></tr>
          <tr><td>Client</td><td class="txt-right">${esc(d.client)}</td></tr>
          ${d.tel ? `<tr><td>Tél</td><td class="txt-right">${esc(d.tel)}</td></tr>` : ''}
          <tr><td>Appareil</td><td class="txt-right">${esc(d.marque)} ${esc(d.modele)}</td></tr>
          <tr><td>Technicien</td><td class="txt-right">${esc(d.technicien)}</td></tr>
          <tr><td>Priorité</td><td class="txt-right">${esc(d.priorite)}</td></tr>
          <tr><td>Date</td><td class="txt-right">${_fmtDateTime(d.dateEm)}</td></tr>
        </table>

        <hr class="print-ticket-sep">

        <div style="font-size:8pt;padding:0 1mm;">
          <strong>Panne déclarée :</strong><br>${esc(d.panne) || '—'}
        </div>

        <hr class="print-ticket-sep">

        <div style="text-align:center;">
          ${qrDataUrl  ? `<img src="${qrDataUrl}" alt="QR ouverture ticket" style="width:26mm;height:26mm;">` : ''}
          ${eanDataUrl ? `<img src="${eanDataUrl}" alt="Code-barre" style="width:60mm;margin-top:2mm;">` : ''}
        </div>

        <div class="print-ticket-footer">
          Scanner pour ouvrir le ticket dans le logiciel
        </div>
      </div>
    </div>`;
}

```

- [ ] **Step 2: Câbler temporairement pour tester (retiré en Task 7)**

```javascript
    const html = _buildEtiquetteTechnicienHTML(data);  // TEMPORAIRE — Task 7 remet le dispatch propre
```

- [ ] **Step 3: Valider en local live**

```bash
npm run build
npx wrangler pages dev dist --port 8788 --local
```

Ouvrir la fiche détail d'un ticket réel, cliquer "🖨 Imprimer", vérifier dans l'aperçu :
- Contenu complet visible (panne, technicien, priorité, date — contrairement au ticket client)
- QR distinct de celui du ticket client (comparer visuellement les data-URI générées, ou scanner : l'URL doit contenir `tickets.html?open=` et non `/suivi/`)
- EAN-13 identique en valeur à celui du ticket client (même ID ticket)

- [ ] **Step 4: Retirer le câblage temporaire**

Remettre `const html = _buildTicketA4HTML(data);` (état stable avant Task 7).

- [ ] **Step 5: Commit**

```bash
git add public/static/js/tickets.js
git commit -m "feat(tickets): _buildEtiquetteTechnicienHTML() — étiquette technicien format 72mm"
```

---

### Task 7: 3 boutons d'impression + dispatch `printTicket(id, format)`

**Files:**
- Modify: `public/tickets.html:430` (bouton unique → 3 boutons)
- Modify: `public/static/js/tickets.js:492-503` (`printTicket()`, signature + dispatch)

**Interfaces:**
- Consumes: `_buildTicketA4HTML`, `_buildTicketThermiqueHTML`, `_buildEtiquetteTechnicienHTML` (Tasks 4, 5, 6).
- Produces: `printTicket(id, format)` où `format` ∈ `'a4' | 'thermique' | 'etiquette'` (défaut `'a4'` si omis, rétrocompatible avec tout appel existant sans second argument).

- [ ] **Step 1: Modifier `printTicket()`**

Dans `public/static/js/tickets.js`, remplacer :

```javascript
async function printTicket(id) {
  if (!id) return;
  try {
    const data = await _fetchTicketPrintData(id);
    if (!data) return;
    const html = _buildTicketA4HTML(data);
    _triggerPrint(html);
  } catch (err) {
    console.error('[printTicket]', err);
    showFlash('⚠️ Erreur lors de la génération de la fiche.', 'error');
  }
}
```

par :

```javascript
async function printTicket(id, format) {
  if (!id) return;
  try {
    const data = await _fetchTicketPrintData(id);
    if (!data) return;
    let html;
    if (format === 'thermique')      html = _buildTicketThermiqueHTML(data);
    else if (format === 'etiquette') html = _buildEtiquetteTechnicienHTML(data);
    else                              html = _buildTicketA4HTML(data);  // défaut = 'a4'
    _triggerPrint(html);
  } catch (err) {
    console.error('[printTicket]', err);
    showFlash('⚠️ Erreur lors de la génération de la fiche.', 'error');
  }
}
```

- [ ] **Step 2: Remplacer le bouton unique par 3 boutons**

Dans `public/tickets.html`, remplacer :

```html
          <button class="btn btn-ghost btn-sm" onclick="printTicket(window._currentTicketId)" title="Imprimer / PDF">🖨 Imprimer</button>
```

par :

```html
          <button class="btn btn-ghost btn-sm" onclick="printTicket(window._currentTicketId, 'a4')" title="Imprimer fiche A4">🖨 Fiche A4</button>
          <button class="btn btn-ghost btn-sm" onclick="printTicket(window._currentTicketId, 'thermique')" title="Imprimer ticket client (thermique 72mm)">🧾 Ticket client</button>
          <button class="btn btn-ghost btn-sm" onclick="printTicket(window._currentTicketId, 'etiquette')" title="Imprimer étiquette technicien (thermique 72mm)">🏷️ Étiquette</button>
```

- [ ] **Step 3: Valider en local live**

```bash
npm run build
npx wrangler pages dev dist --port 8788 --local
```

Ouvrir la fiche détail d'un ticket réel, vérifier que les 3 boutons sont visibles et correctement libellés, cliquer chacun tour à tour et confirmer que l'aperçu d'impression correspond au bon format (A4 complet / ticket client réduit / étiquette technicien complète avec lien interne). Vérifier qu'aucune régression n'affecte le bouton "Archiver"/"Créer un devis →" juste à côté (mise en page du footer modal toujours correcte, pas de débordement avec 3 boutons au lieu d'1).

- [ ] **Step 4: Commit**

```bash
git add public/tickets.html public/static/js/tickets.js
git commit -m "feat(tickets): 3 boutons d'impression (A4 / ticket client / étiquette technicien)"
```

---

### Task 8: Deep-link technicien `tickets.html?open=<token>`

**Files:**
- Modify: `public/static/js/tickets.js:43-50` (`DOMContentLoaded`, ajout d'un appel)

**Interfaces:**
- Consumes: `GET /api/tickets?search=<token>&boutique_id=...` (déjà existant, étendu par la Task 2 pour reconnaître un token) ; `viewTicket(id)` (déjà existant) ; `getBoutiqueId()`, `apiGet()`, `showFlash()` (déjà existants, utilisés ailleurs dans ce fichier).
- Produces: rien consommé par une tâche suivante — dernier maillon du chantier.

- [ ] **Step 1: Écrire `_checkOpenDeepLink()` et la câbler au chargement de page**

Dans `public/static/js/tickets.js`, modifier le bloc `DOMContentLoaded` :

```javascript
document.addEventListener('DOMContentLoaded', function() {
  buildSidebar('tickets');
  loadTickets();   // remplace renderTickets() direct
  initSignature();
  initSchemaGrid();
  populateClients();
  populateTechniciens();
});
```

en :

```javascript
document.addEventListener('DOMContentLoaded', function() {
  buildSidebar('tickets');
  loadTickets();   // remplace renderTickets() direct
  initSignature();
  initSchemaGrid();
  populateClients();
  populateTechniciens();
  _checkOpenDeepLink();
});
```

Puis, juste après la fin de la fonction `loadTickets()` existante (repérer sa dernière accolade fermante avec `grep -n "^async function loadTickets" -A 60 public/static/js/tickets.js` pour trouver le bon point d'insertion), ajouter :

```javascript
// ─── Lien interne technicien (étiquette imprimée) ───────────────────────────
/**
 * Si l'URL contient ?open=<token>, résout le token vers un ticket (réutilise
 * la recherche par token de listTickets(), voir Task 2 de ce plan / docs/
 * superpowers/specs/2026-07-17-impression-ticket-design.md) et ouvre
 * directement sa fiche détail. Permet de scanner l'étiquette technicien
 * (douchette USB sur poste déjà connecté à l'app — pas de gestion de
 * reconnexion nécessaire, voir Décisions du spec) pour reprendre/mettre à
 * jour le ticket sans recherche manuelle.
 */
async function _checkOpenDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('open');
  if (!token) return;

  try {
    const boutiqueId = getBoutiqueId();
    const r = await apiGet('/api/tickets', { search: token, ...(boutiqueId ? { boutique_id: boutiqueId } : {}) });
    const results = r.ok ? (r.data?.data || r.data || []) : [];
    if (results.length === 0) {
      showFlash('⚠️ Ticket introuvable pour ce lien.', 'error');
      return;
    }
    viewTicket(results[0].id);
  } catch (e) {
    console.error('[_checkOpenDeepLink]', e);
    showFlash('⚠️ Erreur lors de la résolution du ticket.', 'error');
  }
}
```

- [ ] **Step 2: Valider en local live**

```bash
npm run build
npx wrangler pages dev dist --port 8788 --local
```

Se connecter avec un compte manager réel, noter le `tracking_token` d'un ticket existant (via `SELECT tracking_token FROM tickets WHERE id = <id>` en local, ou en imprimant son étiquette technicien et en lisant l'URL encodée dans le QR), puis :
1. Naviguer vers `http://127.0.0.1:8788/tickets.html?open=<token-valide>` → la fiche détail du bon ticket doit s'ouvrir automatiquement.
2. Naviguer vers `http://127.0.0.1:8788/tickets.html?open=token-invalide-inexistant` → message "⚠️ Ticket introuvable pour ce lien." doit s'afficher, pas d'écran blanc ni d'exception en console.
3. Naviguer vers `http://127.0.0.1:8788/tickets.html` (sans `?open=`) → comportement inchangé (liste normale, pas de tentative de résolution).

Pour un test complet du flow réel : imprimer l'étiquette technicien d'un ticket (Task 6), scanner son QR avec un téléphone (juste pour lire l'URL, pas besoin d'un poste connecté pour ce test de lecture), copier l'URL affichée, la coller dans le navigateur du poste `wrangler pages dev` déjà connecté à l'app → vérifier l'ouverture automatique de la bonne fiche.

- [ ] **Step 3: Commit**

```bash
git add public/static/js/tickets.js
git commit -m "feat(tickets): deep-link tickets.html?open=<token> — ouverture directe depuis étiquette technicien"
```

---

## Après le plan

- [ ] Mettre à jour `project-docs/todo.md`/`current-state.md` (nouveau checkpoint, chantier impression ticket terminé) et `bugs.md` si des écarts sont découverts pendant l'implémentation (ex. fuite notes internes déjà identifiée dans ce plan comme "fix", pas "nouvelle fonctionnalité").
- [ ] Build + `wrangler pages deploy` + vérification `repairdesk.fr/api/health` + `sw.js` version (`CACHE_VERSION` à bumper — ce plan touche `public/static/js/tickets.js` et `public/tickets.html`, donc au moins un bump nécessaire, comme pour chaque checkpoint précédent de ce projet).
