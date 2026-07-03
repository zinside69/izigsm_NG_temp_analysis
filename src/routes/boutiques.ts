/**
 * @module routes/boutiques
 * @description Controller Boutiques & Paramètres (P1 MVC — controller pur, 0 SQL).
 *
 * Rôle architectural (P1 Modularité) :
 *   Controller pur — 0 SQL direct. Toutes les opérations DB sont déléguées
 *   à `boutiqueService.ts`. Les endpoints NF525 délèguent à `nf525.ts`.
 *
 * Responsabilités du controller :
 *   - Validation des inputs (formats, contraintes métier)
 *   - Contrôles d'autorisation (isolation boutique, rôles)
 *   - Orchestration des appels service
 *   - Formatage des réponses P5
 *
 * Endpoints :
 *   GET    /api/boutiques                    → Liste boutiques (admin = toutes, autres = la leur)
 *   GET    /api/boutiques/:id                → Détail boutique + settings
 *   POST   /api/boutiques                    → Créer boutique (admin seulement)
 *   PUT    /api/boutiques/:id                → Modifier infos boutique (admin/manager)
 *   PUT    /api/boutiques/:id/settings       → Modifier paramètres boutique (admin/manager)
 *   GET    /api/boutiques/:id/stats          → KPIs globaux boutique
 *   GET    /api/boutiques/:id/nf525/verify   → Vérifier intégrité chaîne NF525
 *   POST   /api/boutiques/:id/nf525/cloture  → Clôture journalière NF525
 *
 * Sécurité :
 *   Toutes les routes requièrent `authMiddleware`.
 *   Isolation : non-admin ne peut accéder qu'à leur boutique (`user.boutique_id`).
 *
 * Format de réponse (P5 uniforme) : `{ success, data?, error?, message? }`
 */

import { Hono } from 'hono'
import { authMiddleware, requireRole } from '../lib/middleware'
import { verifyChain, clotureJournaliere } from '../lib/nf525'
import {
  listAllBoutiques,
  listBoutiqueForUser,
  getBoutiqueById,
  getBoutiqueSettings,
  createBoutique,
  updateBoutique,
  updateBoutiqueSettings,
  getStatsBoutique,
  type CreateBoutiqueInput,
  type UpdateBoutiqueInput,
  type UpdateSettingsInput,
} from '../services/boutiqueService'

type Bindings = { DB: D1Database; KV: import("../lib/d1kv").D1KVNamespace; JWT_SECRET: string }
type Variables = { user: any }

const boutiques = new Hono<{ Bindings: Bindings; Variables: Variables }>()
boutiques.use('*', authMiddleware)

// ─── GET /api/boutiques ───────────────────────────────────────────────────────

/**
 * GET /api/boutiques
 * Liste les boutiques actives selon le rôle de l'utilisateur.
 *
 * Isolation multi-tenant :
 *   - `admin` → retourne toutes les boutiques actives via `listAllBoutiques()`
 *   - Autres  → retourne uniquement la boutique de l'utilisateur via `listBoutiqueForUser()`
 *
 * @returns 200 `{ success: true, data: Boutique[] }`
 */
boutiques.get('/', async (c) => {
  const user = c.get('user')

  // Admin voit toutes les boutiques ; les autres rôles voient uniquement la leur
  const data = user.role === 'admin'
    ? await listAllBoutiques(c.env.DB)
    : await listBoutiqueForUser(c.env.DB, user.boutique_id)

  return c.json({ success: true, data })
})

// ─── GET /api/boutiques/:id ───────────────────────────────────────────────────

/**
 * GET /api/boutiques/:id
 * Retourne le détail d'une boutique avec ses paramètres (`boutique_settings`).
 *
 * Isolation : non-admin ne peut accéder qu'à sa propre boutique.
 *
 * @param id  Identifiant numérique de la boutique
 * @returns 200 `{ success: true, data: { ...boutique, settings: BoutiqueSettings } }`
 * @returns 403 si non-admin tente d'accéder à une autre boutique
 * @returns 404 si boutique introuvable ou inactive
 */
boutiques.get('/:id', async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)

  if (user.role !== 'admin' && user.boutique_id !== id)
    return c.json({ success: false, error: 'Accès interdit.' }, 403)

  const boutique = await getBoutiqueById(c.env.DB, id)
  if (!boutique) return c.json({ success: false, error: 'Boutique introuvable.' }, 404)

  const settings = await getBoutiqueSettings(c.env.DB, id)

  return c.json({ success: true, data: { ...boutique, settings } })
})

// ─── POST /api/boutiques ──────────────────────────────────────────────────────

/**
 * POST /api/boutiques
 * Crée une nouvelle boutique. Réservé aux administrateurs.
 *
 * Auto-génère un slug depuis le nom (normalisation des accents et caractères spéciaux).
 * Délègue la création DB + initialisation settings à `createBoutique()`.
 *
 * Body JSON :
 * ```json
 * {
 *   "nom":        "iZiGSM Paris",   // requis
 *   "siret":      "12345678900012", // optionnel
 *   "tva_numero": "FR12345678901",  // optionnel
 *   "adresse":    "1 rue de la Paix",
 *   "code_postal": "75001",
 *   "ville":      "Paris",
 *   "telephone":  "0123456789",
 *   "email":      "contact@izigsm.fr"
 * }
 * ```
 *
 * @returns 201 `{ success: true, id: number, message: 'Boutique créée.' }`
 * @returns 400 si nom manquant
 */
boutiques.post('/', requireRole('admin'), async (c) => {
  const { nom, siret, tva_numero, adresse, code_postal, ville, telephone, email } = await c.req.json()
  if (!nom) return c.json({ success: false, error: 'Nom obligatoire.' }, 400)

  // Auto-générer le slug depuis le nom si non fourni
  const slug = nom.toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[éèêë]/g, 'e').replace(/[àâ]/g, 'a')
    .replace(/[ôö]/g, 'o').replace(/[ùûü]/g, 'u')
    .replace(/[^a-z0-9-]/g, '')

  const input: CreateBoutiqueInput = {
    nom, slug,
    siret:       siret       ?? null,
    tva_numero:  tva_numero  ?? null,
    adresse:     adresse     ?? null,
    code_postal: code_postal ?? null,
    ville:       ville       ?? null,
    telephone:   telephone   ?? null,
    email:       email       ?? null,
  }

  const id = await createBoutique(c.env.DB, input)
  return c.json({ success: true, id, message: 'Boutique créée.' }, 201)
})

// ─── PUT /api/boutiques/:id ───────────────────────────────────────────────────

/**
 * PUT /api/boutiques/:id
 * Met à jour les informations d'une boutique (identité, contact, réseaux sociaux).
 * Réservé à `admin` et `manager`. Non-admin ne peut modifier que sa boutique.
 *
 * Délègue la mise à jour à `updateBoutique()` (COALESCE PATCH-like).
 *
 * Body JSON (tous optionnels) :
 *   `nom`, `siret`, `tva_numero`, `adresse`, `code_postal`, `ville`,
 *   `telephone`, `email`, `site_web`, `slug`, `description`,
 *   `facebook_url`, `instagram_url`, `google_maps_url`
 *
 * @param id  Identifiant numérique de la boutique
 * @returns 200 `{ success: true, message: 'Boutique mise à jour.' }`
 * @returns 403 si non-admin tente de modifier une autre boutique
 */
boutiques.put('/:id', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  if (user.role !== 'admin' && user.boutique_id !== id)
    return c.json({ success: false, error: 'Accès interdit.' }, 403)

  const {
    nom, siret, tva_numero, adresse, code_postal, ville, telephone, email,
    site_web, slug, description, facebook_url, instagram_url, google_maps_url
  } = await c.req.json()

  const input: UpdateBoutiqueInput = {
    nom:             nom             ?? null,
    siret:           siret           ?? null,
    tva_numero:      tva_numero      ?? null,
    adresse:         adresse         ?? null,
    code_postal:     code_postal     ?? null,
    ville:           ville           ?? null,
    telephone:       telephone       ?? null,
    email:           email           ?? null,
    site_web:        site_web        ?? null,
    slug:            slug            ?? null,
    description:     description     ?? null,
    facebook_url:    facebook_url    ?? null,
    instagram_url:   instagram_url   ?? null,
    google_maps_url: google_maps_url ?? null,
  }

  await updateBoutique(c.env.DB, id, input)
  return c.json({ success: true, message: 'Boutique mise à jour.' })
})

// ─── PUT /api/boutiques/:id/settings ─────────────────────────────────────────

/**
 * PUT /api/boutiques/:id/settings
 * Met à jour les paramètres opérationnels d'une boutique.
 * Réservé à `admin` et `manager`. Non-admin ne peut modifier que sa boutique.
 *
 * Validations effectuées ici (avant délégation au service) :
 *   - `format_numero` : 'annee' ou 'simple' uniquement
 *   - `padding_numero` : entre 3 et 8
 *
 * Délègue la mise à jour à `updateBoutiqueSettings()`.
 *
 * @param id  Identifiant numérique de la boutique
 * @returns 200 `{ success: true, message: 'Paramètres mis à jour.' }`
 * @returns 403 si non-admin tente de modifier une autre boutique
 * @returns 422 si format_numero ou padding_numero invalide
 */
boutiques.put('/:id/settings', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  if (user.role !== 'admin' && user.boutique_id !== id)
    return c.json({ success: false, error: 'Accès interdit.' }, 403)

  const {
    tva_taux_defaut, horaires, notif_email_actif, notif_sms_actif,
    paiement_especes, paiement_cb, paiement_cheque, paiement_virement,
    prefix_ticket, prefix_facture, prefix_devis, prefix_avoir, prefix_rachat,
    format_numero, padding_numero,
    garantie_defaut_jours, delai_relance_jours, mention_facture, pied_de_page,
    email_provider, email_api_key, email_from,
    email_notif_ticket_cree, email_notif_ticket_termine,
    email_notif_sav_ouvert,  email_notif_relance,
  } = await c.req.json()

  // Validations numérotation (avant appel service)
  const FORMATS_VALIDES = ['annee', 'simple']
  if (format_numero && !FORMATS_VALIDES.includes(format_numero))
    return c.json({ success: false, error: `format_numero invalide. Valeurs : ${FORMATS_VALIDES.join(', ')}.` }, 422)
  if (padding_numero && (padding_numero < 3 || padding_numero > 8))
    return c.json({ success: false, error: 'padding_numero doit être entre 3 et 8.' }, 422)

  const input: UpdateSettingsInput = {
    tva_taux_defaut:            tva_taux_defaut           ?? null,
    horaires:                   horaires                  ?? null,
    notif_email_actif:          notif_email_actif         ?? null,
    notif_sms_actif:            notif_sms_actif           ?? null,
    paiement_especes:           paiement_especes          ?? null,
    paiement_cb:                paiement_cb               ?? null,
    paiement_cheque:            paiement_cheque           ?? null,
    paiement_virement:          paiement_virement         ?? null,
    prefix_ticket:              prefix_ticket             ?? null,
    prefix_facture:             prefix_facture            ?? null,
    prefix_devis:               prefix_devis              ?? null,
    prefix_avoir:               prefix_avoir              ?? null,
    prefix_rachat:              prefix_rachat             ?? null,
    format_numero:              format_numero             ?? null,
    padding_numero:             padding_numero            ?? null,
    garantie_defaut_jours:      garantie_defaut_jours     ?? null,
    delai_relance_jours:        delai_relance_jours       ?? null,
    mention_facture:            mention_facture           ?? null,
    pied_de_page:               pied_de_page              ?? null,
    email_provider:             email_provider            ?? null,
    email_api_key:              email_api_key             ?? null,
    email_from:                 email_from                ?? null,
    email_notif_ticket_cree:    email_notif_ticket_cree    ?? null,
    email_notif_ticket_termine: email_notif_ticket_termine ?? null,
    email_notif_sav_ouvert:     email_notif_sav_ouvert     ?? null,
    email_notif_relance:        email_notif_relance        ?? null,
  }

  await updateBoutiqueSettings(c.env.DB, id, input)
  return c.json({ success: true, message: 'Paramètres mis à jour.' })
})

// ─── GET /api/boutiques/:id/stats ─────────────────────────────────────────────

/**
 * GET /api/boutiques/:id/stats
 * Retourne les KPIs globaux d'une boutique via `getStatsBoutique()`.
 *
 * Indicateurs retournés :
 *   - `nb_clients`          : clients actifs
 *   - `tickets_en_cours`    : tickets actifs hors statuts `livre` et `annule`
 *   - `ca_mois`             : CA TTC encaissé sur le mois courant (factures `payee`)
 *   - `produits_stock_bas`  : produits dont `stock_actuel <= stock_minimum`
 *
 * @param id  Identifiant numérique de la boutique
 * @returns 200 `{ success: true, data: StatsBoutique }`
 * @returns 403 si non-admin tente d'accéder aux stats d'une autre boutique
 */
boutiques.get('/:id/stats', async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  if (user.role !== 'admin' && user.boutique_id !== id)
    return c.json({ success: false, error: 'Accès interdit.' }, 403)

  const data = await getStatsBoutique(c.env.DB, id)
  return c.json({ success: true, data })
})

// ─── GET /api/boutiques/:id/nf525/verify ──────────────────────────────────────

/**
 * GET /api/boutiques/:id/nf525/verify
 * Vérifie l'intégrité complète de la chaîne NF525 d'une boutique.
 * Réservé à `admin` et `manager`.
 *
 * Recalcule chaque hash SHA-256 et vérifie le chaînage séquentiel.
 * Toute divergence révèle une modification frauduleuse ou une corruption.
 *
 * Délègue à `verifyChain()` du module `nf525.ts`.
 *
 * @param id  Identifiant numérique de la boutique
 * @returns 200 `{ success: true, verification: { valide, nb_entrees, premiere_erreur? } }`
 * @returns 403 si non-admin tente d'accéder à une autre boutique
 */
boutiques.get('/:id/nf525/verify', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  if (user.role !== 'admin' && user.boutique_id !== id)
    return c.json({ success: false, error: 'Accès interdit.' }, 403)

  const result = await verifyChain(c.env.DB, id)
  return c.json({ success: true, verification: result })
})

// ─── POST /api/boutiques/:id/nf525/cloture ───────────────────────────────────

/**
 * POST /api/boutiques/:id/nf525/cloture
 * Effectue la clôture journalière NF525 pour une boutique.
 * Réservé à `admin` et `manager`.
 *
 * Body JSON (optionnel) :
 * ```json
 * { "date": "2026-06-29" }  // défaut : aujourd'hui (ISO split T)
 * ```
 *
 * Délègue à `clotureJournaliere()` du module `nf525.ts`.
 * Une clôture déjà effectuée retourne `{ success: false }` sans exception.
 *
 * @param id  Identifiant numérique de la boutique
 * @returns 200 `{ success: boolean, message: string }`
 * @returns 403 si non-admin tente d'accéder à une autre boutique
 */
boutiques.post('/:id/nf525/cloture', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  if (user.role !== 'admin' && user.boutique_id !== id)
    return c.json({ success: false, error: 'Accès interdit.' }, 403)

  const { date } = await c.req.json().catch(() => ({ date: new Date().toISOString().split('T')[0] }))
  const result = await clotureJournaliere(c.env.DB, id, date, user.sub)
  return c.json({ success: result.success, message: result.message })
})

export default boutiques
