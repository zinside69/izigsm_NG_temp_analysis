/**
 * @file tests/e2e/roles-manager.spec.ts
 * @description Le manager dirige sa boutique (décision de l'exploitant du 2026-10-01) — preuve sur
 * la VRAIE base locale : il clôture sa caisse (NF525), vérifie l'intégrité de la chaîne, lit le
 * rapport comptable et les statistiques par technicien.
 *
 * Avant le correctif, ces routes exigeaient un rôle `gerant` qui n'a jamais existé : 403 « Rôles
 * requis » pour tout manager. Les tests de route (`tests/roles-manager-routes.test.ts`) le prouvent
 * sur base simulée ; celui-ci prouve le geste métier de bout en bout, clôture écrite comprise.
 */
import { test, expect } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'

test('un manager clôture sa caisse, vérifie l\'intégrité et lit ses rapports', async ({ request }) => {
  const tenant  = await createTenantAdmin(request)   // compte manager d'une boutique neuve
  const headers = { Authorization: `Bearer ${tenant.accessToken}` }

  // Une vente du jour, pour que la clôture ait une transaction à sceller
  const vente = await request.post('/api/caisse/vente', { headers, data: { mode_paiement: 'especes', lignes: [
    { designation: 'Protection écran E2E', quantite: 1, prix_unitaire_ht: 10, tva_taux: 20 },
  ] } })
  expect(vente.status(), await vente.text()).toBe(201)

  const cloture = await request.post('/api/caisse/cloture', { headers, data: {} })
  const corpsCloture = await cloture.text()
  expect(corpsCloture).not.toContain('Rôles requis')
  expect(cloture.status(), corpsCloture).toBe(201)
  expect(JSON.parse(corpsCloture).data.hash_cloture).toMatch(/^[0-9a-f]{64}$/)

  const integrite = await request.get('/api/caisse/integrite', { headers })
  expect(integrite.status(), await integrite.text()).toBe(200)

  for (const chemin of ['/api/stats/rapport-comptable', '/api/stats/techniciens']) {
    const res = await request.get(chemin, { headers })
    expect(res.status(), `${chemin} : ${await res.text()}`).toBe(200)
  }
})
