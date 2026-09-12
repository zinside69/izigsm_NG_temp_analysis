/**
 * @file tests/e2e/stock-seuil-defaut-creation.spec.ts
 * @description Seuil d'alerte par défaut à la création manuelle + rappel sur la page Stock
 *              (ticket 03, chantier `reglages-stock-boutique`, décisions du 2026-09-12).
 *
 * Un produit créé sans seuil explicite prenait 5 (repli codé en dur) et le formulaire proposait
 * 2 : aucune de ces valeurs n'était choisie par la boutique. Désormais les deux suivent le seuil
 * d'alerte par défaut de la boutique — 0 (non surveillé) tant qu'elle n'a rien réglé. Tant que ce
 * seuil n'a jamais été enregistré (`NULL`), la page Stock le rappelle ; un 0 enregistré est un
 * choix, le rappel disparaît.
 *
 * Prouvé contre la VRAIE D1 locale, boutique neuve par test : la valeur par défaut est lue en SQL
 * au moment de la création, et les mocks du dépôt rendent ce qu'on leur configure.
 */
import { test, expect } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

test.describe('Seuil d\'alerte par défaut — création manuelle', () => {
  test('API : sans seuil dans la requête, le produit prend le réglage de la boutique — jamais 5', async ({ request }) => {
    const tenant  = await createTenantAdmin(request)
    const headers = { Authorization: `Bearer ${tenant.accessToken}` }

    /** Crée un produit et relit son seuil d'alerte enregistré. */
    const seuilCree = async (data: Record<string, unknown>) => {
      const res = await request.post('/api/produits', { headers, data })
      expect(res.status(), await res.text()).toBe(201)
      const id = (await res.json()).id
      return { id, seuil: (await (await request.get(`/api/produits/${id}`, { headers })).json()).data.stock_minimum }
    }

    // Jamais réglé : 0, produit non surveillé
    const avant = await seuilCree({ nom: 'E2E sans réglage' })
    expect(avant.seuil).toBe(0)

    // Réglé à 3 : un nouveau produit sans seuil le prend…
    const reglage = await request.put(`/api/boutiques/${tenant.boutiqueId}/stock`, { headers, data: { stock_seuil_defaut: 3 } })
    expect(reglage.status(), await reglage.text()).toBe(200)
    expect((await seuilCree({ nom: 'E2E avec réglage' })).seuil).toBe(3)

    // …un seuil explicite l'emporte, même 0…
    expect((await seuilCree({ nom: 'E2E seuil explicite', stock_minimum: 1 })).seuil).toBe(1)
    expect((await seuilCree({ nom: 'E2E seuil zéro explicite', stock_minimum: 0 })).seuil).toBe(0)

    // …et le produit créé avant le réglage n'a pas bougé
    const relu = (await (await request.get(`/api/produits/${avant.id}`, { headers })).json()).data
    expect(relu.stock_minimum).toBe(0)
  })

  test('écran : formulaire pré-rempli par le réglage, rappel tant qu\'aucun seuil n\'est enregistré', async ({ page, request }) => {
    const tenant  = await createTenantAdmin(request)
    const headers = { Authorization: `Bearer ${tenant.accessToken}` }
    const url     = `/api/boutiques/${tenant.boutiqueId}/stock`

    /** Ouvre /stock et attend la lecture des réglages : le rappel et le pré-remplissage en
     *  dépendent — sans cette attente, « rappel masqué » passerait avant toute lecture. */
    const ouvrirStock = async () => {
      const reglagesLus = page.waitForResponse(r =>
        new RegExp(`/api/boutiques/${tenant.boutiqueId}(\\?|$)`).test(r.url()) && r.request().method() === 'GET')
      await page.goto('/stock')
      expect((await reglagesLus).status()).toBe(200)
    }

    await seConnecter(page, tenant)
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })

    // Jamais réglé : rappel affiché, formulaire à 0 / 0
    await ouvrirStock()
    const rappel = page.locator('#rappel-seuil-defaut')
    await expect(rappel).toBeVisible({ timeout: 15_000 })
    await expect(rappel).toContainText('seuil d\'alerte')
    await page.evaluate('openNewStock()')
    await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '1')
    await expect(page.locator('#stock-min-qty')).toHaveValue('0')
    await expect(page.locator('#stock-qty')).toHaveValue('0')
    await page.evaluate("closeModal('modal-stock')")

    // Le rappel mène à l'onglet Stock des Réglages
    await rappel.locator('a').click()
    await page.waitForURL('**/settings**')
    await expect(page.locator('#tab-stock')).toBeVisible()

    // Un 0 enregistré est un choix : plus de rappel
    expect((await request.put(url, { headers, data: { stock_seuil_defaut: 0 } })).status()).toBe(200)
    await ouvrirStock()
    await expect(rappel).toBeHidden()

    // Réglé à 4 : le formulaire de création le propose, la quantité reste à 0
    expect((await request.put(url, { headers, data: { stock_seuil_defaut: 4 } })).status()).toBe(200)
    await ouvrirStock()
    await page.evaluate('openNewStock()')
    await expect(page.locator('#stock-min-qty')).toHaveValue('4')
    await expect(page.locator('#stock-qty')).toHaveValue('0')

    // Seuil vidé à la main = pas de choix : le produit enregistré prend le réglage, jamais 0
    await page.fill('#stock-name', 'E2E seuil vidé')
    await page.fill('#stock-min-qty', '')
    await page.evaluate('saveStock()')
    await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '0')
    const liste = await (await request.get(`/api/produits?search=${encodeURIComponent('E2E seuil vidé')}`, { headers })).json()
    expect(liste.data.map((p: any) => p.stock_minimum)).toEqual([4])
  })
})
