/**
 * @file tests/nf525-ecrivains-conformite.test.ts
 * @description Garde-fou statique — le vérificateur NF525 connaît tous ses écrivains.
 *
 * Pourquoi ce fichier existe (ticket 005, 2026-09-04) :
 *   Deux fonctions écrivent dans `journal_nf525`, avec deux formats canoniques
 *   incompatibles. `verifierIntegriteChaine()` aiguille sur `type_transaction`
 *   via `TYPES_ECRIVAIN_B` (`caisseService.ts`). Si un développeur fait passer un
 *   NOUVEAU type par `lib/nf525.enregistrerTransaction()` sans l'ajouter à cet
 *   ensemble, le vérificateur le recalculera au format A et le déclarera
 *   frauduleux — exactement le défaut que ce ticket corrige, réintroduit en
 *   silence sur le contrôle légal.
 *
 * Ce test relit les SOURCES, pas le comportement : c'est le seul moyen de couvrir
 * un type qui n'existe pas encore. Il échoue le jour où l'on en ajoute un.
 */

import { describe, it, expect } from 'vitest'
// @ts-ignore node:fs types not available without @types/node
import { readFileSync, readdirSync } from 'node:fs'
// @ts-ignore node:path types not available without @types/node
import { join } from 'node:path'
import { TYPES_ECRIVAIN_B } from '../src/services/caisseService'

// `process.cwd()` et non `__dirname` : meme patron que les autres gardes-fous
// statiques du depot (tsconfig n'inclut pas les types Node).
// @ts-ignore process non type sans @types/node
const SRC = join(process.cwd(), 'src')

/** Liste récursivement les fichiers .ts sous un dossier. */
function fichiersTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e: any) =>
    e.isDirectory() ? fichiersTs(join(dir, e.name))
      : e.name.endsWith('.ts') ? [join(dir, e.name)] : []
  )
}

/** Retire les commentaires : un exemple documenté ne doit pas compter comme un appel. */
function sansCommentaires(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

describe('conformité NF525 — écrivains du journal et vérificateur', () => {
  it('tout type_transaction passé à enregistrerTransaction() est déclaré dans TYPES_ECRIVAIN_B', () => {
    const trouves = new Set<string>()

    for (const f of fichiersTs(SRC)) {
      if (f.endsWith(join('lib', 'nf525.ts'))) continue   // la lib elle-même n'appelle pas
      const src = sansCommentaires(readFileSync(f, 'utf8'))

      // Chaque appel `enregistrerTransaction(db, { ... type_transaction: 'x' ... })`
      for (const appel of src.matchAll(/enregistrerTransaction\s*\([\s\S]{0,600}?\}\s*\)/g)) {
        for (const m of appel[0].matchAll(/type_transaction\s*:\s*['"]([a-z_]+)['"]/g)) {
          trouves.add(m[1])
        }
      }
    }

    // Filet : si la regex ne trouve plus rien, c'est que la forme des appels a changé
    // et que ce garde-fou ne garde plus rien. Mieux vaut échouer que passer à vide.
    expect(trouves.size).toBeGreaterThan(0)

    const manquants = [...trouves].filter(t => !TYPES_ECRIVAIN_B.has(t))
    expect(manquants, `type_transaction écrits au format B mais absents de TYPES_ECRIVAIN_B : ${manquants.join(', ')}`).toEqual([])
  })

  it("aucun type de l'écrivain A n'est déclaré comme écrivain B", () => {
    // 'vente' et 'encaissement' sont écrits par INSERT direct dans caisseService,
    // au format A. Les déclarer côté B les ferait tous ressortir en anomalie.
    for (const typeA of ['vente', 'encaissement']) {
      expect(TYPES_ECRIVAIN_B.has(typeA), `'${typeA}' est écrit au format A`).toBe(false)
    }
  })
})
