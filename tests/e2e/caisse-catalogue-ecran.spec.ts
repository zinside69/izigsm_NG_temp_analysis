/**
 * @file tests/e2e/caisse-catalogue-ecran.spec.ts
 * @description La vente lit le catalogue — niveau écran (ticket 02 du chantier
 * `vente-lit-catalogue`).
 *
 * Au comptoir, le vendeur cherche un produit dans la fenêtre « Nouvelle vente », le choisit, la
 * ligne naît préremplie (désignation, prix, TVA) et reste modifiable ; la vente fait baisser le
 * stock. Joué sur le vrai serveur local et la vraie base, sous un compte **de boutique** (un admin
 * plateforme ne vend pas, ADR 0002). Le stock est relu par l'API : c'est la preuve métier.
 *
 * La ligne saisie entièrement à la main reste couverte par le balayage
 * (`resolveur-boutique-pages.spec.ts`, « caisse enregistre une vente »).
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { createTenantAdmin, type TenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

// ═══════════════════════════════════════════════════════════════════════════════
// Aides
// ═══════════════════════════════════════════════════════════════════════════════

/** Crée un produit dans la boutique du tenant et rend son identifiant. */
async function creerProduit(request: APIRequestContext, tenant: TenantAdmin, data: Record<string, unknown>) {
  const res = await request.post('/api/produits', {
    headers: { Authorization: `Bearer ${tenant.accessToken}` },
    data:    { stock_minimum: 0, ...data },
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).id as number
}

/** Stock actuel d'un produit, relu par l'API. */
async function stockDe(request: APIRequestContext, tenant: TenantAdmin, id: number) {
  const res = await request.get(`/api/produits/${id}`, { headers: { Authorization: `Bearer ${tenant.accessToken}` } })
  return (await res.json()).data.stock_actuel as number
}

/** Connexion du tenant, ouverture de la caisse et de la fenêtre « Nouvelle vente ». */
async function ouvrirVente(page: Page, tenant: TenantAdmin) {
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/caisse')
  await expect(page.locator('#kpi-nb-tx')).toHaveText('0', { timeout: 15_000 })
  await page.click('#btn-nouvelle-vente')
}

/** Cherche un produit dans la fenêtre de vente et choisit le premier résultat. */
async function ajouterDepuisCatalogue(page: Page, texte: string) {
  await page.fill('#vente-produit-search', texte)
  const resultat = page.locator('#vente-produit-results [data-produit-id]').first()
  await expect(resultat).toBeVisible({ timeout: 10_000 })
  await resultat.click()
}

// ═══════════════════════════════════════════════════════════════════════════════
// Scénarios
// ═══════════════════════════════════════════════════════════════════════════════

test('caisse : chercher un produit, ligne préremplie et modifiable, le stock baisse à la vente', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const id = await creerProduit(request, tenant, {
    nom: 'E2E Coque transparente A54', code_barre: '3700275471129', prix_vente_ht: 20, tva_taux: 10, stock_actuel: 4,
  })
  await ouvrirVente(page, tenant)

  // Recherche par code-barres : la ligne naît remplie depuis le catalogue
  await ajouterDepuisCatalogue(page, '3700275471129')
  const ligne = page.locator('#lignes-container .linha-row')
  await expect(ligne).toHaveCount(1)
  await expect(ligne.locator('[data-field="designation"]')).toHaveValue('E2E Coque transparente A54')
  await expect(ligne.locator('[data-field="prix_unitaire_ht"]')).toHaveValue('20')
  await expect(ligne.locator('[data-field="tva_taux"]')).toHaveValue('10')

  // Chaque champ reste modifiable : quantité et prix changés à la main
  await ligne.locator('[data-field="quantite"]').fill('2')
  await ligne.locator('[data-field="prix_unitaire_ht"]').fill('18')
  await expect(page.locator('#total-ttc-vente')).toHaveText(/39,60/)

  await page.fill('#montant-remis', '50')
  await page.click('#btn-submit-vente')
  await expect(page.locator('#toast-inner')).toContainText(/enregistrée/i, { timeout: 15_000 })
  expect(await stockDe(request, tenant, id)).toBe(2)
})

test('caisse : un stock insuffisant laisse passer la vente, avec un avertissement', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const id = await creerProduit(request, tenant, { nom: 'E2E Écran Redmi Note 12', prix_vente_ht: 45, stock_actuel: 1 })
  await ouvrirVente(page, tenant)

  await ajouterDepuisCatalogue(page, 'Redmi Note 12')
  await page.locator('#lignes-container [data-field="quantite"]').fill('2')
  await page.click('#btn-submit-vente')

  await expect(page.locator('#toast-inner')).toContainText('Stock insuffisant', { timeout: 15_000 })
  await expect(page.locator('#toast-inner')).toContainText('E2E Écran Redmi Note 12')
  expect(await stockDe(request, tenant, id)).toBe(0)
})

test('caisse : un produit à 0 € bloque la validation tant qu\'aucun prix n\'est saisi', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const id = await creerProduit(request, tenant, { nom: 'E2E Nappe sans prix', prix_vente_ht: 0, stock_actuel: 3 })
  await ouvrirVente(page, tenant)

  let ventesEnvoyees = 0
  page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/api/caisse/vente')) ventesEnvoyees++ })

  await ajouterDepuisCatalogue(page, 'Nappe sans prix')
  const prix = page.locator('#lignes-container [data-field="prix_unitaire_ht"]')
  await expect(prix).toHaveAttribute('data-prix-manquant', '1')

  await page.click('#btn-submit-vente')
  await expect(page.locator('#toast-inner')).toContainText('prix', { timeout: 5_000 })
  expect(ventesEnvoyees).toBe(0)
  expect(await stockDe(request, tenant, id)).toBe(3)

  // Un prix saisi lève le blocage
  await prix.fill('12')
  await expect(prix).not.toHaveAttribute('data-prix-manquant', '1')
  await page.click('#btn-submit-vente')
  await expect(page.locator('#toast-inner')).toContainText(/enregistrée/i, { timeout: 15_000 })
  expect(await stockDe(request, tenant, id)).toBe(2)
})

test('caisse : un nom de produit piégé est affiché comme du texte', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const piege  = 'E2E piège <img src=x data-xss="caisse"> fin'
  await creerProduit(request, tenant, { nom: piege, prix_vente_ht: 5, stock_actuel: 2 })
  await ouvrirVente(page, tenant)

  await page.fill('#vente-produit-search', 'piège')
  const resultat = page.locator('#vente-produit-results [data-produit-id]').first()
  await expect(resultat).toContainText(piege, { timeout: 10_000 })
  await resultat.click()
  await expect(page.locator('#lignes-container [data-field="designation"]')).toHaveValue(piege)

  // Aucun élément n'a été créé par la charge, ni dans les résultats ni dans la ligne
  await expect(page.locator('[data-xss="caisse"]')).toHaveCount(0)
})

// ═══════════════════════════════════════════════════════════════════════════════
// Services et dossiers SAV (ticket 03 `vente-lit-catalogue`, récits 1, 3, 7, 20)
// ═══════════════════════════════════════════════════════════════════════════════

/** Crée un service dans la boutique du tenant et rend son identifiant. */
async function creerService(request: APIRequestContext, tenant: TenantAdmin, data: Record<string, unknown>) {
  const res = await request.post('/api/services', {
    headers: { Authorization: `Bearer ${tenant.accessToken}` },
    data:    { tva_taux: 20, ...data },
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).id as number
}

/** Crée un client et un dossier SAV pour lui ; rend `{ id, numero }`. */
async function creerDossierSav(request: APIRequestContext, tenant: TenantAdmin, nomClient: string) {
  const headers = { Authorization: `Bearer ${tenant.accessToken}` }
  const client = await request.post('/api/clients', { headers, data: { prenom: 'Lina', nom: nomClient, telephone: '0600000000' } })
  expect(client.status(), await client.text()).toBe(201)
  const res = await request.post('/api/sav', { headers, data: { client_id: (await client.json()).id, motif: 'E2E écran qui scintille' } })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).data as { id: number; numero: string }
}

test('caisse : vendre un service du catalogue, la facture garde le lien vers le service', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const id = await creerService(request, tenant, { nom: 'E2E Pose de film écran', prix_ht: 12.5 })
  await ouvrirVente(page, tenant)

  await page.fill('#vente-produit-search', 'Pose de film')
  const resultat = page.locator('#vente-produit-results [data-service-id]').first()
  await expect(resultat).toBeVisible({ timeout: 10_000 })
  await expect(resultat.locator('[data-nature]')).toHaveText('Service')
  await resultat.click()

  const ligne = page.locator('#lignes-container .linha-row')
  await expect(ligne).toHaveCount(1)
  await expect(ligne.locator('[data-field="designation"]')).toHaveValue('E2E Pose de film écran')
  await expect(ligne.locator('[data-field="prix_unitaire_ht"]')).toHaveValue('12.5')
  // Renommée à la main : le lien, lui, reste celui du catalogue
  await ligne.locator('[data-field="designation"]').fill('Film posé en boutique')

  await page.fill('#montant-remis', '20')
  const reponse = page.waitForResponse(r => r.url().includes('/api/caisse/vente') && r.request().method() === 'POST')
  await page.click('#btn-submit-vente')
  const factureId = (await (await reponse).json()).data.facture.id
  await expect(page.locator('#toast-inner')).toContainText(/enregistrée/i, { timeout: 15_000 })

  const facture = await request.get(`/api/factures/${factureId}`, { headers: { Authorization: `Bearer ${tenant.accessToken}` } })
  expect((await facture.json()).data.lignes).toEqual([
    expect.objectContaining({ description: 'Film posé en boutique', service_id: id, produit_id: null }),
  ])
})

test('caisse : choisir un dossier SAV l\'ouvre dans sa page, sans rien ajouter au panier', async ({ page, request }) => {
  const tenant  = await createTenantAdmin(request)
  const dossier = await creerDossierSav(request, tenant, 'E2EDurandsav')
  await ouvrirVente(page, tenant)

  let ventesEnvoyees = 0
  page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/api/caisse/vente')) ventesEnvoyees++ })

  await page.fill('#vente-produit-search', 'E2EDurandsav')
  const resultat = page.locator('#vente-produit-results [data-sav-id]').first()
  await expect(resultat).toBeVisible({ timeout: 10_000 })
  await expect(resultat.locator('[data-nature]')).toHaveText('Dossier SAV')
  await expect(resultat).toContainText(dossier.numero)
  await expect(page.locator('#lignes-container .linha-row')).toHaveCount(0)

  await resultat.click()
  await page.waitForURL(`**/sav?dossier=${dossier.id}`, { timeout: 15_000 })
  await expect(page.locator('#modal-sav-detail')).not.toHaveClass(/hidden/)
  await expect(page.locator('#detail-titre')).toHaveText(`Dossier ${dossier.numero}`, { timeout: 15_000 })
  expect(ventesEnvoyees).toBe(0)
})

test('caisse : un service ou un client SAV au nom piégé est affiché comme du texte', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const piege  = 'E2Epiege <img src=x data-xss="caisse-03"> fin'
  await creerService(request, tenant, { nom: piege, prix_ht: 5 })
  await creerDossierSav(request, tenant, piege)
  await ouvrirVente(page, tenant)

  await page.fill('#vente-produit-search', 'E2Epiege')
  await expect(page.locator('#vente-produit-results [data-service-id]')).toContainText(piege, { timeout: 10_000 })
  await expect(page.locator('#vente-produit-results [data-sav-id]')).toContainText(piege)
  await expect(page.locator('[data-xss="caisse-03"]')).toHaveCount(0)
})
