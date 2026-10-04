// AVANT (2026-10-04 — vi et les crochets servent au bloc de la synchro, appel réseau simulé) : import { describe, it, expect } from 'vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// @ts-ignore node:fs types not available without @types/node
import { readdirSync, readFileSync } from 'node:fs'
// @ts-ignore node:path types not available without @types/node
import { join } from 'node:path'
import app from '../src/index'
import { createMockD1 } from './helpers/mockD1'
import { generateTokenPair } from '../src/lib/auth'

/**
 * Hiérarchie des rôles (décisions de l'exploitant du 2026-10-01) : l'admin plateforme supervise
 * toutes les boutiques ; le **manager dirige la sienne sans contrainte** ; le technicien travaille
 * dessous. Aucun autre rôle n'existe (`roles` : admin, manager, technicien, client — migration 0001,
 * identique en production, mesuré le 2026-10-01).
 *
 * Défaut corrigé : six routes exigeaient un rôle `gerant` qui n'a jamais existé — seul l'admin
 * plateforme les passait, et **aucun manager ne pouvait clôturer sa caisse** (NF525), vérifier son
 * intégrité, ni lire le rapport comptable. Et la purge RGPD d'un client et la suppression d'un
 * employé, gestes de la boutique, étaient réservées à l'admin.
 *
 * Observé de l'extérieur : le refus de rôle de `requireRole()` (403 « Rôles requis »). Le handler
 * tourne ensuite contre une base simulée vide ; son résultat n'est pas l'objet de ces tests.
 */

const SECRET = 'secret-de-test'

async function appeler(
  compte: { role: string; boutique_id: number | null },
  methode: string,
  chemin: string,
  corps?: unknown,
  d1 = createMockD1(),
) {
  const { accessToken } = await generateTokenPair(
    { id: 7, email: 'compte@boutique.fr', prenom: 'Compte', nom: 'Test', ...compte } as any,
    SECRET,
  )
  const res = await app.request(
    chemin,
    {
      method:  methode,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      ...(corps !== undefined ? { body: JSON.stringify(corps) } : {}),
    },
    { DB: d1, JWT_SECRET: SECRET } as any,
    { waitUntil: () => {}, passThroughOnException: () => {} } as any,
  )
  const texte = await res.text()
  return { res, texte, d1 }
}

const MANAGER    = { role: 'manager',    boutique_id: 1 }
const TECHNICIEN = { role: 'technicien', boutique_id: 1 }

/** Vrai si la réponse est le refus de rôle de `requireRole()`. */
const refusDeRole = (texte: string) => texte.includes('Rôles requis')

describe('le manager dirige sa boutique — routes qui le refusaient à tort', () => {
  const OUVERTES_AU_MANAGER: [string, string, unknown?][] = [
    ['POST',   '/api/caisse/cloture', {}],
    ['GET',    '/api/caisse/integrite'],
    ['GET',    '/api/stats/techniciens'],
    ['GET',    '/api/stats/export/csv'],
    ['GET',    '/api/stats/rapport-comptable'],
    ['DELETE', '/api/clients/5/purge', { confirm: true }],
    ['DELETE', '/api/employes/5'],
  ]

  for (const [methode, chemin, corps] of OUVERTES_AU_MANAGER) {
    it(`${methode} ${chemin} : un manager n'est pas refusé pour son rôle`, async () => {
      const { texte } = await appeler(MANAGER, methode, chemin, corps)
      expect(refusDeRole(texte), texte).toBe(false)
    })
  }

  it('la clôture de caisse reste refusée au technicien (gestion de la boutique)', async () => {
    const { res, texte } = await appeler(TECHNICIEN, 'POST', '/api/caisse/cloture', {})
    expect(res.status).toBe(403)
    expect(refusDeRole(texte)).toBe(true)
  })

  it('la suppression d\'un employé reste refusée au technicien', async () => {
    const { res } = await appeler(TECHNICIEN, 'DELETE', '/api/employes/5')
    expect(res.status).toBe(403)
  })

  it('un manager ne désactive jamais l\'employé d\'une autre boutique (garde d\'appartenance)', async () => {
    const d1 = createMockD1()
    d1.__setResponseFn('SELECT * FROM employes WHERE id = ? AND actif = 1', (p: any[]) => ({ id: p[0], boutique_id: 99, actif: 1 }))
    const { res } = await appeler(MANAGER, 'DELETE', '/api/employes/5', undefined, d1)
    expect(res.status).toBe(403)
    const appels = JSON.stringify((d1 as any).__getCalls())
    // Le refus vient de la garde d'appartenance (la fiche a été lue), pas du rôle
    expect(appels).toMatch(/SELECT \* FROM employes/i)
    expect(appels).not.toMatch(/UPDATE employes/i)
  })
})

describe('synchro phone-specs-api ouverte au manager (décision de l\'exploitant du 2026-10-04)', () => {
  // Le bouton « Synchroniser API » était proposé au manager, et chaque marque échouait en 403
  // « Rôles requis : admin » — affiché en succès vert. La synchro n'AJOUTE qu'au référentiel
  // commun (INSERT OR IGNORE), jamais n'écrase : l'exploitant l'ouvre au manager.
  const ROUTES_DE_SYNCHRO: [string, string, unknown?][] = [
    ['GET',  '/api/services/catalog/sync-status'],
    ['POST', '/api/services/catalog/sync-brands', {}],
    ['POST', '/api/services/catalog/sync-modeles/apple-phones-48', {}],
    ['POST', '/api/services/catalog/sync-selected', { slugs: ['apple-phones-48'] }],
  ]

  // Aucun appel réel à l'API externe : elle répond « indisponible », le handler s'arrête vite
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => new Response('indisponible', { status: 503 }))) })
  afterEach(() => { vi.unstubAllGlobals() })

  for (const [methode, chemin, corps] of ROUTES_DE_SYNCHRO) {
    it(`${methode} ${chemin} : un manager n'est pas refusé pour son rôle`, async () => {
      const { texte } = await appeler(MANAGER, methode, chemin, corps)
      expect(refusDeRole(texte), texte).toBe(false)
    })

    it(`${methode} ${chemin} : le technicien reste refusé`, async () => {
      const { res, texte } = await appeler(TECHNICIEN, methode, chemin, corps)
      expect(res.status).toBe(403)
      expect(refusDeRole(texte)).toBe(true)
    })
  }
})

describe('aucun requireRole() ne cite un rôle qui n\'existe pas', () => {
  // @ts-ignore process types not available without @types/node
  const RACINE = process.cwd()

  /** Rôles réellement insérés par la migration 0001 (source de la table `roles`). */
  function rolesExistants(): string[] {
    const sql = readFileSync(join(RACINE, 'migrations', '0001_users_roles.sql'), 'utf8')
    const bloc = /INSERT[^;]*INTO\s+roles[^;]*;/i.exec(sql)?.[0] ?? ''
    return [...bloc.matchAll(/\(\s*\d+\s*,\s*'([a-z_]+)'/g)].map(m => m[1])
  }

  it('la liste des rôles est bien lue (sinon ce garde-fou passerait à vide)', () => {
    expect(rolesExistants()).toEqual(['admin', 'manager', 'technicien', 'client'])
  })

  it('chaque rôle cité dans un requireRole() de src/routes existe', () => {
    const connus = new Set(rolesExistants())
    const dossier = join(RACINE, 'src', 'routes')
    const inconnus: string[] = []
    for (const f of readdirSync(dossier).filter((n: string) => n.endsWith('.ts'))) {
      // Commentaires retirés : un `AVANT :` qui cite l'ancien rôle n'est pas une route servie
      const src = readFileSync(join(dossier, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      for (const m of src.matchAll(/requireRole\(([^)]*)\)/g)) {
        for (const r of m[1].matchAll(/'([^']+)'/g))
          if (!connus.has(r[1])) inconnus.push(`${f} : requireRole(${m[1]}) — « ${r[1]} » n'existe pas`)
      }
    }
    expect(inconnus).toEqual([])
  })
})
