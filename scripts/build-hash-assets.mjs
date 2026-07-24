#!/usr/bin/env node
/**
 * build-hash-assets.mjs — hash de contenu des assets statiques (JS/CSS) pour
 * cache-busting. Opère uniquement sur dist/ après `vite build` — voir
 * docs/superpowers/specs/2026-07-24-cache-busting-design.md.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Hash de contenu (SHA-256, 8 caractères hex) — base du nom de fichier
 * cache-busté (`app.a1b2c3d4.js`). Un contenu identique produit toujours le
 * même hash, un contenu différent produit toujours un hash différent.
 *
 * @param buffer  Contenu binaire du fichier
 * @returns       8 premiers caractères hex du digest SHA-256
 */
export function hashContent(buffer) {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 8)
}

const STATIC_REF_PATTERN = /(["'])(\/static\/(?:js|css)\/[^"']+)\1/g

/**
 * Réécrit chaque référence `/static/js/...` ou `/static/css/...` d'un
 * contenu (page HTML ou `sw.js`) par son équivalent hashé du manifest.
 * Échoue bruyamment plutôt que de laisser passer une référence cassée —
 * voir § Gestion d'erreurs du spec (docs/superpowers/specs/2026-07-24-cache-busting-design.md).
 *
 * @param content   Contenu HTML ou JS à réécrire
 * @param manifest  Mapping nom logique -> nom hashé (voir hashAndRenameAssets)
 * @returns         Contenu avec toutes les références résolues vers leur nom hashé
 * @throws {Error}  Si une référence /static/js|css/ n'a pas d'entrée dans le manifest
 */
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

const HASHED_DIRS = ['static/js', 'static/css']

/**
 * Hash et renomme en place chaque fichier `.js`/`.css` de
 * `distDir/static/js/` et `distDir/static/css/`. N'opère jamais sur
 * `public/static/img/` (hors scope, décision actée dans le spec).
 *
 * @param distDir  Chemin absolu du dossier `dist/` généré par `vite build`
 * @returns        Manifest `{ 'static/js/app.js': 'static/js/app.a1b2c3d4.js', ... }`
 */
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

/**
 * Écrit `distDir/_headers` (fichier natif Cloudflare Pages) : cache long +
 * immutable sur les assets hashés (sûr uniquement parce que leur contenu ne
 * peut plus changer sous un même nom), no-cache explicite sur `sw.js` et les
 * pages HTML (doivent toujours être à jour pour référencer les bons hashs).
 *
 * @param distDir  Chemin absolu du dossier `dist/`
 */
export function writeHeadersFile(distDir) {
  writeFileSync(join(distDir, '_headers'), HEADERS_CONTENT)
}

/**
 * Orchestration complète, exécutée après `vite build` (voir `npm run build`
 * dans package.json) : hash+renomme les assets, écrit le manifest, réécrit
 * les pages HTML et `sw.js`, écrit `_headers`. Repart toujours d'un `dist/`
 * fraîchement généré (le script `build` vide `dist/` avant `vite build`) —
 * jamais de mutation incrémentale entre deux runs.
 */
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
