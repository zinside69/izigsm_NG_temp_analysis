import type { Database } from '../../ports/database'

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
}
