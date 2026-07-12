/**
 * Port d'accès base de données — découple les services de l'implémentation
 * concrète (D1 aujourd'hui, Postgres au moment de la bascule VPS).
 * Voir docs/superpowers/specs/2026-07-12-architecture-ports-adapters-design.md
 */
export interface Database {
  /** SELECT retournant plusieurs lignes (équivalent D1 .all()) */
  all<T>(sql: string, params?: unknown[]): Promise<T[]>
  /** SELECT retournant une ligne ou null (équivalent D1 .first()) */
  get<T>(sql: string, params?: unknown[]): Promise<T | null>
  /** INSERT/UPDATE/DELETE sans RETURNING (équivalent D1 .run()) */
  run(sql: string, params?: unknown[]): Promise<{ id: number | null; changes: number }>
}
