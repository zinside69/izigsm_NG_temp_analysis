#!/usr/bin/env node
/**
 * build-hash-assets.mjs — hash de contenu des assets statiques (JS/CSS) pour
 * cache-busting. Opère uniquement sur dist/ après `vite build` — voir
 * docs/superpowers/specs/2026-07-24-cache-busting-design.md.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, extname, basename } from 'node:path'

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
