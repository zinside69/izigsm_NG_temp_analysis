/**
 * @file tests/e2e/fixtures/tenant.ts
 * @description Helpers E2E — création d'un second tenant (boutique + admin) via
 * l'API publique register/verify-otp, pour tester l'isolation multi-boutique sans
 * dépendre des données seed.sql (boutique 1 uniquement).
 *
 * Utilise `otpDemo` (retourné par POST /api/auth/register uniquement en local sans
 * RESEND_API_KEY configurée — voir src/routes/auth.ts) : conçu pour ce cas d'usage,
 * jamais actif en environnement avec une vraie clé Resend.
 */
import type { APIRequestContext } from '@playwright/test'

export interface TenantAdmin {
  email: string
  accessToken: string
  boutiqueId: number
}

let counter = 0

export async function createTenantAdmin(request: APIRequestContext): Promise<TenantAdmin> {
  counter += 1
  const email = `e2e-tenant-${Date.now()}-${counter}@e2e-test.local`
  const password = 'E2eTest@2026!'
  const workshopName = `E2E Boutique ${Date.now()}-${counter}`

  const registerRes = await request.post('/api/auth/register', {
    data: { email, password, prenom: 'E2E', nom: 'Tenant', workshopName },
  })
  if (!registerRes.ok()) {
    throw new Error(`register failed: ${registerRes.status()} ${await registerRes.text()}`)
  }
  const registerBody = await registerRes.json()
  const otp = registerBody.otpDemo
  if (!otp) {
    throw new Error(
      'otpDemo absent de la réponse register — RESEND_API_KEY est configurée dans cet ' +
      'environnement de test, ou le contrat de l\'API a changé. Ce fixture ne doit ' +
      'tourner que contre un wrangler local sans clé Resend.'
    )
  }

  const verifyRes = await request.post('/api/auth/verify-otp', { data: { email, otp } })
  if (!verifyRes.ok()) {
    throw new Error(`verify-otp failed: ${verifyRes.status()} ${await verifyRes.text()}`)
  }
  const verifyBody = await verifyRes.json()

  return {
    email,
    accessToken: verifyBody.accessToken,
    boutiqueId: verifyBody.user?.boutique_id,
  }
}
