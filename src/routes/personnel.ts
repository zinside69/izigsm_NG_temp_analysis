/**
 * routes/personnel.ts — Employés & Pointage (machine à états)
 *
 * Machine à états du pointage :
 * absent → en_poste → pause → en_poste → termine
 *
 * Transitions autorisées :
 *   absent    → en_poste
 *   en_poste  → pause | termine
 *   pause     → en_poste
 *   termine   → (aucune — état terminal de la journée)
 */

import { Hono } from 'hono'
import { authMiddleware, requireRole, getBoutiqueId } from '../lib/middleware'
import { auditLog } from '../lib/db'

type Bindings = { DB: D1Database; KV: KVNamespace; JWT_SECRET: string }
type Variables = { user: any }

// Transitions de pointage autorisées
const TRANSITIONS_POINTAGE: Record<string, string[]> = {
  absent:    ['en_poste'],
  en_poste:  ['pause', 'termine'],
  pause:     ['en_poste'],
  termine:   [],
}

const STATUT_LABELS: Record<string, string> = {
  absent:   '🔴 Absent',
  en_poste: '🟢 En poste',
  pause:    '🟡 En pause',
  termine:  '⚫ Terminé',
}

const personnel = new Hono<{ Bindings: Bindings; Variables: Variables }>()
personnel.use('*', authMiddleware)

// ── GET /api/employes ─────────────────────────────────────────────────────────
personnel.get('/employes', async (c) => {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, c.req.query('boutique_id'))
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const employes = await c.env.DB.prepare(`
    SELECT e.id, e.prenom, e.nom, e.poste, e.email, e.telephone,
           e.statut_pointage, e.commission_pct, e.taux_horaire, e.actif,
           -- Dernier pointage
           p.horodatage as dernier_pointage,
           -- Heures travaillées aujourd'hui (approximatif)
           ROUND(
             (SELECT SUM(
               (julianday(p2.horodatage) - julianday(p1.horodatage)) * 24
             )
             FROM pointages p1
             JOIN pointages p2 ON p2.employe_id = p1.employe_id AND p2.id = (
               SELECT MIN(id) FROM pointages WHERE employe_id = p1.employe_id AND id > p1.id AND DATE(horodatage) = DATE('now')
             )
             WHERE p1.employe_id = e.id
               AND p1.statut_avant = 'absent' OR p1.statut_avant = 'pause'
               AND p1.statut_apres = 'en_poste'
               AND DATE(p1.horodatage) = DATE('now')
             ), 2
           ) as heures_aujourd_hui
    FROM   employes e
    LEFT JOIN pointages p ON p.id = (
      SELECT MAX(id) FROM pointages WHERE employe_id = e.id
    )
    WHERE  e.boutique_id = ? AND e.actif = 1
    ORDER  BY e.prenom, e.nom
  `).bind(boutiqueId).all()

  return c.json({ success: true, data: employes.results })
})

// ── GET /api/employes/:id ─────────────────────────────────────────────────────
personnel.get('/employes/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10)

  const employe = await c.env.DB.prepare('SELECT * FROM employes WHERE id = ? AND actif = 1').bind(id).first()
  if (!employe) return c.json({ success: false, error: 'Employé introuvable.' }, 404)

  const pointages = await c.env.DB.prepare(`
    SELECT p.*, u.prenom || ' ' || u.nom as valide_par_nom
    FROM   pointages p
    LEFT JOIN users u ON u.id = p.valide_par
    WHERE  p.employe_id = ?
    ORDER  BY p.horodatage DESC
    LIMIT  50
  `).bind(id).all()

  return c.json({ success: true, data: { ...employe, pointages: pointages.results } })
})

// ── POST /api/employes ────────────────────────────────────────────────────────
personnel.post('/employes', requireRole('admin', 'manager'), async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const { prenom, nom, poste, email, telephone, taux_horaire, commission_pct, user_id: linkedUserId } = body

  if (!prenom || !nom) return c.json({ success: false, error: 'Prénom et nom obligatoires.' }, 400)

  const boutiqueId = getBoutiqueId(user, body.boutique_id?.toString())
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const result = await c.env.DB.prepare(`
    INSERT INTO employes (boutique_id, user_id, prenom, nom, poste, email, telephone, taux_horaire, commission_pct)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(boutiqueId, linkedUserId ?? null, prenom, nom, poste ?? 'technicien',
          email ?? null, telephone ?? null, taux_horaire ?? null, commission_pct ?? 0)
    .first<{ id: number }>()

  await auditLog(c.env.DB, { boutique_id: boutiqueId, user_id: user.sub, action: 'CREATE_EMPLOYE', entite_type: 'employe', entite_id: result?.id })
  return c.json({ success: true, id: result?.id, message: 'Employé créé.' }, 201)
})

// ── PUT /api/employes/:id ─────────────────────────────────────────────────────
personnel.put('/employes/:id', requireRole('admin', 'manager'), async (c) => {
  const id   = parseInt(c.req.param('id'), 10)
  const body = await c.req.json()
  const { prenom, nom, poste, email, telephone, taux_horaire, commission_pct } = body

  await c.env.DB.prepare(`
    UPDATE employes SET prenom=?, nom=?, poste=?, email=?, telephone=?, taux_horaire=?, commission_pct=?, updated_at=CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(prenom, nom, poste ?? 'technicien', email ?? null, telephone ?? null, taux_horaire ?? null, commission_pct ?? 0, id).run()

  return c.json({ success: true, message: 'Employé mis à jour.' })
})

// ── DELETE /api/employes/:id ──────────────────────────────────────────────────
personnel.delete('/employes/:id', requireRole('admin'), async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  await c.env.DB.prepare('UPDATE employes SET actif = 0 WHERE id = ?').bind(id).run()
  return c.json({ success: true, message: 'Employé désactivé.' })
})

// ══════════════════════════════════════════════════════════════════════════════
// POINTAGE — Machine à états
// ══════════════════════════════════════════════════════════════════════════════

// ── POST /api/pointage/:employeId/pointer ─────────────────────────────────────
personnel.post('/pointage/:employeId/pointer', async (c) => {
  const user      = c.get('user')
  const employeId = parseInt(c.req.param('employeId'), 10)
  const { notes, latitude, longitude } = await c.req.json().catch(() => ({}))

  const employe = await c.env.DB.prepare(
    'SELECT id, prenom, nom, statut_pointage, boutique_id FROM employes WHERE id = ? AND actif = 1'
  ).bind(employeId).first<{ id: number; prenom: string; nom: string; statut_pointage: string; boutique_id: number }>()

  if (!employe) return c.json({ success: false, error: 'Employé introuvable.' }, 404)

  // Transitions disponibles depuis le statut actuel
  const transitionsDisponibles = TRANSITIONS_POINTAGE[employe.statut_pointage] ?? []

  if (transitionsDisponibles.length === 0) {
    return c.json({
      success: false,
      error: `${employe.prenom} a déjà terminé sa journée. Aucune transition disponible.`
    }, 422)
  }

  // Choisir automatiquement la prochaine transition
  // Si en_poste → 2 options : proposer dans la réponse
  // Si une seule option → appliquer automatiquement
  const body = await c.req.json().catch(() => ({}))
  const nouveauStatut = body.statut ?? transitionsDisponibles[0]

  if (!transitionsDisponibles.includes(nouveauStatut)) {
    return c.json({
      success: false,
      error: `Transition invalide : ${employe.statut_pointage} → ${nouveauStatut}. Transitions disponibles : ${transitionsDisponibles.join(', ')}.`
    }, 422)
  }

  // Enregistrer le pointage
  await c.env.DB.prepare(`
    INSERT INTO pointages (employe_id, boutique_id, statut_avant, statut_apres, latitude, longitude, valide_par, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(employeId, employe.boutique_id, employe.statut_pointage, nouveauStatut,
          latitude ?? null, longitude ?? null,
          user.sub !== employeId ? user.sub : null,  // valide_par si manager
          notes ?? null).run()

  // Mettre à jour le statut de l'employé
  await c.env.DB.prepare(
    'UPDATE employes SET statut_pointage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(nouveauStatut, employeId).run()

  return c.json({
    success: true,
    statut_avant:   employe.statut_pointage,
    statut_apres:   nouveauStatut,
    label:          STATUT_LABELS[nouveauStatut],
    horodatage:     new Date().toISOString(),
    message:        `${employe.prenom} ${employe.nom} : ${STATUT_LABELS[employe.statut_pointage]} → ${STATUT_LABELS[nouveauStatut]}`,
    prochaines_transitions: TRANSITIONS_POINTAGE[nouveauStatut]
  })
})

// ── GET /api/pointage/:employeId/aujourd-hui ──────────────────────────────────
personnel.get('/pointage/:employeId/aujourd-hui', async (c) => {
  const employeId = parseInt(c.req.param('employeId'), 10)

  const pointages = await c.env.DB.prepare(`
    SELECT p.*, u.prenom || ' ' || u.nom as valide_par_nom
    FROM   pointages p
    LEFT JOIN users u ON u.id = p.valide_par
    WHERE  p.employe_id = ? AND DATE(p.horodatage) = DATE('now')
    ORDER  BY p.horodatage ASC
  `).bind(employeId).all()

  // Calculer heures travaillées (hors pauses)
  const rows = pointages.results as any[]
  let heuresTravaillees = 0
  let entreeEnPoste: string | null = null

  for (const p of rows) {
    if (p.statut_apres === 'en_poste') {
      entreeEnPoste = p.horodatage
    } else if ((p.statut_apres === 'pause' || p.statut_apres === 'termine') && entreeEnPoste) {
      const diff = (new Date(p.horodatage).getTime() - new Date(entreeEnPoste).getTime()) / 3600000
      heuresTravaillees += diff
      entreeEnPoste = null
    }
  }

  // Si encore en poste : comptabiliser jusqu'à maintenant
  if (entreeEnPoste) {
    const diff = (Date.now() - new Date(entreeEnPoste).getTime()) / 3600000
    heuresTravaillees += diff
  }

  return c.json({
    success: true,
    employe_id: employeId,
    pointages: rows,
    heures_travaillees: Math.round(heuresTravaillees * 100) / 100
  })
})

// ── GET /api/pointage/rapport ─────────────────────────────────────────────────
personnel.get('/pointage/rapport', requireRole('admin', 'manager'), async (c) => {
  const user       = c.get('user')
  const query      = c.req.query()
  const boutiqueId = getBoutiqueId(user, query.boutique_id)
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const dateDebut = query.date_debut ?? new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
  const dateFin   = query.date_fin   ?? new Date().toISOString().split('T')[0]

  const employes = await c.env.DB.prepare(`
    SELECT e.id, e.prenom, e.nom, e.poste,
           COUNT(DISTINCT DATE(p.horodatage)) as jours_presents,
           MIN(p.horodatage) as premiere_entree,
           MAX(p.horodatage) as derniere_sortie
    FROM   employes e
    LEFT JOIN pointages p ON p.employe_id = e.id
      AND DATE(p.horodatage) BETWEEN ? AND ?
      AND p.statut_apres = 'en_poste'
    WHERE  e.boutique_id = ? AND e.actif = 1
    GROUP  BY e.id
    ORDER  BY e.nom, e.prenom
  `).bind(dateDebut, dateFin, boutiqueId).all()

  return c.json({ success: true, periode: { debut: dateDebut, fin: dateFin }, data: employes.results })
})

// ── GET /api/pointage/statuts — Statuts temps réel ───────────────────────────
personnel.get('/pointage/statuts', async (c) => {
  const user       = c.get('user')
  const boutiqueId = getBoutiqueId(user, c.req.query('boutique_id'))
  if (!boutiqueId) return c.json({ success: false, error: 'boutique_id requis.' }, 400)

  const statuts = await c.env.DB.prepare(`
    SELECT e.id, e.prenom, e.nom, e.poste, e.statut_pointage,
           p.horodatage as depuis
    FROM   employes e
    LEFT JOIN pointages p ON p.id = (
      SELECT MAX(id) FROM pointages WHERE employe_id = e.id
    )
    WHERE  e.boutique_id = ? AND e.actif = 1
    ORDER  BY e.prenom
  `).bind(boutiqueId).all()

  // Grouper par statut
  const grouped = (statuts.results as any[]).reduce((acc: any, e: any) => {
    if (!acc[e.statut_pointage]) acc[e.statut_pointage] = []
    acc[e.statut_pointage].push({ ...e, label: STATUT_LABELS[e.statut_pointage] })
    return acc
  }, {})

  return c.json({
    success: true,
    data: statuts.results,
    resume: {
      total:     statuts.results.length,
      en_poste:  grouped['en_poste']?.length  ?? 0,
      pause:     grouped['pause']?.length     ?? 0,
      absent:    grouped['absent']?.length    ?? 0,
      termine:   grouped['termine']?.length   ?? 0,
    },
    details: grouped
  })
})

export default personnel
