/**
 * @file tests/e2e/prise-en-charge-imei.spec.ts
 * @description L'IMEI saisi à la prise en charge est enregistré (ticket 08a,
 * `.scratch/vente-lit-catalogue/issues/08a-imei-enregistre-a-la-prise-en-charge.md`).
 *
 * Avant ce ticket : le formulaire de prise en charge envoyait `imei`, mais
 * `POST /api/tickets` ne le lisait pas — aucun ticket n'était retrouvable par IMEI. L'IMEI est
 * porté par la fiche appareil du client (table `appareils`), jamais recopié sur `tickets`
 * (décision de l'exploitant du 2026-09-30) : à la prise en charge, l'appareil du client est
 * retrouvé par IMEI, sinon créé, et `tickets.appareil_id` est posé.
 *
 * Parcours réel sur le serveur local et la vraie base : saisie d'un IMEI valide → réouverture de
 * la fiche → l'IMEI s'affiche ; clé de Luhn fausse → message en clair, aucun ticket créé.
 */
import { test, expect } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

const IMEI      = '356938035643809'
const IMEI_FAUX = '356938035643800'  // mêmes chiffres, clé de Luhn fausse

test('IMEI valide à la prise en charge : enregistré, retrouvé à la réouverture de la fiche', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const client = `E2E Client IMEI ${Date.now()}`

  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })

  await page.goto('/tickets')
  await page.getByRole('button', { name: '+ Nouvelle prise en charge' }).click()
  await expect(page.locator('#modal-ticket')).toHaveCSS('opacity', '1')

  await page.fill('#t-new-client', client)
  await page.fill('#t-device-type', 'Apple')
  await page.fill('#t-device-model', 'iPhone 14')
  await page.fill('#t-description', 'Écran cassé')
  await page.fill('#t-imei', IMEI)
  await page.getByRole('button', { name: 'Enregistrer la prise en charge →' }).click()

  // Succès : le modal se ferme (saveTicket() ne le fait que sur une réponse OK).
  await expect(page.locator('#modal-ticket')).toHaveCSS('opacity', '0')
  await expect(page.locator('#tickets-table')).toContainText(client)

  // Réouverture (édition) : l'IMEI enregistré sur la fiche appareil (appareil_imei côté
  // getTicketById()) s'affiche dans le champ — jamais celui, toujours vide, du cache liste.
  await page.locator('#tickets-table tr', { hasText: client }).first().getByTitle('Modifier').click()
  await expect(page.locator('#modal-ticket')).toHaveCSS('opacity', '1')
  await expect(page.locator('#t-imei')).toHaveValue(IMEI, { timeout: 10_000 })
})

test('IMEI à clé de Luhn fausse : message en clair, aucun ticket créé', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const client = `E2E Client Luhn ${Date.now()}`

  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })

  await page.goto('/tickets')
  await page.getByRole('button', { name: '+ Nouvelle prise en charge' }).click()
  await expect(page.locator('#modal-ticket')).toHaveCSS('opacity', '1')

  await page.fill('#t-new-client', client)
  await page.fill('#t-device-type', 'Samsung')
  await page.fill('#t-device-model', 'Galaxy S23')
  await page.fill('#t-description', 'Batterie')
  await page.fill('#t-imei', IMEI_FAUX)
  await page.getByRole('button', { name: 'Enregistrer la prise en charge →' }).click()

  await expect(page.locator('body')).toContainText('IMEI invalide (clé de contrôle)')
  // Échec : le modal reste ouvert (saveTicket() ne ferme que sur succès), aucun ticket créé.
  await expect(page.locator('#modal-ticket')).toHaveCSS('opacity', '1')

  // listTickets() cherche par numero/appareil_marque/appareil_modele, pas par nom de client
  // (ticketService.ts) — chercher sur le modèle, unique à ce test, suffit à prouver qu'aucun
  // ticket n'a été créé (en plus du modal resté ouvert, ci-dessus).
  const res = await request.get('/api/tickets', {
    headers: { Authorization: `Bearer ${tenant.accessToken}` },
    params:  { boutique_id: String(tenant.boutiqueId), search: 'Galaxy S23' },
  })
  expect((await res.json()).data).toEqual([])
})
