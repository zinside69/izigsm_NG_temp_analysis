import { describe, it, expect } from 'vitest'
// @ts-ignore node:fs types not available without @types/node
import { readFileSync, readdirSync } from 'node:fs'
// @ts-ignore node:path types not available without @types/node
import { join } from 'node:path'

/**
 * Garde-fou statique — tout `EmailType` du code doit être admis par le CHECK de
 * `email_logs.type` (🔴 P1 du 2026-09-11, `bugs.md`).
 *
 * `ticket_livre` et `relance_devis` ont été ajoutés au code sans migration : leurs emails
 * partaient sans ligne, et l'anti-doublon des relances de devis ne pouvait pas fonctionner.
 * Aucun test ne l'a vu, parce que les mocks de base n'appliquent pas les contraintes.
 *
 * Ce test relit les sources — seul moyen de couvrir un type qui n'existe pas encore (même
 * principe que `tests/nf525-ecrivains-conformite.test.ts`). Il échoue dès qu'un type est
 * ajouté à `EmailType` sans migration élargissant le CHECK.
 */

// @ts-ignore process types not available without @types/node
const RACINE = process.cwd()

/** Valeurs entre quotes simples d'un fragment de source. */
const valeurs = (fragment: string): string[] => [...fragment.matchAll(/'([^']+)'/g)].map(m => m[1])

/** Union `EmailType` telle que déclarée dans le service. */
function typesDuCode(): string[] {
  const source = readFileSync(join(RACINE, 'src', 'services', 'emailService.ts'), 'utf8')
  const decl = /export type EmailType\s*=\s*([^\n]+)/.exec(source)
  if (!decl) throw new Error('EmailType introuvable dans emailService.ts')
  return valeurs(decl[1])
}

/** CHECK(type IN (…)) de la DERNIÈRE migration qui (re)crée `email_logs`. */
function typesDeLaBase(): { fichier: string; types: string[] } {
  const dossier = join(RACINE, 'migrations')
  const motif = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?email_logs\s*\([\s\S]*?CHECK\s*\(\s*type\s+IN\s*\(([^)]*)\)/
  const trouves = readdirSync(dossier)
    .filter((f: string) => f.endsWith('.sql'))
    .sort()
    .map((f: string) => ({ fichier: f, m: motif.exec(readFileSync(join(dossier, f), 'utf8')) }))
    .filter((x: { m: RegExpExecArray | null }) => x.m)
  const dernier = trouves[trouves.length - 1]
  if (!dernier) throw new Error('Aucune migration ne crée email_logs avec un CHECK sur type')
  return { fichier: dernier.fichier, types: valeurs(dernier.m![1]) }
}

describe('EmailType ↔ CHECK de email_logs.type', () => {
  it('tout type d\'email du code est admis par la base', () => {
    const { fichier, types } = typesDeLaBase()
    const manquants = typesDuCode().filter(t => !types.includes(t))

    expect(
      manquants,
      `Types écrits par le code mais refusés par le CHECK de ${fichier} — ajouter une migration ` +
      `qui élargit le CHECK (recréation de table, patron de 0043), sinon ces emails partent sans ligne`,
    ).toEqual([])
  })
})
