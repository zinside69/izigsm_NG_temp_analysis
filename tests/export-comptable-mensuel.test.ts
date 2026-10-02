import { describe, it, expect, beforeEach } from 'vitest'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'
import { D1DatabaseAdapter } from '../src/adapters/cloudflare/d1Database'
import {
  agregerEncaissementsMensuels,
  lireEncaissementsPeriode,
  type EncaissementBrut,
} from '../src/services/statsService'
import { construireXlsx } from '../src/lib/xlsx'
import { construireOngletsComptables, libellePeriode } from '../src/services/exportComptableService'

/**
 * Export comptable Excel — onglet « Mensuel » (ticket 001 `export-comptable-mensuel`, 2026-10-02).
 *
 * Base : les ENCAISSEMENTS (`paiements`), à leur date en heure de Paris, dans leur mode réel.
 * Observé : l'agrégat rendu (fonction pure) et ce que la lecture rend sur un vrai SQLite.
 */

/** Encaissement de test : facture à une ligne au taux donné. */
function enc(date_paiement: string, montant: number, mode: string | null, taux = 20): EncaissementBrut {
  const ht = Math.round((montant / (1 + taux / 100)) * 100) / 100
  return {
    id: Math.floor(Math.random() * 1e9), date_paiement, montant, mode_paiement: mode,
    facture_numero: 'FAC-TEST', client: 'Comptoir',
    facture_ht: ht, facture_ttc: montant,
    lignes: [{ taux, ht, tva: Math.round((montant - ht) * 100) / 100 }],
  }
}

describe('agregerEncaissementsMensuels() — un jour par date de Paris, une colonne par mode', () => {
  it('une ligne par jour de la période, jours sans encaissement compris', () => {
    const m = agregerEncaissementsMensuels([], '2026-09-01', '2026-09-30')
    expect(m.jours).toHaveLength(30)
    expect(m.jours[0].date).toBe('2026-09-01')
    expect(m.jours[29].date).toBe('2026-09-30')
    expect(m.jours.every(j => j.nb === 0 && j.ttc === 0)).toBe(true)
  })

  it('le jour est celui de Paris : 21:30 UTC le 30/09 = 23:30 à Paris → 30/09 ; 22:30 UTC → 01/10, hors période', () => {
    const m = agregerEncaissementsMensuels([
      enc('2026-09-30 21:30:00', 10, 'cb'),
      enc('2026-09-30 22:30:00', 99, 'cb'),
    ], '2026-09-01', '2026-09-30')
    const j30 = m.jours.find(j => j.date === '2026-09-30')!
    expect(j30.modes.cb).toBe(10)
    expect(m.total.ttc).toBe(10)
  })

  it('« CB » et « cb » vont dans la même colonne ; « mixte » a la sienne ; un mode inconnu va dans « Autre »', () => {
    const m = agregerEncaissementsMensuels([
      enc('2026-09-09 08:00:00', 12, 'CB'),
      enc('2026-09-09 09:00:00', 20, 'cb'),
      enc('2026-09-09 10:00:00', 30, 'mixte'),
      enc('2026-09-09 11:00:00', 5, 'stripe'),
      enc('2026-09-09 12:00:00', 24.9, ' Especes '),
    ], '2026-09-01', '2026-09-30')
    const j = m.jours.find(x => x.date === '2026-09-09')!
    expect(j.modes.cb).toBe(32)
    expect(j.modes.mixte).toBe(30)
    expect(j.modes.autre).toBe(5)
    expect(j.modes.especes).toBe(24.9)
    expect(j.nb).toBe(5)
    expect(m.colonnes).toEqual(['especes', 'cb', 'cheque', 'virement', 'mixte', 'autre'])
  })

  it('« Mixte » et « Autre » n\'apparaissent que s\'ils servent sur la période', () => {
    const m = agregerEncaissementsMensuels([enc('2026-09-09 08:00:00', 12, 'cb')], '2026-09-01', '2026-09-30')
    expect(m.colonnes).toEqual(['especes', 'cb', 'cheque', 'virement'])
  })

  it('HT + TVA = TTC au centime, chaque jour et au total ; total = somme des jours', () => {
    const m = agregerEncaissementsMensuels([
      enc('2026-09-02 08:00:00', 33.33, 'cb'),
      enc('2026-09-02 09:00:00', 0.01, 'especes'),
      enc('2026-09-03 08:00:00', 19.99, 'cheque', 5.5),
    ], '2026-09-01', '2026-09-30')
    for (const j of m.jours) expect(Math.round((j.ht + j.tva) * 100)).toBe(Math.round(j.ttc * 100))
    expect(Math.round((m.total.ht + m.total.tva) * 100)).toBe(Math.round(m.total.ttc * 100))
    expect(m.total.ttc).toBe(53.33)
    expect(m.total.nb).toBe(3)
  })

  it('un paiement partiel prend le HT au prorata de sa facture ; TVA collectée par taux', () => {
    const p: EncaissementBrut = {
      id: 1, date_paiement: '2026-09-10 08:00:00', montant: 60, mode_paiement: 'cb',
      facture_numero: 'FAC-1', client: 'X', facture_ht: 100, facture_ttc: 120,
      lignes: [{ taux: 20, ht: 100, tva: 20 }],
    }
    const m = agregerEncaissementsMensuels([p], '2026-09-01', '2026-09-30')
    expect(m.total.ht).toBe(50)
    expect(m.total.tva).toBe(10)
    expect(m.tvaParTaux).toEqual([{ taux: 20, ht: 50, tva: 10 }])
  })

  it('l\'onglet Encaissements reprend chaque paiement, heure de Paris, et sa somme égale le total', () => {
    const m = agregerEncaissementsMensuels([
      enc('2026-09-09 08:12:00', 24.9, 'especes'),
      enc('2026-09-09 13:40:00', 20, 'cb'),
    ], '2026-09-01', '2026-09-30')
    expect(m.encaissements.map(e => e.heure)).toEqual(['10:12', '15:40'])
    expect(m.encaissements.reduce((s, e) => s + e.ttc, 0)).toBeCloseTo(m.total.ttc, 2)
  })
})

describe('lireEncaissementsPeriode() — vrai SQLite au schéma réel', () => {
  let base: BaseReelle
  beforeEach(() => {
    base = baseAuSchemaReel()
    const s = base.sqlite
    s.exec(`INSERT INTO boutiques (id, nom, slug) VALUES (1, 'B1', 'b1'), (2, 'B2', 'b2')`)
    s.exec(`INSERT INTO clients (id, boutique_id, nom, prenom) VALUES (1, 1, 'Comptoir', 'Client'), (2, 2, 'Autre', 'Client')`)
    s.exec(`INSERT INTO users (id, email, password_hash, prenom, nom, role_id, boutique_id, actif)
            VALUES (1, 'vendeur@b1.fr', 'x', 'Ven', 'Deur', 2, 1, 1)`)
    s.exec(`INSERT INTO factures (id, boutique_id, client_id, numero, total_ht, total_tva, total_ttc, statut)
            VALUES (1, 1, 1, 'FAC-1', 20.75, 4.15, 24.9, 'payee'), (2, 2, 2, 'FAC-2', 100, 20, 120, 'payee')`)
    s.exec(`INSERT INTO lignes_document (document_type, document_id, ordre, description, quantite, prix_unitaire_ht, tva_taux, total_ht, total_tva, total_ttc)
            VALUES ('facture', 1, 1, 'Coque', 1, 20.75, 20, 20.75, 4.15, 24.9), ('facture', 2, 1, 'Ecran', 1, 100, 20, 100, 20, 120)`)
    s.exec(`INSERT INTO paiements (facture_id, boutique_id, montant, mode_paiement, date_paiement, user_id)
            VALUES (1, 1, 24.9, 'especes', '2026-09-09 08:12:00', 1),
                   (2, 2, 120, 'cb', '2026-09-09 09:00:00', 1),
                   (1, 1, 5, 'cb', '2026-08-31 21:59:00', 1)`)
  })

  it('ne lit que la boutique demandée, avec facture, client et lignes', async () => {
    const lus = await lireEncaissementsPeriode(new D1DatabaseAdapter(base.d1), 1, '2026-09-01', '2026-09-30')
    const sept = agregerEncaissementsMensuels(lus, '2026-09-01', '2026-09-30')
    expect(sept.total.ttc).toBe(24.9)
    expect(sept.encaissements[0].facture_numero).toBe('FAC-1')
    expect(sept.encaissements[0].client).toContain('Comptoir')
    expect(sept.tvaParTaux).toEqual([{ taux: 20, ht: 20.75, tva: 4.15 }])
  })

  it('un paiement de 23:59 à Paris le 31/08 (21:59 UTC) n\'entre pas en septembre', async () => {
    const lus = await lireEncaissementsPeriode(new D1DatabaseAdapter(base.d1), 1, '2026-09-01', '2026-09-30')
    expect(agregerEncaissementsMensuels(lus, '2026-09-01', '2026-09-30').total.nb).toBe(1)
  })
})

describe('construireOngletsComptables() — trois onglets, Mensuel lisible', () => {
  const m = agregerEncaissementsMensuels([
    enc('2026-09-09 08:12:00', 24.9, 'especes'),
    enc('2026-09-09 13:40:00', 20, 'cb'),
    enc('2026-09-10 09:00:00', 30, 'mixte'),
  ], '2026-09-01', '2026-09-30')
  const onglets = construireOngletsComptables(m, [{ numero: 'FAC-1', total_ttc: 24.9, date_emission: '2026-09-09' }],
    [{ key: 'numero', label: 'N° Facture' }, { key: 'date_emission', label: 'Date émission' }, { key: 'total_ttc', label: 'TTC' }],
    { boutique: 'SOTELI', ville: 'Beynost', du: '2026-09-01', au: '2026-09-30', genereLe: '02/10/2026 à 10:00' })
  const texte = (o: number) => JSON.stringify(onglets[o].lignes)

  it('trois onglets nommés : Mensuel, Encaissements, Factures payées', () => {
    expect(onglets.map(o => o.nom)).toEqual(['Mensuel', 'Encaissements', 'Factures payées'])
  })

  it('Mensuel : période en clair, 30 jours, ligne TOTAL, colonne Mixte avec sa note', () => {
    expect(texte(0)).toContain('Encaissements — Septembre 2026')
    expect(texte(0)).toContain('SOTELI — Beynost')
    expect(texte(0)).toContain('mer. 09/09/2026')   // le 09/09/2026 est un mercredi
    expect(texte(0)).toContain('Mixte *')
    expect(texte(0)).toContain('la part espèces / CB n\'est pas enregistrée')
    const total = onglets[0].lignes.find(l => l[0]?.v === 'TOTAL')!
    expect(total.some(c => c.v === 74.9)).toBe(true)
  })

  it('un mois partiel est libellé « du … au … »', () => {
    expect(libellePeriode('2026-09-01', '2026-09-15')).toBe('du 01/09/2026 au 15/09/2026')
    expect(libellePeriode('2026-02-01', '2026-02-28')).toBe('Février 2026')
  })

  it('Encaissements : une ligne par paiement et un total égal au Mensuel', () => {
    expect(texte(1)).toContain('"v":"10:12"')
    const total = onglets[1].lignes.at(-1)!
    expect(total.some(c => c.v === 74.9)).toBe(true)
  })

  it('Factures payées : montant en nombre, date en JJ/MM/AAAA', () => {
    expect(texte(2)).toContain('"v":24.9')
    expect(texte(2)).toContain('09/09/2026')
  })
})

describe('construireXlsx() — archive .xlsx lisible', () => {
  /** Décompresse une archive ZIP sans compression (méthode 0) : nom → contenu texte. */
  function lireZip(octets: Uint8Array): Record<string, string> {
    const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength)
    const fichiers: Record<string, string> = {}
    let i = 0
    while (i + 30 <= octets.length && vue.getUint32(i, true) === 0x04034b50) {
      const methode = vue.getUint16(i + 8, true)
      const taille  = vue.getUint32(i + 18, true)
      const lnom    = vue.getUint16(i + 26, true)
      const lext    = vue.getUint16(i + 28, true)
      const nom     = new TextDecoder().decode(octets.subarray(i + 30, i + 30 + lnom))
      const debut   = i + 30 + lnom + lext
      expect(methode).toBe(0)
      fichiers[nom] = new TextDecoder().decode(octets.subarray(debut, debut + taille))
      i = debut + taille
    }
    return fichiers
  }

  const octets = construireXlsx([
    { nom: 'Mensuel', lignes: [[{ v: 'Date', style: 'entete' }, { v: 'CB', style: 'entete' }],
                                [{ v: 'mar. 09/09' }, { v: 377.7, style: 'euro' }],
                                [{ v: 'TOTAL', style: 'gras' }, { v: 377.7, style: 'euroGras' }]] },
    { nom: 'Encaissements', lignes: [[{ v: 'A & <B>' }]] },
  ])

  it('commence par la signature ZIP et contient les parties attendues', () => {
    expect(octets[0]).toBe(0x50); expect(octets[1]).toBe(0x4b)
    const f = lireZip(octets)
    for (const p of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels',
                     'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'])
      expect(Object.keys(f)).toContain(p)
  })

  it('les onglets sont nommés, les montants sont des nombres, le texte est échappé', () => {
    const f = lireZip(octets)
    expect(f['xl/workbook.xml']).toContain('name="Mensuel"')
    expect(f['xl/workbook.xml']).toContain('name="Encaissements"')
    // Nombre : cellule sans t="inlineStr", valeur dans <v>
    expect(f['xl/worksheets/sheet1.xml']).toMatch(/<c r="B2"[^>]*><v>377\.7<\/v><\/c>/)
    expect(f['xl/worksheets/sheet2.xml']).toContain('A &amp; &lt;B&gt;')
  })
})
