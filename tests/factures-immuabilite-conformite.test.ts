import { describe, it, expect } from 'vitest'
// @ts-ignore node:fs types not available without @types/node
import { readFileSync } from 'node:fs'
// @ts-ignore node:path types not available without @types/node
import { join } from 'node:path'
import app from '../src/index'
import { createMockD1 } from './helpers/mockD1'
import { generateTokenPair } from '../src/lib/auth'

/**
 * Immuabilite d'une facture — conformite NF525 (ticket 003).
 *
 * Une facture est persistante, non modifiable, non supprimable ; la seule annulation
 * est un avoir. Jusqu'a ce ticket, cette regle n'etait tenue que par l'ABSENCE de
 * routes `PUT`/`DELETE /factures/:id` : une immuabilite accidentelle, qu'un futur
 * chantier pouvait rouvrir sans savoir qu'elle devait rester close — et l'ecran
 * proposait un bouton de suppression appelant cette route morte.
 *
 * Deux volets, volontairement complementaires :
 *
 *  - FONCTIONNEL : les deux routes existent et refusent, avec un motif qui nomme
 *    l'avoir. Un 404 muet ne convient pas : il laisse croire a une erreur de chemin.
 *  - STATIQUE : aucun handler `put`/`delete` sur `/factures/:id` ne fait autre chose
 *    que refuser. C'est ce volet qui empeche la reouverture — un test fonctionnel
 *    seul resterait vert le jour ou quelqu'un remplace le refus par une vraie
 *    implementation, puisqu'il suffirait d'en changer les attentes.
 *
 * Modele : `tests/routes-isolation-conformite.test.ts`, meme principe de relecture
 * des sources pour couvrir du code qui n'existe pas encore.
 */

// @ts-ignore process types not available without @types/node
const FICHIER_ROUTES = join(process.cwd(), 'src', 'routes', 'facturation.ts')

/** Retire commentaires de bloc et de ligne : un commentaire n'execute rien. */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/** Declarations de routes du fichier, dans l'ordre, avec leur corps. */
function handlers(): { methode: string; chemin: string; corps: string }[] {
  const source = sansCommentaires(readFileSync(FICHIER_ROUTES, 'utf8'))
  const lignes = source.split('\n')
  const decl   = /^\s*\w+\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]*)['"`]/
  const debuts: { methode: string; chemin: string; ligne: number }[] = []

  lignes.forEach((ligne, i) => {
    const m = decl.exec(ligne)
    if (m) debuts.push({ methode: m[1].toUpperCase(), chemin: m[2], ligne: i })
  })

  // Le corps d'un handler s'etend jusqu'a la declaration suivante.
  return debuts.map((d, i) => ({
    methode: d.methode,
    chemin:  d.chemin,
    corps:   lignes.slice(d.ligne, debuts[i + 1]?.ligne ?? lignes.length).join('\n'),
  }))
}

/** Requete authentifiee contre l'application reelle. */
async function appeler(methode: string, chemin: string): Promise<Response> {
  const d1     = createMockD1()
  const secret = 'secret-de-test'
  const { accessToken } = await generateTokenPair(
    { id: 7, email: 'gerant@boutique.fr', role: 'admin', boutique_id: 1, prenom: 'Gerant', nom: 'Test' },
    secret,
  )
  return app.request(
    chemin,
    {
      method:  methode,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body:    JSON.stringify({ total_ttc: 1 }),
    },
    { DB: d1, JWT_SECRET: secret } as any,
    { waitUntil: () => {}, passThroughOnException: () => {} } as any,
  )
}

describe('Immuabilite d\'une facture (NF525)', () => {
  describe('refus motive, pas un 404 muet', () => {
    for (const methode of ['PUT', 'DELETE']) {
      it(`${methode} /api/factures/:id repond 405 et nomme l'avoir`, async () => {
        const res = await appeler(methode, '/api/factures/42')

        expect(res.status, 'un 404 laisserait croire a une erreur de chemin').toBe(405)

        const corps = await res.json() as { success: boolean; error: string }
        expect(corps.success).toBe(false)
        expect(corps.error.toLowerCase()).toContain('avoir')
      })
    }

    it('refuse aussi un brouillon : la regle ne depend pas du statut', async () => {
      // Un brouillon peut deja porter des paiements — `ajouterPaiement()` n'accepte
      // QUE les factures non verrouillees. Le supprimer effacerait des encaissements.
      const res = await appeler('DELETE', '/api/factures/1?statut=brouillon')
      expect(res.status).toBe(405)
    })
  })

  describe('garde-fou statique anti-reouverture', () => {
    it('aucun handler put/delete sur /factures/:id ne fait autre chose que refuser', () => {
      /*
       * Critere : AUCUN `await` dans ces handlers.
       *
       * La premiere version listait des verbes de mutation (update|delete|supprim).
       * Elle ratait `await modifierFacture(...)` — un garde-fou cense empecher la
       * reouverture l'aurait laissee passer parce que le mot n'etait pas dans la
       * liste. L'absence d'`await` ne se contourne pas : D1 est asynchrone, toute
       * implementation reelle en contient un. Un refus, lui, n'attend rien.
       */
      const fautifs = handlers()
        .filter((h) => ['PUT', 'DELETE'].includes(h.methode) && /^\/factures\/:id/.test(h.chemin))
        .filter((h) => /\bawait\b/.test(h.corps))
        .map((h) => `${h.methode} ${h.chemin}`)

      expect(fautifs, 'une facture ne se modifie ni ne se supprime : emettre un avoir').toEqual([])
    })

    it('le refus est bien un refus : chaque handler nomme le motif et repond 405', () => {
      // Sans ceci, supprimer le corps du handler suffirait a verdir le test precedent.
      const manquants = handlers()
        .filter((h) => ['PUT', 'DELETE'].includes(h.methode) && /^\/factures\/:id/.test(h.chemin))
        .filter((h) => !(h.corps.includes('REFUS_MUTATION_FACTURE') && h.corps.includes('405')))
        .map((h) => `${h.methode} ${h.chemin}`)

      expect(manquants, 'un handler muet ne vaut pas mieux qu\'un 404').toEqual([])
    })

    it('les deux routes de refus sont declarees', () => {
      const declarees = handlers()
        .filter((h) => ['PUT', 'DELETE'].includes(h.methode) && h.chemin === '/factures/:id')
        .map((h) => h.methode)
        .sort()

      expect(declarees, 'sans elles, un appel tombe en 404 muet').toEqual(['DELETE', 'PUT'])
    })
  })
})
