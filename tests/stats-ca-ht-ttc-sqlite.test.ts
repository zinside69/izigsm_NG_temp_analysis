import { describe, it, expect, beforeEach } from 'vitest'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'
import { D1DatabaseAdapter } from '../src/adapters/cloudflare/d1Database'
import { getKpisDashboard, getCaMensuel } from '../src/services/statsService'
import { todayParis } from '../src/lib/timezone'

/**
 * Chiffre d'affaires en HT et en TTC côte à côte (ticket 11 du chantier prix TTC, décision Q21 de
 * l'exploitant du 2026-10-04) : le tableau de bord et les statistiques n'affichaient que le TTC.
 * Les factures comptées ne changent pas (payées, de la boutique) : seul le HT s'ajoute à côté.
 *
 * Contre un vrai SQLite au schéma réel : la règle est portée par le SQL.
 */

let base: BaseReelle

/** Mois courant et mois précédent, au fuseau de Paris, au format AAAA-MM-JJ (le 10 du mois). */
const ceMois        = todayParis().slice(0, 7) + '-10'
const moisPrecedent = moisAvant(todayParis().slice(0, 7)) + '-10'

/** Mois précédent d'un « AAAA-MM », calculé à part du service testé. */
function moisAvant(anneeMois: string): string {
  const [annee, mois] = anneeMois.split('-').map(Number)
  const estJanvier = mois === 1
  const anneePrecedente = estJanvier ? annee - 1 : annee
  const moisPrecedentNumero = estJanvier ? 12 : mois - 1
  return `${anneePrecedente}-${String(moisPrecedentNumero).padStart(2, '0')}`
}

function facture(id: number, boutique: number, statut: string, dateEmission: string, ht: number, ttc: number) {
  base.sqlite.prepare(`INSERT INTO factures (id, boutique_id, client_id, numero, statut, date_emission, total_ht, total_tva, total_ttc)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, boutique, boutique, `FAC-${id}`, statut, dateEmission, ht, ttc - ht, ttc)
}

beforeEach(() => {
  base = baseAuSchemaReel()
  base.sqlite.exec(`INSERT INTO boutiques (id, nom) VALUES (1, 'B1'), (2, 'B2')`)
  // Un client par boutique, de même identifiant que sa boutique
  base.sqlite.exec(`INSERT INTO clients (id, boutique_id, nom, prenom) VALUES (1, 1, 'Client', 'Un'), (2, 2, 'Client', 'Deux')`)
  // Ce mois, boutique 1 : deux payées (100 HT / 120 TTC et 50 HT / 60 TTC), une annulée, une brouillon
  facture(1, 1, 'payee',    ceMois, 100, 120)
  facture(2, 1, 'payee',    ceMois,  50,  60)
  facture(3, 1, 'annulee',  ceMois, 999, 999)
  facture(4, 1, 'brouillon', ceMois, 888, 888)
  // Émises mais pas payées : hors CA (décision de l'exploitant du 2026-10-04 — factures payées seulement)
  facture(7, 1, 'en_attente',          ceMois, 300, 360)
  facture(8, 1, 'partiellement_payee', ceMois, 400, 480)
  // Mois précédent, boutique 1 : 10 HT / 12 TTC
  facture(5, 1, 'payee', moisPrecedent, 10, 12)
  // Autre boutique : jamais comptée
  facture(6, 2, 'payee', ceMois, 700, 840)
})

describe('getKpisDashboard() — CA du mois en HT et en TTC', () => {
  it('rend le CA du mois et du mois précédent, en TTC et en HT, sur les mêmes factures', async () => {
    const kpis = await getKpisDashboard(new D1DatabaseAdapter(base.d1), 1)
    expect(kpis.ca_mois).toBe(180)
    expect(kpis.ca_mois_ht).toBe(150)
    expect(kpis.ca_mois_precedent).toBe(12)
    expect(kpis.ca_mois_precedent_ht).toBe(10)
  })
})

describe('getCaMensuel() — total 12 mois en HT et en TTC', () => {
  it('rend le total des 12 mois en TTC et en HT', async () => {
    const ca = await getCaMensuel(new D1DatabaseAdapter(base.d1), 1)
    expect(ca.total_12_mois).toBe(192)
    expect(ca.total_12_mois_ht).toBe(160)
  })
})
