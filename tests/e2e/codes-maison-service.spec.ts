/**
 * @file tests/e2e/codes-maison-service.spec.ts
 * @description Codes maison — PARTIE ÉCRAN SERVICE (ticket 05 `vente-lit-catalogue`, T-013), sur
 * les routes livrées par T-009 : `POST /api/services/:id/code-maison`, `createService()` /
 * `updateService()` acceptant `code_barre`. Miroir de `codes-maison-produit.spec.ts` (T-012),
 * adapté aux différences de la fiche service : aucune pose automatique à la création (donc pas de
 * baseline à vider avant d'ouvrir une fiche vide), pas de dispense SKU EAN-13, et le chemin
 * Services de `services.js` garde sa convention `res.ok`/`res.error` (CLAUDE.md § Enveloppe —
 * « Ne pas uniformiser ») au lieu du déballage `(await apiX(…)).data`.
 *
 * Ne touche ni `caisse.js` ni `caisse.html` : le scan réutilise la capture de douchette livrée par
 * le ticket 04 (`caisse-douchette.spec.ts`), ici seulement comme preuve que le code maison affiché
 * dans la fiche service est bien celui que la caisse reconnaît. Prouvé contre la VRAIE D1 locale,
 * boutique neuve par test ; `.service-card-actions` n'est révélé qu'au survol réel du curseur
 * (`:hover` CSS, `display: none` par défaut) — `hover()` avant tout clic sur « Modifier ».
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { createTenantAdmin, type TenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

// ═══════════════════════════════════════════════════════════════════════════════
// Aides
// ═══════════════════════════════════════════════════════════════════════════════

async function creerService(request: APIRequestContext, tenant: TenantAdmin, data: Record<string, unknown>) {
  const res = await request.post('/api/services', {
    headers: { Authorization: `Bearer ${tenant.accessToken}` },
    data:    { prix_ht: 20, ...data },
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).id as number
}

async function serviceDe(request: APIRequestContext, tenant: TenantAdmin, id: number) {
  const res = await request.get(`/api/services/${id}`, { headers: { Authorization: `Bearer ${tenant.accessToken}` } })
  return (await res.json()).data
}

async function ouvrirServices(page: Page, tenant: TenantAdmin) {
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/services')
}

/** Ouvre la fiche d'un service depuis la grille, par son nom (icône « Modifier » de sa carte,
 *  révélée seulement au survol — `.service-card-actions { display: none }` par défaut). */
async function ouvrirFicheService(page: Page, nom: string) {
  const carte = page.locator('.service-card', { hasText: nom })
  await expect(carte).toBeVisible({ timeout: 10_000 })
  await carte.hover()
  await carte.locator('button[title="Modifier"]').click()
  await expect(page.locator('#modal-service')).toBeVisible()
}

async function fermerFicheService(page: Page) {
  await page.locator('#modal-service .modal-footer button', { hasText: 'Annuler' }).click()
  await expect(page.locator('#modal-service')).toBeHidden()
}

// ═══════════════════════════════════════════════════════════════════════════════
// Scénarios
// ═══════════════════════════════════════════════════════════════════════════════

test('générer le code d\'un service créé à la main, puis le scanner en caisse', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await ouvrirServices(page, tenant)

  await page.locator('button[onclick="openModalService()"]').click()
  await expect(page.locator('#modal-service')).toBeVisible()
  // En création, le service n'a pas encore d'identifiant : pas de bouton « Générer »
  await expect(page.locator('#btn-svc-generer-code')).toBeHidden()

  const nom = `E2E Service code maison ${Date.now()}`
  await page.fill('#svc-nom', nom)
  await page.fill('#svc-prix', '25')
  await page.locator('#modal-service button', { hasText: 'Enregistrer' }).click()
  await expect(page.locator('#modal-service')).toBeHidden()

  await ouvrirFicheService(page, nom)
  await expect(page.locator('#svc-code-barre')).toHaveValue('')
  await expect(page.locator('#btn-svc-generer-code')).toBeVisible()
  await page.click('#btn-svc-generer-code')
  // '22' = type service, suivi des 10 chiffres de l'identifiant et de la clé EAN-13
  await expect(page.locator('#svc-code-barre')).toHaveValue(/^22\d{11}$/)
  const code = await page.locator('#svc-code-barre').inputValue()
  await fermerFicheService(page)

  await page.goto('/caisse')
  await expect(page.locator('#kpi-nb-tx')).toHaveText('0', { timeout: 15_000 })
  await page.keyboard.type(code)
  await page.keyboard.press('Enter')
  await expect(page.locator('#modal-vente')).not.toHaveClass(/hidden/)
  const ligne = page.locator('#lignes-container .linha-row')
  await expect(ligne).toHaveCount(1)
  await expect(ligne.locator('[data-field="designation"]')).toHaveValue(nom)
})

test('« Générer » puis « Enregistrer » sans rien saisir : le code maison reste en base et affiché', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const id = await creerService(request, tenant, { nom: 'E2E Générer puis enregistrer' })
  await ouvrirServices(page, tenant)
  await ouvrirFicheService(page, 'E2E Générer puis enregistrer')

  await expect(page.locator('#svc-code-barre')).toHaveValue('')
  await expect(page.locator('#btn-svc-generer-code')).toBeVisible()
  await page.click('#btn-svc-generer-code')
  await expect(page.locator('#svc-code-barre')).toHaveValue(/^22\d{11}$/)
  const code = await page.locator('#svc-code-barre').inputValue()
  await expect(page.locator('#btn-svc-generer-code')).toBeHidden()

  // Aucune saisie supplémentaire : « Enregistrer » n'a pas besoin de renvoyer le code déjà posé
  await page.locator('#modal-service button', { hasText: 'Enregistrer' }).click()
  await expect(page.locator('#modal-service')).toBeHidden()

  const service = await serviceDe(request, tenant, id)
  expect(service.code_barre).toBe(code)

  // Affiché à la réouverture, relu par l'API
  await ouvrirFicheService(page, 'E2E Générer puis enregistrer')
  await expect(page.locator('#svc-code-barre')).toHaveValue(code)
})

test('fiche ouverte sans code, posé par l\'API pendant qu\'elle est ouverte, autre champ modifié puis Enregistrer : le code posé reste', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const id = await creerService(request, tenant, { nom: 'E2E Pose concurrente', prix_ht: 10 })
  await ouvrirServices(page, tenant)
  await ouvrirFicheService(page, 'E2E Pose concurrente')
  await expect(page.locator('#svc-code-barre')).toHaveValue('')

  // Pose par l'API, hors de l'écran — le champ affiché ne le sait pas
  const pose = await request.post(`/api/services/${id}/code-maison`, { headers: { Authorization: `Bearer ${tenant.accessToken}` } })
  expect(pose.status(), await pose.text()).toBe(200)
  const codePose = (await pose.json()).code_barre as string

  await page.fill('#svc-prix', '12.5')
  await page.locator('#modal-service button', { hasText: 'Enregistrer' }).click()
  await expect(page.locator('#modal-service')).toBeHidden()

  const service = await serviceDe(request, tenant, id)
  expect(service.code_barre).toBe(codePose)
  expect(service.prix_ht).toBe(12.5)
})

test('vider volontairement le champ Code-barres puis Enregistrer : le code est retiré', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const id = await creerService(request, tenant, { nom: 'E2E Retrait du code', code_barre: '3700275472164' })
  await ouvrirServices(page, tenant)
  await ouvrirFicheService(page, 'E2E Retrait du code')

  await expect(page.locator('#svc-code-barre')).toHaveValue('3700275472164')
  await expect(page.locator('#btn-svc-generer-code')).toBeHidden()
  await page.fill('#svc-code-barre', '')
  await page.locator('#modal-service button', { hasText: 'Enregistrer' }).click()
  await expect(page.locator('#modal-service')).toBeHidden()

  const service = await serviceDe(request, tenant, id)
  expect(service.code_barre).toBeNull()
})

test('fiche service : un code-barres déjà porté par un autre service est refusé, en nommant le porteur', async ({ page, request }) => {
  const tenant    = await createTenantAdmin(request)
  const idPorteur = await creerService(request, tenant, { nom: 'E2E Porteur du code', code_barre: '3700275472164' })
  await creerService(request, tenant, { nom: 'E2E Service sans code' })
  await ouvrirServices(page, tenant)
  await ouvrirFicheService(page, 'E2E Service sans code')

  await page.fill('#svc-code-barre', '3700275472164')
  await page.locator('#modal-service button', { hasText: 'Enregistrer' }).click()

  await expect(page.locator('.flash.error')).toHaveText(
    `Ce code-barres est déjà utilisé par « E2E Porteur du code » (service n° ${idPorteur}).`,
  )
  await expect(page.locator('#modal-service')).toBeVisible()
})

test('« Générer » sur un service déjà codé par un autre poste : 409 « déjà codé » affiché en clair', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const id = await creerService(request, tenant, { nom: 'E2E Déjà codé entre-temps' })
  await ouvrirServices(page, tenant)
  await ouvrirFicheService(page, 'E2E Déjà codé entre-temps')
  await expect(page.locator('#svc-code-barre')).toHaveValue('')
  await expect(page.locator('#btn-svc-generer-code')).toBeVisible()

  // Un autre poste pose le code avant le clic sur « Générer » — l'écran ne le sait pas encore
  const pose = await request.post(`/api/services/${id}/code-maison`, { headers: { Authorization: `Bearer ${tenant.accessToken}` } })
  expect(pose.status(), await pose.text()).toBe(200)

  await page.click('#btn-svc-generer-code')

  await expect(page.locator('.flash.error')).toHaveText('Ce service a déjà un code-barres.')
  await expect(page.locator('#svc-code-barre')).toHaveValue('')
})

test('en création, aucun bouton « Générer un code maison »', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  await ouvrirServices(page, tenant)

  await page.locator('button[onclick="openModalService()"]').click()
  await expect(page.locator('#modal-service')).toBeVisible()
  await expect(page.locator('#btn-svc-generer-code')).toBeHidden()
})
