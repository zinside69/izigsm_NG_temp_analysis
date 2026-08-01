/**
 * @file tests/e2e/resolveur-boutique-pages.spec.ts
 * @description Les pages qui portent leur propre mise en page visent bien la boutique
 * consultée par l'admin plateforme (🔴 P1 de `project-docs/todo.md`, suite du ticket 02).
 *
 * Le ticket 02 a fait basculer les 10 pages construites par `buildSidebar()`. Les autres
 * portent leur propre mise en page et résolvaient la boutique elles-mêmes — soit en
 * lisant `session.boutique_id` en direct, soit en n'envoyant rien du tout. Pour un admin
 * plateforme, `boutique_id` est NULL : ces écrans étaient inutilisables, sélection faite
 * ou non.
 *
 * Prior art : `selection-boutique.spec.ts` § « l'agenda vise la boutique consultée » —
 * même seam (observer la requête sortante), même défaut, une page plus tôt.
 *
 * Ce que ces tests observent : l'URL réellement émise vers l'API. Jamais la clé de
 * stockage ni le nom de la variable interne d'une page — les corriger ne doit pas figer
 * leur implémentation.
 */
import { test, expect } from '@playwright/test'
import { seConnecterAdminPlateforme, creerBoutique, choisirBoutique } from './fixtures/console-plateforme'

/**
 * Une page hors socle, et l'appel par lequel on la prend en flagrant délit.
 *
 * `portage` distingue les deux façons dont une boutique voyage dans ces appels :
 *   - `query`   → `?boutique_id=<id>` (le cas général)
 *   - `chemin`  → `/api/boutiques/<id>/…` (les réglages, qui adressent la boutique
 *                 elle-même comme ressource)
 */
interface PageHorsSocle {
  nom: string
  url: string
  appel: string
  portage: 'query' | 'chemin'
}

const PAGES: PageHorsSocle[] = [
  { nom: 'stats',         url: '/stats',         appel: '/api/stats',               portage: 'query'  },
  { nom: 'notifications', url: '/notifications', appel: '/api/notifications/stats', portage: 'query'  },
  { nom: 'kanban',        url: '/kanban',        appel: '/api/tickets/kanban',      portage: 'query'  },
  { nom: 'personnel',     url: '/personnel',     appel: '/api/pointage/statuts',    portage: 'query'  },
  { nom: 'caisse',        url: '/caisse',        appel: '/api/caisse/kpis',         portage: 'query'  },
  { nom: 'sav',           url: '/sav',           appel: '/api/sav/kpis',            portage: 'query'  },
  { nom: 'settings',      url: '/settings',      appel: '/api/boutiques/',          portage: 'chemin' },
]

test.describe('Pages hors socle — la boutique consultée est bien celle visée', () => {
  for (const { nom, url, appel, portage } of PAGES) {
    test(`${nom} vise la boutique choisie dans la console`, async ({ page, request }) => {
      const { tenant, nomBoutique } = await creerBoutique(request)

      await seConnecterAdminPlateforme(page)
      await choisirBoutique(page, nomBoutique)

      const requete = page.waitForRequest(r => r.url().includes(appel), { timeout: 15_000 })
      await page.goto(url)
      const emise = new URL((await requete).url())

      if (portage === 'query') {
        expect(
          emise.searchParams.get('boutique_id'),
          `${nom} : l'appel ${appel} doit porter la boutique consultée`
        ).toBe(String(tenant.boutiqueId))
      } else {
        expect(
          emise.pathname,
          `${nom} : l'appel ${appel} doit adresser la boutique consultée`
        ).toContain(`/api/boutiques/${tenant.boutiqueId}`)
      }
    })
  }

  test("une écriture vise la boutique consultée, pas seulement les lectures", async ({ page, request }) => {
    // Le vrai défaut du chantier : `apiGet` résolvait la boutique, `apiPost`/`apiPut`/
    // `apiDelete` non. Un admin plateforme pouvait donc *consulter* la boutique d'un
    // client sans pouvoir y *écrire* — et l'écriture est justement ce que le journal
    // des actions de plateforme (ADR 0001) existe pour tracer.
    //
    // L'expiration des garanties est prise comme témoin : c'est la mutation de ces
    // pages qui se déclenche en un clic, sans saisie préalable.
    const { tenant, nomBoutique } = await creerBoutique(request)

    await seConnecterAdminPlateforme(page)
    await choisirBoutique(page, nomBoutique)

    page.on('dialog', d => d.accept())

    await page.goto('/sav')
    const ecriture = page.waitForRequest(
      r => r.url().includes('/api/garanties/expire') && r.method() === 'POST',
      { timeout: 15_000 }
    )
    await page.click('button:has-text("Expirer")')

    const emise = new URL((await ecriture).url())
    expect(
      emise.searchParams.get('boutique_id'),
      "l'écriture doit désigner la boutique consultée, comme le fait déjà la lecture"
    ).toBe(String(tenant.boutiqueId))
  })

  test('sans sélection, aucune page hors socle ne vise une boutique au hasard', async ({ page }) => {
    // Le pendant du test précédent : la règle « aucune auto-sélection » (CLAUDE.md) vaut
    // aussi ici. Une page qui retomberait sur la boutique 1 du seed ferait travailler
    // l'exploitant chez un client tiré au sort — pire qu'un écran vide.
    await seConnecterAdminPlateforme(page)

    const appels: string[] = []
    page.on('request', r => {
      if (r.url().includes('/api/')) appels.push(r.url())
    })

    await page.goto('/stats')
    await page.waitForTimeout(2_000)

    for (const u of appels) {
      expect(
        new URL(u).searchParams.get('boutique_id'),
        `aucune boutique n'est choisie, ${u} ne doit en désigner aucune`
      ).toBeNull()
    }
  })
})
