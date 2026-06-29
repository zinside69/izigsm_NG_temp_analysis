/**
 * @module routes/caisse
 * @description Controller Caisse POS + Journal NF525 (P1 MVC — 0 SQL ici).
 *
 * Rôle architectural :
 *   Controller pur (P1 Modularité) — orchestration HTTP uniquement.
 *   Toute logique métier et SQL est déléguée à `caisseService.ts` (Model).
 *
 * Endpoints :
 *   GET    /api/caisse/kpis         → KPIs caisse du jour + mois
 *   GET    /api/caisse/journal      → Journal NF525 du jour (ou ?date=YYYY-MM-DD)
 *   POST   /api/caisse/vente        → Vente POS directe (crée facture + journal NF525)
 *   POST   /api/caisse/encaissement → Encaisser une facture existante
 *   GET    /api/caisse/clotures     → Historique des clôtures journalières
 *   POST   /api/caisse/cloture      → Clôture journalière NF525 (admin/gerant)
 *   GET    /api/caisse/integrite    → Vérifier intégrité chaîne de hash (admin/gerant)
 *
 * Sécurité :
 *   Toutes les routes requièrent `authMiddleware`.
 *   `cloture` et `integrite` requièrent en plus `requireRole('admin', 'gerant')`.
 *
 * Format de réponse (P5 uniforme) : `{ success, data?, error?, message? }`
 */

import { Hono }          from 'hono'
import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'
import {
  createVente,
  enregistrerEncaissement,
  getCaisseJournal,
  cloturerJournee,
  verifierIntegriteChaine,
  getKpisCaisse,
  listClotures,
} from '../services/caisseService'

// ─── Types ────────────────────────────────────────────────────────────────────

type Bindings = { DB: D1Database; KV: KVNamespace; JWT_SECRET: string }
const caisse = new Hono<{ Bindings: Bindings }>()

// ─── Helper contexte (même pattern que sav.ts) ────────────────────────────────

/**
 * Extrait le contexte utilisateur et le boutique_id résolu depuis le contexte Hono.
 * Centralise la résolution multi-tenant pour toutes les routes de ce controller.
 *
 * @param c  Contexte Hono
 * @returns  `{ user: JwtPayload, boutiqueId: number | null }`
 */
function ctx(c: any) {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, new URL(c.req.url).searchParams.get('boutique_id') ?? undefined)
  return { user, boutiqueId }
}

// ─── Auth sur toutes les routes ───────────────────────────────────────────────
caisse.use('*', authMiddleware)

// ─── Validators locaux ────────────────────────────────────────────────────────

/**
 * Valide le corps d'une requête de vente POS.
 * Vérifie la présence des lignes, le mode de paiement et la cohérence de chaque ligne.
 *
 * Modes de paiement valides : `especes` | `cb` | `virement` | `cheque` | `mixte`
 * Taux TVA valides : `0` | `5.5` | `10` | `20`
 *
 * @param body  Corps JSON de la requête POST /caisse/vente
 * @returns     Message d'erreur (string) si invalide, `null` si valide
 */
function validateVente(body: any): string | null {
  if (!Array.isArray(body.lignes) || body.lignes.length === 0)
    return 'Au moins une ligne de vente obligatoire.'

  const modesValides = ['especes', 'cb', 'virement', 'cheque', 'mixte']
  if (!body.mode_paiement || !modesValides.includes(body.mode_paiement))
    return `mode_paiement obligatoire (${modesValides.join(', ')}).`

  for (const [i, l] of (body.lignes as any[]).entries()) {
    if (!l.designation?.trim())
      return `Ligne ${i + 1} : désignation obligatoire.`
    if (l.quantite === undefined || isNaN(Number(l.quantite)) || Number(l.quantite) <= 0)
      return `Ligne ${i + 1} : quantité invalide (> 0).`
    if (l.prix_unitaire_ht === undefined || isNaN(Number(l.prix_unitaire_ht)) || Number(l.prix_unitaire_ht) < 0)
      return `Ligne ${i + 1} : prix_unitaire_ht invalide (≥ 0).`
    if (l.tva_taux === undefined || isNaN(Number(l.tva_taux)) || ![0, 5.5, 10, 20].includes(Number(l.tva_taux)))
      return `Ligne ${i + 1} : tva_taux invalide (0, 5.5, 10 ou 20).`
  }
  return null
}

// ─── KPIs Caisse ─────────────────────────────────────────────────────────────

/**
 * GET /api/caisse/kpis
 * Retourne les indicateurs clés de performance de la caisse pour le jour courant et le mois.
 * Délègue à `getKpisCaisse()` qui effectue des requêtes D1 + KV en parallèle.
 *
 * Query params :
 *   `boutique_id` (requis pour admin, ignoré pour autres rôles)
 *
 * @returns 200 `{ success: true, data: KpisCaisse }`
 * @returns 400 si boutique_id manquant
 * @returns 500 en cas d'erreur serveur
 */
caisse.get('/caisse/kpis', async (c) => {
  const { boutiqueId } = ctx(c)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  try {
    const kpis = await getKpisCaisse(c.env.DB, boutiqueId)
    return c.json({ success: true, data: kpis })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ─── Journal du jour ──────────────────────────────────────────────────────────

/**
 * GET /api/caisse/journal
 * Retourne le journal NF525 du jour courant ou d'une date spécifique.
 *
 * Query params :
 *   `boutique_id` (requis admin)
 *   `date`        (optionnel, format YYYY-MM-DD — défaut : aujourd'hui)
 *
 * @returns 200 `{ success: true, data: JournalEntry[] }`
 * @returns 400 si boutique_id manquant ou format date invalide
 * @returns 500 en cas d'erreur serveur
 */
caisse.get('/caisse/journal', async (c) => {
  const { boutiqueId } = ctx(c)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const date = new URL(c.req.url).searchParams.get('date') ?? undefined
  // Valider format date si fourni
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return c.json({ success: false, error: 'Format date invalide (YYYY-MM-DD).' }, 400)

  try {
    const journal = await getCaisseJournal(c.env.DB, boutiqueId, date)
    return c.json({ success: true, data: journal })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ─── Vente POS ────────────────────────────────────────────────────────────────

/**
 * POST /api/caisse/vente
 * Crée une vente POS directe : génère la facture + l'entrée NF525 en une transaction.
 *
 * Body JSON :
 * ```json
 * {
 *   "client_id":       1,          // optionnel
 *   "mode_paiement":  "especes",   // requis : especes|cb|virement|cheque|mixte
 *   "montant_especes": 50.00,      // pour mode mixte
 *   "montant_cb":      30.00,      // pour mode mixte
 *   "note":            "...",      // optionnel
 *   "lignes": [{
 *     "produit_id":       1,       // optionnel
 *     "service_id":       2,       // optionnel
 *     "designation":      "Réparation écran",
 *     "quantite":         1,
 *     "prix_unitaire_ht": 80.00,
 *     "tva_taux":         20,      // 0 | 5.5 | 10 | 20
 *     "remise_pct":       0        // optionnel
 *   }]
 * }
 * ```
 *
 * @returns 201 `{ success: true, data: { facture_id, numero_facture, hash_nf525 } }`
 * @returns 400 si boutique_id manquant ou erreur métier
 * @returns 422 si corps invalide (validation `validateVente`)
 */
caisse.post('/caisse/vente', async (c) => {
  const { user, boutiqueId } = ctx(c)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  let body: any
  try { body = await c.req.json() }
  catch { return c.json({ success: false, error: 'JSON invalide.' }, 400) }

  const err = validateVente(body)
  if (err) return c.json({ success: false, error: err }, 422)

  try {
    const result = await createVente(c.env.DB, boutiqueId, user.sub, {
      client_id:       body.client_id       ? Number(body.client_id)       : undefined,
      lignes:          body.lignes.map((l: any) => ({
        produit_id:       l.produit_id       ? Number(l.produit_id)       : undefined,
        service_id:       l.service_id       ? Number(l.service_id)       : undefined,
        designation:      String(l.designation),
        quantite:         Number(l.quantite),
        prix_unitaire_ht: Number(l.prix_unitaire_ht),
        tva_taux:         Number(l.tva_taux),
        remise_pct:       l.remise_pct       ? Number(l.remise_pct)        : 0,
      })),
      mode_paiement:   body.mode_paiement,
      montant_especes: body.montant_especes  ? Number(body.montant_especes)  : undefined,
      montant_cb:      body.montant_cb       ? Number(body.montant_cb)       : undefined,
      montant_cheque:  body.montant_cheque   ? Number(body.montant_cheque)   : undefined,
      note:            body.note,
    })
    return c.json({ success: true, data: result }, 201)
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 400)
  }
})

// ─── Encaissement sur facture existante ──────────────────────────────────────

/**
 * POST /api/caisse/encaissement
 * Encaisse une facture existante (statut `en_attente` → `payee`) + entrée NF525.
 *
 * Body JSON :
 * ```json
 * {
 *   "facture_id":    42,        // requis
 *   "mode_paiement": "cb"       // requis : especes|cb|virement|cheque|mixte
 * }
 * ```
 *
 * @returns 201 `{ success: true, data: JournalEntry }`
 * @returns 400 si facture_id manquant, erreur métier, ou facture déjà payée
 * @returns 422 si mode_paiement invalide
 */
caisse.post('/caisse/encaissement', async (c) => {
  const { user, boutiqueId } = ctx(c)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  let body: any
  try { body = await c.req.json() }
  catch { return c.json({ success: false, error: 'JSON invalide.' }, 400) }

  if (!body.facture_id || isNaN(Number(body.facture_id)))
    return c.json({ success: false, error: 'facture_id obligatoire.' }, 422)

  const modesValides = ['especes', 'cb', 'virement', 'cheque', 'mixte']
  if (!body.mode_paiement || !modesValides.includes(body.mode_paiement))
    return c.json({ success: false, error: `mode_paiement obligatoire (${modesValides.join(', ')}).` }, 422)

  try {
    const journal = await enregistrerEncaissement(
      c.env.DB,
      boutiqueId,
      user.sub,
      Number(body.facture_id),
      body.mode_paiement
    )
    return c.json({ success: true, data: journal }, 201)
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 400)
  }
})

// ─── Historique clôtures ──────────────────────────────────────────────────────

/**
 * GET /api/caisse/clotures
 * Retourne l'historique des clôtures journalières NF525.
 *
 * Query params :
 *   `boutique_id` (requis admin)
 *   `limit`       (optionnel, défaut 30, max 100)
 *
 * @returns 200 `{ success: true, data: Cloture[] }`
 * @returns 400 si boutique_id manquant
 * @returns 500 en cas d'erreur serveur
 */
caisse.get('/caisse/clotures', async (c) => {
  const { boutiqueId } = ctx(c)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const limitParam = new URL(c.req.url).searchParams.get('limit')
  const limit = limitParam ? Math.min(100, Math.max(1, parseInt(limitParam, 10))) : 30

  try {
    const clotures = await listClotures(c.env.DB, boutiqueId, limit)
    return c.json({ success: true, data: clotures })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ─── Clôture journalière NF525 ────────────────────────────────────────────────

/**
 * POST /api/caisse/cloture
 * Effectue la clôture journalière NF525 (opération irréversible).
 * Réservé aux rôles `admin` et `gerant`.
 *
 * Body JSON (optionnel) :
 * ```json
 * { "date": "2026-06-29" }  // défaut : aujourd'hui
 * ```
 *
 * Délègue à `cloturerJournee()` — génère le hash de clôture SHA-256
 * enchaîné avec la dernière transaction du journal.
 *
 * @returns 201 `{ success: true, data: { hash_cloture, nb_transactions, total_ttc } }`
 * @returns 400 si journée déjà clôturée, format date invalide, ou aucune transaction
 */
caisse.post('/caisse/cloture', requireRole('admin', 'gerant'), async (c) => {
  const { user, boutiqueId } = ctx(c)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  let body: any = {}
  try { body = await c.req.json() } catch { /* body vide accepté */ }

  const date = body.date ?? undefined
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return c.json({ success: false, error: 'Format date invalide (YYYY-MM-DD).' }, 400)

  try {
    const cloture = await cloturerJournee(c.env.DB, boutiqueId, user.sub, date)
    return c.json({ success: true, data: cloture }, 201)
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 400)
  }
})

// ─── Vérification intégrité chaîne NF525 ─────────────────────────────────────

/**
 * GET /api/caisse/integrite
 * Vérifie l'intégrité complète de la chaîne de hash NF525 pour la boutique.
 * Réservé aux rôles `admin` et `gerant`.
 *
 * Recalcule chaque hash SHA-256 et détecte toute rupture de chaîne
 * qui indiquerait une modification frauduleuse des données.
 *
 * Query params :
 *   `boutique_id` (requis admin)
 *   `date_debut`  (optionnel, format YYYY-MM-DD)
 *   `date_fin`    (optionnel, format YYYY-MM-DD)
 *
 * @returns 200 `{ success: true, data: { valide, nb_entrees, premiere_erreur? } }`
 * @returns 400 si boutique_id manquant
 * @returns 500 en cas d'erreur serveur
 */
caisse.get('/caisse/integrite', requireRole('admin', 'gerant'), async (c) => {
  const { boutiqueId } = ctx(c)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const sp        = new URL(c.req.url).searchParams
  const dateDebut = sp.get('date_debut') ?? undefined
  const dateFin   = sp.get('date_fin')   ?? undefined

  try {
    const result = await verifierIntegriteChaine(c.env.DB, boutiqueId, dateDebut, dateFin)
    return c.json({ success: true, data: result })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

export default caisse
