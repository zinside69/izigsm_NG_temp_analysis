/**
 * @module journalPlateformeService
 * @description Journal des actions de l'admin plateforme sur une boutique cliente.
 *
 * Registre **distinct** de l'`audit_logs` de la boutique visée, conformément à
 * `docs/adr/0001-journal-separe-actions-plateforme.md` : le client doit pouvoir savoir ce qui
 * a été fait sur ses données, en particulier sur une facture en cas de litige.
 *
 * Alimenté par `journalPlateformeMiddleware` (`src/lib/middleware.ts`), jamais par les routes :
 * les 77 appels dispersés à `auditLog()` ne passent par aucun point unique et laisseraient des
 * trous — c'est la leçon des trois campagnes successives de correction d'isolation.
 *
 * Principe directeur : **complétude avant précision**. Une action dont la boutique visée n'a pas
 * pu être déterminée est enregistrée quand même, cible nulle. Ne jamais taire une ligne faute de
 * pouvoir la qualifier.
 *
 * Fonction exportée :
 *   - `enregistrerActionPlateforme()` : expurge le corps de requête, puis écrit la ligne
 *
 * L'expurgation est faite **ici**, jamais par l'appelant : un futur appelant ne peut donc pas
 * l'oublier et faire entrer un secret dans le registre.
 */

import type { Database } from '../ports/database'

// ─── Constantes ───────────────────────────────────────────────────────────────

/** Longueur maximale de la capture du corps de requête, en caractères. */
const LONGUEUR_MAX_CORPS = 2000

/** Remplace la valeur d'un champ sensible — jamais le secret lui-même. */
const VALEUR_EXPURGEE = '[expurgé]'

/** Marqueur ajouté à une capture tronquée, pour qu'une lecture ne s'y trompe pas. */
const MARQUEUR_TRONCATURE = '…[tronqué]'

/**
 * Champs dont la valeur ne doit jamais atteindre le journal, reconnus par **inclusion**
 * dans le nom de la clé (`nouveau_mot_de_passe` comme `password_hash`).
 */
const MOTIFS_SENSIBLES = [
  'password', 'mot_de_passe', 'motdepasse', 'token', 'secret',
  'deverrouillage', 'code_sim',
]

/**
 * Champs sensibles reconnus par **égalité stricte** — leur nom est trop court pour une
 * recherche par inclusion (`pin` apparaîtrait dans `shipping`).
 */
const CLES_SENSIBLES_EXACTES = ['pin', 'mdp']

// ─── Types ────────────────────────────────────────────────────────────────────

/** Une ligne du journal, telle que le middleware la connaît. */
export interface ActionPlateforme {
  /** Auteur : l'admin plateforme. Aucune clé étrangère vers `users` (ADR 0001). */
  user_id:     number
  /** Boutique visée, ou `null` si elle n'a pas pu être résolue. */
  boutique_id: number | null
  methode:     string
  chemin:      string
  statut_http: number
  /** Corps de requête **brut** (déjà parsé) — expurgé et tronqué ici même, jamais par l'appelant. */
  corps:       unknown
  ip_address:  string | null
}

// ─── Expurgation du corps de requête ──────────────────────────────────────────

/** Vrai si la valeur de cette clé est un secret à ne jamais journaliser. */
function estCleSensible(cle: string): boolean {
  const normalisee = cle.toLowerCase()
  return CLES_SENSIBLES_EXACTES.includes(normalisee)
      || MOTIFS_SENSIBLES.some((motif) => normalisee.includes(motif))
}

/** Remplace récursivement toute valeur portée par une clé sensible. */
function expurger(valeur: unknown): unknown {
  if (Array.isArray(valeur)) return valeur.map(expurger)
  if (valeur === null || typeof valeur !== 'object') return valeur

  const sortie: Record<string, unknown> = {}
  for (const [cle, v] of Object.entries(valeur as Record<string, unknown>)) {
    sortie[cle] = estCleSensible(cle) ? VALEUR_EXPURGEE : expurger(v)
  }
  return sortie
}

/**
 * Transforme un corps de requête déjà parsé en capture journalisable :
 * secrets remplacés, sérialisation JSON, troncature à `LONGUEUR_MAX_CORPS`.
 *
 * @param corps Corps de requête parsé (`undefined`/`null` si absent ou illisible)
 * @returns     Chaîne prête à écrire, ou `null` s'il n'y a rien à journaliser
 */
function expurgerCorps(corps: unknown): string | null {
  if (corps === undefined || corps === null) return null

  let serialise: string
  try {
    serialise = JSON.stringify(expurger(corps))
  } catch {
    return null   // structure non sérialisable (cycle) — pas de raison de faire échouer la ligne
  }
  if (!serialise) return null

  return serialise.length > LONGUEUR_MAX_CORPS
    ? serialise.slice(0, LONGUEUR_MAX_CORPS) + MARQUEUR_TRONCATURE
    : serialise
}

// ─── Écriture ─────────────────────────────────────────────────────────────────

/**
 * Écrit une ligne dans le journal des actions de plateforme.
 *
 * L'appelant est responsable du caractère non bloquant de cet appel : le middleware le
 * confie à `executionCtx.waitUntil()`. Un échec d'écriture ne doit jamais faire échouer la
 * requête métier — le registre est un moyen de preuve, pas une condition de service.
 *
 * @param db     Port `Database`
 * @param action Ligne à écrire
 */
export async function enregistrerActionPlateforme(db: Database, action: ActionPlateforme): Promise<void> {
  await db.run(
    `INSERT INTO journal_actions_plateforme
       (user_id, boutique_id, methode, chemin, statut_http, corps_expurge, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      action.user_id,
      action.boutique_id,
      action.methode,
      action.chemin,
      action.statut_http,
      expurgerCorps(action.corps),
      action.ip_address,
    ]
  )
}
