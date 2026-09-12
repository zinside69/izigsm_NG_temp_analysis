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

    // Import avec 2 pièces déjà en rayon (ticket 05 réglages de stock) : même appel qu'avant,
    // aucun quota brûlé en plus
    await premiere.locator('input.mobilax-qte').fill('2')
    // Import : la fiche du produit s'ouvre, nom repris, prix d'achat relu chez Mobilax
    await premiere.getByRole('button', { name: 'Importer' }).click()
    await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '1', { timeout: 20_000 })
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
    await expect(page.locator('#modal-stock')).toHaveCSS('opacity', '1', { timeout: 20_000 })
    await expect(page.locator('#stock-name')).toHaveValue(nomPiece)
    const produits = await request.get('/api/produits?limit=200', { headers: { Authorization: `Bearer ${tenant.accessToken}` } })
    const lignes = (await produits.json()).data.filter((p: any) => p.nom === nomPiece)
    expect(lignes).toHaveLength(1)
    // Les 2 pièces déclarées : en stock, valorisées au prix d'achat relu chez Mobilax, et
    // entrées dans l'historique sous le motif commun « Stock initial » (aucun appel Mobilax)
    expect(lignes[0].stock_actuel).toBe(2)
    expect(lignes[0].prix_achat_cump).toBe(lignes[0].prix_achat_ht)
    const fiche = await request.get(`/api/produits/${lignes[0].id}`, { headers: { Authorization: `Bearer ${tenant.accessToken}` } })
    expect((await fiche.json()).data.mouvements.map((m: any) => [m.type_mouvement, m.quantite, m.motif]))
      .toEqual([['entree', 2, 'Stock initial']])
  })

  test('« Qté en rayon » : pré-remplie par le stock initial par défaut, transmise à l\'import (API simulée)', async ({ page, request }) => {
    const tenant  = await createTenantAdmin(request)
    const headers = { Authorization: `Bearer ${tenant.accessToken}` }
    const reglage = await request.put(`/api/boutiques/${tenant.boutiqueId}/stock`, { headers, data: { stock_initial_defaut: 3 } })
    expect(reglage.status(), await reglage.text()).toBe(200)

    // Fournisseur simulé : aucun quota brûlé ; l'import est intercepté pour lire ce que l'écran envoie
    await page.route('**/api/mobilax/produits*', route => route.fulfill({
      json: { success: true, data: { total: 1, page: 1, pages: 1, produits: [{
        mobilax_id: 42, nom: 'Écran simulé', ean13: '123', prix_achat_ht: 10, stock: 5,
      }] } },
    }))
    let corpsImport: unknown = null
    await page.route('**/api/mobilax/import*', route => {
      corpsImport = route.request().postDataJSON()
      return route.fulfill({ status: 502, json: { success: false, error: 'Mobilax simulé.', code: 'indisponible' } })
    })

    await seConnecter(page, { email: tenant.email, password: tenant.password })
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
    // La valeur pré-remplie vient des réglages, lus au chargement de la page
    const reglagesLus = page.waitForResponse(r =>
      new RegExp(`/api/boutiques/${tenant.boutiqueId}(\\?|$)`).test(r.url()) && r.request().method() === 'GET')
    await page.goto('/stock')
    await reglagesLus
    await page.click('#btn-mobilax')
    await chercherDansStock(page, 'ecran')

    const champ = page.locator('#mobilax-resultats tr').first().locator('input.mobilax-qte')
    await expect(champ).toHaveValue('3')
    await champ.fill('4')
    await page.locator('#mobilax-resultats tr').first().getByRole('button', { name: 'Importer' }).click()
    await expect.poll(() => corpsImport).toEqual({ mobilax_id: 42, quantite_en_rayon: 4 })
  })

  /** Recherche simulée d'un seul article, import simulé avec la réponse donnée (aucun quota). */
  async function rechercheEtImportSimules(page: Page, request: any, reponseImport: { status: number; json: object }) {
    const tenant = await createTenantAdmin(request)
    await page.route('**/api/mobilax/produits*', route => route.fulfill({
      json: { success: true, data: { total: 1, page: 1, pages: 1, produits: [{
        mobilax_id: 42, nom: 'Écran simulé', ean13: '123', prix_achat_ht: 10, stock: 5,
      }] } },
    }))
    await page.route('**/api/mobilax/import*', route => route.fulfill(reponseImport))
    await seConnecter(page, { email: tenant.email, password: tenant.password })
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
    await page.goto('/stock')
    await page.click('#btn-mobilax')
    await chercherDansStock(page, 'ecran')
    const ligne = page.locator('#mobilax-resultats tr').first()
    await ligne.locator('input.mobilax-qte').fill('3')
    await ligne.getByRole('button', { name: 'Importer' }).click()
  }

  test('import avec une quantité saisie : le message dit combien de pièces sont entrées (API simulée)', async ({ page, request }) => {
    await rechercheEtImportSimules(page, request, { status: 201, json: { success: true, data: { produit_id: 999999 } } })
    await expect(page.locator('.flash').last()).toContainText('3 en stock')
  })

  test('pièce déjà importée avec une quantité saisie : l\'écran dit qu\'elle n\'a pas été ajoutée (API simulée)', async ({ page, request }) => {
    await rechercheEtImportSimules(page, request, { status: 409, json: {
      success: false, error: 'Cette pièce est déjà dans votre stock.', code: 'deja_importe', data: { produit_id: 999999 },
    } })
    // Vocabulaire du glossaire : la quantité du fournisseur est une disponibilité, pas un stock
    await expect(page.locator('#modal-mobilax')).toContainText('Dispo. fournisseur')
    await expect(page.locator('.flash').last()).toContainText('n\'a pas été ajoutée')
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
