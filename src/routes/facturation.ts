/**
 * routes/facturation.ts — Devis, Factures, Paiements + NF525
 * Architecture P1 MVC : Controller pur — 0 SQL (tout délégué aux services).
 * Sprint 2.20 : section Factures/Avoirs migrée vers factureService.
 */

import { Hono } from 'hono'
import { authMiddleware, requireRole, getBoutiqueId, assertBoutiqueOwnership } from '../lib/middleware'
import { parsePagination } from '../lib/db'
import {
  listDevis, getDevis, createDevis, updateDevis,
  updateStatutDevis, convertirDevis, getStatsDevis,
  expireDevisPerimes, type StatutDevis,
} from '../services/devisService'
import {
  listFactures, getFacture, ajouterPaiement, emettreFacture,
  listAvoirs, getAvoir, createAvoir, createFactureAcompte,
  getDevisPourNf525, updateFactureHash,
  createFacture, type CreateFactureInput,
} from '../services/factureService'
import { sendEmail } from '../services/emailService'
import { enregistrerTransaction } from '../lib/nf525'
import { auditLog } from '../lib/db'
import type { Database } from '../ports/database'

type Bindings = { DB: D1Database; KV: import("../lib/d1kv").D1KVNamespace; JWT_SECRET: string; FRONTEND_URL?: string; RESEND_API_KEY?: string }
// 'db' : port Database injecté par le middleware global (src/index.tsx) — utilisé
// par listFactures/getFacture/listAvoirs/getAvoir/getDevisPourNf525/updateFactureHash
// (Ports & Adapters, 2026-07-12) et par listDevis/getDevis/getStatsDevis/
// expireDevisPerimes (Ports & Adapters, 2026-07-13). ajouterPaiement/emettreFacture/
// createAvoir/createDevis/updateDevis/updateStatutDevis/convertirDevis restent sur
// c.env.DB (dépendent d'auditLog/enregistrerTransaction/nextNumero/batch, non migrés).
type Variables = { user: any; db: Database }

const facturation = new Hono<{ Bindings: Bindings; Variables: Variables }>()
facturation.use('*', authMiddleware)

// ══════════════════════════════════════════════════════════════════════════════
// DEVIS — Controller pur (0 SQL), délègue à devisService
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/devis
 * Query : page, limit, statut, client_id, search, boutique_id
 */
facturation.get('/devis', async (c) => {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, c.req.query('boutique_id'))
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const result = await listDevis(c.get('db'), boutiqueId, c.req.query())
  return c.json({ success: true, ...result })
})

/**
 * GET /api/devis/stats
 * Statistiques agrégées des devis d'une boutique.
 */
facturation.get('/devis/stats', async (c) => {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, c.req.query('boutique_id'))
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const data = await getStatsDevis(c.get('db'), boutiqueId)
  return c.json({ success: true, data })
})

/**
 * POST /api/devis/expire
 * Expire les devis dont la date_validite est dépassée (cron-like, admin uniquement).
 */
facturation.post('/devis/expire', requireRole('admin'), async (c) => {
  const count = await expireDevisPerimes(c.get('db'))
  return c.json({ success: true, data: { expires: count }, message: `${count} devis expiré(s).` })
})

/**
 * POST /api/devis
 * Crée un devis avec ses lignes. Génère numéro séquentiel + public_token.
 * Body : { boutique_id?, client_id, ticket_id?, lignes[], notes?, conditions?, date_validite? }
 */
facturation.post('/devis', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()

  if (!body.client_id || !body.lignes?.length)
    return c.json({ success: false, error: 'client_id et lignes obligatoires.' }, 400)

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString())
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  try {
    const result = await createDevis(c.env.DB, boutiqueId, user.sub, { ...body, boutique_id: boutiqueId })
    return c.json({ success: true, ...result, message: 'Devis créé.' }, 201)
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 422)
  }
})

/**
 * GET /api/devis/:id
 * Détail complet d'un devis avec lignes, client et boutique.
 */
facturation.get('/devis/:id', async (c) => {
  const id   = parseInt(c.req.param('id'), 10)
  const data = await getDevis(c.get('db'), id)

  // Isolation multi-tenant : ne jamais servir le devis d'une autre boutique
  // (coordonnées client + montants).
  const deny = assertBoutiqueOwnership(c.get('user'), data, 'Devis')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  return c.json({ success: true, data })
})

/**
 * PUT /api/devis/:id
 * Modifie un devis (uniquement si statut = draft).
 * Body : { client_id?, lignes?, notes?, conditions?, date_validite? }
 */
facturation.put('/devis/:id', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)

  // Isolation multi-tenant : la garde précède toute mutation.
  const devisACtrl = await getDevis(c.get('db'), id)
  const deny = assertBoutiqueOwnership(user, devisACtrl, 'Devis')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  const body = await c.req.json()

  try {
    await updateDevis(c.env.DB, id, user.sub, body)
    return c.json({ success: true, message: 'Devis mis à jour.' })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 422)
  }
})

/**
 * PUT /api/devis/:id/statut
 * Change le statut d'un devis (machine à états enforced).
 * Body : { statut }  — valeurs : envoye | accepte | refuse | expire | annule
 */
facturation.put('/devis/:id/statut', requireRole('admin', 'manager'), async (c) => {
  const user   = c.get('user')
  const id     = parseInt(c.req.param('id'), 10)

  // Isolation multi-tenant : la garde précède toute mutation.
  const devisACtrl = await getDevis(c.get('db'), id)
  const deny = assertBoutiqueOwnership(user, devisACtrl, 'Devis')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  const { statut } = await c.req.json()
  if (!statut) return c.json({ success: false, error: 'statut obligatoire.' }, 400)

  try {
    const result = await updateStatutDevis(c.env.DB, id, user.sub, statut as StatutDevis)
    return c.json({ success: true, ...result, message: `Statut mis à jour : ${statut}.` })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 422)
  }
})

/**
 * POST /api/devis/:id/accord-manuel
 * Valide manuellement l'accord d'un devis "envoyé" — feature "Accord" (timeline
 * suivi.html), permet à l'équipe de débloquer la prise en charge quand le client
 * ne répond pas au lien public (`POST /api/public/devis/:token/repondre`).
 *
 * Autorisation volontairement plus large que `PUT /devis/:id/statut` (admin/manager
 * seulement) : technicien/manager/admin, sans délai imposé — décision explicite
 * (2026-07-16), le jugement de "client injoignable" est laissé à l'équipe terrain.
 * Reste néanmoins une action distincte et tracée (`ACCORD_MANUEL_STAFF`, en plus
 * du log générique déjà écrit par `updateStatutDevis()`) — pas un simple alias de
 * `PUT /devis/:id/statut`, pour ne pas élargir au passage tout le pouvoir de gestion
 * des devis (annuler, refuser…) à un rôle technicien.
 *
 * @param id  Identifiant du devis
 * @returns 200 `{ success, statut_avant, statut_apres, message }`
 * @returns 409 si le devis n'est pas au statut `envoye` (déjà répondu, brouillon, expiré…)
 */
facturation.post('/devis/:id/accord-manuel', requireRole('admin', 'manager', 'technicien'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)

  const devis = await getDevis(c.get('db'), id)

  // Isolation multi-tenant : la garde précède toute mutation.
  const denyAccord = assertBoutiqueOwnership(user, devis, 'Devis')
  if (denyAccord) return c.json({ success: false, error: denyAccord.error }, denyAccord.status)

  if (devis.statut !== 'envoye')
    return c.json({ success: false, error: `Ce devis ne peut pas être validé manuellement (statut actuel : ${devis.statut}).` }, 409)

  try {
    const result = await updateStatutDevis(c.env.DB, id, user.sub, 'accepte')
    await auditLog(c.env.DB, {
      boutique_id: devis.boutique_id, user_id: user.sub,
      action: 'ACCORD_MANUEL_STAFF', entite_type: 'devis', entite_id: id,
      apres: { raison: 'client non-répondant, validé par l\'équipe' },
    })
    return c.json({ success: true, ...result, message: 'Accord validé manuellement.' })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 422)
  }
})

/**
 * POST /api/devis/:id/envoyer
 * Marque le devis comme "envoye" et notifie le client par email.
 * Le lien public_token est inclus dans l'email.
 */
facturation.post('/devis/:id/envoyer', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const id   = parseInt(c.req.param('id'), 10)

  const data = await getDevis(c.get('db'), id)

  // Isolation multi-tenant : la garde précède toute mutation.
  const denyEnvoyer = assertBoutiqueOwnership(user, data, 'Devis')
  if (denyEnvoyer) return c.json({ success: false, error: denyEnvoyer.error }, denyEnvoyer.status)

  if (!data.client_email) return c.json({ success: false, error: 'Le client n\'a pas d\'email renseigné.' }, 422)

  try {
    await updateStatutDevis(c.env.DB, id, user.sub, 'envoye')
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 422)
  }

  // Construire lien acceptation
  const baseUrl     = c.env.FRONTEND_URL ?? 'http://localhost:3000'
  const lienPublic  = `${baseUrl}/devis-public?token=${data.public_token}`
  const expiration  = data.date_validite
    ? `<p>Ce devis est valable jusqu'au <strong>${new Date(data.date_validite).toLocaleDateString('fr-FR')}</strong>.</p>`
    : ''

  // Envoi email non bloquant — waitUntil() obligatoire, voir routes/tickets.ts
  // (sinon Cloudflare Workers tue l'exécution avant l'envoi réel, bug silencieux)
  c.executionCtx.waitUntil(sendEmail({
    db:         c.get('db'),
    boutiqueId: data.boutique_id,
    to:         data.client_email,
    sujet:      `Devis ${data.numero} — ${data.boutique_nom}`,
    html: `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:#6366f1;">📄 Votre devis ${data.numero}</h2>
      <p>Bonjour ${data.client_prenom || data.client_nom},</p>
      <p><strong>${data.boutique_nom}</strong> vous a envoyé un devis de <strong>${data.total_ttc?.toFixed(2)} € TTC</strong>.</p>
      ${expiration}
      <div style="text-align:center;margin:30px 0;">
        <a href="${lienPublic}" style="background:#6366f1;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">
          Consulter et répondre au devis →
        </a>
      </div>
      <p style="color:#888;font-size:12px;">Ou copiez ce lien dans votre navigateur : ${lienPublic}</p>
      <hr><p style="color:#888;font-size:11px;">${data.boutique_nom} — ${data.boutique_telephone ?? ''} — ${data.boutique_email ?? ''}</p>
    </body></html>`,
    type: 'devis',
    apiKeyFallback: c.env.RESEND_API_KEY,
  }).catch(() => {/* non bloquant */}))

  return c.json({
    success:      true,
    lien_public:  lienPublic,
    message:      `Devis ${data.numero} envoyé — email de notification envoyé à ${data.client_email}.`,
  })
})

/**
 * PUT /api/devis/:id/convertir
 * Convertit un devis en facture (avec chaîne NF525).
 */
facturation.put('/devis/:id/convertir', requireRole('admin', 'manager'), async (c) => {
  const user    = c.get('user')
  const devisId = parseInt(c.req.param('id'), 10)

  // Isolation multi-tenant : ne jamais convertir le devis d'une autre boutique.
  // Même patron que POST /devis/:id/acompte ci-dessous (faille trouvée le 2026-07-30).
  const devisAControler = await getDevis(c.get('db'), devisId)
  const deny = assertBoutiqueOwnership(user, devisAControler, 'Devis')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  try {
    const { facture_id, facture_numero } = await convertirDevis(c.env.DB, devisId, user.sub)

    // ── NF525 : enregistrer la transaction chaînée ─────────────────────────
    const devis = await getDevisPourNf525(c.get('db'), devisId)
    if (devis) {
      const hashNf525 = await enregistrerTransaction(c.env.DB, {
        boutique_id: devis.boutique_id, type_transaction: 'facture',
        reference_id: facture_id, reference_numero: facture_numero,
        client_id: devis.client_id,
        montant_ht: devis.total_ht, montant_tva: devis.total_tva, montant_ttc: devis.total_ttc,
        date_transaction: new Date().toISOString(), user_id: user.sub,
      })
      await updateFactureHash(c.get('db'), facture_id, hashNf525)
    }

    return c.json({ success: true, facture_id, facture_numero, message: 'Devis converti en facture.' })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 422)
  }
})

/**
 * POST /api/devis/:id/acompte
 * Facture un acompte pour ce devis — voir
 * docs/superpowers/specs/2026-07-16-acompte-structure-design.md.
 * Réservé admin/manager. Même contrat que POST /api/tickets/:id/acompte.
 *
 * @param id  — ID du devis
 * @body { montant_ht, tva_taux, mode_paiement, reference? }
 * @returns 201 { success, facture_id, facture_numero, message }
 * @returns 409 si un acompte existe déjà pour ce devis
 */
facturation.post('/devis/:id/acompte', requireRole('admin', 'manager'), async (c) => {
  const user    = c.get('user')
  const devisId = parseInt(c.req.param('id'), 10)

  const devis = await getDevis(c.get('db'), devisId)
  const denyAcompte = assertBoutiqueOwnership(user, devis, 'Devis')
  if (denyAcompte) return c.json({ success: false, error: denyAcompte.error }, denyAcompte.status)

  const { montant_ht, tva_taux, mode_paiement, reference } = await c.req.json().catch(() => ({}))
  // typeof/isNaN, pas juste `<= 0` : voir routes/tickets.ts (même acompte, commit c7abcc4)
  if (typeof montant_ht !== 'number' || isNaN(montant_ht) || montant_ht <= 0)
    return c.json({ success: false, error: 'montant_ht doit être positif.' }, 400)
  if (!mode_paiement)
    return c.json({ success: false, error: 'mode_paiement obligatoire.' }, 400)

  try {
    const result = await createFactureAcompte(c.env.DB, user.sub, {
      boutique_id: devis.boutique_id,
      client_id:   devis.client_id,
      ticket_id:   devis.ticket_id ?? null,
      devis_id:    devisId,
      montant_ht,
      tva_taux:    tva_taux ?? 20,
      mode_paiement,
      reference,
    })
    return c.json({ success: true, ...result, message: 'Acompte facturé.' }, 201)
  } catch (err: any) {
    const status = err.message.includes('déjà été facturé') ? 409 : 422
    return c.json({ success: false, error: err.message }, status)
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// FACTURES — Controller pur (0 SQL), délègue à factureService
// ══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/factures
 * Crée une facture manuelle (modal "Nouvelle facture" de factures.html).
 * Voir docs/superpowers/specs/2026-07-30-factures-creation-manuelle-design.md.
 *
 * Si `devis_id` est fourni, délègue à convertirDevis() — chemin existant qui
 * porte déjà ses garanties (refus si devis refusé/annulé/déjà converti,
 * déduction d'un acompte antérieur) — et les lignes du body sont ignorées.
 *
 * @body { client_id, ticket_id?, devis_id?, lignes[], notes?, conditions?, date_execution?,
 *         action: 'brouillon'|'emettre'|'emettre_encaisser', mode_paiement?, reference? }
 * `date_execution` (date de livraison/exécution, socle réglementaire de la facture
 * électronique) transite tel quel vers createFacture() par le spread du body ; absent,
 * le service retombe sur la date du jour.
 * @returns 201 { success, facture_id, facture_numero, statut }
 */
facturation.post('/factures', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const body = await c.req.json().catch(() => ({} as any))

  const ACTIONS = ['brouillon', 'emettre', 'emettre_encaisser']

  if (!body.client_id)
    return c.json({ success: false, error: 'client_id obligatoire.' }, 400)
  if (!ACTIONS.includes(body.action))
    return c.json({ success: false, error: `action invalide (${ACTIONS.join(' | ')}).` }, 400)
  if (!body.devis_id && !body.lignes?.length)
    return c.json({ success: false, error: 'lignes obligatoires sans devis source.' }, 400)
  if (body.action === 'emettre_encaisser' && !body.mode_paiement)
    return c.json({ success: false, error: 'mode_paiement obligatoire pour encaisser.' }, 400)

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString())
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  try {
    // ── Chemin devis : délégation, jamais de seconde implémentation ────────
    if (body.devis_id) {
      // Volontairement PAS `assertBoutiqueOwnership()` ici : ce contrôle est plus strict.
      // Le helper laisse l'admin plateforme traverser ; ici on exige que le devis soit dans
      // la boutique *effectivement ciblée* (`boutiqueId`, issu de getBoutiqueId), pour qu'un
      // admin qui poste `boutique_id: 3` ne puisse pas facturer le devis de la boutique 7
      // dans la 3. Ne pas « uniformiser » sans transposer cette contrainte.
      const devis = await getDevis(c.get('db'), body.devis_id)
      if (!devis) return c.json({ success: false, error: 'Devis introuvable.' }, 404)
      if (devis.boutique_id !== boutiqueId)
        return c.json({ success: false, error: 'Accès refusé.' }, 403)
      // Garde côté serveur : la modale a un select "Client" et un select "Devis source"
      // indépendants, que rien ne synchronise côté UI. Sans ce contrôle, choisir le
      // client Dupont puis un devis de Martin produit silencieusement une facture pour
      // Martin (convertirDevis() utilise toujours le client du devis, body.client_id
      // n'est jamais lu) — sur un document verrouillable. Voir finding F4, revue finale
      // 2026-07-30.
      if (body.client_id && Number(body.client_id) !== devis.client_id)
        return c.json({ success: false, error: 'client_id ne correspond pas au client du devis sélectionné.' }, 400)

      const { facture_id, facture_numero } = await convertirDevis(c.env.DB, body.devis_id, user.sub)

      let statut = 'brouillon'
      if (body.action === 'emettre_encaisser') {
        // Le montant à encaisser n'est PAS `devis.total_ttc` : convertirDevis() déduit
        // une facture d'acompte antérieure et crée donc une facture au solde restant
        // (devisService.ts:437-483). Encaisser le total du devis ferait payer deux fois
        // l'acompte au client et laisserait `montant_paye` au-dessus du `total_ttc` réel.
        // On relit la facture créée plutôt que de recopier ici la règle de déduction —
        // si celle-ci évolue, l'encaissement suit sans modification.
        const factureCreee = await getFacture(c.get('db'), facture_id)
        const paiement = await ajouterPaiement(c.env.DB, facture_id, user.sub, {
          montant:       factureCreee?.total_ttc ?? devis.total_ttc,
          mode_paiement: body.mode_paiement,
          reference:     body.reference,
        })
        statut = paiement.statut
      }
      if (body.action !== 'brouillon') {
        await emettreFacture(c.env.DB, facture_id, user.sub)
        if (statut === 'brouillon') statut = 'en_attente'
      }

      return c.json({ success: true, facture_id, facture_numero, statut }, 201)
    }

    // ── Chemin manuel ──────────────────────────────────────────────────────
    const input: CreateFactureInput = { ...body, boutique_id: boutiqueId }
    const result = await createFacture(c.env.DB, user.sub, input)
    return c.json({ success: true, ...result }, 201)
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 422)
  }
})

/**
 * GET /api/factures
 * Liste paginée des factures d'une boutique.
 * Query : page, limit, statut, client_id, boutique_id
 */
facturation.get('/factures', async (c) => {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, c.req.query('boutique_id'))
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const result = await listFactures(c.get('db'), boutiqueId, c.req.query())
  return c.json({ success: true, ...result })
})

/**
 * GET /api/factures/:id
 * Détail complet d'une facture (lignes + paiements + infos client/boutique).
 */
facturation.get('/factures/:id', async (c) => {
  const id   = parseInt(c.req.param('id'), 10)
  const data = await getFacture(c.get('db'), id)

  // Isolation multi-tenant : ne jamais servir la facture d'une autre boutique
  const deny = assertBoutiqueOwnership(c.get('user'), data, 'Facture')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  return c.json({ success: true, data })
})

/**
 * POST /api/factures/:id/paiement
 * Enregistre un paiement et met à jour le statut (payee / partiellement_payee).
 * Body : { montant, mode_paiement, reference?, notes? }
 */
facturation.post('/factures/:id/paiement', requireRole('admin', 'manager'), async (c) => {
  const user      = c.get('user')
  const factureId = parseInt(c.req.param('id'), 10)
  const body      = await c.req.json()

  if (!body.montant || !body.mode_paiement)
    return c.json({ success: false, error: 'montant et mode_paiement obligatoires.' }, 400)

  // Isolation multi-tenant : la facture encaissée doit appartenir à la boutique
  // appelante. ajouterPaiement() lit bien boutique_id mais ne le compare à rien.
  const facture = await c.get('db').get<{ boutique_id: number }>(
    'SELECT boutique_id FROM factures WHERE id = ?', [factureId]
  )
  const deny = assertBoutiqueOwnership(user, facture, 'Facture')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  try {
    const result = await ajouterPaiement(c.env.DB, factureId, user.sub, body)
    return c.json({ success: true, ...result, message: 'Paiement enregistré.' })
  } catch (err: any) {
    const status = err.message.includes('introuvable') ? 404
                 : err.message.includes('verrouillée') ? 403 : 422
    return c.json({ success: false, error: err.message }, status)
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// EMISSION FACTURE (CGI art. 289 — verrouillage inaltérable)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/factures/:id/emettre
 * Émet la facture : verrouillage NF525 + hash SHA-256 + tracking_token.
 * La facture devient inaltérable (CGI art. 289).
 */
facturation.post('/factures/:id/emettre', requireRole('admin', 'manager'), async (c) => {
  const user      = c.get('user')
  const factureId = parseInt(c.req.param('id'), 10)

  // Isolation multi-tenant : l'émission verrouille la facture DÉFINITIVEMENT et écrit
  // dans le journal NF525 de sa boutique — l'opération est irréversible, la vérification
  // d'appartenance doit donc précéder tout appel au service.
  const facture = await c.get('db').get<{ boutique_id: number }>(
    'SELECT boutique_id FROM factures WHERE id = ?', [factureId]
  )
  const deny = assertBoutiqueOwnership(user, facture, 'Facture')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  try {
    const result = await emettreFacture(c.env.DB, factureId, user.sub)
    return c.json({
      success:    true,
      facture_id: factureId,
      ...result,
      message:    'Facture émise et verrouillée conformément au CGI art. 289.',
    })
  } catch (err: any) {
    const status = err.message.includes('introuvable') ? 404
                 : err.message.includes('verrouillée') ? 400 : 422
    return c.json({ success: false, error: err.message }, status)
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// AVOIRS (NF525 — chaîne SHA-256 anti-fraude) — Controller pur
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/avoirs
 * Liste paginée des avoirs. Query : page, limit, statut, facture_id, client_id
 */
facturation.get('/avoirs', async (c) => {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, c.req.query('boutique_id'))
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const result = await listAvoirs(c.get('db'), boutiqueId, c.req.query())
  return c.json({ success: true, ...result })
})

/**
 * GET /api/avoirs/:id
 * Détail complet d'un avoir (+ lignes).
 */
facturation.get('/avoirs/:id', async (c) => {
  const id   = parseInt(c.req.param('id'), 10)
  const data = await getAvoir(c.get('db'), id)

  // Isolation multi-tenant : ne jamais servir l'avoir d'une autre boutique
  const deny = assertBoutiqueOwnership(c.get('user'), data, 'Avoir')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  return c.json({ success: true, data })
})

/**
 * POST /api/avoirs
 * Crée un avoir sur une facture émise (NF525 obligatoire).
 * Body : { facture_id, type?, motif, lignes[], notes? }
 */
facturation.post('/avoirs', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const body = await c.req.json()

  if (!body.facture_id) return c.json({ success: false, error: 'facture_id obligatoire.' }, 400)
  if (!body.motif)      return c.json({ success: false, error: 'motif obligatoire.' }, 400)
  if (!body.lignes?.length) return c.json({ success: false, error: 'Au moins une ligne obligatoire.' }, 400)

  // Isolation multi-tenant : l'avoir hérite de la boutique de sa facture support
  // (createAvoir()), donc c'est l'appartenance de cette facture qui fait foi.
  const factureSupport = await c.get('db').get<{ boutique_id: number }>(
    'SELECT boutique_id FROM factures WHERE id = ?', [body.facture_id]
  )
  const deny = assertBoutiqueOwnership(user, factureSupport, 'Facture')
  if (deny) return c.json({ success: false, error: deny.error }, deny.status)

  try {
    const result = await createAvoir(c.env.DB, user.sub, body)
    return c.json({
      success:    true,
      ...result,
      message:    'Avoir créé et enregistré dans le journal NF525.',
    }, 201)
  } catch (err: any) {
    const status = err.message.includes('introuvable') ? 404
                 : err.message.includes('non émise')   ? 400 : 422
    return c.json({ success: false, error: err.message }, status)
  }
})

export default facturation
