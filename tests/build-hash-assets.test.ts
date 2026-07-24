import { describe, it, expect, beforeEach, afterEach } from 'vitest'
// @ts-ignore node:fs types not available without @types/node
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
// @ts-ignore node:os types not available without @types/node
import { tmpdir } from 'node:os'
// @ts-ignore node:path types not available without @types/node
import { join } from 'node:path'
import {
  hashContent,
  rewriteStaticReferences,
  hashAndRenameAssets,
  writeHeadersFile,
} from '../scripts/build-hash-assets.mjs'

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

describe('hashAndRenameAssets', () => {
  let distDir: string

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
    const jsHash = hashContent(new TextEncoder().encode("console.log('a')"))
    const cssHash = hashContent(new TextEncoder().encode('body{color:red}'))

    const manifest = hashAndRenameAssets(distDir)

    expect(manifest).toEqual({
      'static/js/app.js': `static/js/app.${jsHash}.js`,
      'static/css/main.css': `static/css/main.${cssHash}.css`,
    })
  })

  it('supprime le fichier original et crée le fichier hashé avec le même contenu', () => {
    const jsHash = hashContent(new TextEncoder().encode("console.log('a')"))
    hashAndRenameAssets(distDir)

    expect(existsSync(join(distDir, 'static', 'js', 'app.js'))).toBe(false)
    const hashedPath = join(distDir, 'static', 'js', `app.${jsHash}.js`)
    expect(existsSync(hashedPath)).toBe(true)
    expect(readFileSync(hashedPath, 'utf8')).toBe("console.log('a')")
  })
})

describe('writeHeadersFile', () => {
  let distDir: string

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
