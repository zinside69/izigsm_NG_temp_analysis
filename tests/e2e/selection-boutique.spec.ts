/**
 * @file tests/e2e/selection-boutique.spec.ts
 * @description Sélection d'une boutique par l'admin plateforme, et bascule des pages
 * métier existantes sur cette boutique (ticket 02 du chantier supervision).
 *
 * Deux seams (spec `.scratch/supervision-admin-plateforme/spec.md`) :
 *   - navigateur : ce que l'exploitant voit après avoir choisi une boutique
 *   - API        : qu'une route exigeant `boutique_id` cesse de répondre 400
 *
 * Prior art : `console-boutiques.spec.ts` (connexion réelle, assertions par rôle) et
 * `isolation-routes.spec.ts` + `fixtures/tenant.ts` (tenant étranger jetable).
 *
 * Ces tests observent un comportement visible de l'extérieur — la page affichée, la
 * réponse de l'API, le libellé lu à l'écran — jamais la clé de stockage employée ni la
 * signature d'une fonction : ces choix doivent pouvoir changer sans casser la suite.
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { createTenantAdmin, type TenantAdmin } from './fixtures/tenant'
import { ADMIN_PLATEFORME, MANAGER, seConnecter, obtenirToken } from './fixtures/comptes'

/** Boutique du seed, celle du manager. */
const SEED_BOUTIQUE = { id: 1, nom: 'iziGSM Paris 11' }

/**
 * Connexion en admin plateforme, **puis attente de la console**.
 *
 * Attendre est indispensable : `seConnecter` rend la main dès le clic, et naviguer
 * avant que la session ne soit posée renvoie au formulaire de connexion.
 */
async function seConnecterAdminPlateforme(page: Page) {
  await seConnecter(page, ADMIN_PLATEFORME)
  await expect(page.locator('#console-table')).toBeVisible({ timeout: 15_000 })
}

/**
 * Crée un tenant jetable et lui donne un client au nom unique.
 *
 * C'est le témoin de la bascule : ce nom n'existe que dans cette boutique-là, donc le
 * voir à l'écran prouve que la page travaille bien sur elle, et non sur celle du seed.
 */
async function creerBoutiqueTemoin(request: APIRequestContext): Promise<{
  tenant: TenantAdmin
  nomBoutique: string
  nomClient: string
}> {
  const tenant = await createTenantAdmin(request)

  const boutiquesRes = await request.get('/api/boutiques', {
    headers: { Authorization: `Bearer ${tenant.accessToken}` },
  })
  expect(boutiquesRes.status()).toBe(200)
  const nomBoutique = (await boutiquesRes.json()).data[0].nom as string

  const nomClient = `Temoin${Date.now()}`
  const clientRes = await request.post('/api/clients', {
    headers: { Authorization: `Bearer ${tenant.accessToken}` },
    data: {
      boutique_id: tenant.boutiqueId,
      nom:         nomClient,
      prenom:      'Bascule',
      email:       `${nomClient.toLowerCase()}@e2e-test.local`,
      telephone:   '0600000000',
    },
  })
  expect(clientRes.ok(), `création du client témoin : ${await clientRes.text()}`).toBe(true)

  return { tenant, nomBoutique, nomClient }
}

/** Choisit une boutique depuis la console, en la retrouvant par son nom. */
async function choisirBoutique(page: Page, nomBoutique: string) {
  await page.goto('/console-boutiques')
  await expect(page.locator('#console-table')).toBeVisible({ timeout: 15_000 })
  await page.fill('#console-search', nomBoutique)

  const ligne = page.locator('#console-list tr', { hasText: nomBoutique }).first()
  await expect(ligne).toBeVisible()
  await ligne.click()
}

// ══════════════════════════════════════════════════════════════════════════════
// SEAM 1 — NAVIGATEUR
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Sélection d\'une boutique — navigateur', () => {
  test('choisir une boutique mène à une page métier peuplée de ses données', async ({ page, request }) => {
    const { nomBoutique, nomClient } = await creerBoutiqueTemoin(request)

    await seConnecterAdminPlateforme(page)
    await choisirBoutique(page, nomBoutique)

    // La sélection sort de la console vers l'application elle-même.
    await expect(page.locator('#sidebar')).toBeVisible({ timeout: 15_000 })
    expect(page.url()).not.toContain('/console-boutiques')

    await page.goto('/clients')
    await expect(page.locator('#clients-tbody')).toContainText(nomClient, { timeout: 15_000 })
  })

  test('le choix persiste en naviguant vers une autre page, sans le refaire', async ({ page, request }) => {
    const { nomBoutique, nomClient } = await creerBoutiqueTemoin(request)

    await seConnecterAdminPlateforme(page)
    await choisirBoutique(page, nomBoutique)

    await page.goto('/clients')
    await expect(page.locator('#clients-tbody')).toContainText(nomClient, { timeout: 15_000 })

    // Une autre page, puis retour : la boutique consultée n'a pas bougé.
    await page.goto('/dashboard')
    await expect(page.locator('#kpi-grid')).toBeVisible({ timeout: 15_000 })
    await page.goto('/clients')
    await expect(page.locator('#clients-tbody')).toContainText(nomClient, { timeout: 15_000 })
  })

  test('changer de boutique depuis la console rebascule les pages sur la nouvelle', async ({ page, request }) => {
    const premiere = await creerBoutiqueTemoin(request)
    const seconde  = await creerBoutiqueTemoin(request)

    await seConnecterAdminPlateforme(page)
    await choisirBoutique(page, premiere.nomBoutique)
    await page.goto('/clients')
    await expect(page.locator('#clients-tbody')).toContainText(premiere.nomClient, { timeout: 15_000 })

    await choisirBoutique(page, seconde.nomBoutique)
    await page.goto('/clients')
    await expect(page.locator('#clients-tbody')).toContainText(seconde.nomClient, { timeout: 15_000 })
    // Et plus celui de la précédente : rebasculer, ce n'est pas cumuler.
    await expect(page.locator('#clients-tbody')).not.toContainText(premiere.nomClient)
  })

  test('une route qui exigeait boutique_id répond 200 une fois une boutique choisie', async ({ page, request }) => {
    const { nomBoutique } = await creerBoutiqueTemoin(request)

    await seConnecterAdminPlateforme(page)
    await choisirBoutique(page, nomBoutique)

    const reponse = page.waitForResponse(
      r => r.url().includes('/api/tickets') && r.request().method() === 'GET',
      { timeout: 15_000 }
    )
    await page.goto('/tickets')
    expect((await reponse).status()).toBe(200)
  })

  test("l'agenda vise la boutique consultée, et non une boutique codée en dur", async ({ page, request }) => {
    // Régression : cette page portait son propre résolveur de boutique, chargé après
    // le socle et l'écrasant, qui retombait toujours sur la boutique 1. Elle était la
    // seule des 29 pages à ne pas suivre la sélection.
    const { tenant, nomBoutique } = await creerBoutiqueTemoin(request)

    await seConnecterAdminPlateforme(page)
    await choisirBoutique(page, nomBoutique)

    const appel = page.waitForRequest(
      r => r.url().includes('/api/agenda/kpis'),
      { timeout: 15_000 }
    )
    await page.goto('/agenda')
    expect(new URL((await appel).url()).searchParams.get('boutique_id')).toBe(String(tenant.boutiqueId))
  })

  test("l'en-tête annonce « Console plateforme » tant qu'aucune boutique n'est choisie", async ({ page }) => {
    await seConnecterAdminPlateforme(page)
    await expect(page.locator('#console-table')).toBeVisible({ timeout: 15_000 })

    // Page métier atteinte sans sélection : le repli « MyDesk » nommerait une
    // boutique qui n'existe pas.
    await page.goto('/dashboard')
    await expect(page.locator('.sidebar-user .u-role')).toHaveText('Console plateforme', { timeout: 15_000 })
  })

  test("l'en-tête affiche le nom de la boutique consultée après sélection", async ({ page, request }) => {
    const { nomBoutique } = await creerBoutiqueTemoin(request)

    await seConnecterAdminPlateforme(page)
    await choisirBoutique(page, nomBoutique)

    await page.goto('/clients')
    await expect(page.locator('.sidebar-user .u-role')).toHaveText(nomBoutique, { timeout: 15_000 })
  })

  test('un manager garde le libellé de boutique qu\'il avait — jamais celui de la console', async ({ page }) => {
    await seConnecter(page, MANAGER)
    await expect(page.locator('#kpi-grid')).toBeVisible({ timeout: 15_000 })

    // Comportement de référence, antérieur à ce chantier : aucune réponse de l'API
    // d'authentification ne porte de nom de boutique (`boutique_name` n'existe nulle
    // part côté serveur), donc le socle affiche son repli — c'est le cas « boutique
    // sans nom configuré » prévu par la spec. Ce qui compte ici est que rien ne
    // change pour un manager, et surtout qu'il ne lise jamais « Console plateforme ».
    await expect(page.locator('.sidebar-user .u-role')).toHaveText('MyDesk')
  })

  test('après déconnexion puis reconnexion, aucune boutique n\'est présélectionnée', async ({ page, request }) => {
    const { nomBoutique } = await creerBoutiqueTemoin(request)

    await seConnecterAdminPlateforme(page)
    await choisirBoutique(page, nomBoutique)
    await page.goto('/clients')
    await expect(page.locator('.sidebar-user .u-role')).toHaveText(nomBoutique, { timeout: 15_000 })

    await page.click('.sidebar-footer a[onclick="logout()"]')
    await expect(page.locator('#login-form')).toBeVisible({ timeout: 15_000 })

    await seConnecterAdminPlateforme(page)
    await expect(page.locator('#console-table')).toBeVisible({ timeout: 15_000 })
    await page.goto('/dashboard')
    await expect(page.locator('.sidebar-user .u-role')).toHaveText('Console plateforme', { timeout: 15_000 })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// SEAM 2 — API
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Résolution de la boutique côté API — les trois cas', () => {
  test("l'admin plateforme sans boutique visée reçoit 400, avec une boutique visée reçoit 200", async ({ request }) => {
    const token = await obtenirToken(request, ADMIN_PLATEFORME)
    const auth  = { Authorization: `Bearer ${token}` }

    const sans = await request.get('/api/tickets', { headers: auth })
    expect(sans.status(), 'sans boutique_id, la route ne peut pas deviner la cible').toBe(400)

    const avec = await request.get(`/api/tickets?boutique_id=${SEED_BOUTIQUE.id}`, { headers: auth })
    expect(avec.status()).toBe(200)
  })

  test('le manager passe sans rien préciser, et reste borné à sa boutique', async ({ request }) => {
    const token = await obtenirToken(request, MANAGER)

    const res = await request.get('/api/tickets', { headers: { Authorization: `Bearer ${token}` } })
    expect(res.status()).toBe(200)
  })

  test("l'étranger est refusé : viser une autre boutique ne change rien pour un manager", async ({ request }) => {
    const tenant = await createTenantAdmin(request)
    const token  = await obtenirToken(request, MANAGER)
    const auth   = { Authorization: `Bearer ${token}` }

    const sien     = await request.get('/api/tickets', { headers: auth })
    const etranger = await request.get(`/api/tickets?boutique_id=${tenant.boutiqueId}`, { headers: auth })
    expect(sien.status()).toBe(200)
    expect(etranger.status()).toBe(200)

    // Comparer les deux réponses plutôt que filtrer la seconde : une assertion qui
    // parcourt une liste ne prouve rien quand la liste est vide. Ici l'égalité échoue
    // dès que le paramètre a le moindre effet — et la boutique du seed a des tickets,
    // donc les deux réponses sont non vides.
    expect(await etranger.json()).toEqual(await sien.json())
  })
})
