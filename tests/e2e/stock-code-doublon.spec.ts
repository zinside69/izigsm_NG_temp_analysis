/**
 * @file tests/e2e/stock-code-doublon.spec.ts
 * @description Un code-barres, un produit ; un SKU, un produit (ticket 01 du chantier
 * `vente-lit-catalogue`, story 36).
 *
 * La migration 0048 fait refuser un doublon par la base. Sans conversion, l'opérateur recevait
 * une erreur de base de données. Désormais la création et la modification répondent 409, avec un
 * message qui **nomme** le produit qui porte déjà le code.
 *
 * Prouvé contre la VRAIE D1 locale (migration 0048 appliquée), boutique neuve à chaque test : le
 * message réel du moteur doit être reconnu — une base simulée ne le prouverait pas.
 * Fenêtres `.modal-overlay` : fermées par opacité 0, jamais `toBeVisible()` (`CLAUDE.md`).
 */
import { test, expect } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

test('code-barres déjà porté : création et modification refusées en nommant le produit', async ({ request }) => {
  const tenant  = await createTenantAdmin(request)
  const headers = { Authorization: `Bearer ${tenant.accessToken}` }

  const premier = await request.post('/api/produits', {
    headers, data: { nom: 'E2E coque d\'origine', code_barre: '3700275472140', stock_minimum: 0 },
  })
  expect(premier.status(), await premier.text()).toBe(201)
  const idPremier = (await premier.json()).id

  // Création d'un second produit au même code-barres : refus nommant le premier
  const doublon = await request.post('/api/produits', {
    headers, data: { nom: 'E2E doublon', code_barre: '3700275472140', stock_minimum: 0 },
  })
  expect(doublon.status(), await doublon.text()).toBe(409)
  expect(await doublon.json()).toMatchObject({
    success:    false,
    champ:      'code_barre',
    produit_id: idPremier,
    error:      `Ce code-barres est déjà utilisé par « E2E coque d'origine » (produit n° ${idPremier}).`,
  })
  const kpis = await (await request.get('/api/produits/kpis', { headers })).json()
  expect(kpis.data.nb_produits).toBe(1)

  // Modification d'un autre produit vers ce code-barres : refus, son code ne bouge pas
  const autre = await request.post('/api/produits', {
    headers, data: { nom: 'E2E autre coque', code_barre: '3700275472157', stock_minimum: 0 },
  })
  expect(autre.status(), await autre.text()).toBe(201)
  const idAutre = (await autre.json()).id

  const refusMaj = await request.put(`/api/produits/${idAutre}`, { headers, data: { code_barre: '3700275472140' } })
  expect(refusMaj.status(), await refusMaj.text()).toBe(409)
  expect((await refusMaj.json()).produit_id).toBe(idPremier)
  const relu = (await (await request.get(`/api/produits/${idAutre}`, { headers })).json()).data
  expect(relu.code_barre).toBe('3700275472157')

  // Un produit supprimé libère son code
  expect((await request.delete(`/api/produits/${idPremier}`, { headers })).status()).toBe(200)
  const apresSuppression = await request.post('/api/produits', {
    headers, data: { nom: 'E2E remplaçant', code_barre: '3700275472140', stock_minimum: 0 },
  })
  expect(apresSuppression.status(), await apresSuppression.text()).toBe(201)
})

test('fiche produit : un SKU déjà porté est refusé à l\'écran, en nommant le produit', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const cree = await request.post('/api/produits', {
    headers: { Authorization: `Bearer ${tenant.accessToken}` },
    data:    { nom: 'E2E verre trempé', sku: 'E2E-VT-IP12', stock_minimum: 0 },
  })
  expect(cree.status(), await cree.text()).toBe(201)
  const idExistant = (await cree.json()).id

  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/stock')

  await page.evaluate('openNewStock()')
  await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '1')
  await page.fill('#stock-name', 'E2E verre trempé en double')
  await page.fill('#stock-reference', 'E2E-VT-IP12')
  await page.locator('#modal-stock button', { hasText: 'Enregistrer' }).click()

  // Le message nomme le produit existant ; la fiche reste ouverte pour corriger
  await expect(page.locator('.flash.error')).toHaveText(
    `Erreur: Ce SKU est déjà utilisé par « E2E verre trempé » (produit n° ${idExistant}).`,
  )
  await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '1')
})
