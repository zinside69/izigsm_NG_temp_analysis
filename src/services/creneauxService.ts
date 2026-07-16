/**
 * @module services/creneauxService
 * @description Créneaux horaires bookables pour la prise de RDV en ligne (MOD-14).
 *
 * Rôle architectural (P1 Modularité) : service pur, toute logique SQL vit ici.
 * Consommé par `routes/boutiques.ts` (écriture, admin/manager) et
 * `publicService.ts` → `getDisponibilites()` (lecture publique, génère les
 * créneaux réservables à partir de ces plages).
 *
 * Migré vers le port `Database` dès l'écriture (chantier Ports & Adapters,
 * 2026-07-12) — aucune dépendance `auditLog()`/`nextNumero()`/`db.batch()` ici.
 */

import type { Database } from '../ports/database'

export interface CreneauRow {
  id:           number
  boutique_id:  number
  jour_semaine: number  // 1=Lundi … 7=Dimanche (ISO), cohérent avec getDisponibilites()
  heure_debut:  string  // "HH:MM"
  heure_fin:    string  // "HH:MM"
  duree_slot:   number  // minutes
  actif:        number  // 0|1
}

export interface CreneauInput {
  jour_semaine: number
  heure_debut:  string
  heure_fin:    string
  duree_slot:   number
}

const REGEX_HEURE = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Valide une liste de créneaux avant écriture. Ne jette jamais — retourne le
 * premier message d'erreur trouvé, ou `null` si tout est valide.
 * @param creneaux  Liste brute reçue du frontend (non fiable)
 */
export function validateCreneaux(creneaux: CreneauInput[]): string | null {
  for (const cr of creneaux) {
    if (!Number.isInteger(cr.jour_semaine) || cr.jour_semaine < 1 || cr.jour_semaine > 7)
      return 'jour_semaine doit être un entier entre 1 (Lundi) et 7 (Dimanche).'
    if (!REGEX_HEURE.test(cr.heure_debut) || !REGEX_HEURE.test(cr.heure_fin))
      return 'heure_debut/heure_fin doivent être au format "HH:MM".'
    if (cr.heure_debut >= cr.heure_fin)
      return `Plage invalide (${cr.heure_debut}–${cr.heure_fin}) : heure_debut doit précéder heure_fin.`
    if (!Number.isInteger(cr.duree_slot) || cr.duree_slot < 5 || cr.duree_slot > 480)
      return 'duree_slot doit être un entier entre 5 et 480 minutes.'
  }
  return null
}

/**
 * Liste les créneaux configurés pour une boutique, tous jours confondus.
 * @param db          Port Database
 * @param boutiqueId  ID de la boutique
 * @returns           Lignes triées par jour puis heure de début
 */
export async function listCreneaux(db: Database, boutiqueId: number): Promise<CreneauRow[]> {
  return db.all<CreneauRow>(`
    SELECT id, boutique_id, jour_semaine, heure_debut, heure_fin, duree_slot, actif
    FROM boutique_creneaux
    WHERE boutique_id = ?
    ORDER BY jour_semaine ASC, heure_debut ASC
  `, [boutiqueId])
}

/**
 * Remplace intégralement le planning hebdomadaire d'une boutique (delete-then-insert).
 * Choix volontaire plutôt qu'un CRUD ligne par ligne : l'écran de configuration édite
 * toujours le planning complet de la semaine en un seul enregistrement, ce qui rend le
 * remplacement total plus simple et sans risque d'incohérence (doublons, lignes orphelines)
 * qu'un diff partiel. Pas de `db.batch()` (hors du port `Database`) — écrit hors du
 * périmètre NF525, un enchaînement séquentiel de `run()` est suffisant ici.
 * @param db          Port Database
 * @param boutiqueId  ID de la boutique
 * @param creneaux    Planning complet à enregistrer (déjà validé par `validateCreneaux()`)
 */
export async function replaceCreneaux(
  db:         Database,
  boutiqueId: number,
  creneaux:   CreneauInput[]
): Promise<void> {
  await db.run(`DELETE FROM boutique_creneaux WHERE boutique_id = ?`, [boutiqueId])

  for (const cr of creneaux) {
    await db.run(`
      INSERT INTO boutique_creneaux (boutique_id, jour_semaine, heure_debut, heure_fin, duree_slot, actif)
      VALUES (?, ?, ?, ?, ?, 1)
    `, [boutiqueId, cr.jour_semaine, cr.heure_debut, cr.heure_fin, cr.duree_slot])
  }
}
