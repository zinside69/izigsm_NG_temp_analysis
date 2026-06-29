/**
 * services/personnelService.ts — Model layer Employés & Pointage
 * Sprint 2.21 — Architecture P1 : 0 SQL dans les routes, tout ici.
 *
 * Périmètre :
 *   - Employés : liste (avec statut temps réel), détail, création, mise à jour, désactivation
 *   - Pointage : machine à états (absent → en_poste ↔ pause → termine)
 *   - Rapport   : présences sur période + rapport statuts temps réel
 *
 * Machine à états du pointage :
 *   absent   → en_poste
 *   en_poste → pause | termine
 *   pause    → en_poste
 *   termine  → (état terminal de la journée)
 *
 * @module personnelService
 */

import { auditLog } from '../lib/db'

// ─── Types ────────────────────────────────────────────────────────────────────

export type StatutPointage = 'absent' | 'en_poste' | 'pause' | 'termine'

export interface CreateEmployeInput {
  prenom:          string
  nom:             string
  poste?:          string
  email?:          string
  telephone?:      string
  taux_horaire?:   number
  commission_pct?: number
  user_id?:        number
  boutique_id?:    number
}

export interface UpdateEmployeInput {
  prenom:          string
  nom:             string
  poste?:          string
  email?:          string
  telephone?:      string
  taux_horaire?:   number
  commission_pct?: number
}

// ─── Constantes ───────────────────────────────────────────────────────────────

/** Transitions de pointage autorisées par statut courant. */
export const TRANSITIONS_POINTAGE: Record<StatutPointage, StatutPointage[]> = {
  absent:   ['en_poste'],
  en_poste: ['pause', 'termine'],
  pause:    ['en_poste'],
  termine:  [],
}

/** Labels affichage statut pointage. */
export const STATUT_LABELS: Record<StatutPointage, string> = {
  absent:   '🔴 Absent',
  en_poste: '🟢 En poste',
  pause:    '🟡 En pause',
  termine:  '⚫ Terminé',
}

// ─── Employés ─────────────────────────────────────────────────────────────────

/**
 * Liste des employés actifs d'une boutique avec statut de pointage temps réel.
 * @param db         - Instance D1Database
 * @param boutiqueId - ID de la boutique
 */
export async function listEmployes(db: D1Database, boutiqueId: number): Promise<any[]> {
  const rows = await db.prepare(`
    SELECT e.id, e.prenom, e.nom, e.poste, e.email, e.telephone,
           e.statut_pointage, e.commission_pct, e.taux_horaire, e.actif,
           p.horodatage as dernier_pointage,
           ROUND(
             (SELECT SUM(
               (julianday(p2.horodatage) - julianday(p1.horodatage)) * 24
             )
             FROM pointages p1
             JOIN pointages p2 ON p2.employe_id = p1.employe_id AND p2.id = (
               SELECT MIN(id) FROM pointages
               WHERE employe_id = p1.employe_id AND id > p1.id
                 AND DATE(horodatage) = DATE('now')
             )
             WHERE p1.employe_id = e.id
               AND (p1.statut_avant = 'absent' OR p1.statut_avant = 'pause')
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
  `).bind(boutiqueId).all<any>()

  return rows.results ?? []
}

/**
 * Détail complet d'un employé avec ses 50 derniers pointages.
 * @param db - Instance D1Database
 * @param id - ID de l'employé
 */
export async function getEmploye(db: D1Database, id: number): Promise<any | null> {
  const [employe, pointages] = await Promise.all([
    db.prepare('SELECT * FROM employes WHERE id = ? AND actif = 1').bind(id).first<any>(),
    db.prepare(`
      SELECT p.*, u.prenom || ' ' || u.nom as valide_par_nom
      FROM   pointages p
      LEFT JOIN users u ON u.id = p.valide_par
      WHERE  p.employe_id = ?
      ORDER  BY p.horodatage DESC
      LIMIT  50
    `).bind(id).all<any>(),
  ])

  if (!employe) return null
  return { ...employe, pointages: pointages.results ?? [] }
}

/**
 * Crée un employé et l'associe optionnellement à un compte utilisateur.
 * @param db         - Instance D1Database
 * @param boutiqueId - ID de la boutique
 * @param userId     - ID de l'admin/manager effectuant la création
 * @param input      - Données de l'employé
 */
export async function createEmploye(
  db:          D1Database,
  boutiqueId:  number,
  userId:      number,
  input:       CreateEmployeInput
): Promise<{ id: number }> {
  const result = await db.prepare(`
    INSERT INTO employes
      (boutique_id, user_id, prenom, nom, poste, email, telephone, taux_horaire, commission_pct)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(
    boutiqueId,
    input.user_id      ?? null,
    input.prenom,
    input.nom,
    input.poste        ?? 'technicien',
    input.email        ?? null,
    input.telephone    ?? null,
    input.taux_horaire ?? null,
    input.commission_pct ?? 0,
  ).first<{ id: number }>()

  if (!result?.id) throw new Error('Erreur lors de la création de l\'employé.')

  await auditLog(db, {
    boutique_id: boutiqueId, user_id: userId,
    action: 'CREATE_EMPLOYE', entite_type: 'employe', entite_id: result.id,
    apres: { prenom: input.prenom, nom: input.nom, poste: input.poste },
  })

  return { id: result.id }
}

/**
 * Met à jour les informations d'un employé.
 * @param db    - Instance D1Database
 * @param id    - ID de l'employé
 * @param input - Champs modifiables
 */
export async function updateEmploye(
  db:    D1Database,
  id:    number,
  input: UpdateEmployeInput
): Promise<void> {
  await db.prepare(`
    UPDATE employes
    SET prenom         = ?,
        nom            = ?,
        poste          = ?,
        email          = ?,
        telephone      = ?,
        taux_horaire   = ?,
        commission_pct = ?,
        updated_at     = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    input.prenom,
    input.nom,
    input.poste          ?? 'technicien',
    input.email          ?? null,
    input.telephone      ?? null,
    input.taux_horaire   ?? null,
    input.commission_pct ?? 0,
    id,
  ).run()
}

/**
 * Désactive un employé (soft delete — actif = 0).
 * @param db - Instance D1Database
 * @param id - ID de l'employé
 */
export async function desactiverEmploye(db: D1Database, id: number): Promise<void> {
  await db.prepare('UPDATE employes SET actif = 0 WHERE id = ?').bind(id).run()
}

// ─── Pointage ─────────────────────────────────────────────────────────────────

/**
 * Effectue une transition de pointage selon la machine à états.
 * Choisit automatiquement la transition si une seule est disponible,
 * sinon applique le statut demandé.
 * @param db         - Instance D1Database
 * @param employeId  - ID de l'employé
 * @param userId     - ID de l'opérateur (peut différer de l'employé → valide_par)
 * @param opts       - Statut demandé + géolocalisation + notes
 */
export async function pointer(
  db:         D1Database,
  employeId:  number,
  userId:     number,
  opts: {
    statut?:    string
    notes?:     string
    latitude?:  number
    longitude?: number
  } = {}
): Promise<{
  statut_avant:          StatutPointage
  statut_apres:          StatutPointage
  label:                 string
  horodatage:            string
  message:               string
  prochaines_transitions: StatutPointage[]
}> {
  const employe = await db.prepare(
    'SELECT id, prenom, nom, statut_pointage, boutique_id FROM employes WHERE id = ? AND actif = 1'
  ).bind(employeId).first<{ id: number; prenom: string; nom: string; statut_pointage: StatutPointage; boutique_id: number }>()

  if (!employe) throw new Error('Employé introuvable.')

  const transitionsDisponibles = TRANSITIONS_POINTAGE[employe.statut_pointage] ?? []

  if (transitionsDisponibles.length === 0) {
    throw Object.assign(
      new Error(`${employe.prenom} a déjà terminé sa journée. Aucune transition disponible.`),
      { code: 'JOURNEE_TERMINEE' }
    )
  }

  const nouveauStatut = (opts.statut as StatutPointage) ?? transitionsDisponibles[0]

  if (!transitionsDisponibles.includes(nouveauStatut)) {
    throw Object.assign(
      new Error(
        `Transition invalide : ${employe.statut_pointage} → ${nouveauStatut}. ` +
        `Transitions disponibles : ${transitionsDisponibles.join(', ')}.`
      ),
      { code: 'TRANSITION_INVALIDE' }
    )
  }

  // Enregistrer le pointage
  await db.prepare(`
    INSERT INTO pointages
      (employe_id, boutique_id, statut_avant, statut_apres, latitude, longitude, valide_par, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    employeId, employe.boutique_id,
    employe.statut_pointage, nouveauStatut,
    opts.latitude  ?? null,
    opts.longitude ?? null,
    userId !== employeId ? userId : null,   // valide_par si manager différent
    opts.notes ?? null,
  ).run()

  // Mise à jour statut employé
  await db.prepare(
    'UPDATE employes SET statut_pointage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(nouveauStatut, employeId).run()

  const horodatage = new Date().toISOString()

  return {
    statut_avant:           employe.statut_pointage,
    statut_apres:           nouveauStatut,
    label:                  STATUT_LABELS[nouveauStatut],
    horodatage,
    message:                `${employe.prenom} ${employe.nom} : ${STATUT_LABELS[employe.statut_pointage]} → ${STATUT_LABELS[nouveauStatut]}`,
    prochaines_transitions: TRANSITIONS_POINTAGE[nouveauStatut],
  }
}

/**
 * Pointages d'un employé pour aujourd'hui + calcul des heures travaillées.
 * @param db        - Instance D1Database
 * @param employeId - ID de l'employé
 */
export async function pointagesAujourdhui(
  db:        D1Database,
  employeId: number
): Promise<{ pointages: any[]; heures_travaillees: number }> {
  const rows = await db.prepare(`
    SELECT p.*, u.prenom || ' ' || u.nom as valide_par_nom
    FROM   pointages p
    LEFT JOIN users u ON u.id = p.valide_par
    WHERE  p.employe_id = ? AND DATE(p.horodatage) = DATE('now')
    ORDER  BY p.horodatage ASC
  `).bind(employeId).all<any>()

  const pointages = rows.results ?? []

  // Calcul heures hors pauses (en JavaScript — léger, pas de SQL complexe)
  let heuresTravaillees = 0
  let entreeEnPoste: string | null = null

  for (const p of pointages) {
    if (p.statut_apres === 'en_poste') {
      entreeEnPoste = p.horodatage
    } else if ((p.statut_apres === 'pause' || p.statut_apres === 'termine') && entreeEnPoste) {
      heuresTravaillees += (new Date(p.horodatage).getTime() - new Date(entreeEnPoste).getTime()) / 3_600_000
      entreeEnPoste = null
    }
  }
  // Si encore en poste — comptabiliser jusqu'à maintenant
  if (entreeEnPoste) {
    heuresTravaillees += (Date.now() - new Date(entreeEnPoste).getTime()) / 3_600_000
  }

  return {
    pointages,
    heures_travaillees: Math.round(heuresTravaillees * 100) / 100,
  }
}

// ─── Rapport ──────────────────────────────────────────────────────────────────

/**
 * Rapport de présences sur une période (jours présents, premières entrées/sorties).
 * @param db         - Instance D1Database
 * @param boutiqueId - ID de la boutique
 * @param dateDebut  - Date début (YYYY-MM-DD)
 * @param dateFin    - Date fin (YYYY-MM-DD)
 */
export async function rapportPointage(
  db:          D1Database,
  boutiqueId:  number,
  dateDebut:   string,
  dateFin:     string
): Promise<any[]> {
  const rows = await db.prepare(`
    SELECT e.id, e.prenom, e.nom, e.poste,
           COUNT(DISTINCT DATE(p.horodatage)) as jours_presents,
           MIN(p.horodatage)                  as premiere_entree,
           MAX(p.horodatage)                  as derniere_sortie
    FROM   employes e
    LEFT JOIN pointages p ON p.employe_id = e.id
      AND DATE(p.horodatage) BETWEEN ? AND ?
      AND p.statut_apres = 'en_poste'
    WHERE  e.boutique_id = ? AND e.actif = 1
    GROUP  BY e.id
    ORDER  BY e.nom, e.prenom
  `).bind(dateDebut, dateFin, boutiqueId).all<any>()

  return rows.results ?? []
}

/**
 * Statuts temps réel de tous les employés actifs, groupés par statut.
 * @param db         - Instance D1Database
 * @param boutiqueId - ID de la boutique
 */
export async function statutsTempsReel(db: D1Database, boutiqueId: number): Promise<{
  data:    any[]
  resume:  { total: number; en_poste: number; pause: number; absent: number; termine: number }
  details: Record<string, any[]>
}> {
  const rows = await db.prepare(`
    SELECT e.id, e.prenom, e.nom, e.poste, e.statut_pointage,
           p.horodatage as depuis
    FROM   employes e
    LEFT JOIN pointages p ON p.id = (
      SELECT MAX(id) FROM pointages WHERE employe_id = e.id
    )
    WHERE  e.boutique_id = ? AND e.actif = 1
    ORDER  BY e.prenom
  `).bind(boutiqueId).all<any>()

  const data = rows.results ?? []

  const grouped = data.reduce((acc: Record<string, any[]>, e: any) => {
    const key = e.statut_pointage as string
    if (!acc[key]) acc[key] = []
    acc[key].push({ ...e, label: STATUT_LABELS[e.statut_pointage as StatutPointage] })
    return acc
  }, {})

  return {
    data,
    resume: {
      total:    data.length,
      en_poste: grouped['en_poste']?.length ?? 0,
      pause:    grouped['pause']?.length    ?? 0,
      absent:   grouped['absent']?.length   ?? 0,
      termine:  grouped['termine']?.length  ?? 0,
    },
    details: grouped,
  }
}
