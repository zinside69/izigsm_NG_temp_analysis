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
  /**
   * Plusieurs écritures jouées en UN SEUL bloc « tout ou rien » (équivalent D1 .batch(), qui les
   * exécute dans une transaction) : si l'une échoue, aucune n'est gardée.
   *
   * Ajouté le 2026-10-03 (décision de l'exploitant) pour la clôture journalière NF525, dont le
   * marquage du journal et l'enregistrement de la clôture doivent réussir ou échouer ensemble.
   *
   * @param requetes  Les requêtes, dans l'ordre d'exécution
   * @returns         Pour chaque requête, dans le même ordre, les lignes qu'elle renvoie
   *                  (clause RETURNING) — une liste vide si elle n'en renvoie pas
   */
  batch(requetes: RequeteDeLot[]): Promise<unknown[][]>
}

/** Une requête d'un lot `batch()` : le SQL et ses paramètres. */
export interface RequeteDeLot {
  sql:     string
  params?: unknown[]
}
