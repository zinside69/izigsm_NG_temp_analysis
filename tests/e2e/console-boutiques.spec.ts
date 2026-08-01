/**
 * @file tests/e2e/console-boutiques.spec.ts
 * @description Console des boutiques — point d'entrée de l'admin plateforme.
 *
 * Deux seams (spec `.scratch/supervision-admin-plateforme/spec.md`) :
 *   - navigateur : où l'on atterrit, ce que la console affiche, ce qu'un manager voit
 *   - API        : ce que `GET /api/boutiques` répond selon le rôle
 *
 * Prior art : `tests/e2e/auth.spec.ts` (connexion réelle) et
 * `tests/e2e/isolation-routes.spec.ts` (assertions API par rôle).
 *
 * Comptes seed.sql : `admin@izigsm.fr` est l'**admin plateforme** (boutique_id NULL),
 * `manager@izigsm.fr` est le **manager** de la boutique 1 « iziGSM Paris 11 ».
 */
import { test, expect } from '@playwright/test'
import { ADMIN_PLATEFORME, MANAGER, seConnecter, obtenirToken } from './fixtures/comptes'

// Boutique du seed — 3 comptes rattachés (manager + 2 techniciens ; l'admin
// plateforme n'est rattaché à aucune boutique, il ne compte donc nulle part).
const SEED_BOUTIQUE = { nom: 'iziGSM Paris 11', slug: 'izigsm-paris-11', nbComptes: 3 }

// ══════════════════════════════════════════════════════════════════════════════
// SEAM 1 — NAVIGATEUR
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Console des boutiques — navigateur', () => {
  test("une connexion en admin plateforme aboutit sur la console, pas sur le tableau de bord", async ({ page }) => {
    await seConnecter(page, ADMIN_PLATEFORME)

    await expect(page.locator('#console-table')).toBeVisible({ timeout: 15_000 })
    expect(page.url()).toContain('/console-boutiques')
  })

  test('la console liste la boutique du seed avec nom, slug et nombre de comptes', async ({ page }) => {
    await seConnecter(page, ADMIN_PLATEFORME)
    await expect(page.locator('#console-table')).toBeVisible({ timeout: 15_000 })

    const ligne = page.locator('#console-list tr[data-boutique-id="1"]')
    await expect(ligne).toBeVisible()
    await expect(ligne.locator('.b-nom')).toHaveText(SEED_BOUTIQUE.nom)
    await expect(ligne.locator('.b-slug')).toHaveText(SEED_BOUTIQUE.slug)
    await expect(ligne.locator('.b-comptes')).toHaveText(String(SEED_BOUTIQUE.nbComptes))
  })

  test('la recherche par nom filtre la liste', async ({ page }) => {
    await seConnecter(page, ADMIN_PLATEFORME)
    await expect(page.locator('#console-list tr[data-boutique-id="1"]')).toBeVisible({ timeout: 15_000 })

    // Un nom qui n'existe pas : la boutique du seed doit disparaître, avec un
    // message — jamais un tableau vide muet.
    await page.fill('#console-search', 'zzz-aucune-boutique-ne-porte-ce-nom')
    await expect(page.locator('#console-list tr[data-boutique-id="1"]')).toHaveCount(0)
    await expect(page.locator('#console-empty[data-etat="aucun-resultat"]')).toBeVisible()

    // Un fragment du nom réel : elle revient.
    await page.fill('#console-search', 'Paris 11')
    await expect(page.locator('#console-list tr[data-boutique-id="1"]')).toBeVisible()
  })

  test("sans aucune boutique active, un message explicite s'affiche et aucun bouton de création", async ({ page }) => {
    // La console est alimentée par l'API : on force la réponse vide plutôt que de
    // vider la base locale, que les autres tests partagent.
    await page.route('**/api/boutiques*', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) })
    )

    await seConnecter(page, ADMIN_PLATEFORME)

    // Attendre l'état « vide » et non la simple présence du bloc : celui-ci
    // existe dès le HTML initial pour porter le message de chargement, donc
    // `toBeVisible` seul passerait avant même que la page ait appelé l'API.
    const vide = page.locator('#console-empty[data-etat="vide"]')
    await expect(vide).toBeVisible({ timeout: 15_000 })
    await expect(vide).toContainText(/aucune boutique cliente/i)
    await expect(page.locator('#console-table')).toBeHidden()
    await expect(page.getByRole('button', { name: /cr[ée]er/i })).toHaveCount(0)
  })

  test("un manager atteignant l'URL de la console est renvoyé vers son tableau de bord", async ({ page }) => {
    await seConnecter(page, MANAGER)
    await expect(page.locator('#kpi-grid')).toBeVisible({ timeout: 15_000 })

    await page.goto('/console-boutiques')

    await expect(page.locator('#kpi-grid')).toBeVisible({ timeout: 15_000 })
    expect(page.url()).toContain('/dashboard')
  })

  test('une connexion en manager aboutit toujours sur le tableau de bord', async ({ page }) => {
    await seConnecter(page, MANAGER)

    await expect(page.locator('#kpi-grid')).toBeVisible({ timeout: 15_000 })
    expect(page.url()).toContain('/dashboard')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// SEAM 2 — API
// ══════════════════════════════════════════════════════════════════════════════

test.describe('GET /api/boutiques — selon le rôle', () => {
  test("l'admin plateforme reçoit toutes les boutiques actives, chacune avec son nombre de comptes", async ({ request }) => {
    const token = await obtenirToken(request, ADMIN_PLATEFORME)

    const res = await request.get('/api/boutiques', { headers: { Authorization: `Bearer ${token}` } })
    expect(res.status()).toBe(200)
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
    // Toutes les lignes portent le comptage, pas seulement celle du seed.
    for (const b of body.data) {
      expect(typeof b.nb_comptes).toBe('number')
    }

    const seed = body.data.find((b: any) => b.slug === SEED_BOUTIQUE.slug)
    expect(seed, 'la boutique du seed doit être présente').toBeTruthy()
    expect(seed.nom).toBe(SEED_BOUTIQUE.nom)
    expect(seed.nb_comptes).toBe(SEED_BOUTIQUE.nbComptes)
  })

  test('un manager ne reçoit que sa boutique, au même format qu\'avant ce chantier', async ({ request }) => {
    const token = await obtenirToken(request, MANAGER)

    const res = await request.get('/api/boutiques', { headers: { Authorization: `Bearer ${token}` } })
    expect(res.status()).toBe(200)
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe(1)
    expect(body.data[0].nom).toBe(SEED_BOUTIQUE.nom)
    // Chemin manager laissé intact : pas d'enrichissement, donc pas de nb_comptes.
    expect(body.data[0].nb_comptes).toBeUndefined()
  })
})
