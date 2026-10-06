import { describe, it, expect } from 'vitest'
import { validateService } from '../src/lib/validators'

/**
 * Validation d'un service (ticket 04 du chantier prix TTC) : le prix se saisit en TTC ; un ancien écran
 * qui n'envoie que le HT reste accepté pendant la transition. L'un des deux est obligatoire, ≥ 0.
 */
describe('validateService() — prix TTC ou HT', () => {
  it('TTC seul : valide', () => {
    expect(validateService({ nom: 'Pose', prix_ttc: 49.9 })).toBeNull()
  })

  it('HT seul (ancien écran) : valide', () => {
    expect(validateService({ nom: 'Pose', prix_ht: 41.58 })).toBeNull()
  })

  it('TTC envoyé en texte numérique : valide', () => {
    expect(validateService({ nom: 'Pose', prix_ttc: '49.90' })).toBeNull()
  })

  it('aucun prix : refusé', () => {
    expect(validateService({ nom: 'Pose' })).toMatch(/prix/i)
  })

  it('TTC négatif : refusé, même avec un HT valide', () => {
    expect(validateService({ nom: 'Pose', prix_ttc: -1, prix_ht: 10 })).toMatch(/prix/i)
  })

  it('TTC illisible : refusé', () => {
    expect(validateService({ nom: 'Pose', prix_ttc: 'abc' })).toMatch(/prix/i)
  })
})

describe('validateService() — prix vide (revue du ticket 04)', () => {
  it('TTC vide sans HT : refusé (et non un service à 0 €)', () => {
    expect(validateService({ nom: 'Pose', prix_ttc: '' })).toMatch(/prix/i)
  })

  it('TTC vide avec un HT valide (ancien écran) : c\'est le HT qui est contrôlé', () => {
    expect(validateService({ nom: 'Pose', prix_ttc: '', prix_ht: 50 })).toBeNull()
    expect(validateService({ nom: 'Pose', prix_ttc: '', prix_ht: -1 })).toMatch(/prix/i)
  })
})
