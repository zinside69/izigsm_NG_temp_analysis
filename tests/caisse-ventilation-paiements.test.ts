import { describe, it, expect } from 'vitest'
import { ventilerPaiements } from '../src/services/caisseService'

/**
 * Ventilation du paiement d'une vente en caisse (recette 002 B et C, décisions de l'exploitant du
 * 2026-10-03) :
 *  - B : « Mixte » = deux parts, chacune dans n'importe quel mode (espèces, CB, chèque, virement),
 *    modes différents, somme égale au total TTC au centime près ;
 *  - C : le montant remis en espèces et le rendu sont conservés, sur la part en espèces.
 *
 * `ventilerPaiements()` est une fonction pure : elle décide des lignes `paiements` à écrire, ou
 * refuse, AVANT toute écriture de `createVente()` (un refus ne doit consommer aucun numéro).
 */

describe('ventilerPaiements — paiement simple', () => {
  it('CB : une part du montant total, sans remis ni rendu', () => {
    expect(ventilerPaiements({ mode_paiement: 'cb' }, 264)).toEqual([
      { mode_paiement: 'cb', montant: 264, montant_remis: null, rendu_monnaie: null },
    ])
  })

  it('espèces avec 300 remis pour 264 : rendu 36, gardés sur la part', () => {
    expect(ventilerPaiements({ mode_paiement: 'especes', montant_especes: 300 }, 264)).toEqual([
      { mode_paiement: 'especes', montant: 264, montant_remis: 300, rendu_monnaie: 36 },
    ])
  })

  it('espèces sans montant remis : ni remis ni rendu', () => {
    expect(ventilerPaiements({ mode_paiement: 'especes' }, 26.68)).toEqual([
      { mode_paiement: 'especes', montant: 26.68, montant_remis: null, rendu_monnaie: null },
    ])
  })

  it('montant remis inférieur au montant dû en espèces : refusé', () => {
    expect(() => ventilerPaiements({ mode_paiement: 'especes', montant_especes: 200 }, 264))
      .toThrow(/remis/i)
  })

  it('montant remis alors que rien n\'est payé en espèces : refusé', () => {
    expect(() => ventilerPaiements({ mode_paiement: 'cb', montant_especes: 300 }, 264))
      .toThrow(/espèces/i)
  })

  it('des parts envoyées hors du mode « mixte » : refusé', () => {
    expect(() => ventilerPaiements({ mode_paiement: 'cb', paiements: [{ mode_paiement: 'cb', montant: 264 }] }, 264))
      .toThrow(/mixte/i)
  })
})

describe('ventilerPaiements — mixte (deux parts)', () => {
  it('espèces 100 + CB 164 pour 264 : deux parts, remis et rendu sur la part espèces', () => {
    expect(ventilerPaiements({
      mode_paiement: 'mixte',
      paiements: [{ mode_paiement: 'especes', montant: 100 }, { mode_paiement: 'cb', montant: 164 }],
      montant_especes: 120,
    }, 264)).toEqual([
      { mode_paiement: 'especes', montant: 100, montant_remis: 120, rendu_monnaie: 20 },
      { mode_paiement: 'cb',      montant: 164, montant_remis: null, rendu_monnaie: null },
    ])
  })

  it('chèque + virement : toute combinaison de deux modes', () => {
    expect(ventilerPaiements({
      mode_paiement: 'mixte',
      paiements: [{ mode_paiement: 'cheque', montant: 50.5 }, { mode_paiement: 'virement', montant: 49.5 }],
    }, 100).map(p => p.mode_paiement)).toEqual(['cheque', 'virement'])
  })

  it('somme différente du total, même d\'un centime : refusé', () => {
    expect(() => ventilerPaiements({
      mode_paiement: 'mixte',
      paiements: [{ mode_paiement: 'especes', montant: 100 }, { mode_paiement: 'cb', montant: 163.99 }],
    }, 264)).toThrow(/total/i)
  })

  it('arrondis flottants : 0,1 + 0,2 pour 0,30 est accepté (comparaison en centimes)', () => {
    expect(ventilerPaiements({
      mode_paiement: 'mixte',
      paiements: [{ mode_paiement: 'especes', montant: 0.1 }, { mode_paiement: 'cb', montant: 0.2 }],
    }, 0.3)).toHaveLength(2)
  })

  it.each([
    ['une seule part',          [{ mode_paiement: 'cb', montant: 264 }]],
    ['trois parts',             [{ mode_paiement: 'cb', montant: 100 }, { mode_paiement: 'cheque', montant: 100 }, { mode_paiement: 'especes', montant: 64 }]],
    ['deux fois le même mode',  [{ mode_paiement: 'cb', montant: 100 }, { mode_paiement: 'cb', montant: 164 }]],
    ['un mode inconnu',         [{ mode_paiement: 'bitcoin', montant: 100 }, { mode_paiement: 'cb', montant: 164 }]],
    ['« mixte » comme part',    [{ mode_paiement: 'mixte', montant: 100 }, { mode_paiement: 'cb', montant: 164 }]],
    ['une part à 0',            [{ mode_paiement: 'especes', montant: 0 }, { mode_paiement: 'cb', montant: 264 }]],
    ['une part négative',       [{ mode_paiement: 'especes', montant: -10 }, { mode_paiement: 'cb', montant: 274 }]],
    ['aucune part',             undefined],
  ])('%s : refusé', (_cas, paiements) => {
    expect(() => ventilerPaiements({ mode_paiement: 'mixte', paiements: paiements as any }, 264)).toThrow()
  })

  it('montant remis sur un mixte sans espèces : refusé', () => {
    expect(() => ventilerPaiements({
      mode_paiement: 'mixte',
      paiements: [{ mode_paiement: 'cb', montant: 100 }, { mode_paiement: 'cheque', montant: 164 }],
      montant_especes: 120,
    }, 264)).toThrow(/espèces/i)
  })
})
