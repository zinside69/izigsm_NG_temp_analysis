/**
 * @module routes/boutiques
 * @description Controller Boutiques & Paramètres (P1 MVC).
 *
 * Note architecturale :
 *   Ce controller contient exceptionnellement du SQL direct — les opérations
 *   sur les boutiques sont des opérations d'administration simple (CRUD basique)
 *   qui ne justifient pas un service dédié à ce stade.
 *   Les endpoints NF525 (`/nf525/verify`, `/nf525/cloture`) délèguent à `nf525.ts`.
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

type Bindings = { DB: D1Database; KV: KVNamespace; JWT_SECRET: string }
type Variables = { user: any }

const boutiques = new Hono<{ Bindings: Bindings; Variables: Variables }>()
boutiques.use('*', authMiddleware)

// ─── GET /api/boutiques ───────────────────────────────────────────────────────

/**
 * GET /api/boutiques
 * Liste les boutiques actives selon le rôle de l'utilisateur.
 *
 * Isolation multi-tenant :
 *   - `admin` → retourne toutes les boutiques actives (ORDER BY nom)
 *   - Autres  → retourne uniquement la boutique de l'utilisateur (`user.boutique_id`)
 *
 * @returns 200 `{ success: true, data: Boutique[] }`
 */
boutiques.get('/', async (c) => {
  const user = c.get('user')

  // Admin voit toutes les boutiques ; les autres rôles voient uniquement la leur
  const rows = user.role === 'admin'
    ? await c.env.DB.prepare('SELECT * FROM boutiques WHERE actif = 1 ORDER BY nom').all()
    : await c.env.DB.prepare('SELECT * FROM boutiques WHERE id = ? AND actif = 1').bind(user.boutique_id).all()

  return c.json({ success: true, data: rows.results })
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

  const boutique = await c.env.DB.prepare('SELECT * FROM boutiques WHERE id = ? AND actif = 1').bind(id).first()
  if (!boutique) return c.json({ success: false, error: 'Boutique introuvable.' }, 404)

  const settings = await c.env.DB.prepare('SELECT * FROM boutique_settings WHERE boutique_id = ?').bind(id).first()

  return c.json({ success: true, data: { ...boutique, settings } })
})

// ─── POST /api/boutiques ──────────────────────────────────────────────────────

/**
 * POST /api/boutiques
 * Crée une nouvelle boutique. Réservé aux administrateurs.
 *
 * Auto-génère un slug depuis le nom (normalisation des accents et caractères spéciaux).
 * Crée automatiquement une entrée `boutique_settings` avec les valeurs par défaut.
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

  const result = await c.env.DB.prepare(`
    INSERT INTO boutiques (nom, slug, siret, tva_numero, adresse, code_postal, ville, telephone, email)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(nom, slug, siret ?? null, tva_numero ?? null, adresse ?? null, code_postal ?? null, ville ?? null, telephone ?? null, email ?? null)
    .first<{ id: number }>()

  // Initialiser les settings avec les valeurs par défaut (colonnes DEFAULT en SQL)
  await c.env.DB.prepare('INSERT INTO boutique_settings (boutique_id) VALUES (?)').bind(result?.id).run()
  return c.json({ success: true, id: result?.id, message: 'Boutique créée.' }, 201)
})

// ─── PUT /api/boutiques/:id ───────────────────────────────────────────────────

/**
 * PUT /api/boutiques/:id
 * Met à jour les informations d'une boutique (identité, contact, réseaux sociaux).
 * Réservé à `admin` et `manager`. Non-admin ne peut modifier que sa boutique.
 *
 * Utilise COALESCE pour ne mettre à jour que les champs fournis (PATCH-like).
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

  const { nom, siret, tva_numero, adresse, code_postal, ville, telephone, email,
          site_web, slug, description, facebook_url, instagram_url, google_maps_url } = await c.req.json()

  await c.env.DB.prepare(`
    UPDATE boutiques SET
      nom=COALESCE(?,nom), siret=COALESCE(?,siret), tva_numero=COALESCE(?,tva_numero),
      adresse=COALESCE(?,adresse), code_postal=COALESCE(?,code_postal), ville=COALESCE(?,ville),
      telephone=COALESCE(?,telephone), email=COALESCE(?,email), site_web=COALESCE(?,site_web),
      slug=COALESCE(?,slug), description=COALESCE(?,description),
      facebook_url=COALESCE(?,facebook_url), instagram_url=COALESCE(?,instagram_url),
      google_maps_url=COALESCE(?,google_maps_url),
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(nom ?? null, siret ?? null, tva_numero ?? null,
          adresse ?? null, code_postal ?? null, ville ?? null,
          telephone ?? null, email ?? null, site_web ?? null,
          slug ?? null, description ?? null,
          facebook_url ?? null, instagram_url ?? null, google_maps_url ?? null, id).run()

  return c.json({ success: true, message: 'Boutique mise à jour.' })
})

// ─── PUT /api/boutiques/:id/settings ─────────────────────────────────────────

/**
 * PUT /api/boutiques/:id/settings
 * Met à jour les paramètres opérationnels d'une boutique.
 * Réservé à `admin` et `manager`. Non-admin ne peut modifier que sa boutique.
 *
 * Paramètres gérés (tous optionnels, COALESCE sur champs non fournis) :
 *   - TVA/paiements : `tva_taux_defaut`, `paiement_especes/cb/cheque/virement`
 *   - Numérotation  : `prefix_ticket/facture/devis/avoir/rachat`, `format_numero`, `padding_numero`
 *   - Métier        : `garantie_defaut_jours`, `delai_relance_jours`, `mention_facture`, `pied_de_page`
 *   - Email         : `email_provider`, `email_api_key`, `email_from`, notifications activées/désactivées
 *
 * Validations :
 *   - `format_numero` : 'annee' ou 'simple' uniquement
 *   - `padding_numero` : entre 3 et 8
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
    // Numérotation configurable (Sprint 2.9)
    prefix_ticket, prefix_facture, prefix_devis, prefix_avoir, prefix_rachat,
    format_numero, padding_numero,
    // Paramètres métier
    garantie_defaut_jours, delai_relance_jours, mention_facture, pied_de_page,
    // Email notifications (Sprint 2.11)
    email_provider, email_api_key, email_from,
    email_notif_ticket_cree, email_notif_ticket_termine,
    email_notif_sav_ouvert,  email_notif_relance,
  } = await c.req.json()

  // Validations numérotation
  const FORMATS_VALIDES = ['annee', 'simple']
  if (format_numero && !FORMATS_VALIDES.includes(format_numero))
    return c.json({ success: false, error: `format_numero invalide. Valeurs : ${FORMATS_VALIDES.join(', ')}.` }, 422)
  if (padding_numero && (padding_numero < 3 || padding_numero > 8))
    return c.json({ success: false, error: 'padding_numero doit être entre 3 et 8.' }, 422)

  await c.env.DB.prepare(`
    UPDATE boutique_settings SET
      tva_taux_defaut=?, horaires=?, notif_email_actif=?, notif_sms_actif=?,
      paiement_especes=?, paiement_cb=?, paiement_cheque=?, paiement_virement=?,
      prefix_ticket=COALESCE(?,prefix_ticket), prefix_facture=COALESCE(?,prefix_facture),
      prefix_devis=COALESCE(?,prefix_devis),   prefix_avoir=COALESCE(?,prefix_avoir),
      prefix_rachat=COALESCE(?,prefix_rachat),
      format_numero=COALESCE(?,format_numero),  padding_numero=COALESCE(?,padding_numero),
      garantie_defaut_jours=COALESCE(?,garantie_defaut_jours),
      delai_relance_jours=COALESCE(?,delai_relance_jours),
      mention_facture=COALESCE(?,mention_facture),
      pied_de_page=COALESCE(?,pied_de_page),
      email_provider=COALESCE(?,email_provider),
      email_api_key=COALESCE(?,email_api_key),
      email_from=COALESCE(?,email_from),
      email_notif_ticket_cree=COALESCE(?,email_notif_ticket_cree),
      email_notif_ticket_termine=COALESCE(?,email_notif_ticket_termine),
      email_notif_sav_ouvert=COALESCE(?,email_notif_sav_ouvert),
      email_notif_relance=COALESCE(?,email_notif_relance),
      updated_at=CURRENT_TIMESTAMP
    WHERE boutique_id=?
  `).bind(
    tva_taux_defaut ?? 20, horaires ? JSON.stringify(horaires) : null,
    notif_email_actif ? 1 : 0, notif_sms_actif ? 1 : 0,
    paiement_especes ? 1 : 0, paiement_cb ? 1 : 0, paiement_cheque ? 1 : 0, paiement_virement ? 1 : 0,
    prefix_ticket  ?? null, prefix_facture ?? null,
    prefix_devis   ?? null, prefix_avoir   ?? null, prefix_rachat  ?? null,
    format_numero  ?? null, padding_numero ?? null,
    garantie_defaut_jours ?? null, delai_relance_jours ?? null,
    mention_facture ?? null, pied_de_page ?? null,
    email_provider  ?? null, email_api_key ?? null, email_from ?? null,
    email_notif_ticket_cree    != null ? (email_notif_ticket_cree    ? 1 : 0) : null,
    email_notif_ticket_termine != null ? (email_notif_ticket_termine ? 1 : 0) : null,
    email_notif_sav_ouvert     != null ? (email_notif_sav_ouvert     ? 1 : 0) : null,
    email_notif_relance        != null ? (email_notif_relance        ? 1 : 0) : null,
    id
  ).run()

  return c.json({ success: true, message: 'Paramètres mis à jour.' })
})

// ─── GET /api/boutiques/:id/stats ─────────────────────────────────────────────

/**
 * GET /api/boutiques/:id/stats
 * Retourne les KPIs globaux d'une boutique en 4 requêtes parallèles (`Promise.all`).
 *
 * Indicateurs retournés :
 *   - `nb_clients`          : clients actifs
 *   - `tickets_en_cours`    : tickets actifs hors statuts `livre` et `annule`
 *   - `ca_mois`             : CA TTC encaissé sur le mois courant (factures `payee`)
 *   - `produits_stock_bas`  : produits dont `stock_actuel <= stock_minimum`
 *
 * @param id  Identifiant numérique de la boutique
 * @returns 200 `{ success: true, data: { nb_clients, tickets_en_cours, ca_mois, produits_stock_bas } }`
 * @returns 403 si non-admin tente d'accéder aux stats d'une autre boutique
 */
boutiques.get('/:id/stats', async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)
  if (user.role !== 'admin' && user.boutique_id !== id)
    return c.json({ success: false, error: 'Accès interdit.' }, 403)

  // 4 requêtes en parallèle via Promise.all pour optimiser la latence
  const [clients, tickets, ca_mois, stock_bas] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM clients WHERE boutique_id = ? AND actif = 1').bind(id).first<{ cnt: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM tickets WHERE boutique_id = ? AND statut NOT IN ('livre','annule') AND actif = 1").bind(id).first<{ cnt: number }>(),
    c.env.DB.prepare("SELECT COALESCE(SUM(total_ttc),0) as ca FROM factures WHERE boutique_id = ? AND statut='payee' AND strftime('%Y-%m',date_emission) = strftime('%Y-%m','now')").bind(id).first<{ ca: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM produits WHERE boutique_id = ? AND stock_actuel <= stock_minimum AND actif = 1').bind(id).first<{ cnt: number }>(),
  ])

  return c.json({
    success: true,
    data: {
      nb_clients:         clients?.cnt ?? 0,
      tickets_en_cours:   tickets?.cnt ?? 0,
      ca_mois:            ca_mois?.ca  ?? 0,
      produits_stock_bas: stock_bas?.cnt ?? 0,
    }
  })
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
