/**
 * @file tests/e2e/stock-recherche-filtres.spec.ts
 * @description Page Stock — recherche, filtres de famille et filtres de stock (signalé par
 * l'exploitant le 2026-09-15, production `izigsm-v3.06`) : « Références 100 », mais « iphone 12 »
 * dans la recherche → « Aucun produit trouvé » ; filtres de famille sans effet ; « Tous » sans effet.
 *
 * Boucle de diagnostic (`/diagnosing-bugs`) : chaque symptôme a son propre contrôle, pour que le
 * premier rouge désigne le geste en cause. Produits créés par l'API, à l'image de la boutique de
 * l'exploitant : pièces importées à stock 0, un accessoire en stock. Boutique neuve par test.
 *
 * Cause mesurée en production le 2026-09-15 : 795 produits, la page n'en chargeait que 100 — elle
 * demandait `limit: 200`, le serveur plafonne une page à 100 (`lib/db.ts`) et la page ne lisait pas
 * la pagination. Recherche, filtres et compteur « Références » ne voyaient que ces 100 produits,
 * triés par nom : « Batterie Samsung… » en tête, les écrans iPhone au-delà. Le second test en est la
 * reproduction ; le premier, écrit avant la mesure, restait vert avec 3 produits.
 */
import { test, expect } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

const PRODUITS = [
  { nom: 'Ecran Tactile Apple iPhone 12 Pro Max Noir', famille: 'piece',      stock_actuel: 0, stock_minimum: 0 },
  { nom: 'Batterie Apple iPhone 11',                  famille: 'piece',      stock_actuel: 0, stock_minimum: 0 },
  { nom: 'Coque Samsung Galaxy S24',                  famille: 'accessoire', stock_actuel: 5, stock_minimum: 1 },
]

test('Stock : la liste, la recherche et les filtres montrent les bons produits', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const headers = { Authorization: `Bearer ${tenant.accessToken}` }
  for (const p of PRODUITS) {
    const res = await request.post('/api/produits', { headers, data: p })
    expect(res.status(), await res.text()).toBe(201)
  }
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/stock')

  const liste = page.locator('#stock-tbody')
  const [iphone12, iphone11, coque] = PRODUITS.map(p => p.nom)

  // 1. Sans filtre : les trois produits
  await expect(liste).toContainText(iphone12)
  await expect(liste).toContainText(iphone11)
  await expect(liste).toContainText(coque)

  // 2. Recherche « iphone 12 » (casse de l'exploitant) : le seul iPhone 12
  await page.fill('#search-stock', 'iphone 12')
  await expect(liste).toContainText(iphone12)
  await expect(liste).not.toContainText(iphone11)
  await expect(liste).not.toContainText(coque)
  await page.fill('#search-stock', '')
  await expect(liste).toContainText(coque)

  // 3. Famille « Pièce » : l'accessoire sort ; « Toutes » le fait revenir
  await page.click('.btn-famille[data-f="piece"]')
  await expect(liste).toContainText(iphone12)
  await expect(liste).not.toContainText(coque)
  await page.click('.btn-famille[data-f=""]')
  await expect(liste).toContainText(coque)

  // 4. « Rupture » : seulement les produits à 0 ; « Tous » fait tout revenir
  await page.click('[data-filter-stock="out"]')
  await expect(liste).toContainText(iphone12)
  await expect(liste).not.toContainText(coque)
  await page.click('[data-filter-stock="all"]')
  await expect(liste).toContainText(coque)
  await expect(liste).toContainText(iphone11)
})

/** « Ecran… iPhone 12 », rangé 105e par nom derrière 104 « Batterie… » — hors de la première page de 100. */
const IPHONE_12 = 'Ecran Tactile E2E Apple iPhone 12 Noir'

/**
 * Boutique neuve de 105 produits (import CSV) : 104 « Batterie E2E Samsung 000…103 » puis l'écran
 * iPhone 12 — comme les écrans iPhone de l'exploitant derrière ses batteries Samsung. Page Stock ouverte.
 */
async function stockDe105Produits(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
  const tenant = await createTenantAdmin(request)
  const headers = { Authorization: `Bearer ${tenant.accessToken}` }
  const lignes = ['nom,prix_achat_ht,stock_actuel,stock_minimum']
  for (let i = 0; i < 104; i++) lignes.push(`Batterie E2E Samsung ${String(i).padStart(3, '0')},10,0,0`)
  lignes.push(`${IPHONE_12},40,0,0`)
  const res = await request.post('/api/produits/import-csv', { headers, data: { csvContent: lignes.join('\n') } })
  expect(res.status(), await res.text()).toBe(200)
  expect(await res.json()).toMatchObject({ imported: 105, skipped: 0 })

  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/stock')
}

test('Stock : plus de 100 produits — tous chargés, la recherche trouve celui rangé au-delà du 100e', async ({ page, request }) => {
  await stockDe105Produits(page, request)

  // Le compteur dit le nombre réel de références, pas celui de la première page
  await expect(page.locator('#kpi-refs')).toHaveText('105')
  await page.fill('#search-stock', 'iphone 12')
  await expect(page.locator('#stock-tbody')).toContainText(IPHONE_12)
})

test('Stock : la recherche reste appliquée après un clic sur une famille ou sur « Tous » (capture du 2026-09-15)', async ({ page, request }) => {
  await stockDe105Produits(page, request)
  const liste = page.locator('#stock-tbody')
  await expect(page.locator('#kpi-refs')).toHaveText('105')

  // Geste de l'exploitant : la recherche d'abord, puis la famille « Pièce »
  await page.fill('#search-stock', 'iphone 12')
  await expect(liste).not.toContainText('Batterie E2E Samsung 000')
  await page.click('.btn-famille[data-f="piece"]')
  // Le clic RECHARGE la liste (famille filtrée par le serveur, pages de 100) : juger après le
  // rechargement, sinon l'ancienne vue encore filtrée suffit à faire passer le test
  await page.waitForLoadState('networkidle')
  await expect(liste).toContainText(IPHONE_12)
  await expect(liste).not.toContainText('Batterie E2E Samsung 000')

  // Puis « Tous » : la recherche tient toujours
  await page.click('[data-filter-stock="all"]')
  await page.waitForLoadState('networkidle')
  await expect(liste).toContainText(IPHONE_12)
  await expect(liste).not.toContainText('Batterie E2E Samsung 000')
})

test('Stock : les compteurs suivent la liste affichée — recherche et filtres compris (décision du 2026-09-15)', async ({ page, request }) => {
  await stockDe105Produits(page, request)
  const references = page.locator('#kpi-refs')
  await expect(references).toHaveText('105')

  // « iphone 12 » : une seule référence affichée, un seul compté
  await page.fill('#search-stock', 'iphone 12')
  await expect(page.locator('#stock-tbody')).toContainText(IPHONE_12)
  await expect(references).toHaveText('1')

  // Recherche vidée : toute la boutique
  await page.fill('#search-stock', '')
  await expect(references).toHaveText('105')

  // Filtre « À commander » : aucun des 105 produits n'est surveillé (seuil 0) — le compteur le dit
  await page.click('[data-filter-stock="low"]')
  await expect(references).toHaveText('0')
  // « Tous » : retour à toute la boutique
  await page.click('[data-filter-stock="all"]')
  await expect(references).toHaveText('105')
})

test('Stock : une recherche saisie pendant le chargement de la liste reste appliquée', async ({ page, request }) => {
  // Page 2 de la liste retenue : la recherche est saisie pendant que le chargement est en cours —
  // chez l'exploitant, 8 pages à charger laissent largement le temps de taper « iphone 12 »
  let libererPage2!: () => void
  const page2Retenue = new Promise<void>(r => { libererPage2 = r })
  let page2Demandee = false
  await page.route(url => url.pathname === '/api/produits' && url.searchParams.get('page') === '2', async route => {
    page2Demandee = true
    await page2Retenue
    await route.continue()
  })

  await stockDe105Produits(page, request)
  await expect.poll(() => page2Demandee).toBe(true)
  await page.fill('#search-stock', 'iphone 12')
  libererPage2()
  await page.waitForLoadState('networkidle')

  const liste = page.locator('#stock-tbody')
  await expect(liste).toContainText(IPHONE_12)
  await expect(liste).not.toContainText('Batterie E2E Samsung 000')
  // Compteurs = liste affichée (décision B du 2026-09-15) : l'écran iPhone 12 seul
  await expect(page.locator('#kpi-refs')).toHaveText('1')
})
