import { describe, it, expect } from 'vitest'
import app from '../src/index'
import { createMockD1 } from './helpers/mockD1'
import { generateTokenPair } from '../src/lib/auth'

/**
 * PUT /api/boutiques/:id/marges — taux de marge par boutique (ticket 02, chantier Mobilax).
 *
 * Route dédiée, et non un champ de plus sur `PUT /:id/settings` : cette dernière appelle
 * toujours `updateBoutiqueSettings()`, qui assigne la TVA et les paiements sans COALESCE.
 * Un corps ne portant que les marges y remettrait la TVA à 20 % et décocherait les moyens
 * de paiement (`bugs.md`, défaut consigné le 2026-09-10).
 *
 * Observé de l'extérieur : le statut HTTP, et ce que la route a réellement écrit en base.
 */

const SECRET = 'secret-de-test'

const MARGES_VALIDES = {
  marge_taux_defaut: 30, marge_taux_piece: null, marge_taux_accessoire: 80,
  marge_taux_appareil: null, marge_taux_consommable: 0,
}

/** SQL de `getBoutiqueById()` — répliqué car le mock matche sur la requête exacte. */
const SQL_BOUTIQUE_ACTIVE = 'SELECT * FROM boutiques WHERE id = ? AND actif = 1'

/**
 * Requête authentifiée contre l'application réelle ; renvoie aussi la base simulée.
 * Par défaut, la boutique visée existe (`boutiqueExiste: false` pour simuler l'inverse).
 */
async function appeler(
  compte: { role: string; boutique_id: number | null },
  chemin: string,
  corps: unknown,
  { boutiqueExiste = true }: { boutiqueExiste?: boolean } = {},
) {
  const d1 = createMockD1()
  if (boutiqueExiste) d1.__setResponseFn(SQL_BOUTIQUE_ACTIVE, (params) => ({ id: params[0], actif: 1 }))
  const { accessToken } = await generateTokenPair(
    { id: 7, email: 'gerant@boutique.fr', prenom: 'Gerant', nom: 'Test', ...compte } as any,
    SECRET,
  )
  const res = await app.request(
    chemin,
    {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body:    JSON.stringify(corps),
    },
    { DB: d1, JWT_SECRET: SECRET } as any,
    { waitUntil: () => {}, passThroughOnException: () => {} } as any,
  )
  return { res, d1 }
}

/** Écritures des taux de marge effectivement envoyées à la base. */
function ecrituresMarge(d1: ReturnType<typeof createMockD1>) {
  return d1.__getCalls().filter(c => c.sql.includes('marge_taux_defaut'))
}

describe('PUT /api/boutiques/:id/marges', () => {
  it('enregistre les cinq taux sur la boutique du manager', async () => {
    const { res, d1 } = await appeler({ role: 'manager', boutique_id: 1 }, '/api/boutiques/1/marges', MARGES_VALIDES)

    expect(res.status).toBe(200)
    const ecritures = ecrituresMarge(d1)
    expect(ecritures).toHaveLength(1)
    expect(ecritures[0].params).toEqual([30, null, 80, null, 0, 1])
  })

  it('ne touche ni la TVA ni les moyens de paiement', async () => {
    const { d1 } = await appeler({ role: 'manager', boutique_id: 1 }, '/api/boutiques/1/marges', MARGES_VALIDES)

    const autres = d1.__getCalls().filter(c => /tva_taux_defaut|paiement_/.test(c.sql))
    expect(autres).toHaveLength(0)
  })

  it('traite une famille absente du corps comme non fixée (remplacement complet)', async () => {
    const { res, d1 } = await appeler({ role: 'manager', boutique_id: 1 }, '/api/boutiques/1/marges', { marge_taux_defaut: 25 })

    expect(res.status).toBe(200)
    expect(ecrituresMarge(d1)[0].params).toEqual([25, null, null, null, null, 1])
  })

  describe('isolation', () => {
    it('refuse en 403 un manager qui vise une autre boutique, sans rien écrire', async () => {
      const { res, d1 } = await appeler({ role: 'manager', boutique_id: 1 }, '/api/boutiques/2/marges', MARGES_VALIDES)

      expect(res.status).toBe(403)
      expect(ecrituresMarge(d1)).toHaveLength(0)
    })

    it('refuse aussi un admin rattaché à une boutique qui en vise une autre', async () => {
      const { res, d1 } = await appeler({ role: 'admin', boutique_id: 1 }, '/api/boutiques/2/marges', MARGES_VALIDES)

      expect(res.status).toBe(403)
      expect(ecrituresMarge(d1)).toHaveLength(0)
    })

    it('laisse l\'admin plateforme écrire sur la boutique consultée', async () => {
      const { res, d1 } = await appeler({ role: 'admin', boutique_id: null }, '/api/boutiques/2/marges', MARGES_VALIDES)

      expect(res.status).toBe(200)
      expect(ecrituresMarge(d1)[0].params.at(-1)).toBe(2)
    })

    it('répond 404 à l\'admin plateforme qui vise une boutique inexistante, sans rien écrire', async () => {
      // Sans ce contrôle, l'UPDATE ne touchait aucune ligne et la route annonçait
      // « mis à jour » — relevé en revue le 2026-09-10.
      const { res, d1 } = await appeler(
        { role: 'admin', boutique_id: null }, '/api/boutiques/999/marges', MARGES_VALIDES,
        { boutiqueExiste: false },
      )

      expect(res.status).toBe(404)
      expect(ecrituresMarge(d1)).toHaveLength(0)
    })

    it('refuse un technicien, même sur sa propre boutique', async () => {
      const { res, d1 } = await appeler({ role: 'technicien', boutique_id: 1 }, '/api/boutiques/1/marges', MARGES_VALIDES)

      expect(res.status).toBe(403)
      expect(ecrituresMarge(d1)).toHaveLength(0)
    })
  })

  describe('validation', () => {
    for (const [cas, valeur] of [
      ['négatif',        -5],
      ['non numérique',  'trente'],
      // Un champ de formulaire vide doit arriver en `null`, jamais en chaîne vide
      ['chaîne vide',    ''],
    ] as const) {
      it(`refuse en 422 un taux ${cas}, sans rien écrire`, async () => {
        const { res, d1 } = await appeler(
          { role: 'manager', boutique_id: 1 },
          '/api/boutiques/1/marges',
          { ...MARGES_VALIDES, marge_taux_piece: valeur },
        )

        expect(res.status).toBe(422)
        const corps = await res.json() as { success: boolean; error: string }
        expect(corps.success).toBe(false)
        expect(corps.error).toContain('marge_taux_piece')
        expect(ecrituresMarge(d1)).toHaveLength(0)
      })
    }
  })
})
