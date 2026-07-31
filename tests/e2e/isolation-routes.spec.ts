import { test, expect, type APIRequestContext } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'

/**
 * Isolation des routes par ID — voir
 * docs/superpowers/specs/2026-07-31-isolation-routes-par-id-design.md
 *
 * Trois cas par domaine : l'etranger est refuse, le proprietaire passe,
 * l'admin plateforme passe (capacite de depannage, garantie par test).
 */

const PRODUIT_BOUTIQUE_1 = 1   // seed.sql : produits ids 1..9, boutique 1
const EMPLOYE_BOUTIQUE_1 = 1   // seed.sql : employes ids 1,2,3 — boutique 1

/** Connexion au compte admin plateforme du seed (boutique_id NULL). */
async function loginSeedAdmin(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/auth/login', {
    data: { email: 'admin@izigsm.fr', password: 'Admin@2026!' },
  })
  if (!res.ok()) throw new Error(`login admin seed failed: ${res.status()} ${await res.text()}`)
  return (await res.json()).accessToken
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` }
}

test.describe('Isolation — Stock', () => {
  test('un manager d\'une autre boutique ne peut pas lire un produit qui ne lui appartient pas', async ({ request }) => {
    const etranger = await createTenantAdmin(request)
    const res = await request.get(`/api/produits/${PRODUIT_BOUTIQUE_1}`, {
      headers: authHeader(etranger.accessToken),
    })
    expect([403, 404]).toContain(res.status())
  })

  test('un manager d\'une autre boutique ne peut pas modifier un produit qui ne lui appartient pas', async ({ request }) => {
    const etranger = await createTenantAdmin(request)
    const res = await request.put(`/api/produits/${PRODUIT_BOUTIQUE_1}`, {
      headers: authHeader(etranger.accessToken),
      data: { nom: 'Renomme par un tenant etranger' },
    })
    expect([403, 404]).toContain(res.status())
  })

  test('un manager d\'une autre boutique ne peut pas supprimer un produit qui ne lui appartient pas', async ({ request }) => {
    const etranger = await createTenantAdmin(request)
    const res = await request.delete(`/api/produits/${PRODUIT_BOUTIQUE_1}`, {
      headers: authHeader(etranger.accessToken),
    })
    expect([403, 404]).toContain(res.status())
  })

  test('l\'admin plateforme lit le produit de n\'importe quelle boutique', async ({ request }) => {
    const token = await loginSeedAdmin(request)
    const res = await request.get(`/api/produits/${PRODUIT_BOUTIQUE_1}`, { headers: authHeader(token) })
    expect(res.status()).toBe(200)
  })

  test('le proprietaire legitime lit et modifie son propre produit', async ({ request }) => {
    const proprio = await createTenantAdmin(request)
    const creation = await request.post('/api/produits', {
      headers: authHeader(proprio.accessToken),
      data: { nom: 'Produit du proprietaire', prix_vente_ht: 10, tva_taux: 20 },
    })
    expect(creation.status()).toBe(201)
    const produitId = (await creation.json()).id

    const lecture = await request.get(`/api/produits/${produitId}`, { headers: authHeader(proprio.accessToken) })
    expect(lecture.status()).toBe(200)

    const modif = await request.put(`/api/produits/${produitId}`, {
      headers: authHeader(proprio.accessToken),
      data: { nom: 'Renomme par son proprietaire' },
    })
    expect(modif.status()).toBe(200)
  })
})

test.describe('Isolation — Personnel', () => {
  test('un manager d\'une autre boutique ne peut pas lire la fiche d\'un employe etranger', async ({ request }) => {
    const etranger = await createTenantAdmin(request)
    const res = await request.get(`/api/employes/${EMPLOYE_BOUTIQUE_1}`, {
      headers: authHeader(etranger.accessToken),
    })
    expect([403, 404]).toContain(res.status())
  })

  test('un manager d\'une autre boutique ne peut pas modifier la fiche d\'un employe etranger', async ({ request }) => {
    const etranger = await createTenantAdmin(request)
    const res = await request.put(`/api/employes/${EMPLOYE_BOUTIQUE_1}`, {
      headers: authHeader(etranger.accessToken),
      data: { poste: 'modifie par un tenant etranger' },
    })
    expect([403, 404]).toContain(res.status())
  })

  test('un manager d\'une autre boutique ne peut pas lire le pointage d\'un employe etranger', async ({ request }) => {
    const etranger = await createTenantAdmin(request)
    const res = await request.get(`/api/pointage/${EMPLOYE_BOUTIQUE_1}/aujourd-hui`, {
      headers: authHeader(etranger.accessToken),
    })
    expect([403, 404]).toContain(res.status())
  })

  test('l\'admin plateforme lit la fiche employe de n\'importe quelle boutique', async ({ request }) => {
    const token = await loginSeedAdmin(request)
    const res = await request.get(`/api/employes/${EMPLOYE_BOUTIQUE_1}`, { headers: authHeader(token) })
    expect(res.status()).toBe(200)
  })

  test('le proprietaire legitime lit la fiche de son propre employe', async ({ request }) => {
    const proprio = await createTenantAdmin(request)
    const creation = await request.post('/api/employes', {
      headers: authHeader(proprio.accessToken),
      data: { prenom: 'Employe', nom: 'DuProprietaire', poste: 'technicien' },
    })
    expect(creation.status()).toBe(201)
    const employeId = (await creation.json()).id

    const res = await request.get(`/api/employes/${employeId}`, { headers: authHeader(proprio.accessToken) })
    expect(res.status()).toBe(200)
  })
})
