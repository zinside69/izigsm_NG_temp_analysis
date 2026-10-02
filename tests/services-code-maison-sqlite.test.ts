import { describe, it, expect, beforeEach } from 'vitest'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'
import { D1DatabaseAdapter } from '../src/adapters/cloudflare/d1Database'
import type { Database } from '../src/ports/database'
import {
  createService, updateService, poserCodeMaisonService,
  ErreurServiceCodeEnDoublon, ErreurServiceDejaCode,
} from '../src/services/servicesService'
import { codeMaison, estEan13Valide } from '../src/lib/codeMaison'

/**
 * @file tests/services-code-maison-sqlite.test.ts
 * @description Code-barres / code maison des services (ticket 05 `vente-lit-catalogue`), contre le
 * schéma RÉEL (`baseAuSchemaReel()`, migration 0052 comprise — appliquée en production le
 * 2026-10-02). La règle d'unicité et les écritures conditionnelles sont réellement exercées
 * (`CLAUDE.md` § Bons de commande, jamais un mock).
 *
 * `D1DatabaseAdapter` enveloppe le D1Database réel en port `Database`, exactement comme
 * `src/index.tsx` le fait en production pour `c.get('db')`.
 */

let base: BaseReelle
let db: Database

function service(p: Partial<{ boutique_id: number; nom: string; code_barre: string | null; actif: number }>): number {
  const v = { boutique_id: 1, nom: 'Service', code_barre: null, actif: 1, ...p }
  return Number(base.sqlite.prepare(
    'INSERT INTO services (boutique_id, nom, code_barre, actif, prix_ht, tva_taux) VALUES (?, ?, ?, ?, 0, 20)',
  ).run(v.boutique_id, v.nom, v.code_barre, v.actif).lastInsertRowid)
}

function codeBarreDe(id: number): string | null {
  return (base.sqlite.prepare('SELECT code_barre FROM services WHERE id = ?').get(id) as any).code_barre
}

beforeEach(() => {
  base = baseAuSchemaReel()
  base.sqlite.exec("INSERT INTO boutiques (id, nom) VALUES (1, 'Boutique 1'), (2, 'Boutique 2')")
  db = new D1DatabaseAdapter(base.d1)
})

// ─── poserCodeMaisonService() ───────────────────────────────────────────────────

describe('poserCodeMaisonService()', () => {
  it('pose un code maison (préfixe 22, EAN-13 valide) sur un service sans code', async () => {
    const id = service({ nom: 'Pose de film' })
    const { code } = await poserCodeMaisonService(db, 1, id)
    expect(code).toBe(codeMaison(2, id))
    expect(code.startsWith('22')).toBe(true)
    expect(estEan13Valide(code)).toBe(true)
    expect(codeBarreDe(id)).toBe(code)
  })

  it('refuse un service qui a déjà un code-barres (ErreurServiceDejaCode, UPDATE sans effet)', async () => {
    const id = service({ code_barre: 'DEJA' })
    await expect(poserCodeMaisonService(db, 1, id)).rejects.toBeInstanceOf(ErreurServiceDejaCode)
    expect(codeBarreDe(id)).toBe('DEJA') // inchangé
  })

  it('service introuvable (autre boutique) → Error dédiée', async () => {
    const id = service({ boutique_id: 2 })
    await expect(poserCodeMaisonService(db, 1, id)).rejects.toThrow('Service introuvable.')
  })

  it('service inactif → Error dédiée (comme introuvable)', async () => {
    const id = service({ actif: 0 })
    await expect(poserCodeMaisonService(db, 1, id)).rejects.toThrow('Service introuvable.')
  })

  it('collision avec un autre service porteur du même code calculé → ErreurServiceCodeEnDoublon nommant le porteur', async () => {
    const id = service({ nom: 'Cible' })
    service({ nom: 'Porteur existant', code_barre: codeMaison(2, id) })

    const err = await poserCodeMaisonService(db, 1, id).catch(e => e)
    expect(err).toBeInstanceOf(ErreurServiceCodeEnDoublon)
    expect(err.service.nom).toBe('Porteur existant')
    expect(codeBarreDe(id)).toBeNull() // pas posé
  })

  // ─── Mutation (ADR 0003) ────────────────────────────────────────────────────
  // Mutant : dans `poserCodeMaisonService()` (src/services/servicesService.ts), remplacer `if
  // (resultat.changes === 0) throw new ErreurServiceDejaCode()` par un `return { code }`
  // inconditionnel. Rouge observé sur « refuse un service qui a déjà un code-barres » :
  // `poserCodeMaisonService()` résolvait au lieu de rejeter ET écrasait silencieusement le code
  // existant (`codeBarreDe(id)` valait le nouveau code calculé au lieu de `'DEJA'`). Mutation
  // restaurée, test revérifié vert (voir compte rendu).
})

// ─── createService() / updateService() — doublon et trois états de code_barre ──

describe('createService() — doublon de code-barres', () => {
  it('crée un service avec un code-barres libre', async () => {
    const id = await createService(base.d1, { boutique_id: 1, nom: 'Pose de film', prix_ht: 10, code_barre: 'ABC' }, 1)
    expect(codeBarreDe(id)).toBe('ABC')
  })

  it('refuse un code-barres déjà porté, en nommant le service existant', async () => {
    await createService(base.d1, { boutique_id: 1, nom: 'Premier', prix_ht: 10, code_barre: 'ABC' }, 1)

    const err = await createService(base.d1, { boutique_id: 1, nom: 'Doublon', prix_ht: 10, code_barre: 'ABC' }, 1).catch(e => e)
    expect(err).toBeInstanceOf(ErreurServiceCodeEnDoublon)
    expect(err.service.nom).toBe('Premier')
    expect(err.message).toContain('Premier')
  })

  it('aucun code maison automatique à la création (spec : génération à la demande seulement)', async () => {
    const id = await createService(base.d1, { boutique_id: 1, nom: 'Sans code', prix_ht: 10 }, 1)
    expect(codeBarreDe(id)).toBeNull()
  })

  it('code_barre vide à la création → NULL, jamais une chaîne vide', async () => {
    const id = await createService(base.d1, { boutique_id: 1, nom: 'Code vide', prix_ht: 10, code_barre: '  ' }, 1)
    expect(codeBarreDe(id)).toBeNull()
  })

  it('même code-barres dans une AUTRE boutique → admis', async () => {
    await createService(base.d1, { boutique_id: 1, nom: 'Boutique 1', prix_ht: 10, code_barre: 'ABC' }, 1)
    await expect(createService(base.d1, { boutique_id: 2, nom: 'Boutique 2', prix_ht: 10, code_barre: 'ABC' }, 1))
      .resolves.toBeTypeOf('number')
  })
})

describe('updateService() — code_barre à trois états', () => {
  it('pose un code-barres sur un service qui n\'en avait pas', async () => {
    const id = service({ nom: 'Cible' })
    await updateService(base.d1, id, { code_barre: 'NOUVEAU' }, 1)
    expect(codeBarreDe(id)).toBe('NOUVEAU')
  })

  it('refuse de donner à un service le code-barres d\'un autre, en le nommant', async () => {
    service({ nom: 'Porteur', code_barre: 'ABC' })
    const cible = service({ nom: 'Cible' })

    const err = await updateService(base.d1, cible, { code_barre: 'ABC' }, 1).catch(e => e)
    expect(err).toBeInstanceOf(ErreurServiceCodeEnDoublon)
    expect(err.service.nom).toBe('Porteur')
    expect(codeBarreDe(cible)).toBeNull() // inchangé
  })

  it('code_barre ABSENT du corps → inchangé', async () => {
    const id = service({ nom: 'A', code_barre: 'GARDE' })
    await updateService(base.d1, id, { nom: 'A renommé' }, 1)
    expect(codeBarreDe(id)).toBe('GARDE')
  })

  it('code_barre VIDE ("") dans le corps → retire le code (NULL)', async () => {
    const id = service({ nom: 'A', code_barre: 'A-RETIRER' })
    await updateService(base.d1, id, { code_barre: '' }, 1)
    expect(codeBarreDe(id)).toBeNull()
  })

  it('code_barre BLANC ("  ") dans le corps → retire le code (NULL), comme vide', async () => {
    const id = service({ nom: 'A', code_barre: 'A-RETIRER' })
    await updateService(base.d1, id, { code_barre: '  ' }, 1)
    expect(codeBarreDe(id)).toBeNull()
  })

  // ─── Mutation (ADR 0003) ────────────────────────────────────────────────────
  // Mutant : dans `updateService()` (src/services/servicesService.ts), remplacer `code_barre =
  // CASE WHEN ? = 1 THEN ? ELSE code_barre END` par `code_barre = COALESCE(?, code_barre)` (bind
  // `codeBarre ?? null` seul, sans l'indicateur). Rouge observé sur « code_barre VIDE ("") …
  // → retire le code » : `COALESCE('', code_barre)` écrit la chaîne vide littérale au lieu de
  // NULL (`codeBarreDe(id)` valait `''`, pas `null`). Mutation restaurée, test revérifié vert
  // (voir compte rendu).
})
