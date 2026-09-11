import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import app from '../src/index'
import { createMockD1 } from './helpers/mockD1'
import { generateTokenPair } from '../src/lib/auth'

/**
 * POST /api/notifications/test — bouton « Envoyer test » de l'onglet Emails des réglages.
 *
 * Défaut trouvé le 2026-09-11 : la route ne transmettait pas la clé Resend globale
 * (`RESEND_API_KEY`) à `sendEmail()`, alors que TOUS les envois réels le font (tickets,
 * SAV, facturation, relances). Une boutique sans clé propre — le cas normal depuis le
 * repli plateforme du 2026-07-10 — voyait donc « Mode simulé » en permanence, et
 * l'exploitant concluait à tort qu'aucun email ne partait.
 *
 * Observé de l'extérieur : l'appel réellement adressé à Resend (fetch simulé), et la
 * réponse de la route.
 */

const SECRET = 'secret-de-test'
const CLE_GLOBALE = 're_cle_globale_de_test'

/** Réponse de Resend à un envoi accepté. */
const RESEND_OK = () => new Response(JSON.stringify({ id: 're_msg_test' }), {
  status: 200, headers: { 'Content-Type': 'application/json' },
})

let fetchSimule: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSimule = vi.fn(async () => RESEND_OK())
  vi.stubGlobal('fetch', fetchSimule)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Manager de la boutique 1, qui n'a pas de clé Resend propre (base simulée vide). */
async function envoyerTest(env: Record<string, unknown>) {
  const { accessToken } = await generateTokenPair(
    { id: 7, email: 'gerant@boutique.fr', role: 'manager', boutique_id: 1, prenom: 'Gerant', nom: 'Test' } as any,
    SECRET,
  )
  const res = await app.request(
    '/api/notifications/test',
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body:    JSON.stringify({ to: 'destinataire@exemple.fr' }),
    },
    { DB: createMockD1(), JWT_SECRET: SECRET, ...env } as any,
    { waitUntil: () => {}, passThroughOnException: () => {} } as any,
  )
  return { res, corps: await res.json() as { success: boolean; simulated: boolean } }
}

/** Appels réellement adressés à l'API Resend. */
const appelsResend = () => fetchSimule.mock.calls.filter(([url]) => String(url).includes('api.resend.com'))

describe('POST /api/notifications/test', () => {
  it('envoie par la clé globale quand la boutique n\'a pas de clé propre', async () => {
    const { res, corps } = await envoyerTest({ RESEND_API_KEY: CLE_GLOBALE })

    expect(res.status).toBe(200)
    expect(corps.simulated, 'la clé globale existe : l\'envoi ne doit pas être simulé').toBe(false)
    expect(corps.success).toBe(true)

    const appels = appelsResend()
    expect(appels).toHaveLength(1)
    const [, init] = appels[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${CLE_GLOBALE}`)
  })

  it('reste simulé, sans appeler Resend, quand aucune clé n\'existe', async () => {
    // Garde-fou : le correctif ne doit pas inventer d'envoi en l'absence de toute clé.
    const { corps } = await envoyerTest({})

    expect(corps.simulated).toBe(true)
    expect(appelsResend()).toHaveLength(0)
  })
})
