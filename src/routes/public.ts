/**
 * @module routes/public
 * @description Routes publiques (sans authentification JWT) — Sprint 2.7 MOD-14 Vitrine + MOD-01 Tracking token.
 *
 * Controller pur — 0 SQL. Tout le SQL est dans `publicService.ts` et `devisService.ts`.
 *
 * Endpoints :
 *   GET  /api/public/ticket/:token           → Suivi ticket client
 *   GET  /api/public/boutique/:slug          → Info vitrine boutique
 *   GET  /api/public/catalogue/:slug         → Services publics d'une boutique
 *   GET  /api/public/devis/:token            → Consultation devis par le client
 *   POST /api/public/devis/:token/repondre   → Accepter / refuser un devis
 *   GET  /api/public/entreprise-search       → Recherche SIRENE (autocomplete inscription)
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getDevisByToken, updateStatutDevis, saveSignatureDevis, type StatutDevis } from '../services/devisService'
import {
  getTicketPublicByToken,
  getBoutiquePublicBySlug,
  getStatsBoutiquePublic,
  getBoutiqueIdBySlug,
  getCategoriesPubliques,
  getServicesPublics,
  getDisponibilites,
  createRdvPublic,
} from '../services/publicService'
import { searchEntreprises } from '../services/sirenService'
import type { Database } from '../ports/database'

type Bindings = { DB: D1Database; KV: import("../lib/d1kv").D1KVNamespace; JWT_SECRET: string }
// 'db' : port Database injecté par le middleware global (src/index.tsx) — utilisé
// par les fonctions de publicService.ts, entièrement migrées (Ports & Adapters, 2026-07-12).
type Variables = { db: Database }

const pub = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// CORS large pour les pages publiques (clients sans compte)
pub.use('/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'] }))

// ─── Libellés statuts ticket ──────────────────────────────────────────────────

/** Correspondance machine à états → libellés lisibles par le client. */
const STATUT_CLIENT: Record<string, { label: string; description: string; emoji: string }> = {
  recu:           { label: 'Reçu',              description: 'Votre appareil a été réceptionné.',                         emoji: '📥' },
  en_diagnostic:  { label: 'En diagnostic',     description: 'Le technicien examine votre appareil.',                     emoji: '🔍' },
  attente_accord: { label: 'Accord en attente', description: 'Nous attendons votre accord pour procéder à la réparation.', emoji: '✋' },
  a_commander:    { label: 'Pièces à commander',description: 'Les pièces nécessaires vont être commandées.',               emoji: '🛒' },
  commande:       { label: 'Pièces commandées', description: 'Les pièces sont en cours de livraison.',                    emoji: '📦' },
  pieces_recues:  { label: 'Pièces reçues',     description: 'Les pièces sont arrivées, la réparation va débuter.',       emoji: '✅' },
  en_reparation:  { label: 'En réparation',     description: 'Votre appareil est en cours de réparation.',                emoji: '🔧' },
  termine:        { label: 'Réparé',            description: 'La réparation est terminée. Vous pouvez venir récupérer votre appareil.', emoji: '🎉' },
  livre:          { label: 'Rendu',             description: 'L\'appareil vous a été restitué.',                          emoji: '🏠' },
  annule:         { label: 'Annulé',            description: 'La réparation a été annulée.',                               emoji: '❌' },
}

/** Correspondance statuts devis → libellés lisibles par le client. */
const STATUT_DEVIS_CLIENT: Record<string, { label: string; description: string; emoji: string; peutRepondre: boolean }> = {
  draft:   { label: 'Brouillon',          description: 'Ce devis n\'est pas encore finalisé.',                          emoji: '📝', peutRepondre: false },
  envoye:  { label: 'En attente',         description: 'Votre devis est prêt. Vous pouvez l\'accepter ou le refuser.',  emoji: '⏳', peutRepondre: true  },
  accepte: { label: 'Accepté',            description: 'Vous avez accepté ce devis. Merci de votre confiance !',        emoji: '✅', peutRepondre: false },
  refuse:  { label: 'Refusé',             description: 'Vous avez refusé ce devis.',                                    emoji: '❌', peutRepondre: false },
  expire:  { label: 'Expiré',             description: 'Ce devis a dépassé sa date de validité.',                       emoji: '⌛', peutRepondre: false },
  annule:  { label: 'Annulé',             description: 'Ce devis a été annulé par le technicien.',                      emoji: '🚫', peutRepondre: false },
}

// ══════════════════════════════════════════════════════════════════════════════
// SUIVI TICKET PAR TOKEN
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/public/ticket/:token
 * Retourne les infos publiques d'un ticket (pas les notes internes).
 *
 * @param token - Valeur du `tracking_token` (≥ 16 caractères)
 * @returns     Infos ticket + statut enrichi + coordonnées boutique
 */
pub.get('/ticket/:token', async (c) => {
  try {
    const token = c.req.param('token')
    if (!token || token.length < 16)
      return c.json({ success: false, error: 'Token invalide.' }, 400)

    const ticket = await getTicketPublicByToken(c.get('db'), token)
    if (!ticket)
      return c.json({ success: false, error: 'Ticket introuvable ou lien invalide.' }, 404)

    const statutInfo = STATUT_CLIENT[ticket.statut] ?? {
      label: ticket.statut, description: '', emoji: '📋'
    }

    return c.json({
      success: true,
      data: {
        numero:         ticket.numero,
        statut:         ticket.statut,
        statut_label:   statutInfo.label,
        statut_desc:    statutInfo.description,
        statut_emoji:   statutInfo.emoji,
        appareil:       `${ticket.appareil_marque} ${ticket.appareil_modele}`,
        panne:          ticket.description_panne,
        diagnostic:     ticket.diagnostic,
        prix_estime:    ticket.prix_estime,
        prix_final:     ticket.prix_final,
        date_reception: ticket.date_reception,
        date_promesse:  ticket.date_promesse,
        date_livraison: ticket.date_livraison,
        client_prenom:  ticket.client_prenom,
        boutique_slug: ticket.boutique_slug,
        boutique: {
          nom:       ticket.boutique_nom,
          telephone: ticket.boutique_telephone,
          email:     ticket.boutique_email,
          adresse:   ticket.boutique_adresse,
          ville:     ticket.boutique_ville,
          slug:      ticket.boutique_slug,
        }
      }
    })
  } catch (e: any) {
    return c.json({ success: false, error: 'Erreur serveur.' }, 500)
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// VITRINE BOUTIQUE & CATALOGUE
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/public/boutique/:slug
 * Infos publiques d'une boutique (nom, adresse, services, horaires…).
 *
 * @param slug - Slug URL de la boutique
 * @returns    Infos boutique + stats réparations
 */
pub.get('/boutique/:slug', async (c) => {
  try {
    const slug     = c.req.param('slug').toLowerCase()
    const boutique = await getBoutiquePublicBySlug(c.get('db'), slug)
    if (!boutique)
      return c.json({ success: false, error: 'Boutique introuvable.' }, 404)

    const stats = await getStatsBoutiquePublic(c.get('db'), boutique.id)

    return c.json({
      success: true,
      data: {
        ...boutique,
        horaires: boutique.horaires ? JSON.parse(boutique.horaires) : null,
        stats: { reparations_effectuees: stats.tickets_done },
      }
    })
  } catch (e: any) {
    return c.json({ success: false, error: 'Erreur serveur.' }, 500)
  }
})

/**
 * GET /api/public/catalogue/:slug
 * Services publics d'une boutique avec catégories et tarifs.
 *
 * @param slug - Slug URL de la boutique
 * @returns    Catalogue groupé par catégorie avec prix TTC calculé
 */
pub.get('/catalogue/:slug', async (c) => {
  try {
    const slug     = c.req.param('slug').toLowerCase()
    const boutique = await getBoutiqueIdBySlug(c.get('db'), slug)
    if (!boutique)
      return c.json({ success: false, error: 'Boutique introuvable.' }, 404)

    const [categories, services] = await Promise.all([
      getCategoriesPubliques(c.get('db'), boutique.id),
      getServicesPublics(c.get('db'), boutique.id),
    ])

    // Grouper services par catégorie + calculer prix TTC
    const catMap: Record<number, any> = {}
    for (const cat of categories) {
      catMap[cat.id] = { ...cat, services: [] }
    }
    for (const svc of services) {
      if (catMap[svc.categorie_id]) {
        catMap[svc.categorie_id].services.push({
          id:            svc.id,
          nom:           svc.nom,
          description:   svc.description,
          prix_ttc:      Math.round(svc.prix_ht * (1 + svc.tva_taux / 100) * 100) / 100,
          duree_minutes: svc.duree_minutes,
        })
      }
    }

    return c.json({
      success:  true,
      boutique: { id: boutique.id, nom: boutique.nom, slug },
      catalogue: Object.values(catMap).filter((cat: any) => cat.services.length > 0),
    })
  } catch (e: any) {
    console.error('[catalogue]', e?.message ?? e)
    return c.json({ success: false, error: 'Erreur serveur.' }, 500)
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// DEVIS PUBLIC (accès client sans authentification)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/public/devis/:token
 * Consultation d'un devis par le client via son token public.
 *
 * @param token - Token public du devis (≥ 16 caractères)
 * @returns     Lignes, totaux, statut enrichi, infos boutique (sans données sensibles)
 */
pub.get('/devis/:token', async (c) => {
  try {
    const token = c.req.param('token')
    if (!token || token.length < 16)
      return c.json({ success: false, error: 'Token invalide.' }, 400)

    const devis = await getDevisByToken(c.env.DB, token)
    if (!devis)
      return c.json({ success: false, error: 'Devis introuvable ou lien invalide.' }, 404)

    const statutInfo = STATUT_DEVIS_CLIENT[devis.statut] ?? {
      label: devis.statut, description: '', emoji: '📋', peutRepondre: false
    }

    const estExpire = devis.statut === 'envoye' && devis.date_validite
      ? new Date(devis.date_validite) < new Date()
      : false

    return c.json({
      success: true,
      data: {
        numero:         devis.numero,
        statut:         devis.statut,
        statut_label:   estExpire ? 'Expiré' : statutInfo.label,
        statut_desc:    estExpire ? 'Ce devis a dépassé sa date de validité.' : statutInfo.description,
        statut_emoji:   estExpire ? '⌛' : statutInfo.emoji,
        peut_repondre:  statutInfo.peutRepondre && !estExpire,
        est_expire:     estExpire,
        total_ht:       devis.total_ht,
        total_tva:      devis.total_tva,
        total_ttc:      devis.total_ttc,
        date_validite:  devis.date_validite,
        envoye_le:      devis.envoye_le,
        repondu_le:     devis.repondu_le,
        notes:          devis.notes,
        conditions:     devis.conditions,
        client_prenom:  devis.client_prenom,
        boutique: {
          nom:       devis.boutique_nom,
          telephone: devis.boutique_telephone,
          email:     devis.boutique_email,
          adresse:   devis.boutique_adresse,
          ville:     devis.boutique_ville,
          logo:      devis.boutique_logo,
        },
        lignes: (devis.lignes ?? []).map((l: any) => ({
          ordre:            l.ordre,
          description:      l.description,
          quantite:         l.quantite,
          prix_unitaire_ht: l.prix_unitaire_ht,
          tva_taux:         l.tva_taux,
          total_ht:         l.total_ht,
          total_ttc:        l.total_ttc,
        })),
      }
    })
  } catch (e: any) {
    console.error('[public/devis]', e?.message ?? e)
    return c.json({ success: false, error: 'Erreur serveur.' }, 500)
  }
})

/**
 * POST /api/public/devis/:token/repondre
 * Permet au client d'accepter ou de refuser un devis (sans authentification).
 *
 * @param token  - Token public du devis
 * @body         `{ action: 'accepte' | 'refuse', signature?: string }`
 * @returns      `{ success, statut_avant, statut_apres, message }`
 */
pub.post('/devis/:token/repondre', async (c) => {
  try {
    const token = c.req.param('token')
    if (!token || token.length < 16)
      return c.json({ success: false, error: 'Token invalide.' }, 400)

    const body = await c.req.json().catch(() => ({}))
    const { action, signature } = body

    if (!action || !['accepte', 'refuse'].includes(action))
      return c.json({ success: false, error: 'action doit être "accepte" ou "refuse".' }, 400)

    const devis = await getDevisByToken(c.env.DB, token)
    if (!devis)
      return c.json({ success: false, error: 'Devis introuvable ou lien invalide.' }, 404)

    if (devis.statut !== 'envoye')
      return c.json({ success: false, error: `Ce devis ne peut plus être modifié (statut actuel : ${devis.statut}).` }, 409)

    if (devis.date_validite && new Date(devis.date_validite) < new Date())
      return c.json({ success: false, error: 'Ce devis a expiré et ne peut plus être accepté.' }, 410)

    // Enregistrer la signature si fournie
    if (signature && typeof signature === 'string' && signature.length > 0) {
      await saveSignatureDevis(c.env.DB, devis.id, signature)
    }

    const { statut_avant, statut_apres } = await updateStatutDevis(
      c.env.DB,
      devis.id,
      0, // userId = 0 pour action publique
      action as StatutDevis,
      true, // fromPublic
    )

    const messages: Record<string, string> = {
      accepte: 'Merci ! Votre devis a été accepté. L\'équipe vous contactera prochainement.',
      refuse:  'Devis refusé. L\'équipe a été notifiée.',
    }

    return c.json({ success: true, statut_avant, statut_apres, message: messages[action] ?? 'Réponse enregistrée.' })

  } catch (e: any) {
    console.error('[public/devis/repondre]', e?.message ?? e)
    return c.json({ success: false, error: e.message ?? 'Erreur serveur.' }, 500)
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// DISPONIBILITÉS & RDV PUBLIC (MOD-14)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/public/boutique/:slug/disponibilites?date=YYYY-MM-DD
 * Créneaux disponibles pour une date donnée.
 *
 * @param slug - Slug de la boutique
 * @query date - Date au format YYYY-MM-DD (défaut : demain)
 * @returns    Liste de créneaux disponibles
 */
pub.get('/boutique/:slug/disponibilites', async (c) => {
  try {
    const slug     = c.req.param('slug').toLowerCase()
    const boutique = await getBoutiqueIdBySlug(c.get('db'), slug)
    if (!boutique)
      return c.json({ success: false, error: 'Boutique introuvable.' }, 404)

    // Date par défaut = demain
    let date = c.req.query('date') ?? ''
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      date = tomorrow.toISOString().slice(0, 10)
    }

    const creneaux = await getDisponibilites(c.get('db'), boutique.id, date)

    return c.json({
      success:  true,
      boutique: { id: boutique.id, nom: boutique.nom, slug },
      date,
      creneaux,
    })
  } catch (e: any) {
    console.error('[disponibilites]', e?.message ?? e)
    return c.json({ success: false, error: 'Erreur serveur.' }, 500)
  }
})

/**
 * POST /api/public/rdv
 * Crée un rendez-vous public (sans authentification).
 *
 * @body  `{ slug, debut, duree_minutes?, nom_client, telephone_client?, email_client?, service_nom?, notes?, type_rdv? }`
 * @returns `{ success, data: { id, debut, fin, titre } }`
 */
pub.post('/rdv', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}))

    const { slug } = body
    if (!slug)
      return c.json({ success: false, error: 'slug de la boutique requis.' }, 400)

    const boutique = await getBoutiqueIdBySlug(c.get('db'), slug.toLowerCase())
    if (!boutique)
      return c.json({ success: false, error: 'Boutique introuvable.' }, 404)

    const rdv = await createRdvPublic(c.get('db'), boutique.id, body)

    return c.json({
      success: true,
      message: 'Votre demande de rendez-vous a été enregistrée. L\u2019équipe vous confirmera rapidement.',
      data: {
        id:    rdv.id,
        debut: rdv.debut,
        fin:   rdv.fin,
        titre: rdv.titre,
      }
    }, 201)
  } catch (e: any) {
    const status = e.message?.includes('requis') || e.message?.includes('futur') ? 400 : 500
    console.error('[public/rdv]', e?.message ?? e)
    return c.json({ success: false, error: e.message ?? 'Erreur serveur.' }, status)
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// RECHERCHE ENTREPRISE (SIRENE)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/public/entreprise-search
 * Recherche d'entreprises françaises par nom, SIREN ou SIRET — autocomplete
 * "Rechercher mon entreprise" (register.html étape 2, onboarding post-Google).
 * Délègue entièrement à sirenService (aucune logique ici, controller pur).
 *
 * @query q  Terme de recherche, minimum 3 caractères
 * @returns  200 { success: true, data: EntrepriseResult[] } — tableau vide si rien trouvé
 * @returns  400 si `q` absent ou trop court
 */
pub.get('/entreprise-search', async (c) => {
  const q = c.req.query('q') ?? ''
  if (q.trim().length < 3)
    return c.json({ success: false, error: 'Recherche trop courte (3 caractères minimum).' }, 400)

  const results = await searchEntreprises(q)
  return c.json({ success: true, data: results })
})

// ─── Endpoint interne désactivé ───────────────────────────────────────────────

pub.get('/token-for-ticket/:id', async (c) => {
  return c.json({ success: false, error: 'Utiliser le endpoint /api/tickets/:id' }, 405)
})

export default pub
