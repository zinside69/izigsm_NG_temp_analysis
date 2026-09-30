import { describe, it, expect } from 'vitest'
import app from '../src/index'
import { createMockD1 } from './helpers/mockD1'
import { generateTokenPair } from '../src/lib/auth'

/**
 * `GET /api/catalogue/recherche?scan=` (ticket 04 `vente-lit-catalogue`) : la route applique
 * `routerScan()` et rend `{ type_scan, resultats }`. Ce fichier prouve l'aiguillage et les refus ;
 * la règle SQL de l'égalité stricte est prouvée contre un vrai SQLite
 * (`tests/catalogue-scan-sqlite.test.ts`) — le mock D1 rend ce qu'on lui configure quelle que soit
 * la requête, il ne sert ici qu'à observer QUELLE requête part, et si une requête part.
 */

const SECRET = 'secret-de-test'
const EAN = '3760123456789'

async function appeler(chemin: string) {
  const d1 = createMockD1()
  const { accessToken } = await generateTokenPair(
    { id: 7, email: 'x@boutique.fr', prenom: 'X', nom: 'Test', role: 'manager', boutique_id: 1 } as any, SECRET,
  )
  const res = await app.request(
    chemin,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    { DB: d1, JWT_SECRET: SECRET } as any,
    { waitUntil: () => {}, passThroughOnException: () => {} } as any,
  )
  return { res, appels: d1.__getCalls() }
}

describe('GET /api/catalogue/recherche?scan=', () => {
  it('13 chiffres → type_scan code_barre, recherche par égalité sur code-barres ou SKU', async () => {
    const { res, appels } = await appeler(`/api/catalogue/recherche?scan=${EAN}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { type_scan: 'code_barre', resultats: [] } })
    const sql = appels.map(a => a.sql).join('\n')
    expect(sql).toMatch(/code_barre = \? OR sku = \?/)
    expect(sql).not.toMatch(/LIKE/)
    expect(appels.some(a => (a.params as unknown[]).includes(EAN))).toBe(true)
  })

  // AVANT (2026-09-30, ticket 04) : « 15 chiffres → type_scan imei, liste vide, AUCUNE requête
  // (branché au ticket 07) » — le ticket 07 branche la recherche par IMEI, le test suit.
  it('IMEI à clé juste → type_scan imei, recherche par égalité sur l\'IMEI du produit', async () => {
    const { res, appels } = await appeler('/api/catalogue/recherche?scan=356938035643809')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { type_scan: 'imei', resultats: [] } })
    expect(appels.map(a => a.sql).join('\n')).toMatch(/imei = \?/)
  })

  it('IMEI à clé de Luhn fausse → imei_invalide, AUCUNE requête (story 38)', async () => {
    const { res, appels } = await appeler('/api/catalogue/recherche?scan=356938035643800')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: { type_scan: 'imei', resultats: [], imei_invalide: true } })
    expect(appels).toEqual([])
  })

  it('autre saisie → type_scan texte, même recherche que ?q=', async () => {
    const { res, appels } = await appeler('/api/catalogue/recherche?scan=coque')
    expect(res.status).toBe(200)
    const corps = await res.json() as any
    expect(corps.data.type_scan).toBe('texte')
    expect(Array.isArray(corps.data.resultats)).toBe(true)
    expect(appels.map(a => a.sql).join('\n')).toMatch(/LIKE/)
  })

  it('scan vide → 400 sans requête', async () => {
    const { res, appels } = await appeler('/api/catalogue/recherche?scan=%20%20')
    expect(res.status).toBe(400)
    expect(appels).toEqual([])
  })

  it('scan ET q ensemble → 400 sans requête', async () => {
    const { res, appels } = await appeler(`/api/catalogue/recherche?scan=${EAN}&q=coque`)
    expect(res.status).toBe(400)
    expect(appels).toEqual([])
  })

  it('?q= seul : contrat inchangé (data = liste)', async () => {
    const { res } = await appeler('/api/catalogue/recherche?q=coque')
    expect(res.status).toBe(200)
    expect(Array.isArray((await res.json() as any).data)).toBe(true)
  })
})
