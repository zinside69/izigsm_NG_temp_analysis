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

type Bindings = { DB: D1Database; KV: KVNamespace; JWT_SECRET: string }

const pub = new Hono<{ Bindings: Bindings }>()

// CORS large pour les pages publiques (clients sans compte)
pub.use('/*', cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] }))

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
    const STATUT_CLIENT: Record<string, { label: string; description: string; emoji: string }> = {
      RECEIVED:       { label: 'Reçu',              description: 'Votre appareil a été réceptionné.',             emoji: '📥' },
      DIAGNOSED:      { label: 'Diagnostiqué',       description: 'Le diagnostic est en cours.',                   emoji: '🔍' },
      WAITING_PARTS:  { label: 'Pièces en attente',  description: 'Nous attendons les pièces nécessaires.',        emoji: '⏳' },
      IN_PROGRESS:    { label: 'En réparation',      description: 'Votre appareil est en cours de réparation.',    emoji: '🔧' },
      DONE:           { label: 'Réparé',             description: 'La réparation est terminée.',                    emoji: '✅' },
      READY:          { label: 'Prêt à récupérer',   description: 'Votre appareil est prêt. Vous pouvez venir le récupérer.', emoji: '🎉' },
      DELIVERED:      { label: 'Rendu',              description: 'L\'appareil vous a été restitué.',               emoji: '🏠' },
      CANCELLED:      { label: 'Annulé',             description: 'La réparation a été annulée.',                   emoji: '❌' },
      UNREPAIRABLE:   { label: 'Irréparable',        description: 'Malheureusement, l\'appareil ne peut pas être réparé.', emoji: '😢' },
    }

    const statutInfo = STATUT_CLIENT[ticket.statut] || {
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
