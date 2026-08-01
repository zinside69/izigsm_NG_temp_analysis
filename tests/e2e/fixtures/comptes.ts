/**
 * @file tests/e2e/fixtures/comptes.ts
 * @description Comptes du seed et helpers d'authentification partagés par les suites E2E.
 *
 * Extraits le 2026-08-01 : trois suites recopiaient les mêmes identifiants et la même
 * séquence de connexion. Un identifiant de seed qui change ne doit avoir qu'un seul
 * endroit à corriger.
 *
 * Comptes `seed.sql` : `admin@izigsm.fr` est l'**admin plateforme** (`boutique_id` NULL),
 * `manager@izigsm.fr` est le **manager** de la boutique 1 « iziGSM Paris 11 ».
 */
import { expect, type Page, type APIRequestContext } from '@playwright/test'

export interface Compte {
  email: string
  password: string
}

export const ADMIN_PLATEFORME: Compte = { email: 'admin@izigsm.fr',   password: 'Admin@2026!' }
export const MANAGER:          Compte = { email: 'manager@izigsm.fr', password: 'Admin@2026!' }

/**
 * Connexion par le formulaire réel, sans présumer de la page d'arrivée.
 *
 * Rend la main dès le clic : l'appelant décide de ce qu'il attend ensuite, car la
 * destination dépend du rôle.
 */
export async function seConnecter(page: Page, { email, password }: Compte) {
  await page.goto('/login.html')
  await page.fill('#login-email', email)
  await page.fill('#login-password', password)
  await page.click('#login-form button[type="submit"]')
}

/** Jeton d'accès obtenu par l'API — pour les tests du seam API. */
export async function obtenirToken(request: APIRequestContext, compte: Compte): Promise<string> {
  const res = await request.post('/api/auth/login', { data: compte })
  expect(res.status()).toBe(200)
  return (await res.json()).accessToken as string
}
