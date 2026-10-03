// AVANT (2026-10-03, ajout de batch()) : import type { Database } from '../../ports/database'
import type { Database, RequeteDeLot } from '../../ports/database'

/**
 * Implémentation du port Database pour Cloudflare D1.
 * Seule implémentation active — l'adaptateur Postgres (VPS) sera ajouté
 * au moment de la bascule (hors scope de ce chantier).
 */
export class D1DatabaseAdapter implements Database {
  constructor(private readonly binding: D1Database) {}

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.binding.prepare(sql).bind(...params).all<T>()
    return result.results ?? []
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const result = await this.binding.prepare(sql).bind(...params).first<T>()
    return result ?? null
  }

  async run(sql: string, params: unknown[] = []): Promise<{ id: number | null; changes: number }> {
    const result = await this.binding.prepare(sql).bind(...params).run()
    return {
      id:      result.meta.last_row_id ?? null,
      changes: result.meta.changes     ?? 0,
    }
  }

  /**
   * Lot « tout ou rien » : D1 exécute toutes les instructions d'un `batch()` dans une seule
   * transaction (si l'une échoue, D1 annule les autres). Ajouté le 2026-10-03.
   */
  async batch(requetes: RequeteDeLot[]): Promise<unknown[][]> {
    const instructions = requetes.map(requete =>
      this.binding.prepare(requete.sql).bind(...(requete.params ?? []))
    )
    const resultats = await this.binding.batch(instructions)

    // Pour chaque requête, les lignes renvoyées (RETURNING), ou une liste vide
    const lignesParRequete: unknown[][] = []
    for (const resultat of resultats) {
      lignesParRequete.push(resultat.results ?? [])
    }
    return lignesParRequete
  }
}
