/**
 * @file tests/e2e/tickets-annulation-acompte-couvert.spec.ts
 * @description Ticket 01 du chantier avoirs (revue) : annuler un ticket dont l'acompte facturé est DÉJÀ
 * entièrement couvert par un avoir — cas d'une première tentative où l'avoir a été créé mais le changement
 * de statut a échoué — doit aboutir. Avant le correctif, la nouvelle tentative tombait sur le plafond
 * (`plafond_depasse`, encore annulable 0 €) et le ticket ne pouvait plus jamais être annulé.
 *
 * Contre la VRAIE D1 locale (migration 0068 appliquée), boutique neuve.
 */
import { test, expect } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

test('ticket à acompte déjà couvert par un avoir : l\'annulation aboutit, aucun second avoir', async ({ page, request }) => {
  const tenant = await createTenantAdmin(request)
  const entete = { Authorization: `Bearer ${tenant.accessToken}` }

  const client = await request.post('/api/clients', { headers: entete, data: { prenom: 'Jeanne', nom: 'Acompte' } })
  expect(client.status(), await client.text()).toBe(201)
  const ticket = await request.post('/api/tickets', {
    headers: entete,
    data: { client_id: (await client.json()).id, appareil_marque: 'Apple', appareil_modele: 'iPhone 12', description_panne: 'Écran' },
  })
  expect(ticket.ok(), await ticket.text()).toBe(true)
  const ticketId = (await ticket.json()).id as number

  // Acompte de 25 € HT à 20 % = 30 € TTC
  const acompte = await request.post(`/api/tickets/${ticketId}/acompte`, {
    headers: entete, data: { montant_ht: 25, tva_taux: 20, mode_paiement: 'Espèces' },
  })
  expect(acompte.status(), await acompte.text()).toBe(201)
  const factureAcompteId = (await acompte.json()).facture_id as number

  // Première tentative d'annulation : l'avoir est créé… mais le statut du ticket n'a pas changé
  const premierAvoir = await request.post('/api/avoirs', {
    headers: entete,
    data: {
      facture_id: factureAcompteId, motif: `Annulation de la prise en charge #${ticketId}`,
      lignes: [{ description: 'Acompte annulé', quantite: 1, prix_unitaire_ht: 25, tva_taux: 20 }],
    },
  })
  expect(premierAvoir.status(), await premierAvoir.text()).toBe(201)

  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/tickets')
  await page.waitForLoadState('networkidle')
  page.on('dialog', dialogue => dialogue.accept())

  // Nouvelle tentative, par le geste de l'écran
  const changementDeStatut = page.waitForResponse(r => r.url().includes(`/api/tickets/${ticketId}/statut`), { timeout: 10_000 })
  await page.evaluate((id) => (globalThis as any).changeStatus(id, 'annule'), ticketId)
  await changementDeStatut

  const ticketRelu = (await (await request.get(`/api/tickets/${ticketId}`, { headers: entete })).json()).data
  expect(ticketRelu.statut).toBe('annule')
  const avoirs = (await (await request.get(`/api/avoirs?facture_id=${factureAcompteId}`, { headers: entete })).json()).data
  expect(avoirs.length).toBe(1)
})
