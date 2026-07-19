import { test, expect } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'

/**
 * Gate de non-régression isolation multi-tenant.
 *
 * Historique : 3 failles d'isolation boutique_id déjà trouvées et corrigées sur ce
 * repo (photos tickets, isolation cross-boutique — voir project-docs/bugs.md), à
 * chaque fois découvertes en test manuel malgré des tests unitaires verts. Ce fichier
 * est le gate automatisé équivalent : un admin d'une boutique ne doit jamais pouvoir
 * lire les données d'une autre boutique via l'API.
 *
 * Le ticket 1 (seed.sql) appartient à la boutique 1 ("iziGSM Paris 11").
 */

const BOUTIQUE_1_TICKET_ID = 1

test.describe('Isolation multi-tenant', () => {
  test('un admin d\'une autre boutique ne peut pas lire un ticket qui ne lui appartient pas', async ({ request }) => {
    const otherTenant = await createTenantAdmin(request)

    const res = await request.get(`/api/tickets/${BOUTIQUE_1_TICKET_ID}`, {
      headers: { Authorization: `Bearer ${otherTenant.accessToken}` },
    })

    // Attendu : 403 (ou 404 si l'API choisit de masquer l'existence). Un 200 avec les
    // données du ticket de la boutique 1 est une fuite cross-tenant.
    expect([403, 404]).toContain(res.status())
  })

  test('un admin d\'une autre boutique ne peut pas lister les photos d\'un ticket qui ne lui appartient pas', async ({ request }) => {
    const otherTenant = await createTenantAdmin(request)

    const res = await request.get(`/api/tickets/${BOUTIQUE_1_TICKET_ID}/photos`, {
      headers: { Authorization: `Bearer ${otherTenant.accessToken}` },
    })

    expect([403, 404]).toContain(res.status())
  })

  // Régression : PUT /:id, PUT /:id/statut, DELETE /:id n'avaient aucune vérification
  // boutique_id (trouvé par l'audit loop-engineering du 2026-07-19, voir bugs.md).
  test('un admin d\'une autre boutique ne peut pas modifier un ticket qui ne lui appartient pas (PUT /:id)', async ({ request }) => {
    const otherTenant = await createTenantAdmin(request)

    const res = await request.put(`/api/tickets/${BOUTIQUE_1_TICKET_ID}`, {
      headers: { Authorization: `Bearer ${otherTenant.accessToken}` },
      data: { notes_internes: 'modifié par un tenant étranger — ne doit jamais passer' },
    })

    expect([403, 404]).toContain(res.status())
  })

  test('un admin d\'une autre boutique ne peut pas changer le statut d\'un ticket qui ne lui appartient pas (PUT /:id/statut)', async ({ request }) => {
    const otherTenant = await createTenantAdmin(request)

    const res = await request.put(`/api/tickets/${BOUTIQUE_1_TICKET_ID}/statut`, {
      headers: { Authorization: `Bearer ${otherTenant.accessToken}` },
      data: { statut: 'annule' },
    })

    expect([403, 404]).toContain(res.status())
  })

  test('un admin d\'une autre boutique ne peut pas supprimer un ticket qui ne lui appartient pas (DELETE /:id)', async ({ request }) => {
    const otherTenant = await createTenantAdmin(request)

    const res = await request.delete(`/api/tickets/${BOUTIQUE_1_TICKET_ID}`, {
      headers: { Authorization: `Bearer ${otherTenant.accessToken}` },
    })

    expect([403, 404]).toContain(res.status())
  })
})
