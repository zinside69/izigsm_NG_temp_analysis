/**
 * @file tests/mobilaxSeriesGeneration.test.ts
 * @description Tests unitaires — `seriesDeGeneration()` (ticket 01, chantier
 * `import-par-generation`) : l'opérateur tape un nom de base (« iPhone 17 »), le service rend
 * les séries Mobilax de cette génération.
 *
 * Seam : le service Mobilax, fournisseur simulé à sa frontière HTTP (`fetch` global), comme
 * `mobilaxService.test.ts`. Forme de `GET /catalog/series` reprise de la mesure réelle du
 * 2026-09-12 (`recherche-api-mobilax-2026-09-09.md` v1.5) : `{ status: "OK", data: [...] }`,
 * champs `id`, `id_range`, `name`, `short_name`, `abbreviation`, `position` — sans quota.
 *
 * Règle de correspondance (spec, `CONTEXT.md` § Génération) : nom de série **égal** au texte
 * ou **commençant par lui suivi d'un espace**, insensible à la casse et aux espaces superflus.
 * Un simple préfixe déborde (« Galaxy S2 » capterait S20–S25, « iPhone 1 » capterait 11 à 17).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockDatabase } from './helpers/mockDatabase'
import { chiffrer } from '../src/lib/chiffrement'
import { seriesDeGeneration } from '../src/services/mobilaxService'

const CLE_CHIFFREMENT = 'a'.repeat(64)
const BASE = 'https://mobilax.test/v1.0/external'
const BOUTIQUE = 1

const SQL_FOURNISSEUR_API = `SELECT id, nom, (api_key_chiffree IS NOT NULL) AS a_cle FROM fournisseurs WHERE boutique_id = ? AND api_plateforme = ? AND actif = 1 ORDER BY id LIMIT 2`
const SQL_CLE_API = 'SELECT api_key_chiffree FROM fournisseurs WHERE id = ? AND boutique_id = ? AND actif = 1'

function kvMemoire() {
  const m = new Map<string, string>()
  return {
    async get(k: string) { return m.get(k) ?? null },
    async put(k: string, v: string) { m.set(k, v) },
    async delete(k: string) { m.delete(k) },
  }
}

function json(corps: unknown, status = 200, entetes: Record<string, string> = {}) {
  return new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json', ...entetes } })
}

/** Extrait du catalogue des séries : les pièges mesurés en préproduction y sont tous. */
const SERIES = [
  'iPhone 17', 'iPhone 17 Air', 'iPhone 17 Pro', 'iPhone 17 Pro Max', 'iPhone 17e',
  'iPhone 16', 'iPhone 11', 'iPhone 12 Mini',
  'Galaxy S2', 'Galaxy S2 Plus', 'Galaxy S20', 'Galaxy S21 FE', 'Galaxy S25 Ultra',
].map((name, i) => ({ id: 2000 + i, id_range: 7, name, short_name: name, abbreviation: null, position: i }))

let db: ReturnType<typeof createMockDatabase>
let fetchMock: ReturnType<typeof vi.fn>
const deps = () => ({ db, kv: kvMemoire(), cleChiffrement: CLE_CHIFFREMENT, baseUrl: BASE })

beforeEach(async () => {
  db = createMockDatabase()
  db.__setListResponse(SQL_FOURNISSEUR_API, [{ id: 3, nom: 'MOBILAX', a_cle: 1 }])
  db.__setResponse(SQL_CLE_API, { api_key_chiffree: await chiffrer('cle-mobilax-test', CLE_CHIFFREMENT) })
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

/** Mobilax répond : connexion, puis le catalogue des séries (`catalogue` remplace la liste). */
function mobilaxRepond(catalogue: unknown = { status: 'OK', data: SERIES }) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === `${BASE}/auth`) return json({ token: 'jwt-1', expireIn: '1h' })
    if (url === `${BASE}/catalog/series`) return json(catalogue)
    throw new Error(`URL inattendue : ${url}`)
  })
}

const noms = (r: Awaited<ReturnType<typeof seriesDeGeneration>>) => (r.ok ? r.series.map(s => s.nom) : r)

describe('seriesDeGeneration() — correspondance des noms', () => {
  it('« iPhone 17 » → 17, 17 Air, 17 Pro, 17 Pro Max — jamais 17e', async () => {
    mobilaxRepond()
    const r = await seriesDeGeneration(deps(), BOUTIQUE, 'iPhone 17')
    expect(noms(r)).toEqual(['iPhone 17', 'iPhone 17 Air', 'iPhone 17 Pro', 'iPhone 17 Pro Max'])
  })

  it('sortie normalisée { id, nom }', async () => {
    mobilaxRepond()
    const r = await seriesDeGeneration(deps(), BOUTIQUE, 'iPhone 17 Air')
    expect(r).toEqual({ ok: true, series: [{ id: 2001, nom: 'iPhone 17 Air' }] })
  })

  it('« Galaxy S2 » → S2 et S2 Plus, jamais S20 à S25', async () => {
    mobilaxRepond()
    expect(noms(await seriesDeGeneration(deps(), BOUTIQUE, 'Galaxy S2'))).toEqual(['Galaxy S2', 'Galaxy S2 Plus'])
  })

  it('« iPhone 1 » → aucune série', async () => {
    mobilaxRepond()
    expect(await seriesDeGeneration(deps(), BOUTIQUE, 'iPhone 1')).toEqual({ ok: true, series: [] })
  })

  it('insensible à la casse et aux espaces superflus, du texte comme du catalogue', async () => {
    mobilaxRepond({ status: 'OK', data: [
      { id: 1, name: ' iPhone  17 Pro ' }, { id: 2, name: 'IPHONE 17' },
    ] })
    const r = await seriesDeGeneration(deps(), BOUTIQUE, '  iphone   17 ')
    expect(r).toEqual({ ok: true, series: [{ id: 2, nom: 'IPHONE 17' }, { id: 1, nom: 'iPhone 17 Pro' }] })
  })

  it('une série en double dans le catalogue n\'est proposée qu\'une fois', async () => {
    mobilaxRepond({ status: 'OK', data: [{ id: 5, name: 'iPhone 17' }, { id: 5, name: 'iPhone 17' }] })
    expect(await seriesDeGeneration(deps(), BOUTIQUE, 'iPhone 17')).toEqual({ ok: true, series: [{ id: 5, nom: 'iPhone 17' }] })
  })
})

describe('seriesDeGeneration() — fournisseur', () => {
  it('un seul appel au catalogue des séries, aucune recherche de produits (quota intact)', async () => {
    mobilaxRepond()
    await seriesDeGeneration(deps(), BOUTIQUE, 'iPhone 17')
    const urls = fetchMock.mock.calls.map(([u]) => String(u))
    expect(urls.filter(u => u === `${BASE}/catalog/series`)).toHaveLength(1)
    expect(urls.some(u => u.includes('/products'))).toBe(false)
  })

  it('aucun fournisseur connecté : échec nommé, Mobilax jamais appelé', async () => {
    db.__setListResponse(SQL_FOURNISSEUR_API, [])
    const r = await seriesDeGeneration(deps(), BOUTIQUE, 'iPhone 17')
    expect(r).toMatchObject({ ok: false, erreur: 'sans_fournisseur' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('catalogue illisible : indisponible, jamais « aucune série »', async () => {
    mobilaxRepond({ status: 'OK', data: { series: [] } })
    expect(await seriesDeGeneration(deps(), BOUTIQUE, 'iPhone 17')).toMatchObject({ ok: false, erreur: 'indisponible' })
  })

  it('Mobilax en panne (5xx) : indisponible', async () => {
    fetchMock.mockImplementation(async (url: string) => url === `${BASE}/auth`
      ? json({ token: 'jwt-1', expireIn: '1h' }) : json({}, 503))
    expect(await seriesDeGeneration(deps(), BOUTIQUE, 'iPhone 17')).toMatchObject({ ok: false, erreur: 'indisponible' })
  })

  it('quota atteint (connexion) : signal quota avec le délai annoncé', async () => {
    fetchMock.mockImplementation(async () => json({}, 429, { 'ratelimit-reset': '42' }))
    expect(await seriesDeGeneration(deps(), BOUTIQUE, 'iPhone 17'))
      .toMatchObject({ ok: false, erreur: 'quota', reessayer_dans_s: 42 })
  })

  it('texte vide après nettoyage : aucune série, Mobilax jamais appelé', async () => {
    expect(await seriesDeGeneration(deps(), BOUTIQUE, '   ')).toEqual({ ok: true, series: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
