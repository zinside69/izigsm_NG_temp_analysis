/**
 * @file tests/ticket-appareil-sqlite.test.ts
 * @description Résolution de l'appareil à la prise en charge (ticket 08a) — contre un vrai
 * SQLite au schéma réel. La règle vit dans le SQL (recherche par client + IMEI, dédoublonnage
 * par id) : un mock qui renvoie ce qu'on lui configure ne la prouve pas (CLAUDE.md § Bons de
 * commande).
 *
 * Couvre `resoudreAppareilTicket()` (validations + résolution) et la garantie réelle de
 * `createTicket()` : aucun appareil orphelin sur échec de validation, et un échec d'écriture
 * APRÈS la création d'un appareil laisse un orphelin accepté (retrouvé et réutilisé à la
 * saisie suivante pour le même client et le même IMEI).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { baseAuSchemaReel, type BaseReelle } from './helpers/d1Sqlite'
import { resoudreAppareilTicket, createTicket } from '../src/services/ticketService'

const IMEI       = '356938035643809'
const IMEI_FAUX  = '356938035643800'  // même chiffres, clé de Luhn fausse

let base: BaseReelle
beforeEach(() => {
  base = baseAuSchemaReel()
  base.sqlite.exec(`
    INSERT INTO boutiques (id, nom) VALUES (1, 'Boutique 1'), (2, 'Boutique 2');
    INSERT INTO clients (id, boutique_id, prenom, nom) VALUES
      (7, 1, 'Marie', 'Dupont'),
      (8, 1, 'Jean', 'Martin'),
      (9, 2, 'Autre', 'Boutique');
    INSERT INTO users (id, email, password_hash, prenom, nom, role_id, boutique_id, actif)
      VALUES (50, 'tech@boutique1.fr', 'x', 'Tech', 'Un', 2, 1, 1),
             (60, 'tech@boutique2.fr', 'x', 'Tech', 'Deux', 2, 2, 1);
  `)
})

function nbAppareils(): number {
  return (base.sqlite.prepare('SELECT COUNT(*) AS n FROM appareils').get() as any).n
}

describe('resoudreAppareilTicket()', () => {
  it('champ vide → null, aucune ligne appareils créée', async () => {
    const id = await resoudreAppareilTicket(base.d1, {
      boutiqueId: 1, clientId: 7, marque: 'Apple', modele: 'iPhone 14', imeiOuSerie: '  ',
    })
    expect(id).toBeNull()
    expect(nbAppareils()).toBe(0)
  })

  it('IMEI valide absent de la base → crée une fiche appareil', async () => {
    const id = await resoudreAppareilTicket(base.d1, {
      boutiqueId: 1, clientId: 7, marque: 'Apple', modele: 'iPhone 14', imeiOuSerie: IMEI,
    })
    expect(id).not.toBeNull()
    const row = base.sqlite.prepare('SELECT client_id, marque, modele, imei, numero_serie FROM appareils WHERE id = ?').get(id)
    expect(row).toEqual({ client_id: 7, marque: 'Apple', modele: 'iPhone 14', imei: IMEI, numero_serie: null })
  })

  it('numéro de série (non 15 chiffres) → créé sur la colonne numero_serie, pas imei', async () => {
    const id = await resoudreAppareilTicket(base.d1, {
      boutiqueId: 1, clientId: 7, marque: 'Samsung', modele: 'S23', imeiOuSerie: 'SN-ABC-123',
    })
    const row = base.sqlite.prepare('SELECT imei, numero_serie FROM appareils WHERE id = ?').get(id)
    expect(row).toEqual({ imei: null, numero_serie: 'SN-ABC-123' })
  })

  it('même client + même IMEI → retrouve la fiche existante, n\'en crée pas une seconde', async () => {
    const id1 = await resoudreAppareilTicket(base.d1, {
      boutiqueId: 1, clientId: 7, marque: 'Apple', modele: 'iPhone 14', imeiOuSerie: IMEI,
    })
    const id2 = await resoudreAppareilTicket(base.d1, {
      boutiqueId: 1, clientId: 7, marque: 'Apple', modele: 'iPhone 14', imeiOuSerie: IMEI,
    })
    expect(id2).toBe(id1)
    expect(nbAppareils()).toBe(1)
  })

  it('même IMEI chez un AUTRE client (même boutique) → nouvelle fiche, jamais celle du premier', async () => {
    const idClient7 = await resoudreAppareilTicket(base.d1, {
      boutiqueId: 1, clientId: 7, marque: 'Apple', modele: 'iPhone 14', imeiOuSerie: IMEI,
    })
    const idClient8 = await resoudreAppareilTicket(base.d1, {
      boutiqueId: 1, clientId: 8, marque: 'Apple', modele: 'iPhone 14', imeiOuSerie: IMEI,
    })
    expect(idClient8).not.toBe(idClient7)
    expect(nbAppareils()).toBe(2)
  })

  it('plusieurs fiches pour le même client et le même IMEI → ORDER BY id LIMIT 1 (la plus ancienne)', async () => {
    const { lastInsertRowid: idAncien } = base.sqlite
      .prepare('INSERT INTO appareils (client_id, marque, modele, imei) VALUES (?, ?, ?, ?)')
      .run(7, 'Apple', 'iPhone 14', IMEI)
    base.sqlite
      .prepare('INSERT INTO appareils (client_id, marque, modele, imei) VALUES (?, ?, ?, ?)')
      .run(7, 'Apple', 'iPhone 14', IMEI)

    const id = await resoudreAppareilTicket(base.d1, {
      boutiqueId: 1, clientId: 7, marque: 'Apple', modele: 'iPhone 14', imeiOuSerie: IMEI,
    })
    expect(id).toBe(Number(idAncien))
  })

  it('clé de Luhn fausse → rejette, aucune ligne appareils créée', async () => {
    await expect(resoudreAppareilTicket(base.d1, {
      boutiqueId: 1, clientId: 7, marque: 'Apple', modele: 'iPhone 14', imeiOuSerie: IMEI_FAUX,
    })).rejects.toThrow('IMEI invalide (clé de contrôle).')
    expect(nbAppareils()).toBe(0)
  })

  it('client_id d\'une autre boutique → rejette, aucune ligne appareils créée', async () => {
    await expect(resoudreAppareilTicket(base.d1, {
      boutiqueId: 1, clientId: 9, marque: 'Apple', modele: 'iPhone 14', imeiOuSerie: IMEI,
    })).rejects.toThrow('Client introuvable dans cette boutique.')
    expect(nbAppareils()).toBe(0)
  })

  it('technicien d\'une autre boutique → rejette, aucune ligne appareils créée', async () => {
    await expect(resoudreAppareilTicket(base.d1, {
      boutiqueId: 1, clientId: 7, technicienId: 60, marque: 'Apple', modele: 'iPhone 14', imeiOuSerie: IMEI,
    })).rejects.toThrow('Technicien introuvable dans cette boutique.')
    expect(nbAppareils()).toBe(0)
  })

  it('appareil_id explicite appartenant à un AUTRE client → rejette, aucune ligne appareils créée en plus', async () => {
    const { lastInsertRowid: idAppareil } = base.sqlite
      .prepare('INSERT INTO appareils (client_id, marque, modele, imei) VALUES (?, ?, ?, ?)')
      .run(8, 'Apple', 'iPhone 14', IMEI)
    await expect(resoudreAppareilTicket(base.d1, {
      boutiqueId: 1, clientId: 7, appareilId: Number(idAppareil), marque: 'Apple', modele: 'iPhone 14',
    })).rejects.toThrow('Appareil introuvable pour ce client.')
    expect(nbAppareils()).toBe(1)
  })

  it('appareil_id explicite appartenant au bon client → accepté tel quel', async () => {
    const { lastInsertRowid: idAppareil } = base.sqlite
      .prepare('INSERT INTO appareils (client_id, marque, modele, imei) VALUES (?, ?, ?, ?)')
      .run(7, 'Apple', 'iPhone 14', IMEI)
    const id = await resoudreAppareilTicket(base.d1, {
      boutiqueId: 1, clientId: 7, appareilId: Number(idAppareil), marque: 'Apple', modele: 'iPhone 14',
    })
    expect(id).toBe(Number(idAppareil))
  })

  // ─── Mutation (ADR 0003) ────────────────────────────────────────────────────
  // Mutant : remplacer `WHERE client_id = ? AND boutique_id = ?` par `WHERE client_id = ?`
  // (ligne du SELECT client dans resoudreAppareilTicket()) dans src/services/ticketService.ts,
  // relancer CE test seul → rouge attendu (le client d'une autre boutique serait accepté).
  // Mutation appliquée, testée rouge, puis restaurée — voir compte rendu.
})

describe('createTicket() — garantie orpheline (ticket 08a)', () => {
  it('aucun appareil orphelin sur échec de VALIDATION (Luhn)', async () => {
    await expect(createTicket(base.d1, 1, 50, {
      client_id: 7, appareil_marque: 'Apple', appareil_modele: 'iPhone 14',
      description_panne: 'Écran cassé', imei: IMEI_FAUX,
    })).rejects.toThrow('IMEI invalide (clé de contrôle).')
    expect(nbAppareils()).toBe(0)
    expect((base.sqlite.prepare('SELECT COUNT(*) AS n FROM tickets').get() as any).n).toBe(0)
  })

  it('échec d\'écriture APRÈS la création de l\'appareil : orphelin accepté, retrouvé et réutilisé à la saisie suivante', async () => {
    // `description_panne` est NOT NULL sur `tickets` — passer `null` directement au service
    // (en contournant la validation de la route, qui ne laisse jamais passer ce cas) force
    // l'INSERT du ticket à échouer APRÈS que resoudreAppareilTicket() ait déjà créé la fiche
    // appareil (aucune ligne n'existait encore pour ce client + cet IMEI).
    await expect(createTicket(base.d1, 1, 50, {
      client_id: 7, appareil_marque: 'Apple', appareil_modele: 'iPhone 14',
      description_panne: null as any, imei: IMEI,
    })).rejects.toThrow()
    expect(nbAppareils()).toBe(1)  // l'orphelin existe

    // Saisie suivante, valide cette fois, même client + même IMEI : réutilise l'orphelin.
    const res = await createTicket(base.d1, 1, 50, {
      client_id: 7, appareil_marque: 'Apple', appareil_modele: 'iPhone 14',
      description_panne: 'Écran cassé', imei: IMEI,
    })
    expect(nbAppareils()).toBe(1)  // toujours une seule fiche — pas de doublon
    const ticket = base.sqlite.prepare('SELECT appareil_id FROM tickets WHERE id = ?').get(res.id) as any
    const appareil = base.sqlite.prepare('SELECT id FROM appareils').get() as any
    expect(ticket.appareil_id).toBe(appareil.id)
  })

  // ─── Mutation (ADR 0003) ────────────────────────────────────────────────────
  // Mutant : dans resoudreAppareilTicket(), retirer la recherche `existant` (toujours créer
  // un nouvel appareil) dans src/services/ticketService.ts, relancer CE test seul → rouge
  // attendu (nbAppareils() vaudrait 2 après la seconde saisie). Mutation appliquée, testée
  // rouge, puis restaurée — voir compte rendu.
})
