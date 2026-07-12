/**
 * lib/timezone.ts — Heure locale France (Europe/Paris), DST automatique.
 *
 * Toute la plateforme iziGSM doit passer par ces fonctions pour interpréter
 * ou comparer des horodatages métier (pointage, rapports, "aujourd'hui")
 * plutôt que `new Date()`/`Date.now()` bruts ou `DATE('now')` en SQL (UTC
 * du runtime serveur, pas heure française).
 *
 * @module lib/timezone
 */

const PARIS_TZ = 'Europe/Paris'

/**
 * Parse un horodatage SQLite ("YYYY-MM-DD HH:MM:SS", produit par
 * `DEFAULT CURRENT_TIMESTAMP` — toujours en UTC mais sans suffixe de fuseau)
 * en instant UTC correct.
 *
 * Sans cette fonction, `new Date("2026-07-12 17:50:41")` est interprété
 * comme heure LOCALE du runtime JS (ambigu) — décalage silencieux si ce
 * runtime ne tourne pas en UTC (ex: poste de dev Windows en UTC+1/+2).
 * Cloudflare Workers tourne nativement en UTC (aucun écart en prod), mais
 * `wrangler pages dev` / `vite dev` en local héritent du fuseau système —
 * bug découvert le 2026-07-12 sur `pointagesAujourdhui()` (heures gonflées
 * de 2h en local, machine UTC+2).
 */
export function parseUtcTimestamp(raw: string): Date {
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T')
  return new Date(iso.endsWith('Z') ? iso : `${iso}Z`)
}

/**
 * Date du jour ("YYYY-MM-DD") en heure locale France.
 *
 * Gère automatiquement le passage heure d'été/hiver (UTC+2 été, UTC+1 hiver)
 * via les données de fuseau ICU intégrées au runtime (Node et Cloudflare
 * Workers en disposent nativement) — aucune table de dates codée en dur.
 *
 * À lier en paramètre SQL (`?`) à la place de `DATE('now')` (UTC serveur)
 * partout où "aujourd'hui" doit refléter la journée métier française plutôt
 * que la journée calendaire UTC.
 */
export function todayParis(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PARIS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

/**
 * Mois courant ("YYYY-MM") en heure locale France.
 * À lier en paramètre SQL à la place de `strftime('%Y-%m', ..., 'now')`
 * (UTC serveur) pour les agrégats "ce mois-ci" (KPIs, clôtures NF525).
 */
export function currentMonthParis(date: Date = new Date()): string {
  return todayParis(date).slice(0, 7)
}
