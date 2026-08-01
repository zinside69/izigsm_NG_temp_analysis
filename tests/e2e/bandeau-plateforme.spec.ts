/**
 * @file tests/e2e/bandeau-plateforme.spec.ts
 * @description Bandeau permanent « Vous consultez la boutique X » (ticket 03 du chantier
 * supervision).
 *
 * Ce que le bandeau garantit au client d'une boutique cliente : l'exploitant qui agit
 * chez lui, en écriture, ne peut pas l'ignorer. Les tests visent donc ce qui est
 * observable à l'écran — un libellé lisible, une présence qui survit à la navigation,
 * l'absence de tout moyen de le faire disparaître — jamais la structure interne du
 * socle ni la clé de stockage employée.
 *
 * Prior art : `selection-boutique.spec.ts` (ticket 02) et `fixtures/console-plateforme.ts`.
 */
import { test, expect, type Page } from '@playwright/test'
import { MANAGER, seConnecter, seDeconnecter } from './fixtures/comptes'
import { seConnecterAdminPlateforme, creerBoutique, choisirBoutique } from './fixtures/console-plateforme'

/** Le bandeau, tel qu'une page le rend via le socle partagé. */
const BANDEAU = '#bandeau-plateforme'

/**
 * Pages échantillonnées pour la présence du bandeau, prises parmi celles qui
 * construisent leur interface avec le socle partagé (`buildSidebar`).
 *
 * Un échantillon, pas la liste complète : le bandeau vient du socle commun, donc
 * couvrir des pages de sections différentes suffit à prouver qu'aucune n'a été traitée
 * à la main. Les vérifier toutes coûterait des minutes pour la même information.
 *
 * ⚠️ Seules 10 pages appellent `buildSidebar()`. Les autres — `settings`, `stats`,
 * `caisse`, `kanban`, `personnel`, `sav`, `notifications`, `fournisseurs`, `agenda`
 * et `modules` — portent leur propre mise en page, et la plupart lisent
 * `session.boutique_id` en direct : elles ignorent donc déjà la boutique sélectionnée.
 * Leur afficher le bandeau les ferait mentir sur la boutique réellement visée. Écart
 * tracé dans `project-docs/todo.md` § « Pages hors socle partagé ».
 */
const PAGES_ECHANTILLON = ['/dashboard', '/clients', '/tickets', '/stock', '/devis', '/factures']

/**
 * Attend qu'une page ait fini de construire son interface avec le socle partagé.
 *
 * La navigation rendue (`.sidebar-nav`) sert de marqueur, pas le conteneur `#sidebar` :
 * plusieurs pages hors socle déclarent un `#sidebar` vide, qui passerait pour un socle
 * construit et ferait croire à un test couvrant plus qu'il ne couvre.
 */
async function attendreSocle(page: Page) {
  await expect(page.locator('#sidebar .sidebar-nav')).toBeVisible({ timeout: 15_000 })
}

// ══════════════════════════════════════════════════════════════════════════════
// PRÉSENCE ET CONTENU
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Bandeau permanent — admin plateforme consultant une boutique', () => {
  test('le bandeau nomme la boutique consultée et survit à la navigation', async ({ page, request }) => {
    const { nomBoutique } = await creerBoutique(request)

    await seConnecterAdminPlateforme(page)
    await choisirBoutique(page, nomBoutique)
    await attendreSocle(page)

    await expect(page.locator(BANDEAU)).toContainText('Vous consultez la boutique')
    await expect(page.locator(BANDEAU)).toContainText(nomBoutique)

    await page.goto('/clients')
    await attendreSocle(page)
    await expect(page.locator(BANDEAU)).toContainText(nomBoutique)
  })

  test('le bandeau est présent sur toutes les pages qui utilisent le socle partagé', async ({ page, request }) => {
    const { nomBoutique } = await creerBoutique(request)

    await seConnecterAdminPlateforme(page)
    await choisirBoutique(page, nomBoutique)

    for (const chemin of PAGES_ECHANTILLON) {
      await page.goto(chemin)
      await attendreSocle(page)
      await expect(page.locator(BANDEAU), `bandeau absent sur ${chemin}`).toBeVisible()
    }
  })

  test('changer de boutique met le bandeau à jour', async ({ page, request }) => {
    const premiere = await creerBoutique(request)
    const seconde  = await creerBoutique(request)

    await seConnecterAdminPlateforme(page)
    await choisirBoutique(page, premiere.nomBoutique)
    await attendreSocle(page)
    await expect(page.locator(BANDEAU)).toContainText(premiere.nomBoutique)

    await choisirBoutique(page, seconde.nomBoutique)
    await attendreSocle(page)
    await expect(page.locator(BANDEAU)).toContainText(seconde.nomBoutique)
    await expect(page.locator(BANDEAU)).not.toContainText(premiere.nomBoutique)
  })

  test('son action ramène à la console', async ({ page, request }) => {
    const { nomBoutique } = await creerBoutique(request)

    await seConnecterAdminPlateforme(page)
    await choisirBoutique(page, nomBoutique)
    await page.goto('/clients')
    await attendreSocle(page)

    await page.locator(`${BANDEAU} a, ${BANDEAU} button`).first().click()
    await expect(page.locator('#console-table')).toBeVisible({ timeout: 15_000 })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// NON MASQUABLE
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Bandeau permanent — impossible à faire disparaître', () => {
  test('aucune interaction ne le masque ni ne le referme', async ({ page, request }) => {
    const { nomBoutique } = await creerBoutique(request)

    await seConnecterAdminPlateforme(page)
    await choisirBoutique(page, nomBoutique)
    await attendreSocle(page)

    // La seule action offerte est le retour à la console : un second contrôle serait
    // le candidat naturel à la fermeture.
    await expect(page.locator(`${BANDEAU} a, ${BANDEAU} button`)).toHaveCount(1)

    // Les gestes qui referment habituellement un bandeau.
    await page.locator(BANDEAU).click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Escape')
    await page.mouse.wheel(0, 2000)

    await expect(page.locator(BANDEAU)).toBeVisible()
    await expect(page.locator(BANDEAU)).toContainText(nomBoutique)
  })

  test('un modal ouvert ne le recouvre pas', async ({ page, request }) => {
    // Le cas qui compte le plus : un modal de saisie est l'écran où l'on écrit chez
    // le client. S'il passait par-dessus le bandeau, celui-ci serait masquable par le
    // premier geste d'écriture venu.
    const { nomBoutique } = await creerBoutique(request)

    await seConnecterAdminPlateforme(page)
    await choisirBoutique(page, nomBoutique)
    await page.goto('/tickets')
    await attendreSocle(page)

    await page.click('button:has-text("Nouvelle prise en charge")')
    await expect(page.locator('#modal-ticket')).toHaveClass(/open/)

    await expect(page.locator(BANDEAU)).toBeVisible()
    await expect(page.locator(BANDEAU)).toContainText(nomBoutique)
    // Visible au sens du DOM ne suffit pas : l'overlay du modal pourrait le couvrir
    // sans le masquer. Le clic tranche — Playwright vérifie que l'élément visé reçoit
    // bien le pointeur, et échoue si quoi que ce soit s'interpose.
    await page.locator(BANDEAU).click({ position: { x: 5, y: 5 }, timeout: 5_000 })
  })

  test('il ne recouvre ni ne rogne le contenu de la page', async ({ page, request }) => {
    const { nomBoutique } = await creerBoutique(request)

    await seConnecterAdminPlateforme(page)
    await choisirBoutique(page, nomBoutique)
    await attendreSocle(page)

    const bandeau = await page.locator(BANDEAU).boundingBox()
    const topbar  = await page.locator('.dash-topbar').boundingBox()
    const sidebar = await page.locator('#sidebar').boundingBox()
    expect(bandeau, 'bandeau non mesurable').not.toBeNull()
    expect(topbar,  'topbar non mesurable').not.toBeNull()
    expect(sidebar, 'sidebar non mesurable').not.toBeNull()

    // Pleine largeur, collé en haut. La référence est la largeur de `body` (marges
    // nulles dans le reset), pas celle du viewport : elles diffèrent d'une barre de
    // défilement dès que la page défile.
    const corps = await page.locator('body').boundingBox()
    expect(bandeau!.y).toBe(0)
    expect(bandeau!.width).toBe(corps!.width)

    // Le contenu commence sous lui, il ne passe donc par-dessus rien.
    expect(topbar!.y).toBeGreaterThanOrEqual(bandeau!.y + bandeau!.height)
    expect(sidebar!.y).toBeGreaterThanOrEqual(bandeau!.y + bandeau!.height)

    // Et le logo de la sidebar, premier élément de navigation, reste entièrement visible.
    await expect(page.locator('.sidebar-logo')).toBeInViewport()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// QUI NE LE VOIT JAMAIS
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Bandeau permanent — absent partout ailleurs', () => {
  test('un manager ne voit aucun bandeau, sur aucune page', async ({ page }) => {
    await seConnecter(page, MANAGER)
    await expect(page.locator('#kpi-grid')).toBeVisible({ timeout: 15_000 })

    for (const chemin of PAGES_ECHANTILLON) {
      await page.goto(chemin)
      await attendreSocle(page)
      await expect(page.locator(BANDEAU), `bandeau visible sur ${chemin}`).toHaveCount(0)
    }
  })

  test("un admin plateforme sans sélection ne voit aucun bandeau", async ({ page }) => {
    await seConnecterAdminPlateforme(page)

    await page.goto('/dashboard')
    await attendreSocle(page)
    await expect(page.locator(BANDEAU)).toHaveCount(0)
  })

  test('après déconnexion puis reconnexion, aucune boutique n\'est présélectionnée', async ({ page, request }) => {
    const { nomBoutique } = await creerBoutique(request)

    await seConnecterAdminPlateforme(page)
    await choisirBoutique(page, nomBoutique)
    await attendreSocle(page)
    await expect(page.locator(BANDEAU)).toContainText(nomBoutique)

    await seDeconnecter(page)

    await seConnecterAdminPlateforme(page)
    await page.goto('/dashboard')
    await attendreSocle(page)
    await expect(page.locator(BANDEAU)).toHaveCount(0)
  })
})
