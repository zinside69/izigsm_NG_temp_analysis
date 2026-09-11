/**
 * @file tests/e2e/mobilax-recherche-stock.spec.ts
 * @description Recherche Mobilax depuis l'écran Stock (ticket 03, chantier
 * `integration-mobilax`) — le résultat réel à l'écran, jamais seulement une réponse API.
 *
 * Le premier test appelle la VRAIE préproduction Mobilax (1 connexion + 2 recherches, sous
 * les quotas de 10 et 30/min) avec la clé de `.dev.vars` (`MOBILAX_API_KEY`), lue ici et
 * saisie dans la vraie fiche fournisseur — jamais affichée, jamais écrite ailleurs. Sans
 * clé dans l'environnement, il est sauté plutôt que faussement vert.
 *
 * Chaque test travaille dans une boutique neuve (`createTenantAdmin`) : la boutique de démo
 * peut porter une fiche marquée par un autre test, ce qui rendrait la recherche ambiguë.
 */
import { test, expect, type Page } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { MANAGER, seConnecter } from './fixtures/comptes'

/**
 * Clé de préproduction lue dans `.dev.vars` — `null` si absente (test sauté).
 * Ni `import 'node:fs'` ni `process` typé : `tsconfig` n'inclut pas les types Node et la
 * baseline tsc ne doit pas monter (même parti pris que `(globalThis as any)` ailleurs dans
 * les specs). `process.getBuiltinModule()` (Node ≥ 22.3) charge `fs` sans import.
 */
function cleMobilaxPreprod(): string | null {
  try {
    const proc = (globalThis as any).process
    const vars: string = proc.getBuiltinModule('node:fs').readFileSync(`${proc.cwd()}/.dev.vars`, 'utf8')
    return /^\s*MOBILAX_API_KEY\s*=\s*"?([^"\r\n]+)"?/m.exec(vars)?.[1] ?? null
  } catch { return null }
}

async function chercherDansStock(page: Page, terme: string) {
  await page.fill('#mobilax-terme', terme)
  await page.click('#btn-mobilax-chercher')
}

test.describe('Stock — recherche Mobilax', () => {
  test('vraie recherche en préproduction : pièces affichées, puis « aucun résultat » explicite', async ({ page, request }) => {
    const cle = cleMobilaxPreprod()
    test.skip(!cle, 'MOBILAX_API_KEY absente de .dev.vars — recherche réelle impossible')

    const tenant = await createTenantAdmin(request)
    await seConnecter(page, { email: tenant.email, password: tenant.password })
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })

    // Fiche fournisseur Mobilax par le vrai formulaire : clé + case « Mobilax »
    await page.goto('/fournisseurs')
    await page.click('#btn-new-fournisseur')
    await page.fill('#f-nom', 'Mobilax')
    await page.fill('#f-api-key', cle!)
    await page.check('#f-api-mobilax')
    await page.click('#btn-save-fournisseur')
    await expect(page.locator('#modal-fournisseur')).toBeHidden({ timeout: 15_000 })

    await page.goto('/stock')
    await page.click('#btn-mobilax')
    await chercherDansStock(page, 'ecran iphone 12')

    const lignes = page.locator('#mobilax-resultats tr')
    await expect(lignes.first()).toBeVisible({ timeout: 20_000 })
    await expect(lignes.first()).toContainText(/iPhone 12/i)
    await expect(lignes.first()).toContainText('€')

    await chercherDansStock(page, 'zzqqxx piece introuvable 000')
    await expect(page.locator('#mobilax-message')).toContainText('Aucune pièce', { timeout: 20_000 })
    await expect(lignes).toHaveCount(0)
  })

  test('import réel (ticket 04) : la pièce devient un produit du stock, un second import rouvre l\'existant', async ({ page, request }) => {
    const cle = cleMobilaxPreprod()
    test.skip(!cle, 'MOBILAX_API_KEY absente de .dev.vars — import réel impossible')

    const tenant = await createTenantAdmin(request)
    await seConnecter(page, { email: tenant.email, password: tenant.password })
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
    await page.goto('/fournisseurs')
    await page.click('#btn-new-fournisseur')
    await page.fill('#f-nom', 'Mobilax')
    await page.fill('#f-api-key', cle!)
    await page.check('#f-api-mobilax')
    await page.click('#btn-save-fournisseur')
    await expect(page.locator('#modal-fournisseur')).toBeHidden({ timeout: 15_000 })

    await page.goto('/stock')
    await page.click('#btn-mobilax')
    await chercherDansStock(page, 'ecran iphone 12')
    const premiere = page.locator('#mobilax-resultats tr').first()
    await expect(premiere).toBeVisible({ timeout: 20_000 })
    const nomPiece = (await premiere.locator('td').first().innerText()).trim()

    // Import : la fiche du produit s'ouvre, nom repris, prix d'achat relu chez Mobilax
    await premiere.getByRole('button', { name: 'Importer' }).click()
    await expect(page.locator('#modal-stock')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('#stock-name')).toHaveValue(nomPiece)
    expect(Number(await page.locator('#stock-price-buy').inputValue())).toBeGreaterThan(0)
    await page.locator('#modal-stock .modal-close').click()

    // Le produit est dans la liste du stock
    await expect(page.locator('#stock-tbody').getByText(nomPiece).first()).toBeVisible({ timeout: 15_000 })

    // Second import de la même pièce : pas de doublon, la fiche existante se rouvre
    await page.click('#btn-mobilax')
    await chercherDansStock(page, 'ecran iphone 12')
    await expect(premiere).toBeVisible({ timeout: 20_000 })
    await premiere.getByRole('button', { name: 'Importer' }).click()
    await expect(page.locator('#modal-stock')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('#stock-name')).toHaveValue(nomPiece)
    const produits = await request.get('/api/produits?limit=200', { headers: { Authorization: `Bearer ${tenant.accessToken}` } })
    const lignes = (await produits.json()).data.filter((p: any) => p.nom === nomPiece)
    expect(lignes).toHaveLength(1)
  })

  test('boutique sans fiche Mobilax : message qui dit quoi faire, pas une erreur muette', async ({ page, request }) => {
    const tenant = await createTenantAdmin(request)
    await seConnecter(page, { email: tenant.email, password: tenant.password })
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })

    await page.goto('/stock')
    await page.click('#btn-mobilax')
    await chercherDansStock(page, 'batterie')
    await expect(page.locator('#mobilax-message')).toContainText('marqué « Mobilax »', { timeout: 15_000 })
  })

  test('un libellé Mobilax piégé s\'affiche en texte, sans créer d\'élément (XSS)', async ({ page }) => {
    await page.route('**/api/mobilax/produits*', route => route.fulfill({
      json: { success: true, data: { total: 1, produits: [{
        mobilax_id: 1, nom: '<img src=x onerror="window.__xss=1">Écran piégé',
        ean13: '<b>123</b>', prix_achat_ht: 10, stock: 3,
      }] } },
    }))
    await seConnecter(page, MANAGER)
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
    await page.goto('/stock')
    await page.click('#btn-mobilax')
    await chercherDansStock(page, 'ecran')

    const ligne = page.locator('#mobilax-resultats tr').first()
    await expect(ligne).toContainText('<img src=x')
    await expect(page.locator('#mobilax-resultats img, #mobilax-resultats b')).toHaveCount(0)
  })
})
