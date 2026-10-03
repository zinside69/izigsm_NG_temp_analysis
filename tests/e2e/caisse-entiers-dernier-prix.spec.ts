/**
 * @file tests/e2e/caisse-entiers-dernier-prix.spec.ts
 * @description Recette 002, parties A et D (décisions de l'exploitant du 2026-10-03).
 *
 * A — « afficher que des entiers » : le champ Qté n'accepte que des chiffres (virgule, point, signe
 *     retirés à la frappe), et une valeur vide ou 0 devient 1 en quittant le champ. Mécanisme commun
 *     (`data-entier`, `app.js`) : caisse, devis, avoirs, factures.
 * D — fiche à 0,00 € : tuile, résultat et ligne prennent le dernier prix HT vendu (« (dern.) »).
 *
 * Contre la VRAIE D1 locale, boutique neuve à chaque test.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { createTenantAdmin, type TenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

// ═══════════════════════════════════════════════════════════════════════════════
// Aides
// ═══════════════════════════════════════════════════════════════════════════════

const entete = (tenant: TenantAdmin) => ({ Authorization: `Bearer ${tenant.accessToken}` })

async function creerProduit(request: APIRequestContext, tenant: TenantAdmin, data: Record<string, unknown>) {
  const res = await request.post('/api/produits', {
    headers: entete(tenant),
    data:    { stock_minimum: 0, stock_actuel: 5, tva_taux: 20, ...data },
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).id as number
}

async function ouvrirVente(page: Page, tenant: TenantAdmin) {
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/caisse')
  await expect(page.locator('#kpi-nb-tx')).not.toHaveText('—', { timeout: 15_000 })
  await page.click('#btn-nouvelle-vente')
}

const lignes = (page: Page) => page.locator('#lignes-container .linha-row')

// ═══════════════════════════════════════════════════════════════════════════════
// A — quantité en entiers
// ═══════════════════════════════════════════════════════════════════════════════

test('A : la quantité n\'affiche que des entiers — « 0,98 » devient 98, vide devient 1', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await ouvrirVente(page, tenant)
  await page.click('#btn-ligne-libre')
  const qte = lignes(page).first().locator('[data-field="quantite"]')

  await qte.fill('')
  await qte.pressSequentially('0,98')
  await expect(qte).toHaveValue('98')

  await qte.fill('')
  await qte.pressSequentially('-1.5')
  await expect(qte).toHaveValue('15')

  // Vide ou 0 en quittant le champ → 1 ; le total suit
  await lignes(page).first().locator('[data-field="prix_unitaire_ht"]').fill('10')
  await qte.fill('0')
  await qte.blur()
  await expect(qte).toHaveValue('1')
  await expect(page.locator('#total-ttc-vente')).toHaveText(/12,00/)
})

// ═══════════════════════════════════════════════════════════════════════════════
// D — dernier prix vendu
// ═══════════════════════════════════════════════════════════════════════════════

test('D : fiche à 0 € → tuile, résultat et ligne au dernier prix vendu, marqués « (dern.) »', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const id = await creerProduit(request, tenant, { nom: 'E2E Ecran sans prix', code_barre: '3000000390016', prix_vente_ht: 0 })
  // Vendue 200 puis 220 € HT : la plus récente fait foi
  for (const prix of [200, 220]) {
    const v = await request.post('/api/caisse/vente', { headers: entete(tenant), data: { mode_paiement: 'cb', lignes: [
      { produit_id: id, designation: 'E2E Ecran sans prix', quantite: 1, prix_unitaire_ht: prix, tva_taux: 20 },
    ] } })
    expect(v.status(), await v.text()).toBe(201)
  }
  await ouvrirVente(page, tenant)

  const tuile = page.locator('#vente-favoris [data-favori]').first()
  await expect(tuile).toContainText('264,00')
  await expect(tuile).toContainText('(dern.)')
  await tuile.click()
  await expect(lignes(page).locator('[data-field="prix_unitaire_ht"]')).toHaveValue('220')

  // Scan dans la barre : même produit → quantité 2, prix inchangé
  await page.keyboard.type('3000000390016')
  await page.keyboard.press('Enter')
  await expect(lignes(page).locator('[data-field="quantite"]')).toHaveValue('2')

  // Résultat de recherche : le dernier prix est affiché, marqué
  await page.locator('#vente-produit-search').pressSequentially('E2E Ecran')
  const resultat = page.locator('#vente-produit-results:not(.hidden) [data-produit-id]').first()
  await expect(resultat).toContainText('220,00')
  await expect(resultat).toContainText('(dern.)')
})

test('D : jamais vendue → prix à saisir, comme avant', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await creerProduit(request, tenant, { nom: 'E2E Jamais vendue', code_barre: '3000000390023', prix_vente_ht: 0 })
  await ouvrirVente(page, tenant)
  await page.keyboard.type('3000000390023')
  await page.keyboard.press('Enter')
  const prix = lignes(page).locator('[data-field="prix_unitaire_ht"]')
  await expect(prix).toHaveValue('0')
  await expect(prix).toHaveAttribute('data-prix-manquant', '1')
})

test('A : même règle sur une ligne de devis (mécanisme commun `data-entier`)', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/devis')
  await page.locator('button', { hasText: '+ Nouveau devis' }).first().click()
  // Le formulaire d'un nouveau devis naît avec une ligne ; on en ajoute une au besoin
  const qte = page.locator('input[id^="dl-qty-"]').first()
  if (await qte.count() === 0) await page.locator('button', { hasText: '+ Ajouter une ligne' }).click()

  await qte.fill('')
  await qte.pressSequentially('2,5')
  await expect(qte).toHaveValue('25')
  await qte.fill('')
  await qte.blur()
  await expect(qte).toHaveValue('1')
})
