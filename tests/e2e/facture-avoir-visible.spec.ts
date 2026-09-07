/**
 * @file tests/e2e/facture-avoir-visible.spec.ts
 * @description Une facture émise propose l'avoir, et ne propose plus l'émission.
 *
 * L'avoir est la **seule voie d'annulation** d'une facture depuis le ticket 003
 * (`CLAUDE.md` § Factures). Si l'écran ne l'offre pas, l'invariant est vrai côté
 * serveur et inapplicable côté exploitant.
 *
 * Symptôme constaté en production le 2026-09-07, session admin plateforme : sur des
 * factures que `GET /api/factures` renvoie avec `locked: 1`, l'écran n'affiche ni le
 * badge de verrouillage, ni le bouton « Créer un avoir », et propose « Émettre » sur
 * une facture déjà émise. Les trois dépendent de `f.locked`.
 *
 * Ce spec joue le cas **manager** — le plus simple, sans sélection de boutique. S'il
 * est rouge, le défaut n'a rien à voir avec l'admin plateforme.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { MANAGER, obtenirToken, seConnecter } from './fixtures/comptes'
import { seConnecterAdminPlateforme, choisirBoutique } from './fixtures/console-plateforme'

const LIGNES = [
  { description: 'Réparation écran', quantite: 1, prix_unitaire_ht: 100, tva_taux: 20 },
]

/** Boutique 1 du seed — celle où le symptôme a été observé en production. */
const BOUTIQUE_SEED = 'iziGSM Paris 11'

/** Crée une facture réellement émise sur la boutique 1, et renvoie son numéro. */
async function emettreFactureSeed(request: APIRequestContext): Promise<string> {
  const token = await obtenirToken(request, MANAGER)
  const auth  = { Authorization: `Bearer ${token}` }

  const client = await request.post('/api/clients', {
    headers: auth,
    data: { prenom: 'Avoir', nom: `Visible${Date.now()}`, boutique_id: 1 },
  })
  expect(client.status()).toBe(201)

  const brouillon = await request.post('/api/factures', {
    headers: auth,
    data: { client_id: (await client.json()).id, boutique_id: 1, lignes: LIGNES, action: 'brouillon' },
  })
  expect(brouillon.status()).toBe(201)

  const emise = await request.post(`/api/factures/${(await brouillon.json()).facture_id}/emettre`, { headers: auth })
  expect(emise.status()).toBe(200)
  return (await emise.json()).facture_numero as string
}

/** Les deux boutons dont l'affichage dépend de `f.locked`, sur la ligne d'un numéro. */
async function verifierBoutons(page: Page, numero: string) {
  const ligne = page.locator('table tbody tr', { hasText: numero }).first()
  await expect(ligne).toBeVisible({ timeout: 15_000 })

  await expect(
    ligne.locator('button[title="Créer un avoir (NF525)"]'),
    'l\'avoir est la seule annulation possible : sans ce bouton, l\'exploitant n\'en a aucune',
  ).toBeVisible()

  await expect(
    ligne.locator('button[title="Émettre et verrouiller (CGI art. 289)"]'),
    'proposer d\'émettre une facture déjà émise mène à un refus serveur',
  ).toHaveCount(0)
}

test.describe('écran Factures — une facture émise propose l\'avoir', () => {
  test('manager : la ligne d\'une facture émise porte « Créer un avoir », et plus « Émettre »', async ({ page, request }) => {
    const numero = await emettreFactureSeed(request)

    // `seConnecter` rend la main dès le clic : naviguer tout de suite entre en
    // collision avec la redirection post-connexion (`net::ERR_ABORTED`).
    await seConnecter(page, MANAGER)
    // `waitUntil: 'commit'` : le dashboard n'atteint pas l'état `load` dans ce
    // contexte, et on n'a besoin que de la session posée, pas de la page peinte.
    await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
    await page.goto('/factures')

    await verifierBoutons(page, numero)
  })

  test('admin plateforme, boutique choisie : même écran, mêmes boutons', async ({ page, request }) => {
    const numero = await emettreFactureSeed(request)

    await seConnecterAdminPlateforme(page)
    await choisirBoutique(page, BOUTIQUE_SEED)
    await page.goto('/factures')

    await verifierBoutons(page, numero)
  })

  test('admin plateforme sans boutique choisie : l\'écran ne montre pas de facture verrouillée à tort', async ({ page, request }) => {
    /*
     * Configuration exacte du symptôme observé en production le 2026-09-07 :
     * `boutique_selectionnee_id` nul, donc `getBoutiqueId()` renvoie null. L'écran
     * affichait pourtant des factures — et pour celles que l'API donne `locked: 1`,
     * ni badge de verrouillage ni bouton d'avoir, avec « Émettre » proposé.
     */
    const numero = await emettreFactureSeed(request)

    await seConnecterAdminPlateforme(page)
    await page.goto('/factures')

    const ligne = page.locator('table tbody tr', { hasText: numero })

    // Deux issues acceptables, une seule inacceptable : afficher la ligne SANS l'avoir.
    if (await ligne.count() === 0) {
      test.info().annotations.push({
        type: 'observation',
        description: 'sans boutique choisie, aucune facture n\'est affichée — pas de mensonge à l\'écran',
      })
      return
    }

    await verifierBoutons(page, numero)
  })

  test('cache local écrit sans `locked` : l\'écran ne doit pas en déduire « non verrouillée »', async ({ page }) => {
    /*
     * Rejeu de l'état capturé en production. La page garde les factures dans
     * `localStorage.izigsm_factures` (`setDB`) et s'en sert quand l'API ne répond pas
     * de liste — le cas d'un admin plateforme sans boutique choisie, où
     * `getBoutiqueId()` vaut null.
     *
     * Un cache écrit par une version du mapping ANTÉRIEURE à la ligne
     * `locked: f.locked === 1 || f.locked === true` ne porte pas ce champ. Tout ce qui
     * dépend de `f.locked` bascule alors du mauvais côté : pas de badge, pas d'avoir,
     * et « Émettre » proposé sur une facture pourtant émise.
     *
     * `addInitScript` reçoit une CHAÎNE, pas une fonction : `tsconfig` n'inclut pas la
     * lib `dom`, et une fonction manipulant `localStorage` casserait la baseline tsc.
     */
    const cachePerime = JSON.stringify([{
      id: 999901,
      number: 'FAC-2026-09901',
      clientName: 'Cache Périmé',
      description: 'facture émise, mais le cache ne le dit pas',
      subtotalHT: 100, tva: 20, totalTTC: 120,
      status: 'en_attente', _statut: 'en_attente',
      createdAt: new Date().toISOString(),
      hash_nf525: 'a'.repeat(64),
      // `locked` volontairement ABSENT — c'est tout l'objet du rejeu.
    }])

    await page.addInitScript(`localStorage.setItem('izigsm_factures', '${cachePerime.replace(/'/g, "\\'")}')`)

    await seConnecterAdminPlateforme(page)
    await page.goto('/factures')

    const ligne = page.locator('table tbody tr', { hasText: 'FAC-2026-09901' }).first()
    await expect(ligne, 'préalable du rejeu : la page doit bien afficher la ligne du cache').toBeVisible({ timeout: 15_000 })

    await verifierBoutons(page, 'FAC-2026-09901')
  })
})
