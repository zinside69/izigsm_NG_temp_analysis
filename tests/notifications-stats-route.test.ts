import { describe, it, expect } from 'vitest'
import app from '../src/index'
import { createMockD1 } from './helpers/mockD1'
import { generateTokenPair } from '../src/lib/auth'

/**
 * GET /api/notifications/stats — ce que la page Notifications lit pour annoncer l'état
 * des envois.
 *
 * Défaut trouvé le 2026-09-16, vu à l'écran en production : le bandeau affichait « Mode
 * simulé — aucune clé API » pendant qu'un email de test **arrivait réellement**. La route
 * appelait `getEmailConfig(db, boutiqueId)` **sans** la clé de repli `RESEND_API_KEY`, si
 * bien que `api_key_set` ne décrivait que la clé de la boutique — jamais celle qui envoie
 * vraiment. Même oubli que sur `POST /notifications/test`, corrigé le 2026-09-11
 * (`notifications-test-route.test.ts`) : la règle n'avait pas été étendue à `getEmailConfig()`.
 *
 * Observé de l'extérieur : la réponse de la route, seule chose que l'écran puisse lire.
 */

const SECRET = 'secret-de-test'
const CLE_PLATEFORME = 're_cle_plateforme_de_test'

interface ConfigRendue {
  api_key_set:    boolean
  api_key_source: 'boutique' | 'plateforme' | null
  from:           string
}

/** Manager de la boutique 1, qui n'a pas de clé Resend propre (base simulée vide). */
async function lireStats(env: Record<string, unknown>) {
  const { accessToken } = await generateTokenPair(
    { id: 7, email: 'gerant@boutique.fr', role: 'manager', boutique_id: 1, prenom: 'Gerant', nom: 'Test' } as any,
    SECRET,
  )
  const res = await app.request(
    '/api/notifications/stats',
    { headers: { Authorization: `Bearer ${accessToken}` } },
    { DB: createMockD1(), JWT_SECRET: SECRET, ...env } as any,
    { waitUntil: () => {}, passThroughOnException: () => {} } as any,
  )
  // Lu en texte puis parsé : le corps ne se consomme qu'une fois, et le test de fuite de
  // secret doit pouvoir inspecter la réponse **entière**, pas seulement les champs attendus.
  const brut  = await res.text()
  const corps = JSON.parse(brut) as { success: boolean; data: { config: ConfigRendue } }
  return { res, brut, config: corps.data?.config }
}

describe('GET /api/notifications/stats — origine de la clé employée', () => {
  it('annonce la clé de la plateforme quand la boutique n\'a pas la sienne', async () => {
    const { res, config } = await lireStats({ RESEND_API_KEY: CLE_PLATEFORME })

    expect(res.status).toBe(200)
    expect(config.api_key_source, 'les envois passent par la clé plateforme').toBe('plateforme')
    // `api_key_set` reste vrai : des emails partent réellement
    expect(config.api_key_set).toBe(true)
    // L'expéditeur annoncé est celui du domaine vérifié de la plateforme
    expect(config.from).toContain('via iziGSM')
  })

  it('n\'annonce une absence de clé que si la plateforme n\'en a pas non plus', async () => {
    const { config } = await lireStats({})

    expect(config.api_key_source).toBeNull()
    expect(config.api_key_set).toBe(false)
  })

  it('ne renvoie jamais la clé elle-même, sous aucune forme', async () => {
    const { brut } = await lireStats({ RESEND_API_KEY: CLE_PLATEFORME })
    expect(brut).not.toContain(CLE_PLATEFORME)
  })
})
