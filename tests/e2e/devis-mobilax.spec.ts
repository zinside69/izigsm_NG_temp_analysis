/**
 * @file tests/e2e/devis-mobilax.spec.ts
 * @description Écran devis — recherche Mobilax et ligne marginée (ticket 06 `integration-mobilax`,
 * tâche écran T-007). Le module partagé (`public/static/js/mobilax-recherche.js`) et le serveur
 * (`GET /api/mobilax/produits`, `GET /api/mobilax/prix-vente`, `src/routes/mobilax.ts` et
 * `src/services/mobilaxService.ts`) ont été livrés par le ticket précédent — cette suite ne
 * modifie ni ne rejoue leur code, elle prouve la couture côté écran devis.
 *
 * `/api/mobilax/*` est stubé par `page.route()` (aucun quota réel brûlé). Chaque corps stubé
 * recopie EXACTEMENT la forme que rend la route réelle (`src/routes/mobilax.ts`) — enveloppe
 * `success`/`data`, noms de clés (dont `prix_vente_ht` et `reessayer_dans_s`), code d'erreur,
 * statut HTTP de `STATUT_PAR_ERREUR` — avec en commentaire la ligne de `src/routes/mobilax.ts`
 * dont chaque corps est recopié. `serviceWorkers: 'block'` est déjà posé par
 * `playwright.config.ts` : `sw.js` n'intercepte donc jamais `/api/*` ici.
 *
 * ⚠ Ce que cette suite NE prouve PAS : la marge elle-même (taux résolu par famille ou par
 * défaut, formule `prixDeVente()`). Elle est prouvée par les tests vitest de
 * `prixVenteMobilax()` (`tests/mobilaxPrixVente.test.ts`) et de la route
 * (`tests/mobilax-route.test.ts`) — cette suite relaie une réponse STUBÉE, elle ne peut donc
 * rien dire sur le calcul serveur réel. Elle prouve seulement que l'écran affiche le
 * `prix_vente_ht` reçu (jamais le `prix_achat_ht`), et que ce prix reste modifiable jusqu'à
 * l'enregistrement.
 *
 * Chaque cas de cette suite a été vu rouge avant son correctif (module absent puis
 * `addLine()` non appelée par une sélection Mobilax, verrou absent pour le double clic,
 * absence de message sur réseau coupé/quota/indisponible).
 */
import { test, expect, type APIRequestContext, type Page, type Locator } from '@playwright/test'
import { createTenantAdmin, type TenantAdmin } from './fixtures/tenant'
import { seConnecter } from './fixtures/comptes'

// ═══════════════════════════════════════════════════════════════════════════════
// Aides
// ═══════════════════════════════════════════════════════════════════════════════

async function creerClient(request: APIRequestContext, tenant: TenantAdmin): Promise<number> {
  const res = await request.post('/api/clients', {
    headers: { Authorization: `Bearer ${tenant.accessToken}` },
    data:    { prenom: 'E2E', nom: 'Client Devis', boutique_id: tenant.boutiqueId },
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()).id as number
}

/**
 * Connexion, boutique neuve avec un client, ouverture du formulaire « Nouveau devis » (client
 * sélectionné), puis ouverture du conteneur de recherche Mobilax. Les stubs `page.route()`
 * doivent être posés par l'appelant AVANT cet appel.
 */
async function prepararDevisAvecMobilax(page: Page, request: APIRequestContext) {
  const tenant   = await createTenantAdmin(request)
  const clientId = await creerClient(request, tenant)

  await seConnecter(page, { email: tenant.email, password: tenant.password })
  await page.waitForURL('**/dashboard**', { timeout: 15_000, waitUntil: 'commit' })
  await page.goto('/devis')

  // Deux boutons portent le même texte (en-tête de page + état vide d'une boutique neuve sans
  // devis) : le scope sur .page-header-actions lève l'ambiguïté.
  await page.locator('.page-header-actions').getByRole('button', { name: '+ Nouveau devis' }).click()
  await expect(page.locator('#modal-devis')).toHaveCSS('opacity', '1', { timeout: 10_000 })

  await expect(page.locator(`#d-client option[value="${clientId}"]`)).toHaveCount(1, { timeout: 10_000 })
  await page.selectOption('#d-client', String(clientId))

  await page.click('#btn-devis-mobilax')
  const conteneur = page.locator('#devis-mobilax-recherche')
  await expect(conteneur).toBeVisible()

  return { tenant, clientId, conteneur }
}

async function chercher(conteneur: Locator, terme: string) {
  await conteneur.locator('.mx-recherche-terme').fill(terme)
  await conteneur.locator('.mx-recherche-chercher').click()
}

/** Ligne du formulaire de devis portant cette description (0 ou 1 — jamais plus). */
function ligneMobilax(page: Page, description: string): Locator {
  return page.locator(`#devis-lines tr:has(input[value="${description}"])`)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Scénarios
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Devis — recherche Mobilax (module partagé, ticket 06)', () => {
  // Un alert()/confirm()/prompt() natif fait toujours échouer le scénario où il apparaît —
  // le module doit afficher ses erreurs dans le conteneur, jamais par une boîte de dialogue.
  test.beforeEach(async ({ page }) => {
    page.on('dialog', async d => {
      const texte = d.message()
      await d.dismiss()
      throw new Error(`alert() (ou confirm/prompt) inattendue : ${texte}`)
    })
  })

  test('recherche → sélection → ligne au prix de vente marginé, modifiable, devis enregistré avec le prix modifié', async ({ page, request }) => {
    const DESCRIPTION = 'Écran iPhone 12 simulé'

    await page.route('**/api/mobilax/produits*', route => route.fulfill({ json: {
      // src/routes/mobilax.ts:94 — enveloppe et clés de la recherche (succès)
      success: true,
      data: {
        fournisseur_id: 3, total: 1, page: 1, pages: 1,
        produits: [{ mobilax_id: 42, nom: DESCRIPTION, ean13: '3760123456789', prix_achat_ht: 40, stock: 5 }],
      },
    } }))
    // prix_vente_ht (50) ≠ prix_achat_ht (40) : preuve que la ligne affiche le prix de VENTE,
    // pas le prix d'achat. Le taux/la formule qui produiraient ce nombre en vrai sont couverts
    // par tests/mobilaxPrixVente.test.ts (prixVenteMobilax(), prixDeVente()) — pas ici.
    await page.route('**/api/mobilax/prix-vente*', route => route.fulfill({ json: {
      // src/routes/mobilax.ts:257-260 — enveloppe et clés du prix de vente (succès)
      success: true,
      data: { mobilax_id: 42, nom: DESCRIPTION, prix_achat_ht: 40, famille: 'piece', taux: 25, prix_vente_ht: 50 },
    } }))

    const { tenant, conteneur } = await prepararDevisAvecMobilax(page, request)
    await chercher(conteneur, 'ecran iphone 12')

    const resultat = conteneur.locator('.mx-recherche-ligne[data-mobilax-id="42"]')
    await expect(resultat).toBeVisible({ timeout: 10_000 })
    await resultat.click()

    const ligne = ligneMobilax(page, DESCRIPTION)
    await expect(ligne).toHaveCount(1, { timeout: 10_000 })
    // La ligne affiche prix_vente_ht (50), jamais prix_achat_ht (40, § CONSIGNE)
    await expect(ligne.locator('input[id^="dl-price-"]')).toHaveValue('50')

    // Modifiable avant enregistrement : le devis enregistré porte le prix saisi en dernier,
    // pas le prix calculé.
    await ligne.locator('input[id^="dl-price-"]').fill('65')

    const reponsePost = page.waitForResponse(r => r.url().includes('/api/devis') && r.request().method() === 'POST')
    await page.click('#btn-save-draft')
    const devisId = (await (await reponsePost).json()).id as number
    expect(devisId).toBeTruthy()

    const detail = await request.get(`/api/devis/${devisId}`, { headers: { Authorization: `Bearer ${tenant.accessToken}` } })
    expect(detail.status(), await detail.text()).toBe(200)
    const ligneApi = (await detail.json()).data.lignes.find((l: any) => l.description === DESCRIPTION)
    expect(ligneApi).toBeTruthy()
    // Le prix modifié à la main (65), pas le prix marginé calculé (50)
    expect(ligneApi.prix_unitaire_ht).toBe(65)
  })

  test('double clic pendant le calcul du prix : une seule sélection insérée, un seul appel à prix-vente', async ({ page, request }) => {
    const DESCRIPTION = 'Écran iPhone 12 simulé'

    await page.route('**/api/mobilax/produits*', route => route.fulfill({ json: {
      // src/routes/mobilax.ts:94
      success: true,
      data: {
        fournisseur_id: 3, total: 2, page: 1, pages: 1,
        produits: [
          { mobilax_id: 42, nom: DESCRIPTION, ean13: '3760123456789', prix_achat_ht: 40, stock: 5 },
          { mobilax_id: 43, nom: 'Vitre arrière simulée', ean13: '3760123456790', prix_achat_ht: 20, stock: 2 },
        ],
      },
    } }))

    const appels: string[] = []
    let relacher!: () => void
    const retenue = new Promise<void>(r => { relacher = r })
    await page.route('**/api/mobilax/prix-vente*', async route => {
      appels.push(route.request().url())
      await retenue
      await route.fulfill({ json: {
        // src/routes/mobilax.ts:257-260
        success: true,
        data: { mobilax_id: 42, nom: DESCRIPTION, prix_achat_ht: 40, famille: 'piece', taux: 25, prix_vente_ht: 50 },
      } })
    })

    const { conteneur } = await prepararDevisAvecMobilax(page, request)
    await chercher(conteneur, 'ecran')

    const premier = conteneur.locator('.mx-recherche-ligne[data-mobilax-id="42"]')
    const second  = conteneur.locator('.mx-recherche-ligne[data-mobilax-id="43"]')
    await expect(premier).toBeVisible({ timeout: 10_000 })

    // Trois clics pendant le calcul en cours : le même résultat deux fois, puis un autre.
    // Le verrou est posé de façon synchrone au premier clic (avant tout `await`) : l'ordre
    // d'arrivée des requêtes réseau sur ces routes n'entre pas en jeu.
    await premier.click()
    await premier.click()
    await second.click()
    relacher()

    // Le formulaire naît avec une ligne vide (openNewDevis() → addLine() par défaut) : la
    // preuve porte sur les lignes PORTANT la description Mobilax, jamais sur le total de
    // #devis-lines (toujours ≥ 1, addLine() ajoute sans jamais remplacer).
    await expect(ligneMobilax(page, DESCRIPTION)).toHaveCount(1, { timeout: 10_000 })
    expect(appels).toHaveLength(1)
  })

  test('réseau coupé pendant la recherche : le message remplace « Recherche en cours… »', async ({ page, request }) => {
    await page.route('**/api/mobilax/produits*', route => route.abort())

    const { conteneur } = await prepararDevisAvecMobilax(page, request)
    await chercher(conteneur, 'ecran iphone 12')

    await expect(conteneur.locator('.mx-recherche-message')).toContainText('interrompue', { timeout: 10_000 })
    await expect(conteneur.locator('.mx-recherche-message')).not.toContainText('Recherche en cours')
  })

  test('quota Mobilax (429) sur la recherche : délai affiché, aucun résultat', async ({ page, request }) => {
    await page.route('**/api/mobilax/produits*', route => route.fulfill({
      status: 429, // src/routes/mobilax.ts:63 (STATUT_PAR_ERREUR.quota)
      json: {
        // src/routes/mobilax.ts:95
        success: false, error: 'Quota Mobilax atteint, réessayez plus tard.', code: 'quota', reessayer_dans_s: 42,
      },
    }))

    const { conteneur } = await prepararDevisAvecMobilax(page, request)
    await chercher(conteneur, 'ecran iphone 12')

    await expect(conteneur.locator('.mx-recherche-message')).toContainText('42 s', { timeout: 10_000 })
    await expect(conteneur.locator('.mx-recherche-ligne')).toHaveCount(0)
  })

  test('Mobilax indisponible (502) sur la recherche : message affiché dans le conteneur', async ({ page, request }) => {
    await page.route('**/api/mobilax/produits*', route => route.fulfill({
      status: 502, // src/routes/mobilax.ts:64 (STATUT_PAR_ERREUR.indisponible)
      json: {
        // src/routes/mobilax.ts:95
        success: false, error: 'Mobilax est indisponible pour le moment.', code: 'indisponible',
      },
    }))

    const { conteneur } = await prepararDevisAvecMobilax(page, request)
    await chercher(conteneur, 'ecran iphone 12')

    await expect(conteneur.locator('.mx-recherche-message')).toContainText('indisponible', { timeout: 10_000 })
  })

  test('quota Mobilax (429) sur le calcul du prix : délai affiché, aucune ligne insérée', async ({ page, request }) => {
    const DESCRIPTION = 'Écran iPhone 12 simulé'

    await page.route('**/api/mobilax/produits*', route => route.fulfill({ json: {
      // src/routes/mobilax.ts:94
      success: true,
      data: {
        fournisseur_id: 3, total: 1, page: 1, pages: 1,
        produits: [{ mobilax_id: 42, nom: DESCRIPTION, ean13: '3760123456789', prix_achat_ht: 40, stock: 5 }],
      },
    } }))
    await page.route('**/api/mobilax/prix-vente*', route => route.fulfill({
      status: 429, // src/routes/mobilax.ts:63 (STATUT_PAR_ERREUR.quota)
      json: {
        // src/routes/mobilax.ts:262
        success: false, error: 'Quota Mobilax atteint, réessayez plus tard.', code: 'quota', reessayer_dans_s: 17,
      },
    }))

    const { conteneur } = await prepararDevisAvecMobilax(page, request)
    await chercher(conteneur, 'ecran iphone 12')
    await conteneur.locator('.mx-recherche-ligne[data-mobilax-id="42"]').click()

    await expect(conteneur.locator('.mx-recherche-message')).toContainText('17 s', { timeout: 10_000 })
    await expect(ligneMobilax(page, DESCRIPTION)).toHaveCount(0)
  })

  test('Mobilax indisponible (502) sur le calcul du prix : message affiché, aucune ligne insérée', async ({ page, request }) => {
    const DESCRIPTION = 'Écran iPhone 12 simulé'

    await page.route('**/api/mobilax/produits*', route => route.fulfill({ json: {
      // src/routes/mobilax.ts:94
      success: true,
      data: {
        fournisseur_id: 3, total: 1, page: 1, pages: 1,
        produits: [{ mobilax_id: 42, nom: DESCRIPTION, ean13: '3760123456789', prix_achat_ht: 40, stock: 5 }],
      },
    } }))
    await page.route('**/api/mobilax/prix-vente*', route => route.fulfill({
      status: 502, // src/routes/mobilax.ts:64 (STATUT_PAR_ERREUR.indisponible)
      json: {
        // src/routes/mobilax.ts:262
        success: false, error: 'Mobilax est indisponible pour le moment.', code: 'indisponible',
      },
    }))

    const { conteneur } = await prepararDevisAvecMobilax(page, request)
    await chercher(conteneur, 'ecran iphone 12')
    await conteneur.locator('.mx-recherche-ligne[data-mobilax-id="42"]').click()

    await expect(conteneur.locator('.mx-recherche-message')).toContainText('indisponible', { timeout: 10_000 })
    await expect(ligneMobilax(page, DESCRIPTION)).toHaveCount(0)
  })
})
