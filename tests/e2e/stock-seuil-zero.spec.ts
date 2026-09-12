/**
 * @file tests/e2e/stock-seuil-zero.spec.ts
 * @description Seuil d'alerte à 0 = produit non surveillé (décision du 2026-09-12).
 *
 * Une pièce Mobilax importée naît à stock 0 et seuil 0 ; la règle `stock_actuel <=
 * stock_minimum` la rendait « à commander » dès l'import. Prouvé contre la VRAIE D1 locale —
 * la règle vit dans le SQL, et les mocks du dépôt rendent ce qu'on leur configure.
 *
 * Deux produits dans une boutique neuve : l'un à 0/0 (ne doit alerter nulle part), l'autre à
 * 1/2 (témoin : doit alerter partout). Chaque compteur doit donc valoir exactement 1.
 */
import { test, expect } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

test('seuil 0 : ni « à commander », ni stock bas — le témoin sous son seuil, lui, alerte', async ({ page, request }) => {
  const tenant  = await createTenantAdmin(request)
  const headers = { Authorization: `Bearer ${tenant.accessToken}` }

  for (const produit of [
    { nom: 'E2E seuil zéro',  stock_actuel: 0, stock_minimum: 0 },
    { nom: 'E2E sous seuil',  stock_actuel: 1, stock_minimum: 2 },
  ]) {
    const res = await request.post('/api/produits', { headers, data: produit })
    expect(res.status(), await res.text()).toBe(201)
  }

  // Liste « À commander » et son compteur (écran Fournisseurs)
  const aCommander = await (await request.get('/api/fournisseurs/a-commander', { headers })).json()
  expect(aCommander.data.map((p: any) => p.nom)).toEqual(['E2E sous seuil'])
  const kpisF = await (await request.get('/api/fournisseurs/kpis', { headers })).json()
  expect(kpisF.data.nb_produits_a_commander).toBe(1)

  // Filtre « stock bas » de la liste des produits
  const filtre = await (await request.get('/api/produits?stock_bas=true', { headers })).json()
  expect(filtre.data.map((p: any) => p.nom)).toEqual(['E2E sous seuil'])

  // Indicateurs boutique et tableau de bord
  const statsB = await (await request.get(`/api/boutiques/${tenant.boutiqueId}/stats`, { headers })).json()
  expect(statsB.data.produits_stock_bas).toBe(1)
  const statsD = await (await request.get('/api/stats', { headers })).json()
  expect(statsD.data.stock_bas).toBe(1)

  // À l'écran : le rappel de /fournisseurs compte le seul témoin
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/fournisseurs')
  await expect(page.locator('#badge-a-commander')).toHaveText('1 produit sous le seuil', { timeout: 15_000 })
})
