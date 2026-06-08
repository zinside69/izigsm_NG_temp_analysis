/**
 * lib/db.ts — Helpers D1 : numérotation automatique, pagination, validation
 */

// ─── Numérotation automatique ─────────────────────────────────────────────────

/**
 * Génère le prochain numéro séquentiel pour une boutique.
 * Format configurable via boutique_settings :
 *   - format_numero='annee'  → PREFIX-ANNÉE-XXXXX (ex: TKT-2026-00001)
 *   - format_numero='simple' → PREFIX-XXXXX       (ex: TKT-00001)
 * Les préfixes sont personnalisables (prefix_ticket, prefix_facture…)
 */
export async function nextNumero(
  db: D1Database,
  boutique_id: number,
  type: 'ticket' | 'facture' | 'devis' | 'avoir' | 'rachat'
): Promise<string> {
  const annee = new Date().getFullYear()

  // Lire la config de numérotation de la boutique (avec fallback)
  const settings = await db.prepare(`
    SELECT prefix_ticket, prefix_facture, prefix_devis, prefix_avoir, prefix_rachat,
           format_numero, padding_numero
    FROM   boutique_settings
    WHERE  boutique_id = ?
  `).bind(boutique_id).first<{
    prefix_ticket:  string; prefix_facture: string; prefix_devis: string
    prefix_avoir:   string; prefix_rachat:  string
    format_numero:  string; padding_numero: number
  }>()

  const PREFIXES_DEFAUT: Record<string, string> = {
    ticket:  'TKT', facture: 'FAC', devis: 'DEV', avoir: 'AV', rachat: 'LP',
  }
  const PREFIXES_SETTINGS: Record<string, string | undefined> = {
    ticket:  settings?.prefix_ticket,
    facture: settings?.prefix_facture,
    devis:   settings?.prefix_devis,
    avoir:   settings?.prefix_avoir,
    rachat:  settings?.prefix_rachat,
  }
  const prefix  = PREFIXES_SETTINGS[type] || PREFIXES_DEFAUT[type]
  const format  = settings?.format_numero  ?? 'annee'
  const padding = settings?.padding_numero ?? 5

  // Upsert séquence
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

  const num     = row?.dernier_num ?? 1
  const numStr  = String(num).padStart(padding, '0')

  return format === 'simple'
    ? `${prefix}-${numStr}`
    : `${prefix}-${annee}-${numStr}`
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
