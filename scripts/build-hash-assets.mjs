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
