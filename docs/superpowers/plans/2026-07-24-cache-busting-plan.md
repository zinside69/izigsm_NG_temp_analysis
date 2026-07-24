# Cache-busting par hash de contenu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hasher le contenu de `public/static/js/*.js` et `public/static/css/*.css` dans leur nom de fichier généré (`dist/static/js/tickets.a3f8e1.js`) pour qu'une URL hashée ne puisse jamais être servie périmée, en éliminant à la source l'incident du 2026-07-18 (contenu figé pendant une fenêtre de propagation CDN).

**Architecture:** Un script Node isolé (`scripts/build-hash-assets.mjs`), lancé après `vite build`, opère uniquement sur `dist/` (jamais sur `public/` source) : hash + renomme les JS/CSS, écrit un manifest, réécrit les 29 pages HTML et `sw.js` pour référencer les noms hashés, écrit un fichier `_headers` Cloudflare Pages pour le cache long+immutable.

**Tech Stack:** Node.js (ESM, `node:fs`/`node:path`/`node:crypto`/`node:url`), Vitest pour les tests unitaires, TypeScript pour le fichier de test (via un fichier de déclaration `.d.mts` compagnon puisque le script lui-même reste en `.mjs` pur, cohérent avec `scripts/loop/*.mjs` déjà présents dans le repo).

## Global Constraints

- Le script n'opère que sur `dist/` généré par `vite build` — ne modifie jamais `public/` (source de vérité versionnée, doit garder des noms logiques non hashés).
- Scope strict : `public/static/js/*.js` et `public/static/css/*.css` uniquement. `public/static/img/*` reste non hashé (décision actée dans le spec).
- Toute référence `/static/js/` ou `/static/css/` trouvée dans une page HTML ou `sw.js` sans entrée correspondante dans le manifest **doit faire échouer le build** (exit non-zéro) — jamais de déploiement silencieux avec une référence cassée.
- Aucune modification du build du worker Hono (`@hono/vite-build/cloudflare-pages`, `src/index.tsx` → `dist/_worker.js`).
- `CACHE_VERSION` dans `public/sw.js` reste une discipline développeur manuelle, non touchée par ce chantier.
- Chaque tâche se termine par `npx vitest run` vert avant de passer à la suivante (convention `CLAUDE.md`).
- Aucun déploiement automatique à aucun moment de ce plan — `npm run deploy` reste un geste humain explicite en dehors de ce plan.

---

### Task 1: Fonctions pures de hash et de réécriture (`hashContent`, `rewriteStaticReferences`)

**Files:**
- Create: `scripts/build-hash-assets.mjs`
- Create: `scripts/build-hash-assets.d.mts`
- Test: `tests/build-hash-assets.test.ts`

**Interfaces:**
- Produces: `hashContent(buffer: Buffer): string` — retourne les 8 premiers caractères hex du SHA-256 du contenu.
- Produces: `rewriteStaticReferences(content: string, manifest: Record<string, string>): string` — remplace chaque référence `/static/js/...` ou `/static/css/...` trouvée dans `content` par son équivalent hashé (clé manifest sans le `/` initial). Lève une `Error` si une référence n'a pas d'entrée dans le manifest.

- [ ] **Step 1: Écrire le test qui échoue pour `hashContent`**

Créer `tests/build-hash-assets.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { hashContent, rewriteStaticReferences } from '../scripts/build-hash-assets.mjs'

describe('hashContent', () => {
  it('retourne les 8 premiers caractères hex du SHA-256 du contenu', () => {
    const result = hashContent(Buffer.from('hello'))
    expect(result).toBe('2cf24dba')
  })

  it('retourne un hash différent pour un contenu différent', () => {
    const a = hashContent(Buffer.from('hello'))
    const b = hashContent(Buffer.from('hello world'))
    expect(a).not.toBe(b)
  })
})

describe('rewriteStaticReferences', () => {
  it('remplace une référence /static/js/ connue par son équivalent hashé', () => {
    const html = '<script src="/static/js/app.js"></script>'
    const manifest = { 'static/js/app.js': 'static/js/app.a1b2c3d4.js' }
    const result = rewriteStaticReferences(html, manifest)
    expect(result).toBe('<script src="/static/js/app.a1b2c3d4.js"></script>')
  })

  it('remplace une référence /static/css/ connue par son équivalent hashé', () => {
    const html = '<link rel="stylesheet" href="/static/css/main.css">'
    const manifest = { 'static/css/main.css': 'static/css/main.e5f6a7b8.css' }
    const result = rewriteStaticReferences(html, manifest)
    expect(result).toBe('<link rel="stylesheet" href="/static/css/main.e5f6a7b8.css">')
  })

  it('laisse intactes les références non /static/js|css/ (ex. CDN)', () => {
    const html = "'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'"
    const manifest = {}
    const result = rewriteStaticReferences(html, manifest)
    expect(result).toBe(html)
  })

  it('lève une erreur pour une référence /static/js/ absente du manifest', () => {
    const html = '<script src="/static/js/manquant.js"></script>'
    const manifest = {}
    expect(() => rewriteStaticReferences(html, manifest)).toThrow(
      /manquant\.js/
    )
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run tests/build-hash-assets.test.ts`
Expected: FAIL — `Cannot find module '../scripts/build-hash-assets.mjs'` (le fichier n'existe pas encore).

- [ ] **Step 3: Créer le fichier de déclaration de types**

Créer `scripts/build-hash-assets.d.mts` :

```ts
export declare function hashContent(buffer: Buffer): string
export declare function rewriteStaticReferences(
  content: string,
  manifest: Record<string, string>
): string
```

- [ ] **Step 4: Implémenter les deux fonctions**

Créer `scripts/build-hash-assets.mjs` :

```js
#!/usr/bin/env node
/**
 * build-hash-assets.mjs — hash de contenu des assets statiques (JS/CSS) pour
 * cache-busting. Opère uniquement sur dist/ après `vite build` — voir
 * docs/superpowers/specs/2026-07-24-cache-busting-design.md.
 */
import { createHash } from 'node:crypto'

export function hashContent(buffer) {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 8)
}

const STATIC_REF_PATTERN = /(["'])(\/static\/(?:js|css)\/[^"']+)\1/g

export function rewriteStaticReferences(content, manifest) {
  return content.replace(STATIC_REF_PATTERN, (match, quote, refPath) => {
    const logicalKey = refPath.slice(1)
    const hashedKey = manifest[logicalKey]
    if (!hashedKey) {
      throw new Error(`Reference orpheline : ${refPath} absent du manifest`)
    }
    return `${quote}/${hashedKey}${quote}`
  })
}
```

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run tests/build-hash-assets.test.ts`
Expected: PASS — 5 tests verts.

- [ ] **Step 6: Vérifier qu'aucune nouvelle erreur tsc n'est introduite**

Run: `npx tsc --noEmit`
Expected: le compte d'erreurs reste identique à la baseline (32 erreurs pré-existantes, aucune sur `build-hash-assets`). Si une erreur `TS2307` apparaît sur l'import de `../scripts/build-hash-assets.mjs`, vérifier que `scripts/build-hash-assets.d.mts` est bien au même chemin/nom de base que `scripts/build-hash-assets.mjs` (résolution de types TypeScript par fichier `.d.mts` compagnon).

- [ ] **Step 7: Commit**

```bash
git add scripts/build-hash-assets.mjs scripts/build-hash-assets.d.mts tests/build-hash-assets.test.ts
git commit -m "feat: fonctions hashContent/rewriteStaticReferences (cache-busting)"
```

---

### Task 2: Hash et renommage des fichiers sur disque (`hashAndRenameAssets`) + écriture `_headers` (`writeHeadersFile`)

**Files:**
- Modify: `scripts/build-hash-assets.mjs`
- Modify: `scripts/build-hash-assets.d.mts`
- Modify: `tests/build-hash-assets.test.ts`

**Interfaces:**
- Consumes: `hashContent(buffer: Buffer): string` (Task 1).
- Produces: `hashAndRenameAssets(distDir: string): Record<string, string>` — scanne `distDir/static/js/*.js` et `distDir/static/css/*.css`, hash + renomme chaque fichier en place, retourne le manifest `{ 'static/js/app.js': 'static/js/app.a1b2c3d4.js', ... }`.
- Produces: `writeHeadersFile(distDir: string): void` — écrit `distDir/_headers`.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `tests/build-hash-assets.test.ts` (après les imports existants, ajouter `hashAndRenameAssets` et `writeHeadersFile` à l'import, et ajouter `mkdtempSync`/`mkdirSync`/`writeFileSync`/`readFileSync`/`existsSync`/`rmSync` de `node:fs`, `tmpdir` de `node:os`, `join` de `node:path`) :

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  hashContent,
  rewriteStaticReferences,
  hashAndRenameAssets,
  writeHeadersFile,
} from '../scripts/build-hash-assets.mjs'

// ... (describe hashContent / rewriteStaticReferences existants inchangés) ...

describe('hashAndRenameAssets', () => {
  let distDir

  beforeEach(() => {
    distDir = mkdtempSync(join(tmpdir(), 'izigsm-hash-test-'))
    mkdirSync(join(distDir, 'static', 'js'), { recursive: true })
    mkdirSync(join(distDir, 'static', 'css'), { recursive: true })
    writeFileSync(join(distDir, 'static', 'js', 'app.js'), "console.log('a')")
    writeFileSync(join(distDir, 'static', 'css', 'main.css'), 'body{color:red}')
  })

  afterEach(() => {
    rmSync(distDir, { recursive: true, force: true })
  })

  it('renomme les fichiers JS/CSS avec leur hash de contenu', () => {
    const jsHash = hashContent(Buffer.from("console.log('a')"))
    const cssHash = hashContent(Buffer.from('body{color:red}'))

    const manifest = hashAndRenameAssets(distDir)

    expect(manifest).toEqual({
      'static/js/app.js': `static/js/app.${jsHash}.js`,
      'static/css/main.css': `static/css/main.${cssHash}.css`,
    })
  })

  it('supprime le fichier original et crée le fichier hashé avec le même contenu', () => {
    const jsHash = hashContent(Buffer.from("console.log('a')"))
    hashAndRenameAssets(distDir)

    expect(existsSync(join(distDir, 'static', 'js', 'app.js'))).toBe(false)
    const hashedPath = join(distDir, 'static', 'js', `app.${jsHash}.js`)
    expect(existsSync(hashedPath)).toBe(true)
    expect(readFileSync(hashedPath, 'utf8')).toBe("console.log('a')")
  })
})

describe('writeHeadersFile', () => {
  let distDir

  beforeEach(() => {
    distDir = mkdtempSync(join(tmpdir(), 'izigsm-headers-test-'))
  })

  afterEach(() => {
    rmSync(distDir, { recursive: true, force: true })
  })

  it('écrit un fichier _headers avec les règles de cache attendues', () => {
    writeHeadersFile(distDir)
    const content = readFileSync(join(distDir, '_headers'), 'utf8')

    expect(content).toContain('/static/js/*')
    expect(content).toContain('/static/css/*')
    expect(content).toContain('Cache-Control: public, max-age=31536000, immutable')
    expect(content).toContain('/sw.js')
    expect(content).toContain('/*.html')
    expect(content).toContain('Cache-Control: no-cache')
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run tests/build-hash-assets.test.ts`
Expected: FAIL — `hashAndRenameAssets is not a function` / `writeHeadersFile is not a function`.

- [ ] **Step 3: Mettre à jour le fichier de déclaration de types**

Remplacer le contenu de `scripts/build-hash-assets.d.mts` par :

```ts
export declare function hashContent(buffer: Buffer): string
export declare function rewriteStaticReferences(
  content: string,
  manifest: Record<string, string>
): string
export declare function hashAndRenameAssets(distDir: string): Record<string, string>
export declare function writeHeadersFile(distDir: string): void
```

- [ ] **Step 4: Implémenter les deux fonctions**

Ajouter à `scripts/build-hash-assets.mjs` (après les imports existants, ajouter les imports `node:fs`/`node:path` ; ajouter le code après `rewriteStaticReferences`) :

```js
import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, extname, basename } from 'node:path'

const HASHED_DIRS = ['static/js', 'static/css']

export function hashAndRenameAssets(distDir) {
  const manifest = {}
  for (const relDir of HASHED_DIRS) {
    const absDir = join(distDir, ...relDir.split('/'))
    const files = readdirSync(absDir).filter(
      f => extname(f) === '.js' || extname(f) === '.css'
    )
    for (const file of files) {
      const absPath = join(absDir, file)
      const content = readFileSync(absPath)
      const hash = hashContent(content)
      const ext = extname(file)
      const nameNoExt = basename(file, ext)
      const hashedName = `${nameNoExt}.${hash}${ext}`
      renameSync(absPath, join(absDir, hashedName))
      manifest[`${relDir}/${file}`] = `${relDir}/${hashedName}`
    }
  }
  return manifest
}

const HEADERS_CONTENT = `/static/js/*
  Cache-Control: public, max-age=31536000, immutable

/static/css/*
  Cache-Control: public, max-age=31536000, immutable

/sw.js
  Cache-Control: no-cache

/*.html
  Cache-Control: no-cache
`

export function writeHeadersFile(distDir) {
  writeFileSync(join(distDir, '_headers'), HEADERS_CONTENT)
}
```

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run tests/build-hash-assets.test.ts`
Expected: PASS — 8 tests verts.

- [ ] **Step 6: Vérifier qu'aucune nouvelle erreur tsc n'est introduite**

Run: `npx tsc --noEmit`
Expected: compte d'erreurs identique à la baseline (32).

- [ ] **Step 7: Commit**

```bash
git add scripts/build-hash-assets.mjs scripts/build-hash-assets.d.mts tests/build-hash-assets.test.ts
git commit -m "feat: hashAndRenameAssets + writeHeadersFile (cache-busting)"
```

---

### Task 3: Orchestration `main()` + intégration dans `npm run build`

**Files:**
- Modify: `scripts/build-hash-assets.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `hashAndRenameAssets`, `rewriteStaticReferences`, `writeHeadersFile` (Tasks 1-2).
- Produces: exécutable CLI (`node scripts/build-hash-assets.mjs`) — pas de nouvel export, `main()` reste interne au script.

- [ ] **Step 1: Implémenter `main()` et le déclencheur CLI**

Ajouter à la fin de `scripts/build-hash-assets.mjs` :

```js
import { fileURLToPath } from 'node:url'

function main() {
  const distDir = join(process.cwd(), 'dist')

  const manifest = hashAndRenameAssets(distDir)
  writeFileSync(
    join(distDir, 'static', 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  )

  const htmlFiles = readdirSync(distDir).filter(f => extname(f) === '.html')
  for (const file of htmlFiles) {
    const absPath = join(distDir, file)
    const html = readFileSync(absPath, 'utf8')
    writeFileSync(absPath, rewriteStaticReferences(html, manifest))
  }

  const swPath = join(distDir, 'sw.js')
  const swContent = readFileSync(swPath, 'utf8')
  writeFileSync(swPath, rewriteStaticReferences(swContent, manifest))

  writeHeadersFile(distDir)

  console.log(
    `[build-hash-assets] ${Object.keys(manifest).length} fichiers hashés, ${htmlFiles.length} pages HTML réécrites.`
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
}
```

- [ ] **Step 2: Vérifier que les tests existants passent toujours (aucune régression sur l'ajout de `main()`)**

Run: `npx vitest run tests/build-hash-assets.test.ts`
Expected: PASS — 8 tests verts (inchangé, `main()` n'est pas testé unitairement — voir Task 4 pour la validation d'intégration).

- [ ] **Step 3: Brancher le script dans le build**

Modifier `package.json`, remplacer :

```json
"build": "vite build",
```

par :

```json
"build": "vite build && node scripts/build-hash-assets.mjs",
```

- [ ] **Step 4: Vérifier qu'aucune nouvelle erreur tsc n'est introduite**

Run: `npx tsc --noEmit`
Expected: compte d'erreurs identique à la baseline (32).

- [ ] **Step 5: Commit**

```bash
git add scripts/build-hash-assets.mjs package.json
git commit -m "feat: orchestration main() + integration npm run build (cache-busting)"
```

---

### Task 4: Validation manuelle locale (build réel + inspection)

**Files:** aucun fichier modifié — validation uniquement.

**Interfaces:**
- Consumes : le pipeline complet (`npm run build`) issu des Tasks 1-3.

- [ ] **Step 1: Lancer le build complet**

Run: `npm run build`
Expected: sortie Vite habituelle (`✓ built in ...`) suivie de la ligne `[build-hash-assets] 20 fichiers hashés, 29 pages HTML réécrites.`

- [ ] **Step 2: Vérifier que le manifest existe et couvre les 20 fichiers JS + 2 CSS**

Run: `node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('dist/static/manifest.json','utf8'))).length)"`
Expected: `22`

- [ ] **Step 3: Vérifier qu'une page HTML référence bien un nom hashé**

Run: `grep -o "static/js/app\.[a-f0-9]\{8\}\.js" dist/tickets.html`
Expected: une ligne du type `static/js/app.a1b2c3d4.js` (le hash exact dépend du contenu réel de `app.js` au moment du build).

- [ ] **Step 4: Vérifier que `dist/sw.js` référence les mêmes noms hashés**

Run: `grep -o "static/js/app\.[a-f0-9]\{8\}\.js" dist/sw.js`
Expected: la même valeur hashée qu'à l'étape précédente (cohérence HTML/SW).

- [ ] **Step 5: Vérifier le fichier `_headers`**

Run: `cat dist/_headers`
Expected : contient les 4 blocs (`/static/js/*`, `/static/css/*`, `/sw.js`, `/*.html`) avec les `Cache-Control` attendus (voir Task 2 Step 4 pour le contenu exact).

- [ ] **Step 6: Servir `dist/` localement et vérifier dans le navigateur**

Run (terminal 1) : `npx wrangler d1 migrations apply DB --local` puis `npx wrangler pages dev dist --local --port 3000`
Ouvrir `http://localhost:3000/login`, se connecter (`admin@izigsm.fr` / `Admin@2026!`), naviguer vers `/tickets`.
Expected : la page se charge normalement (aucune erreur console 404 sur un asset statique), l'onglet Réseau du navigateur montre des requêtes vers des noms de fichiers hashés (`app.a1b2c3d4.js`, pas `app.js`).

- [ ] **Step 7: Commit du rapport de validation dans le ledger (pas de code)**

Aucun commit de code à cette étape — si un problème est trouvé, revenir à la tâche concernée (1, 2 ou 3) avant de continuer.

---

### Task 5: Vérification du gate Playwright existant (non-régression)

**Files:** aucun fichier modifié — vérification uniquement.

**Interfaces:**
- Consumes : le build hashé de la Task 4, le serveur local démarré à la Task 4 Step 6.

- [ ] **Step 1: Lancer la suite Playwright complète contre le build hashé**

Run (avec le serveur `wrangler pages dev dist --local --port 3000` de la Task 4 toujours actif) : `npm run test:e2e`
Expected: `10 passed` — les 10 tests `auth.spec.ts`/`health.spec.ts`/`isolation.spec.ts` passent sans modification (le hashing est transparent au comportement fonctionnel, les tests naviguent par route, jamais par nom de fichier statique en dur).

- [ ] **Step 2: Lancer la suite unitaire complète (non-régression globale)**

Run: `npx vitest run`
Expected: `824 passed` (+ les 8 nouveaux tests de `build-hash-assets.test.ts` = 832 au total), 2 échecs pré-existants inchangés (`agendaService.test.ts`, fuseau horaire, non liés à ce chantier).

- [ ] **Step 3: Si tout est vert, chantier prêt pour déploiement humain explicite**

Aucune action automatique — `npm run deploy` reste un geste manuel de l'utilisateur, hors périmètre de ce plan (voir Global Constraints).

---

## Self-Review

**1. Couverture du spec** :
- Script post-build isolé opérant sur `dist/` uniquement → Task 1-3. ✓
- Hash SHA-256 8 caractères, renommage `tickets.a3f8e1.js` → Task 1-2. ✓
- Manifest `dist/static/manifest.json` → Task 3. ✓
- Réécriture des 29 HTML → Task 3 (`main()`, boucle sur `htmlFiles`). ✓
- Régénération `APP_SHELL` dans `sw.js` → Task 3 (`rewriteStaticReferences` appliqué à `swContent`, réutilise la même fonction générique que pour le HTML). ✓
- `_headers` avec cache long+immutable / no-cache → Task 2 (`writeHeadersFile`). ✓
- Scope JS/CSS uniquement, images exclues → `HASHED_DIRS` ne contient que `static/js`/`static/css` (Task 2). ✓
- Échec bruyant sur référence orpheline → `rewriteStaticReferences` lève une erreur (Task 1, testé). ✓
- Test unitaire sur logique pure → Task 1-2 (8 tests). ✓
- Validation manuelle locale → Task 4. ✓
- Gate Playwright + vitest non-régression → Task 5. ✓
- Intégration `package.json` → Task 3. ✓

**2. Placeholders** : aucun trouvé — tout le code est complet et exécutable tel quel.

**3. Cohérence des types/signatures** : `hashAndRenameAssets(distDir: string): Record<string, string>` (Task 2) et son usage dans `main()` (Task 3, `const manifest = hashAndRenameAssets(distDir)`) sont cohérents. `rewriteStaticReferences(content, manifest)` (Task 1) est utilisé identiquement pour le HTML et pour `sw.js` dans `main()` (Task 3) — un seul nom de fonction partout, pas de divergence type `rewriteHtml` vs `rewriteSw`.
