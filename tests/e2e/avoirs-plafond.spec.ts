/**
 * @file tests/e2e/avoirs-plafond.spec.ts
 * @description Ticket 01 du chantier avoirs (décisions Q5, Q6, Q12 de l'exploitant, 2026-10-06) :
 * - un avoir dont le cumul dépasserait le total de la facture est refusé, et l'écran dit le montant
 *   encore annulable ; aucun avoir n'est créé ;
 * - un avoir qui couvre toute la facture la fait afficher « Annulée » dans la liste.
 *
 * Contre la VRAIE D1 locale (migration 0068 appliquée), boutique neuve à chaque test.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { createTenantAdmin, type TenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

// ═══════════════════════════════════════════════════════════════════════════════
// Aides
// ═══════════════════════════════════════════════════════════════════════════════

const entete = (tenant: TenantAdmin) => ({ Authorization: `Bearer ${tenant.accessToken}` })

/** Facture émise de 3 câbles à 19,99 € TTC (59,97 €) ; rend son identifiant et son numéro. */
async function factureDe5997(request: APIRequestContext, tenant: TenantAdmin) {
  const client = await request.post('/api/clients', { headers: entete(tenant), data: { prenom: 'Jeanne', nom: 'Avoir' } })
  expect(client.status(), await client.text()).toBe(201)
  const facture = await request.post('/api/factures', {
    headers: entete(tenant),
    data: {
      client_id: (await client.json()).id, action: 'emettre',
      lignes: [{ description: 'Câble USB-C', quantite: 3, prix_unitaire_ttc: 19.99, tva_taux: 20 }],
    },
  })
  expect(facture.status(), await facture.text()).toBe(201)
  const corps = await facture.json()
  return { id: corps.facture_id as number, numero: corps.facture_numero as string }
}

async function ouvrirFactures(page: Page, tenant: TenantAdmin) {
  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/factures')
  await page.waitForLoadState('networkidle')
  page.on('dialog', dialogue => dialogue.accept())
}

/** Remplit la fenêtre d'avoir d'une ligne de `prixTtc` € TTC à 20 % et l'envoie ; rend la réponse. */
async function emettreAvoir(page: Page, factureId: number, prixTtc: string) {
  await page.evaluate((id) => (globalThis as any).openModalAvoir(id), factureId)
  await page.fill('#avoir-motif', 'Retour')
  const ligne = page.locator('#avoir-lines tr').first()
  await ligne.locator('input[id^="al-desc-"]').fill('Câble USB-C')
  await ligne.locator('input[id^="al-qty-"]').fill('1')
  await ligne.locator('input[id^="al-price-"]').fill(prixTtc)
  await ligne.locator('select[id^="al-tva-"]').selectOption('20')
  const reponse = page.waitForResponse(r => r.url().includes('/api/avoirs') && r.request().method() === 'POST')
  await page.getByRole('button', { name: /Émettre l'avoir/ }).click()
  return reponse
}

const nombreAvoirsDeLaFacture = async (request: APIRequestContext, tenant: TenantAdmin, factureId: number) =>
  ((await (await request.get(`/api/avoirs?facture_id=${factureId}`, { headers: entete(tenant) })).json()).data ?? []).length

// ═══════════════════════════════════════════════════════════════════════════════
// Scénarios
// ═══════════════════════════════════════════════════════════════════════════════

test('avoir de 1 000 € sur une facture de 59,97 € : refusé, l\'écran dit « encore annulable : 59,97 € », aucun avoir', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const facture = await factureDe5997(request, tenant)
  await ouvrirFactures(page, tenant)

  const reponse = await emettreAvoir(page, facture.id, '1000')
  expect(reponse.status()).toBe(400)
  expect((await reponse.json()).code).toBe('plafond_depasse')
  await expect(page.locator('.flash.error')).toContainText('encore annulable : 59,97 €')
  expect(await nombreAvoirsDeLaFacture(request, tenant, facture.id)).toBe(0)
})

test('double-clic sur « Émettre l\'avoir » : le bouton est figé pendant l\'envoi, un seul avoir part', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const facture = await factureDe5997(request, tenant)
  await ouvrirFactures(page, tenant)

  // La réponse du serveur est retenue tant que le test ne la libère pas
  let liberer: () => void = () => {}
  const reponseRetenue = new Promise<void>(resolve => { liberer = resolve })
  let envois = 0
  await page.route('**/api/avoirs*', async route => {
    if (route.request().method() === 'POST') { envois += 1; await reponseRetenue }
    await route.fallback()
  })

  await page.evaluate((id) => (globalThis as any).openModalAvoir(id), facture.id)
  await page.fill('#avoir-motif', 'Retour')
  const ligne = page.locator('#avoir-lines tr').first()
  await ligne.locator('input[id^="al-desc-"]').fill('Câble USB-C')
  await ligne.locator('input[id^="al-qty-"]').fill('1')
  await ligne.locator('input[id^="al-price-"]').fill('59.97')
  const bouton = page.getByRole('button', { name: /Émettre l'avoir/ })
  await bouton.click()
  await expect(bouton).toBeDisabled()
  await bouton.click({ force: true })   // second clic : sans effet sur un bouton figé
  liberer()
  await expect(bouton).toBeEnabled()
  expect(envois).toBe(1)
  expect(await nombreAvoirsDeLaFacture(request, tenant, facture.id)).toBe(1)
})

test('avoir de 59,97 € sur la facture entière : la facture s\'affiche « Annulée » dans la liste', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const facture = await factureDe5997(request, tenant)
  await ouvrirFactures(page, tenant)

  const reponse = await emettreAvoir(page, facture.id, '59.97')
  expect(reponse.status(), await reponse.text()).toBe(201)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('tr', { hasText: facture.numero }).first()).toContainText('Annulée')
})
