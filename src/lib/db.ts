/**
 * lib/db.ts — Helpers D1 : numérotation automatique, pagination, validation
 */

// ─── Numérotation automatique ─────────────────────────────────────────────────

/**
 * Génère le prochain numéro séquentiel pour une boutique.
 * Format : PREFIX-ANNÉE-XXXXX (ex: TKT-2026-00001)
 * Utilise la table `sequences` avec un verrou optimiste.
 */
export async function nextNumero(
  db: D1Database,
  boutique_id: number,
  type: 'ticket' | 'facture' | 'devis'
): Promise<string> {
  const annee = new Date().getFullYear()

  // Upsert la séquence et incrémenter
  await db.prepare(`
    INSERT INTO sequences (boutique_id, type, annee, dernier_num)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(boutique_id, type, annee)
    DO UPDATE SET dernier_num = dernier_num + 1
  `).bind(boutique_id, type, annee).run()

  const row = await db.prepare(`
    SELECT dernier_num FROM sequences
    WHERE boutique_id = ? AND type = ? AND annee = ?
  `).bind(boutique_id, type, annee).first<{ dernier_num: number }>()

  const num = row?.dernier_num ?? 1
  const prefix = { ticket: 'TKT', facture: 'FAC', devis: 'DEV' }[type]
  return `${prefix}-${annee}-${String(num).padStart(5, '0')}`
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginationParams {
  page:    number
  limit:   number
  offset:  number
}

export function parsePagination(query: Record<string, string>): PaginationParams {
  const page  = Math.max(1, parseInt(query.page  ?? '1',  10))
  const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '20', 10)))
  return { page, limit, offset: (page - 1) * limit }
}

export interface PaginatedResult<T> {
  data:       T[]
  pagination: {
    page:     number
    limit:    number
    total:    number
    pages:    number
  }
}

// ─── Validation basique ───────────────────────────────────────────────────────

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function validateImei(imei: string): boolean {
  return /^\d{15}$/.test(imei)
}

export function validateTelephone(tel: string): boolean {
  return /^(\+33|0)[1-9](\d{8})$/.test(tel.replace(/\s/g, ''))
}

// ─── Calculs TVA ──────────────────────────────────────────────────────────────

export interface TvaResult {
  ht:  number
  tva: number
  ttc: number
}

export function calculTva(prixHt: number, tauxTva: number): TvaResult {
  const ht  = Math.round(prixHt * 100) / 100
  const tva = Math.round(ht * (tauxTva / 100) * 100) / 100
  const ttc = Math.round((ht + tva) * 100) / 100
  return { ht, tva, ttc }
}

export function calculLignes(lignes: Array<{ quantite: number; prix_unitaire_ht: number; tva_taux: number }>) {
  return lignes.reduce(
    (acc, l) => {
      const ht  = Math.round(l.quantite * l.prix_unitaire_ht * 100) / 100
      const tva = Math.round(ht * (l.tva_taux / 100) * 100) / 100
      return {
        total_ht:  Math.round((acc.total_ht + ht) * 100) / 100,
        total_tva: Math.round((acc.total_tva + tva) * 100) / 100,
        total_ttc: Math.round((acc.total_ttc + ht + tva) * 100) / 100,
      }
    },
    { total_ht: 0, total_tva: 0, total_ttc: 0 }
  )
}

// ─── Audit log ────────────────────────────────────────────────────────────────

export async function auditLog(
  db: D1Database,
  params: {
    boutique_id?: number
    user_id:      number
    action:       string
    entite_type?: string
    entite_id?:   number
    avant?:       object
    apres?:       object
    ip?:          string
  }
): Promise<void> {
  await db.prepare(`
    INSERT INTO audit_logs (boutique_id, user_id, action, entite_type, entite_id, donnees_avant, donnees_apres, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    params.boutique_id ?? null,
    params.user_id,
    params.action,
    params.entite_type ?? null,
    params.entite_id   ?? null,
    params.avant       ? JSON.stringify(params.avant) : null,
    params.apres       ? JSON.stringify(params.apres) : null,
    params.ip          ?? null
  ).run()
}
