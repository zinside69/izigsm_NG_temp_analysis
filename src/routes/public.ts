/**
 * routes/public.ts — Routes publiques (sans authentification JWT)
 * Sprint 2.7 — MOD-14 Vitrine + MOD-01 Tracking token
 *
 * Endpoints publics (0 auth) :
 *   GET  /api/public/ticket/:token       → Suivi ticket client
 *   GET  /api/public/boutique/:slug      → Info vitrine boutique
 *   GET  /api/public/catalogue/:slug     → Services publics d'une boutique
 *
 * Pages statiques associées :
 *   /suivi.html      → page suivi ticket (frontend)
 *   /pro/:slug       → vitrine boutique (servie par suivi.html mode vitrine)
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getDevisByToken, updateStatutDevis, type StatutDevis } from '../services/devisService'

type Bindings = { DB: D1Database; KV: KVNamespace; JWT_SECRET: string }

const pub = new Hono<{ Bindings: Bindings }>()

// CORS large pour les pages publiques (clients sans compte)
pub.use('/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'] }))

// ─── Suivi ticket par token ───────────────────────────────────────────────────

/**
 * GET /api/public/ticket/:token
 * Retourne les infos publiques d'un ticket (pas les notes internes).
 * Génère le token si absent (idempotent).
 */
pub.get('/ticket/:token', async (c) => {
  try {
    const token = c.req.param('token')
    if (!token || token.length < 16)
      return c.json({ success: false, error: 'Token invalide.' }, 400)

    const ticket = await c.env.DB.prepare(`
      SELECT
        t.id,
        t.numero,
        t.tracking_token,
        t.statut,
        t.appareil_marque,
        t.appareil_modele,
        t.description_panne,
        t.diagnostic,
        t.prix_estime,
        t.prix_final,
        t.date_reception,
        t.date_promesse,
        t.date_livraison,
        c.prenom   AS client_prenom,
        c.nom      AS client_nom,
        b.nom      AS boutique_nom,
        b.telephone AS boutique_telephone,
        b.email    AS boutique_email,
        b.adresse  AS boutique_adresse,
        b.ville    AS boutique_ville
      FROM   tickets t
      JOIN   clients  c ON c.id = t.client_id
      JOIN   boutiques b ON b.id = t.boutique_id
      WHERE  t.tracking_token = ? AND t.actif = 1
    `).bind(token).first<any>()

    if (!ticket)
      return c.json({ success: false, error: 'Ticket introuvable ou lien invalide.' }, 404)

    // Libellés statuts lisibles par le client
    // Clés en minuscules — correspondent aux valeurs de la machine à états ticketService
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
        boutique: {
          nom:       ticket.boutique_nom,
          telephone: ticket.boutique_telephone,
          email:     ticket.boutique_email,
          adresse:   ticket.boutique_adresse,
          ville:     ticket.boutique_ville,
        }
      }
    })
  } catch (e: any) {
    return c.json({ success: false, error: 'Erreur serveur.' }, 500)
  }
})

// ─── Vitrine boutique ─────────────────────────────────────────────────────────

/**
 * GET /api/public/boutique/:slug
 * Infos publiques d'une boutique (nom, adresse, services, horaires…).
 */
pub.get('/boutique/:slug', async (c) => {
  try {
    const slug = c.req.param('slug').toLowerCase()

    const boutique = await c.env.DB.prepare(`
      SELECT id, nom, siret, adresse, code_postal, ville, telephone, email,
             site_web, logo_url, description, horaires, slug,
             facebook_url, instagram_url, google_maps_url
      FROM boutiques
      WHERE slug = ? AND actif = 1
    `).bind(slug).first<any>()

    if (!boutique)
      return c.json({ success: false, error: 'Boutique introuvable.' }, 404)

    // Stats publiques
    const stats = await c.env.DB.prepare(`
      SELECT
        COUNT(*) AS total_tickets,
        SUM(CASE WHEN statut = 'DELIVERED' THEN 1 ELSE 0 END) AS tickets_done
      FROM tickets WHERE boutique_id = ? AND actif = 1
    `).bind(boutique.id).first<any>()

    return c.json({
      success: true,
      data: {
        ...boutique,
        horaires: boutique.horaires ? JSON.parse(boutique.horaires) : null,
        stats: {
          reparations_effectuees: stats?.tickets_done ?? 0,
        }
      }
    })
  } catch (e: any) {
    return c.json({ success: false, error: 'Erreur serveur.' }, 500)
  }
})

/**
 * GET /api/public/catalogue/:slug
 * Services publics d'une boutique avec catégories et tarifs.
 */
pub.get('/catalogue/:slug', async (c) => {
  try {
    const slug = c.req.param('slug').toLowerCase()

    const boutique = await c.env.DB.prepare(
      'SELECT id, nom FROM boutiques WHERE slug = ? AND actif = 1'
    ).bind(slug).first<{ id: number; nom: string }>()

    if (!boutique)
      return c.json({ success: false, error: 'Boutique introuvable.' }, 404)

    // Catégories + services actifs
    const categories = await c.env.DB.prepare(`
      SELECT id, nom, description, couleur, ordre
      FROM categories_services
      WHERE boutique_id = ? AND actif = 1 AND parent_id IS NULL
      ORDER BY ordre ASC, nom ASC
    `).bind(boutique.id).all<any>()

    const services = await c.env.DB.prepare(`
      SELECT s.id, s.nom, s.description, s.prix_ht, s.tva_taux,
             s.duree_minutes, s.categorie_id
      FROM   services s
      WHERE  s.boutique_id = ? AND s.actif = 1
      ORDER  BY s.categorie_id ASC, s.nom ASC
    `).bind(boutique.id).all<any>()

    // Grouper services par catégorie
    const catMap: Record<number, any> = {}
    for (const cat of categories.results ?? []) {
      catMap[cat.id] = { ...cat, services: [] }
    }
    for (const svc of services.results ?? []) {
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
      success: true,
      boutique: { id: boutique.id, nom: boutique.nom, slug },
      catalogue: Object.values(catMap).filter((cat: any) => cat.services.length > 0),
    })
  } catch (e: any) {
    console.error('[catalogue]', e?.message ?? e)
    return c.json({ success: false, error: 'Erreur serveur.' }, 500)
  }
})

// ─── Devis public (accès client sans authentification) ───────────────────────

/**
 * GET /api/public/devis/:token
 * Consultation d'un devis par le client via son token public.
 * Retourne les lignes, totaux et infos boutique — sans données sensibles.
 * Statuts lisibles par le client.
 */
pub.get('/devis/:token', async (c) => {
  try {
    const token = c.req.param('token')
    if (!token || token.length < 16)
      return c.json({ success: false, error: 'Token invalide.' }, 400)

    const devis = await getDevisByToken(c.env.DB, token)
    if (!devis)
      return c.json({ success: false, error: 'Devis introuvable ou lien invalide.' }, 404)

    // Libellés statuts lisibles par le client
    const STATUT_DEVIS_CLIENT: Record<string, { label: string; description: string; emoji: string; peutRepondre: boolean }> = {
      draft:   { label: 'Brouillon',          description: 'Ce devis n\'est pas encore finalisé.',                          emoji: '📝', peutRepondre: false },
      envoye:  { label: 'En attente',         description: 'Votre devis est prêt. Vous pouvez l\'accepter ou le refuser.',  emoji: '⏳', peutRepondre: true  },
      accepte: { label: 'Accepté',            description: 'Vous avez accepté ce devis. Merci de votre confiance !',        emoji: '✅', peutRepondre: false },
      refuse:  { label: 'Refusé',             description: 'Vous avez refusé ce devis.',                                    emoji: '❌', peutRepondre: false },
      expire:  { label: 'Expiré',             description: 'Ce devis a dépassé sa date de validité.',                       emoji: '⌛', peutRepondre: false },
      annule:  { label: 'Annulé',             description: 'Ce devis a été annulé par le technicien.',                      emoji: '🚫', peutRepondre: false },
    }

    const statutInfo = STATUT_DEVIS_CLIENT[devis.statut] ?? {
      label: devis.statut, description: '', emoji: '📋', peutRepondre: false
    }

    // Vérifier expiration si statut envoye
    let estExpire = false
    if (devis.statut === 'envoye' && devis.date_validite) {
      estExpire = new Date(devis.date_validite) < new Date()
    }

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
        // Totaux
        total_ht:       devis.total_ht,
        total_tva:      devis.total_tva,
        total_ttc:      devis.total_ttc,
        // Dates
        date_validite:  devis.date_validite,
        envoye_le:      devis.envoye_le,
        repondu_le:     devis.repondu_le,
        // Notes/conditions
        notes:          devis.notes,
        conditions:     devis.conditions,
        // Client (prénom uniquement pour la confidentialité)
        client_prenom:  devis.client_prenom,
        // Boutique
        boutique: {
          nom:       devis.boutique_nom,
          telephone: devis.boutique_telephone,
          email:     devis.boutique_email,
          adresse:   devis.boutique_adresse,
          ville:     devis.boutique_ville,
          logo:      devis.boutique_logo,
        },
        // Lignes du devis
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
 * Body : { action: 'accepte' | 'refuse', signature?: string }
 * Transition machine à états : envoye → accepte | refuse
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

    // Récupérer le devis par token pour obtenir l'id
    const devis = await getDevisByToken(c.env.DB, token)
    if (!devis)
      return c.json({ success: false, error: 'Devis introuvable ou lien invalide.' }, 404)

    if (devis.statut !== 'envoye')
      return c.json({ success: false, error: `Ce devis ne peut plus être modifié (statut actuel : ${devis.statut}).` }, 409)

    // Vérifier expiration
    if (devis.date_validite && new Date(devis.date_validite) < new Date())
      return c.json({ success: false, error: 'Ce devis a expiré et ne peut plus être accepté.' }, 410)

    // Enregistrer la signature si fournie
    if (signature && typeof signature === 'string' && signature.length > 0) {
      await c.env.DB.prepare(
        'UPDATE devis SET signature_client = ? WHERE id = ?'
      ).bind(signature.slice(0, 1000), devis.id).run()
    }

    // Appliquer la transition (fromPublic = true)
    const { statut_avant, statut_apres } = await updateStatutDevis(
      c.env.DB,
      devis.id,
      0, // userId = 0 pour action publique (pas d'utilisateur authentifié)
      action as StatutDevis,
      true, // fromPublic
    )

    const messages: Record<string, string> = {
      accepte: 'Merci ! Votre devis a été accepté. L\'équipe vous contactera prochainement.',
      refuse:  'Devis refusé. L\'équipe a été notifiée.',
    }

    return c.json({
      success:      true,
      statut_avant,
      statut_apres,
      message:      messages[action] ?? 'Réponse enregistrée.',
    })

  } catch (e: any) {
    console.error('[public/devis/repondre]', e?.message ?? e)
    return c.json({ success: false, error: e.message ?? 'Erreur serveur.' }, 500)
  }
})

// ─── Endpoint interne : générer tracking token pour un ticket ────────────────

/**
 * Utilisé par ticketsService pour générer le token à la création.
 * Exposé en lecture pour que le frontend puisse l'afficher sur une fiche.
 */
pub.get('/token-for-ticket/:id', async (c) => {
  // Auth basique : header interne (pas JWT complet car petite opération)
  // En prod, protéger ou supprimer cet endpoint
  return c.json({ success: false, error: 'Utiliser le endpoint /api/tickets/:id' }, 405)
})

export default pub
