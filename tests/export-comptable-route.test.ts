import { describe, it, expect } from 'vitest'
import app from '../src/index'
import { createMockD1 } from './helpers/mockD1'
import { generateTokenPair } from '../src/lib/auth'

/**
 * GET /api/stats/export/xlsx — route de l'export comptable Excel (ticket 001
 * `export-comptable-mensuel`, 2026-10-02). Observé : statut HTTP et en-têtes de la réponse.
 * Le contenu du classeur est prouvé par `export-comptable-mensuel.test.ts` (vrai SQLite) et par la
 * relecture `openpyxl` du fichier réel en E2E.
 */

const SECRET = 'secret-de-test'

async function appeler(compte: { role: string; boutique_id: number | null } | null, chemin: string) {
  const headers: Record<string, string> = {}
  if (compte) {
    const { accessToken } = await generateTokenPair(
      { id: 7, email: 'compte@boutique.fr', prenom: 'C', nom: 'T', ...compte } as any, SECRET)
    headers.Authorization = `Bearer ${accessToken}`
  }
  return app.request(chemin, { headers }, { DB: createMockD1(), JWT_SECRET: SECRET } as any,
    { waitUntil: () => {}, passThroughOnException: () => {} } as any)
}

const MANAGER = { role: 'manager', boutique_id: 1 }

describe('GET /api/stats/export/xlsx', () => {
  it('manager : un classeur .xlsx en pièce jointe, nommé d\'après le mois', async () => {
    const res = await appeler(MANAGER, '/api/stats/export/xlsx?from=2026-09-01&to=2026-09-30')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="export-comptable_.*_2026-09\.xlsx"/)
    const octets = new Uint8Array(await res.arrayBuffer())
    expect([octets[0], octets[1]]).toEqual([0x50, 0x4b])
  })

  it('technicien : refusé (document comptable de gestion)', async () => {
    expect((await appeler({ role: 'technicien', boutique_id: 1 }, '/api/stats/export/xlsx')).status).toBe(403)
  })

  it('sans jeton : 401', async () => {
    expect((await appeler(null, '/api/stats/export/xlsx')).status).toBe(401)
  })

  for (const [cas, qs] of [
    ['format de date', 'from=2026-9-1&to=2026-09-30'],
    ['date inexistante', 'from=2026-02-30&to=2026-03-01'],
    ['début après fin', 'from=2026-09-30&to=2026-09-01'],
    ['période > 366 jours', 'from=2025-01-01&to=2026-09-30'],
  ]) {
    it(`période invalide (${cas}) : 400`, async () => {
      expect((await appeler(MANAGER, `/api/stats/export/xlsx?${qs}`)).status).toBe(400)
    })
  }
})
