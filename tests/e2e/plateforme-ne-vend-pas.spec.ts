/**
 * @file tests/e2e/plateforme-ne-vend-pas.spec.ts
 * @description L'écran ne propose pas à un admin plateforme ce que le serveur lui refuse.
 *
 * Depuis le ticket 004, un admin plateforme ne peut inscrire aucune pièce au registre
 * légal d'une boutique cliente (ADR 0002). Le serveur refuse ; l'écran doit cesser de
 * l'offrir — même parti pris que le ticket 003, qui a préféré un refus explicite à une
 * erreur muette. Proposer une action vouée à échouer est exactement ce que faisait le
 * bouton « Émettre » du défaut `f.locked`, corrigé le 2026-09-07.
 *
 * Le volet manager est le contrôle de non-débordement : ces boutons doivent rester là
 * pour qui a le droit de s'en servir.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { MANAGER, obtenirToken, seConnecter } from './fixtures/comptes'
import { seConnecterAdminPlateforme, choisirBoutique, creerBoutique } from './fixtures/console-plateforme'

const LIGNES = [
  { description: 'Réparation écran', quantite: 1, prix_unitaire_ht: 100, tva_taux: 20 },
]

const BOUTIQUE_SEED = 'iziGSM Paris 11'

const TITRE_EMETTRE = 'button[title="Émettre et verrouiller (CGI art. 289)"]'
const TITRE_AVOIR   = 'button[title="Créer un avoir (NF525)"]'

/**
 * Prépare, sous un compte manager, les deux états que l'écran distingue :
 * une facture émise (qui offre l'avoir) et un brouillon (qui offre l'émission).
 */
async function preparerFactures(request: APIRequestContext) {
  const token = await obtenirToken(request, MANAGER)
  const auth  = { Authorization: `Bearer ${token}` }

  const client = await request.post('/api/clients', {
    headers: auth,
    data: { prenom: 'Plateforme', nom: `NeVendPas${Date.now()}`, boutique_id: 1 },
  })
  expect(client.status()).toBe(201)
  const clientId = (await client.json()).id

  const corps = { client_id: clientId, boutique_id: 1, lignes: LIGNES }

  const aEmettre = await request.post('/api/factures', {
    headers: auth, data: { ...corps, action: 'brouillon' },
  })
  expect(aEmettre.status()).toBe(201)
  const emise = await request.post(`/api/factures/${(await aEmettre.json()).facture_id}/emettre`, { headers: auth })
  expect(emise.status()).toBe(200)

  const brouillon = await request.post('/api/factures', {
    headers: auth, data: { ...corps, action: 'brouillon' },
  })
  expect(brouillon.status()).toBe(201)

  return {
    numeroEmise: (await emise.json()).facture_numero as string,
    idBrouillon: (await brouillon.json()).facture_id as number,
  }
}

/** La ligne du tableau portant ce texte. */
function ligne(page: Page, texte: string) {
  return page.locator('table tbody tr', { hasText: texte }).first()
}

test.describe('la plateforme ne vend pas — écran (ticket 004)', () => {
  test("un admin plateforme ne se voit proposer ni l'émission ni l'avoir", async ({ page, request }) => {
    const { numeroEmise } = await preparerFactures(request)

    await seConnecterAdminPlateforme(page)
    await choisirBoutique(page, BOUTIQUE_SEED)
    await page.goto('/factures')

    const ligneEmise = ligne(page, numeroEmise)
    await expect(ligneEmise).toBeVisible({ timeout: 15_000 })

    await expect(
      ligneEmise.locator(TITRE_AVOIR),
      "le serveur refuse l'avoir à un admin plateforme : l'écran ne doit pas l'offrir",
    ).toHaveCount(0)

    await expect(
      page.locator(TITRE_EMETTRE),
      "l'émission est refusée à un admin plateforme, sur toute facture de la page",
    ).toHaveCount(0)
  })

  test('un manager garde les deux commandes', async ({ page, request }) => {
    const { numeroEmise } = await preparerFactures(request)

    // `seConnecter` rend la main dès le clic : naviguer aussitôt entre en concurrence
    // avec la redirection post-connexion et abandonne le goto (net::ERR_ABORTED).
    await seConnecter(page, MANAGER)
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
    await page.goto('/factures')

    const ligneEmise = ligne(page, numeroEmise)
    await expect(ligneEmise).toBeVisible({ timeout: 15_000 })

    await expect(
      ligneEmise.locator(TITRE_AVOIR),
      "la fermeture ne doit pas déborder : un manager signe ses propres pièces",
    ).toHaveCount(1)

    await expect(page.locator(TITRE_EMETTRE).first()).toBeVisible()
  })
})

test.describe('la plateforme ne vend pas — caisse (ticket 004)', () => {
  test("un admin plateforme ne se voit pas proposer la vente en caisse", async ({ page, request }) => {
    // Une boutique neuve : le scénario ne dépend d'aucune donnée du seed.
    const { nomBoutique } = await creerBoutique(request)

    await seConnecterAdminPlateforme(page)
    await choisirBoutique(page, nomBoutique)
    await page.goto('/caisse')

    // La page doit être chargée avant de conclure à l'absence d'un bouton : sans ce
    // préalable, le test passerait aussi sur une page blanche.
    await expect(page.locator('#kpi-nb-tx')).toBeVisible({ timeout: 15_000 })

    await expect(
      page.locator('button:has-text("Nouvelle vente")'),
      "le serveur refuse la vente à un admin plateforme : l'écran ne doit pas l'offrir",
    ).toHaveCount(0)
  })
})
