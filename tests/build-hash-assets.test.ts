import { describe, it, expect } from 'vitest'
import { hashContent, rewriteStaticReferences } from '../scripts/build-hash-assets.mjs'

describe('hashContent', () => {
  it('retourne les 8 premiers caractères hex du SHA-256 du contenu', () => {
    const result = hashContent(new TextEncoder().encode('hello'))
    expect(result).toBe('2cf24dba')
  })

  it('retourne un hash différent pour un contenu différent', () => {
    const a = hashContent(new TextEncoder().encode('hello'))
    const b = hashContent(new TextEncoder().encode('hello world'))
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
