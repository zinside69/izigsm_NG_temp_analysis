/**
 * @file tests/e2e/mobilax-fiche-pagination.spec.ts
 * @description Pièce Mobilax importée : fiche remplie (SKU = EAN, famille, catégorie, marque,
 * gamme dans les notes, référence Mobilax visible), notes enfin persistées, et recherche
 * paginée (décisions de l'exploitant du 2026-09-11, retour sur le ticket 04 en production).
 *
 * Appelle la VRAIE préproduction Mobilax (1 connexion, 3 recherches, 1 fiche, 1 arbre de
 * catégories — sous les quotas), clé lue dans `.dev.vars` sans `import 'node:fs'` (tsconfig
 * sans types Node). Sans clé, sauté plutôt que faussement vert. Boutique neuve par test.
 */
import { test, expect, type Page } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

function cleMobilaxPreprod(): string | null {
  try {
    const proc = (globalThis as any).process
    const vars: string = proc.getBuiltinModule('node:fs').readFileSync(`${proc.cwd()}/.dev.vars`, 'utf8')
    return /^\s*MOBILAX_API_KEY\s*=\s*"?([^"\r\n]+)"?/m.exec(vars)?.[1] ?? null
  } catch { return null }
}

/** Boutique neuve, fiche fournisseur Mobilax par le vrai formulaire, puis écran Stock. */
async function boutiqueAvecMobilax(page: Page, request: any, cle: string) {
  const tenant = await createTenantAdmin(request)
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/fournisseurs')
  await page.click('#btn-new-fournisseur')
  await page.fill('#f-nom', 'MOBILAX')
  await page.fill('#f-api-key', cle)
  await page.check('#f-api-mobilax')
  await page.click('#btn-save-fournisseur')
  await expect(page.locator('#modal-fournisseur')).toBeHidden({ timeout: 15_000 })
  await page.goto('/stock')
  return tenant
}

test.describe('Mobilax — fiche importée et pagination', () => {
  test('pièce importée : SKU = EAN, famille, catégorie, marque, gamme et réf. Mobilax ; notes persistées', async ({ page, request }) => {
    const cle = cleMobilaxPreprod()
    test.skip(!cle, 'MOBILAX_API_KEY absente de .dev.vars — import réel impossible')
    await boutiqueAvecMobilax(page, request, cle!)

    await page.click('#btn-mobilax')
    await page.fill('#mobilax-terme', 'ecran iphone 12')
    await page.click('#btn-mobilax-chercher')
    const premiere = page.locator('#mobilax-resultats tr').first()
    await expect(premiere).toBeVisible({ timeout: 20_000 })
    const ean = (await premiere.locator('td').nth(1).innerText()).trim()
    await premiere.getByRole('button', { name: 'Importer' }).click()

    await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '1', { timeout: 20_000 })
    await expect(page.locator('#stock-reference')).toHaveValue(ean)
    await expect(page.locator('#stock-famille')).toHaveValue('piece')
    await expect(page.locator('#stock-marque')).toHaveValue('Apple')
    await expect(page.locator('#stock-ref-mobilax')).toBeVisible()
    await expect(page.locator('#stock-ref-mobilax')).toContainText('Réf. MOBILAX :')
    await expect(page.locator('#stock-notes')).toHaveValue(/^Gamme Mobilax : /)
    // Catégorie locale créée au nom de la catégorie Mobilax, et sélectionnée
    await expect(page.locator('#stock-category option:checked')).not.toHaveText(/Aucune/)

    // Les notes s'enregistrent enfin (colonne `description`)
    await page.fill('#stock-notes', 'Note atelier E2E — tiroir 3')
    await page.click('#modal-stock .modal-footer .btn-primary')
    await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '0', { timeout: 15_000 })
    await page.locator('#stock-tbody tr').first().getByTitle('Modifier').click()
    await expect(page.locator('#stock-notes')).toHaveValue('Note atelier E2E — tiroir 3')
  })

  test('recherche large : 100 pièces par page, Suivante mène à la page 2', async ({ page, request }) => {
    const cle = cleMobilaxPreprod()
    test.skip(!cle, 'MOBILAX_API_KEY absente de .dev.vars — recherche réelle impossible')
    await boutiqueAvecMobilax(page, request, cle!)

    await page.click('#btn-mobilax')
    await page.fill('#mobilax-terme', 'iphone 12')
    await page.click('#btn-mobilax-chercher')
    await expect(page.locator('#mobilax-resultats tr')).toHaveCount(100, { timeout: 20_000 })
    await expect(page.locator('#mobilax-page')).toHaveText(/^Page 1 \/ \d+$/)
    await expect(page.locator('#btn-mobilax-precedente')).toBeDisabled()
    const premierePage1 = await page.locator('#mobilax-resultats tr').first().innerText()

    await page.click('#btn-mobilax-suivante')
    await expect(page.locator('#mobilax-page')).toHaveText(/^Page 2 \/ \d+$/, { timeout: 20_000 })
    await expect(page.locator('#mobilax-resultats tr')).toHaveCount(100)
    expect(await page.locator('#mobilax-resultats tr').first().innerText()).not.toBe(premierePage1)
  })
})
