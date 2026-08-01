/**
 * tests/journalPlateforme.test.ts
 * Ticket 04 — Journal des actions de plateforme (middleware + table dédiée).
 *
 * Ce que ces tests observent : ce que le journal contient après une requête réelle
 * traversant le middleware — jamais la forme interne du code. Le harnais monte une
 * application Hono minimale avec le middleware réel et des routes quelconques : une
 * route écrite après ce ticket doit être journalisée sans que le middleware bouge.
 *
 * Décision structurante : docs/adr/0001-journal-separe-actions-plateforme.md
 *
 * Couverture :
 *   déclenchement           (mutation admin plateforme / GET / manager)   4 tests
 *   résolution de la cible  (query, corps, non résolue)                   3 tests
 *   expurgation & troncature du corps                                     3 tests
 *   robustesse (échec d'écriture, handler qui lève, corps, anonyme)       5 tests
 *   application réelle (route métier non prévue par le middleware)        1 test
 *
 * Total : 16 tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createMockDatabase } from './helpers/mockDatabase'
import { createMockD1 } from './helpers/mockD1'
import app from '../src/index'
import { journalPlateformeMiddleware } from '../src/lib/middleware'
import { generateTokenPair } from '../src/lib/auth'
import type { JwtPayload } from '../src/lib/auth'
import type { Database } from '../src/ports/database'

/** Environnement du harnais — mêmes variables de contexte que `src/index.tsx`. */
type Env = { Bindings: Record<string, unknown>; Variables: { db: Database; user?: JwtPayload } }

// ─── Comptes de test ──────────────────────────────────────────────────────────

/** Admin plateforme : rôle `admin` ET aucune boutique (ADR 0001). */
const ADMIN_PLATEFORME: JwtPayload = {
  sub: 7, email: 'support@soteli.fr', role: 'admin', boutique_id: null,
  prenom: 'Support', nom: 'Soteli', exp: 9999999999, iat: 0,
}

/** Manager d'une boutique cliente — ses actions ne doivent jamais être journalisées. */
const MANAGER: JwtPayload = {
  sub: 12, email: 'manager@boutique2.fr', role: 'manager', boutique_id: 2,
  prenom: 'Alice', nom: 'Dupont', exp: 9999999999, iat: 0,
}

// ─── Harnais ──────────────────────────────────────────────────────────────────

type LigneJournal = {
  user_id:       number | null
  boutique_id:   number | null
  methode:       string
  chemin:        string
  statut_http:   number
  corps_expurge: string | null
  ip_address:    string | null
}

/**
 * Monte une application Hono reproduisant l'ordonnancement réel (`src/index.tsx`) :
 * injection du port `Database`, puis le middleware de journalisation, puis un
 * sous-routeur qui pose l'identité comme le fait `authMiddleware`.
 */
function creerApp(db: ReturnType<typeof createMockDatabase>, user?: JwtPayload) {
  const app = new Hono<Env>()

  app.use('*', async (c, next) => { c.set('db', db); await next() })
  app.use('/api/*', journalPlateformeMiddleware)

  const routeur = new Hono<Env>()
  routeur.use('*', async (c, next) => { if (user) c.set('user', user); await next() })
  // Routes quelconques : le middleware ne les connaît pas et n'a pas à les connaître.
  routeur.post('/clients',     (c) => c.json({ success: true }, 201))
  routeur.put('/factures/:id', (c) => c.json({ success: true }, 200))
  routeur.delete('/tickets/:id', (c) => c.json({ success: true }, 200))
  routeur.get('/clients',      (c) => c.json({ success: true, data: [] }, 200))
  // Route qui lit le corps avant nous — le middleware doit malgré tout le capturer.
  routeur.post('/lecteur', async (c) => { await c.req.json(); return c.json({ success: true }, 201) })
  // Route qui échoue sans rien attraper — cas majoritaire des handlers mutants du dépôt.
  routeur.post('/casse', () => { throw new Error('handler en panne') })
  app.route('/api', routeur)

  return app
}

/** Contexte d'exécution factice : collecte les écritures différées par `waitUntil()`. */
function creerExecutionCtx() {
  const differees: Promise<unknown>[] = []
  return {
    ctx: { waitUntil: (p: Promise<unknown>) => { differees.push(p) }, passThroughOnException: () => {} },
    /** Attend la fin des écritures différées — l'équivalent test de la fin de requête. */
    async attendre() { await Promise.all(differees) },
  }
}

/** Lignes réellement écrites dans le journal, relues depuis les appels SQL du mock. */
function lignesJournal(db: ReturnType<typeof createMockDatabase>): LigneJournal[] {
  return db.__getCalls()
    .filter((appel) => appel.sql.includes('journal_actions_plateforme'))
    .map((appel) => {
      const [user_id, boutique_id, methode, chemin, statut_http, corps_expurge, ip_address] = appel.params as any[]
      return { user_id, boutique_id, methode, chemin, statut_http, corps_expurge, ip_address }
    })
}

/** Envoie une requête au travers du harnais et attend les écritures différées. */
async function appeler(
  app: ReturnType<typeof creerApp>,
  chemin: string,
  init: RequestInit = {},
): Promise<Response> {
  const exec = creerExecutionCtx()
  const res  = await app.request(chemin, init, {}, exec.ctx as any)
  await exec.attendre()
  return res
}

/** Requête JSON prête à l'emploi (le middleware ne capture que ce type de corps). */
function json(methode: string, corps: unknown): RequestInit {
  return {
    method:  methode,
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
    body:    JSON.stringify(corps),
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Journal des actions de plateforme', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => { db = createMockDatabase() })

  describe('déclenchement', () => {
    it('journalise une mutation d\'admin plateforme sur une boutique cliente', async () => {
      const app = creerApp(db, ADMIN_PLATEFORME)

      const res = await appeler(app, '/api/clients?boutique_id=2', json('POST', { nom: 'Dupont' }))

      expect(res.status).toBe(201)
      const lignes = lignesJournal(db)
      expect(lignes).toHaveLength(1)
      expect(lignes[0]).toMatchObject({
        user_id:     ADMIN_PLATEFORME.sub,
        boutique_id: 2,
        methode:     'POST',
        chemin:      '/api/clients',
        statut_http: 201,
        ip_address:  '203.0.113.7',
      })
    })

    it('journalise aussi PUT et DELETE, sur n\'importe quel chemin', async () => {
      const app = creerApp(db, ADMIN_PLATEFORME)

      await appeler(app, '/api/factures/9?boutique_id=2', json('PUT', { statut: 'payee' }))
      await appeler(app, '/api/tickets/4?boutique_id=2',  { method: 'DELETE' })

      const lignes = lignesJournal(db)
      expect(lignes.map((l) => `${l.methode} ${l.chemin}`)).toEqual([
        'PUT /api/factures/9',
        'DELETE /api/tickets/4',
      ])
    })

    it('n\'écrit rien pour une lecture', async () => {
      const app = creerApp(db, ADMIN_PLATEFORME)

      await appeler(app, '/api/clients?boutique_id=2')

      expect(lignesJournal(db)).toHaveLength(0)
    })

    it('n\'écrit rien pour la mutation d\'un manager sur sa propre boutique', async () => {
      const app = creerApp(db, MANAGER)

      const res = await appeler(app, '/api/clients?boutique_id=2', json('POST', { nom: 'Dupont' }))

      expect(res.status).toBe(201)
      expect(lignesJournal(db)).toHaveLength(0)
    })
  })

  describe('résolution de la boutique visée', () => {
    it('lit le paramètre de requête en priorité', async () => {
      const app = creerApp(db, ADMIN_PLATEFORME)

      await appeler(app, '/api/clients?boutique_id=5', json('POST', { boutique_id: 9 }))

      expect(lignesJournal(db)[0].boutique_id).toBe(5)
    })

    it('retombe sur le corps de requête à défaut de paramètre', async () => {
      const app = creerApp(db, ADMIN_PLATEFORME)

      await appeler(app, '/api/clients', json('POST', { boutique_id: 9, nom: 'Dupont' }))

      expect(lignesJournal(db)[0].boutique_id).toBe(9)
    })

    it('écrit quand même la ligne, cible nulle, si la boutique n\'est pas résolue', async () => {
      const app = creerApp(db, ADMIN_PLATEFORME)

      await appeler(app, '/api/clients', json('POST', { nom: 'Dupont' }))

      const lignes = lignesJournal(db)
      expect(lignes).toHaveLength(1)
      expect(lignes[0].boutique_id).toBeNull()
    })
  })

  describe('corps de requête', () => {
    it('n\'expose aucun secret', async () => {
      const app = creerApp(db, ADMIN_PLATEFORME)

      await appeler(app, '/api/clients', json('POST', {
        nom:                 'Dupont',
        password:            'Admin@2026!',
        nouveau_mot_de_passe: 'Secret@2026',
        refresh_token:       'eyJhbGciOi',
        pin:                 '1234',
        code_deverrouillage: '0000',
        code_sim:            '4321',
        appareil:            { code_deverrouillage: 'motif-L' },
      }))

      const corps = lignesJournal(db)[0].corps_expurge ?? ''
      for (const secret of ['Admin@2026!', 'Secret@2026', 'eyJhbGciOi', '1234', '0000', '4321', 'motif-L'])
        expect(corps).not.toContain(secret)
      expect(corps).toContain('Dupont')           // le reste du corps demeure lisible
    })

    it('tronque un corps volumineux', async () => {
      const app = creerApp(db, ADMIN_PLATEFORME)

      await appeler(app, '/api/clients', json('POST', { notes: 'x'.repeat(50_000) }))

      const corps = lignesJournal(db)[0].corps_expurge ?? ''
      expect(corps.length).toBeLessThan(5_000)
    })

    it('capture le corps même si la route l\'a déjà lu', async () => {
      const app = creerApp(db, ADMIN_PLATEFORME)

      await appeler(app, '/api/lecteur', json('POST', { nom: 'Dupont' }))

      expect(lignesJournal(db)[0].corps_expurge).toContain('Dupont')
    })
  })

  describe('robustesse', () => {
    it('ne fait pas échouer la requête métier si l\'écriture du journal échoue', async () => {
      db.__setResponseFn(
        'INSERT INTO journal_actions_plateforme (user_id, boutique_id, methode, chemin, statut_http, corps, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)',
        () => { throw new Error('D1 indisponible') },
      )
      const app = creerApp(db, ADMIN_PLATEFORME)

      const res = await appeler(app, '/api/clients?boutique_id=2', json('POST', { nom: 'Dupont' }))

      expect(res.status).toBe(201)
      expect(await res.json()).toEqual({ success: true })
    })

    it('journalise une mutation sans corps', async () => {
      const app = creerApp(db, ADMIN_PLATEFORME)

      await appeler(app, '/api/tickets/4?boutique_id=2', { method: 'DELETE' })

      const lignes = lignesJournal(db)
      expect(lignes).toHaveLength(1)
      expect(lignes[0].corps_expurge).toBeNull()
    })

    it('journalise une mutation dont le handler a levé, en statut 500', async () => {
      const app = creerApp(db, ADMIN_PLATEFORME)

      // Hono rattrape l'exception et renvoie 500 : la requête métier garde son comportement.
      const res = await appeler(app, '/api/casse?boutique_id=2', json('POST', { nom: 'Dupont' }))
      expect(res.status).toBe(500)

      const lignes = lignesJournal(db)
      expect(lignes).toHaveLength(1)
      expect(lignes[0]).toMatchObject({ chemin: '/api/casse', boutique_id: 2, statut_http: 500 })
    })

    it('journalise une mutation dont le corps n\'est pas du JSON', async () => {
      const app = creerApp(db, ADMIN_PLATEFORME)

      await appeler(app, '/api/clients?boutique_id=2', {
        method:  'POST',
        headers: { 'Content-Type': 'text/plain' },
        body:    'pas du json',
      })

      const lignes = lignesJournal(db)
      expect(lignes).toHaveLength(1)
      expect(lignes[0].corps_expurge).toBeNull()
    })

    it('n\'écrit rien pour une requête non authentifiée', async () => {
      const app = creerApp(db)   // aucune identité posée

      await appeler(app, '/api/clients?boutique_id=2', json('POST', { nom: 'Dupont' }))

      expect(lignesJournal(db)).toHaveLength(0)
    })
  })

  describe('application réelle', () => {
    /**
     * Le harnais ci-dessus monte des routes fabriquées : il prouve la règle, pas la couverture.
     * Ce test-ci traverse l'application réelle (`src/index.tsx`), son vrai `authMiddleware` et
     * une route métier que le middleware n'a jamais eu à connaître — c'est la démonstration du
     * critère « une route ajoutée après ce ticket est journalisée sans modification du
     * middleware ».
     */
    it('journalise une route métier existante, sans que le middleware la connaisse', async () => {
      const d1     = createMockD1()
      const secret = 'secret-de-test'
      const { accessToken } = await generateTokenPair(
        { id: 7, email: 'support@soteli.fr', role: 'admin', boutique_id: null, prenom: 'Support', nom: 'Soteli' },
        secret,
      )

      const exec = creerExecutionCtx()
      const res  = await app.request(
        '/api/clients?boutique_id=2',
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body:    JSON.stringify({ nom: 'Dupont', prenom: 'Alice', telephone: '0600000000' }),
        },
        { DB: d1, JWT_SECRET: secret } as any,
        exec.ctx as any,
      )
      await exec.attendre()

      // Peu importe ce que la route répond : la ligne doit exister (« jamais de ligne tue »).
      const ligne = d1.__getCalls().find((appel) => appel.sql.includes('journal_actions_plateforme'))
      expect(ligne, `aucune ligne écrite (réponse ${res.status})`).toBeDefined()
      const [user_id, boutique_id, methode, chemin] = ligne!.params as any[]
      expect({ user_id, boutique_id, methode, chemin })
        .toEqual({ user_id: 7, boutique_id: 2, methode: 'POST', chemin: '/api/clients' })
    })
  })
})
