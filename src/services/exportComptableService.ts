/**
 * services/exportComptableService.ts — Export comptable Excel (ticket 001 `export-comptable-mensuel`,
 * décisions de l'exploitant du 2026-10-02).
 *
 * Met en page trois onglets à partir de données déjà agrégées (`statsService.ts`) :
 *   - « Mensuel »         : une ligne par jour, encaissements par mode, total, HT, TVA, nombre ;
 *                           ligne TOTAL, part de chaque mode, TVA collectée par taux ;
 *   - « Encaissements »   : une ligne par paiement — sa somme égale le total du Mensuel ;
 *   - « Factures payées » : le contenu du CSV « CA » (base différente : date d'émission).
 *
 * Aucune lecture en base ici : fonctions pures, testées sans réseau. ⊥ fond de caisse, ⊥ remises en
 * banque (chantier distinct, décision 1).
 *
 * @module services/exportComptableService
 */

import type { Cellule, Onglet } from '../lib/xlsx'
import type { ExportMensuel, ModeEncaissement } from './statsService'

/** Libellés de colonne des modes. `mixte` porte un astérisque renvoyant à la note de bas de page. */
const LIBELLES_MODE: Record<ModeEncaissement, string> = {
  especes: 'Espèces', cb: 'CB', cheque: 'Chèque', virement: 'Virement', mixte: 'Mixte *', autre: 'Autre',
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre',
  'octobre', 'novembre', 'décembre']

/** « 2026-09-09 » → « 09/09/2026 ». */
const dateFr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/** « 2026-09-09 » → « mar. 09/09/2026 » (jour calculé sans fuseau, date calendaire). */
function jourFr(iso: string): string {
  const jour = new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'short', timeZone: 'UTC' })
  return `${jour} ${dateFr(iso)}`
}

/** Dernier jour du mois de `iso`. */
function finDuMois(iso: string): string {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0))
  return d.toISOString().slice(0, 10)
}

/** Libellé de la période : « Septembre 2026 » pour un mois entier, sinon « du … au … ». */
export function libellePeriode(du: string, au: string): string {
  if (du.slice(8) === '01' && au === finDuMois(du)) {
    const mois = MOIS[Number(du.slice(5, 7)) - 1]
    return `${mois.charAt(0).toUpperCase()}${mois.slice(1)} ${du.slice(0, 4)}`
  }
  return `du ${dateFr(du)} au ${dateFr(au)}`
}

/** Montant en euros, ou cellule vide quand il vaut 0 (un tableau de zéros ne se lit pas). */
const montant = (v: number, style: 'euro' | 'euroGras' | 'euroGrise' = 'euro'): Cellule =>
  ({ v: v === 0 ? null : v, style })

const pourcent = (part: number, total: number) =>
  total ? `${(Math.round((part / total) * 1000) / 10).toLocaleString('fr-FR')} %` : '—'

export interface EnteteExport {
  boutique: string
  ville?:   string | null
  du:       string
  au:       string
  genereLe: string   // « 02/10/2026 à 10:42 », heure de Paris
}

/**
 * Construit les trois onglets de l'export comptable.
 * @param m        Agrégat des encaissements (`agregerEncaissementsMensuels()`)
 * @param factures Lignes de `lireFacturesPayeesPeriode()`
 * @param colonnesFactures Colonnes du CSV « CA » (`COLONNES_FACTURES_PAYEES`)
 */
export function construireOngletsComptables(
  m:                ExportMensuel,
  factures:         Record<string, any>[],
  colonnesFactures: { key: string; label: string }[],
  entete:           EnteteExport,
): Onglet[] {
  const periode = libellePeriode(entete.du, entete.au)
  const lieu = [entete.boutique, entete.ville].filter(Boolean).join(' — ')

  // ── Mensuel ────────────────────────────────────────────────────────────────
  const modes = m.colonnes
  const enteteMensuel: Cellule[] = [
    { v: 'Date', style: 'entete' },
    ...modes.map(md => ({ v: LIBELLES_MODE[md], style: 'entete' as const })),
    { v: 'TOTAL TTC', style: 'entete' }, { v: 'dont HT', style: 'entete' },
    { v: 'dont TVA', style: 'entete' }, { v: 'Nb', style: 'entete' },
  ]
  const lignesJours: Cellule[][] = m.jours.map(j => {
    const vide = j.nb === 0
    return [
      { v: jourFr(j.date), style: vide ? 'grise' : 'normal' },
      ...modes.map(md => montant(j.modes[md], vide ? 'euroGrise' : 'euro')),
      montant(j.ttc, vide ? 'euroGrise' : 'euroGras'),
      montant(j.ht, vide ? 'euroGrise' : 'euro'),
      montant(j.tva, vide ? 'euroGrise' : 'euro'),
      { v: vide ? null : j.nb, style: vide ? 'grise' : 'entier' },
    ]
  })
  const ligneTotal: Cellule[] = [
    { v: 'TOTAL', style: 'gras' },
    ...modes.map(md => ({ v: m.total.modes[md], style: 'euroGras' as const })),
    { v: m.total.ttc, style: 'euroGras' }, { v: m.total.ht, style: 'euroGras' },
    { v: m.total.tva, style: 'euroGras' }, { v: m.total.nb, style: 'entierGras' },
  ]
  const lignePart: Cellule[] = [
    { v: 'Part du total', style: 'note' },
    ...modes.map(md => ({ v: pourcent(m.total.modes[md], m.total.ttc), style: 'note' as const })),
  ]
  const joursActifs = m.jours.filter(j => j.nb > 0).length
  const synthese: Cellule[][] = [
    [{ v: 'Encaissé sur la période', style: 'gras' }, { v: m.total.ttc, style: 'euroGras' }],
    [{ v: 'Jours avec encaissement' }, { v: joursActifs, style: 'entier' }],
    [{ v: 'Moyenne par jour ouvré' }, { v: joursActifs ? Math.round((m.total.ttc / joursActifs) * 100) / 100 : null, style: 'euro' }],
  ]
  const tva: Cellule[][] = [
    [{ v: 'TVA collectée', style: 'entete' }, { v: 'Base HT', style: 'entete' }, { v: 'TVA', style: 'entete' }],
    ...m.tvaParTaux.map(t => [
      { v: `${t.taux.toLocaleString('fr-FR')} %` }, { v: t.ht, style: 'euro' as const }, { v: t.tva, style: 'euro' as const },
    ] as Cellule[]),
    [{ v: 'Total', style: 'gras' }, { v: m.total.ht, style: 'euroGras' }, { v: m.total.tva, style: 'euroGras' }],
  ]
  const notes: Cellule[][] = [
    [{ v: 'Montants TTC encaissés, au jour de l\'encaissement (heure de Paris). HT et TVA au prorata de la facture réglée.', style: 'note' }],
    ...(modes.includes('mixte')
      ? [[{ v: '* Paiement mixte en caisse : la part espèces / CB n\'est pas enregistrée par iziGSM, le montant est donc présenté à part.', style: 'note' as const }]]
      : []),
    [{ v: `Document généré par iziGSM le ${entete.genereLe}.`, style: 'note' }],
  ]

  const mensuel: Onglet = {
    nom: 'Mensuel',
    lignes: [
      [{ v: `Encaissements — ${periode}`, style: 'titre' }],
      [{ v: lieu, style: 'note' }],
      [],
      ...synthese,
      [],
      enteteMensuel,
      ...lignesJours,
      ligneTotal,
      lignePart,
      [],
      ...tva,
      [],
      ...notes,
    ],
    largeurs: [20, ...modes.map(() => 13), 14, 13, 12, 7],
  }

  // ── Encaissements ──────────────────────────────────────────────────────────
  const encaissements: Onglet = {
    nom: 'Encaissements',
    lignes: [
      [{ v: `Détail des encaissements — ${periode}`, style: 'titre' }],
      [{ v: lieu, style: 'note' }],
      [],
      ['Date', 'Heure', 'N° facture', 'Client', 'Mode', 'Montant TTC', 'HT', 'TVA'].map(v => ({ v, style: 'entete' as const })),
      ...m.encaissements.map(e => [
        { v: dateFr(e.date) }, { v: e.heure }, { v: e.facture_numero }, { v: e.client },
        { v: LIBELLES_MODE[e.mode].replace(' *', '') },
        { v: e.ttc, style: 'euro' as const }, { v: e.ht, style: 'euro' as const }, { v: e.tva, style: 'euro' as const },
      ] as Cellule[]),
      [{ v: 'TOTAL', style: 'gras' }, { v: null, style: 'gras' }, { v: null, style: 'gras' }, { v: null, style: 'gras' },
       { v: `${m.total.nb} encaissement${m.total.nb > 1 ? 's' : ''}`, style: 'gras' },
       { v: m.total.ttc, style: 'euroGras' }, { v: m.total.ht, style: 'euroGras' }, { v: m.total.tva, style: 'euroGras' }],
    ],
    largeurs: [12, 8, 18, 28, 11, 14, 12, 12],
    figerLignes: 4,
  }

  // ── Factures payées (CSV « CA ») ───────────────────────────────────────────
  const numeriques = new Set(['total_ht', 'total_tva', 'total_ttc'])
  const facturesOnglet: Onglet = {
    nom: 'Factures payées',
    lignes: [
      [{ v: `Factures payées — ${periode} (date d'émission)`, style: 'titre' }],
      [{ v: lieu, style: 'note' }],
      [],
      colonnesFactures.map(c => ({ v: c.label, style: 'entete' as const })),
      ...factures.map(f => colonnesFactures.map(c => {
        const v = f[c.key]
        if (numeriques.has(c.key)) return { v: v === null || v === undefined ? null : Number(v), style: 'euro' as const }
        if (c.key.startsWith('date_') && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return { v: dateFr(v) }
        return { v: v ?? null }
      }) as Cellule[]),
    ],
    largeurs: colonnesFactures.map(c => (c.key === 'client' || c.key === 'client_email' || c.key === 'notes' ? 26 : 14)),
    figerLignes: 4,
  }

  return [mensuel, encaissements, facturesOnglet]
}
