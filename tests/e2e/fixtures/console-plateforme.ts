/**
 * @file tests/e2e/fixtures/console-plateforme.ts
 * @description Helpers de la console des boutiques, partagés par les suites du chantier
 * supervision (sélection de boutique, bandeau permanent).
 *
 * Extraits le 2026-08-01 (ticket 03) : deux suites avaient besoin de la même séquence
 * « se connecter en admin plateforme, créer une boutique cliente, la choisir ». Même
 * motif que `comptes.ts` — un changement de la console ne doit avoir qu'un seul endroit
 * à corriger.
 */
import { expect, type Page, type APIRequestContext } from '@playwright/test'
import { createTenantAdmin, type TenantAdmin } from './tenant'
import { ADMIN_PLATEFORME, seConnecter } from './comptes'

/**
 * Connexion en admin plateforme, **puis attente de la console**.
 *
 * Attendre est indispensable : `seConnecter` rend la main dès le clic, et naviguer
 * avant que la session ne soit posée renvoie au formulaire de connexion.
 */
export async function seConnecterAdminPlateforme(page: Page) {
  await seConnecter(page, ADMIN_PLATEFORME)
  await expect(page.locator('#console-table')).toBeVisible({ timeout: 15_000 })
}

/**
 * Crée une boutique cliente jetable et retourne son nom.
 *
 * Le nom est lu depuis l'API plutôt que fabriqué ici : c'est celui que la console
 * affichera et que le bandeau devra reprendre.
 */
export async function creerBoutique(request: APIRequestContext): Promise<{
  tenant: TenantAdmin
  nomBoutique: string
}> {
  const tenant = await createTenantAdmin(request)

  const boutiquesRes = await request.get('/api/boutiques', {
    headers: { Authorization: `Bearer ${tenant.accessToken}` },
  })
  expect(boutiquesRes.status()).toBe(200)
  const nomBoutique = (await boutiquesRes.json()).data[0].nom as string

  return { tenant, nomBoutique }
}

/** Choisit une boutique depuis la console, en la retrouvant par son nom. */
export async function choisirBoutique(page: Page, nomBoutique: string) {
  await page.goto('/console-boutiques')
  await expect(page.locator('#console-table')).toBeVisible({ timeout: 15_000 })
  await page.fill('#console-search', nomBoutique)

  const ligne = page.locator('#console-list tr', { hasText: nomBoutique }).first()
  await expect(ligne).toBeVisible()
  await ligne.click()
}
