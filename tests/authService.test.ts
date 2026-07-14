/**
 * @file tests/authService.test.ts
 * @description Tests unitaires — src/services/authService.ts
 *
 * Couverture :
 *   - findUserByEmail()               — unicité email (register)
 *   - findUserByEmailFull()           — login avec password_hash
 *   - findUserById()                  — refresh token (actif=1)
 *   - findUserWithProfile()           — /me (boutique_nom)
 *   - createBoutiqueWithSettings()    — création boutique + settings séquentiels
 *   - createUser()                    — insert user inactif
 *   - activateUser()                  — UPDATE actif=1 / email_verifie=1
 *   - findUserByEmailAfterActivation() — payload JWT post-OTP
 *
 * Stratégie :
 *   Mock Database (port) en mémoire (createMockDatabase) — aucune base SQLite réelle.
 *   Les SQL sont enregistrés via __setResponse() / __setResponseFn().
 *   On vérifie : valeurs retournées + SQL appelés (via __getCalls()).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockDatabase } from './helpers/mockDatabase'
import {
  findUserByEmail,
  findUserByEmailFull,
  findUserById,
  findUserWithProfile,
  createBoutiqueWithSettings,
  createUser,
  activateUser,
  findUserByEmailAfterActivation,
  type UserWithRole,
  type UserFull,
  type UserProfile,
} from '../src/services/authService'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FIXTURE_USER_WITH_ROLE: UserWithRole = {
  id: 42, email: 'alice@izigsm.fr', prenom: 'Alice',
  nom: 'Martin', boutique_id: 1, role: 'manager',
}

const FIXTURE_USER_FULL: UserFull = {
  ...FIXTURE_USER_WITH_ROLE,
  password_hash: '100000:aabbcc:ddeeff',
  actif: 1,
  email_verifie: 1,
}

const FIXTURE_USER_PROFILE: UserProfile = {
  ...FIXTURE_USER_WITH_ROLE,
  telephone: '0612345678',
  boutique_nom: 'iZiGSM Paris',
}

// ─── findUserByEmail ──────────────────────────────────────────────────────────

describe('findUserByEmail', () => {
  it('retourne { id } si l\'email existe en base', async () => {
    const db = createMockDatabase()
    db.__setResponse('SELECT id FROM users WHERE email = ?', { id: 42 })

    const result = await findUserByEmail(db, 'alice@izigsm.fr')

    expect(result).toEqual({ id: 42 })
  })

  it('retourne null si l\'email n\'existe pas', async () => {
    const db = createMockDatabase()
    db.__setNotFound('SELECT id FROM users WHERE email = ?')

    const result = await findUserByEmail(db, 'inconnu@test.fr')

    expect(result).toBeNull()
  })

  it('appelle bien le SQL avec l\'email en paramètre', async () => {
    const db = createMockDatabase()
    db.__setNotFound('SELECT id FROM users WHERE email = ?')

    await findUserByEmail(db, 'test@test.fr')

    const calls = db.__getCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('SELECT id FROM users WHERE email = ?')
    expect(calls[0].params).toContain('test@test.fr')
  })
})

// ─── findUserByEmailFull ──────────────────────────────────────────────────────

describe('findUserByEmailFull', () => {
  it('retourne UserFull avec password_hash pour le login', async () => {
    const db = createMockDatabase()
    db.__setResponseFn(
      'SELECT u.id, u.email, u.password_hash, u.prenom, u.nom, u.boutique_id, u.actif, u.email_verifie, r.nom as role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ?',
      () => FIXTURE_USER_FULL
    )

    const result = await findUserByEmailFull(db, 'alice@izigsm.fr')

    expect(result).not.toBeNull()
    expect(result?.password_hash).toBe('100000:aabbcc:ddeeff')
    expect(result?.actif).toBe(1)
    expect(result?.email_verifie).toBe(1)
    expect(result?.role).toBe('manager')
  })

  it('retourne null pour un email inconnu', async () => {
    const db = createMockDatabase()
    // Pas de réponse enregistrée → null par défaut

    const result = await findUserByEmailFull(db, 'ghost@test.fr')

    expect(result).toBeNull()
  })
})

// ─── findUserById ─────────────────────────────────────────────────────────────

describe('findUserById', () => {
  it('retourne UserWithRole si l\'utilisateur est actif', async () => {
    const db = createMockDatabase()
    db.__setResponseFn(
      'SELECT u.id, u.email, u.prenom, u.nom, u.boutique_id, r.nom as role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.actif = 1',
      () => FIXTURE_USER_WITH_ROLE
    )

    const result = await findUserById(db, 42)

    expect(result).not.toBeNull()
    expect(result?.id).toBe(42)
    expect(result?.role).toBe('manager')
  })

  it('retourne null si l\'utilisateur est inactif ou introuvable', async () => {
    const db = createMockDatabase()
    // Pas de réponse → null par défaut (simule actif=0 ou id inconnu)

    const result = await findUserById(db, 999)

    expect(result).toBeNull()
  })

  it('transmet l\'id en paramètre SQL', async () => {
    const db = createMockDatabase()

    await findUserById(db, 42)

    const calls = db.__getCalls()
    expect(calls[0].params).toContain(42)
  })
})

// ─── findUserWithProfile ──────────────────────────────────────────────────────

describe('findUserWithProfile', () => {
  it('retourne UserProfile enrichi avec boutique_nom et telephone', async () => {
    const db = createMockDatabase()
    db.__setResponseFn(
      'SELECT u.id, u.email, u.prenom, u.nom, u.telephone, u.boutique_id, r.nom as role, b.nom as boutique_nom FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN boutiques b ON b.id = u.boutique_id WHERE u.id = ? AND u.actif = 1',
      () => FIXTURE_USER_PROFILE
    )

    const result = await findUserWithProfile(db, 42)

    expect(result?.boutique_nom).toBe('iZiGSM Paris')
    expect(result?.telephone).toBe('0612345678')
  })

  it('retourne null si utilisateur désactivé (token zombie)', async () => {
    const db = createMockDatabase()
    // Pas de réponse → null

    const result = await findUserWithProfile(db, 7)

    expect(result).toBeNull()
  })

  it('boutique_nom peut être null (admin sans boutique)', async () => {
    const db = createMockDatabase()
    db.__setResponseFn(
      'SELECT u.id, u.email, u.prenom, u.nom, u.telephone, u.boutique_id, r.nom as role, b.nom as boutique_nom FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN boutiques b ON b.id = u.boutique_id WHERE u.id = ? AND u.actif = 1',
      () => ({ ...FIXTURE_USER_WITH_ROLE, telephone: null, boutique_nom: null, boutique_id: null })
    )

    const result = await findUserWithProfile(db, 1)

    expect(result?.boutique_nom).toBeNull()
    expect(result?.boutique_id).toBeNull()
  })
})

// ─── createBoutiqueWithSettings ───────────────────────────────────────────────

describe('createBoutiqueWithSettings', () => {
  it('retourne l\'id de la boutique créée', async () => {
    const db = createMockDatabase()
    db.__setResponse('INSERT INTO boutiques (nom, slug, siret, tva_numero, adresse, code_postal, ville, telephone) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id', { id: 5 })

    const id = await createBoutiqueWithSettings(db, 'Mon Atelier')

    expect(id).toBe(5)
  })

  it('exécute INSERT boutiques PUIS INSERT boutique_settings en séquence', async () => {
    const db = createMockDatabase()
    db.__setResponse('INSERT INTO boutiques (nom, slug, siret, tva_numero, adresse, code_postal, ville, telephone) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id', { id: 5 })

    await createBoutiqueWithSettings(db, 'Mon Atelier')

    const calls = db.__getCalls()
    expect(calls).toHaveLength(2)
    expect(calls[0].sql).toContain('INSERT INTO boutiques')
    expect(calls[1].sql).toContain('INSERT INTO boutique_settings')
    expect(calls[1].params).toContain(5)  // boutique_id transmis aux settings
  })

  it('génère le slug depuis le nom (accents normalisés, espaces → tirets)', async () => {
    const db = createMockDatabase()
    db.__setResponse('INSERT INTO boutiques (nom, slug, siret, tva_numero, adresse, code_postal, ville, telephone) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id', { id: 5 })

    await createBoutiqueWithSettings(db, 'Réparation Éclair')

    const calls = db.__getCalls()
    expect(calls[0].params[1]).toBe('reparation-eclair')
  })

  it('transmet les détails SIRENE optionnels (siret, adresse...) au INSERT', async () => {
    const db = createMockDatabase()
    db.__setResponse('INSERT INTO boutiques (nom, slug, siret, tva_numero, adresse, code_postal, ville, telephone) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id', { id: 5 })

    await createBoutiqueWithSettings(db, 'Mon Atelier', {
      siret: '12345678900012', adresse: '12 Rue de la Paix', codePostal: '75001', ville: 'Paris',
    })

    const calls = db.__getCalls()
    expect(calls[0].params).toEqual([
      'Mon Atelier', 'mon-atelier', '12345678900012', null, '12 Rue de la Paix', '75001', 'Paris', null,
    ])
  })

  it('retourne null si l\'INSERT boutique échoue (result.id absent)', async () => {
    const db = createMockDatabase()
    db.__setResponse('INSERT INTO boutiques (nom, slug, siret, tva_numero, adresse, code_postal, ville, telephone) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id', null)

    const id = await createBoutiqueWithSettings(db, 'Boutique Fantôme')

    expect(id).toBeNull()
  })

  it('ne crée pas de settings si boutique_id est null', async () => {
    const db = createMockDatabase()
    db.__setResponse('INSERT INTO boutiques (nom, slug, siret, tva_numero, adresse, code_postal, ville, telephone) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id', null)

    await createBoutiqueWithSettings(db, 'Boutique Fantôme')

    const calls = db.__getCalls()
    // Seul INSERT boutiques — pas de INSERT boutique_settings
    expect(calls.every(c => !c.sql.includes('boutique_settings'))).toBe(true)
  })
})

// ─── createUser ───────────────────────────────────────────────────────────────

describe('createUser', () => {
  it('retourne l\'id du nouvel utilisateur', async () => {
    const db = createMockDatabase()
    db.__setResponseFn(
      'INSERT INTO users (email, password_hash, prenom, nom, telephone, boutique_id, role_id, actif, email_verifie) VALUES (?, ?, ?, ?, ?, ?, 2, 0, 0) RETURNING id',
      () => ({ id: 10 })
    )

    const id = await createUser(db, 'new@test.fr', 'hash', 'Jean', 'Dupont', '0601020304', 1)

    expect(id).toBe(10)
  })

  it('accepte telephone=null et boutique_id=null', async () => {
    const db = createMockDatabase()
    db.__setResponseFn(
      'INSERT INTO users (email, password_hash, prenom, nom, telephone, boutique_id, role_id, actif, email_verifie) VALUES (?, ?, ?, ?, ?, ?, 2, 0, 0) RETURNING id',
      () => ({ id: 11 })
    )

    const id = await createUser(db, 'no-boutique@test.fr', 'hash', 'Paul', 'Admin', null, null)

    expect(id).toBe(11)
    const calls = db.__getCalls()
    expect(calls[0].params).toContain(null)  // telephone null
  })

  it('retourne null si l\'INSERT échoue', async () => {
    const db = createMockDatabase()
    // Pas de réponse → first() retourne null

    const id = await createUser(db, 'fail@test.fr', 'hash', 'A', 'B', null, null)

    expect(id).toBeNull()
  })

  it('crée l\'utilisateur avec actif=0 et email_verifie=0 (SQL)', async () => {
    const db = createMockDatabase()

    await createUser(db, 'x@x.fr', 'h', 'X', 'X', null, null)

    const calls = db.__getCalls()
    // Vérifier que le SQL contient bien 0, 0 pour actif et email_verifie
    expect(calls[0].sql).toContain('2, 0, 0')
  })
})

// ─── activateUser ─────────────────────────────────────────────────────────────

describe('activateUser', () => {
  it('appelle UPDATE users avec le bon email', async () => {
    const db = createMockDatabase()

    await activateUser(db, 'alice@izigsm.fr')

    const calls = db.__getCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('UPDATE users SET actif = 1, email_verifie = 1')
    expect(calls[0].params).toContain('alice@izigsm.fr')
  })

  it('ne retourne rien (void)', async () => {
    const db = createMockDatabase()

    const result = await activateUser(db, 'x@x.fr')

    expect(result).toBeUndefined()
  })
})

// ─── findUserByEmailAfterActivation ───────────────────────────────────────────

describe('findUserByEmailAfterActivation', () => {
  it('retourne UserWithRole (sans password_hash) après activation', async () => {
    const db = createMockDatabase()
    db.__setResponseFn(
      'SELECT u.id, u.email, u.prenom, u.nom, u.boutique_id, r.nom as role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ?',
      () => FIXTURE_USER_WITH_ROLE
    )

    const result = await findUserByEmailAfterActivation(db, 'alice@izigsm.fr')

    expect(result).not.toBeNull()
    expect(result?.id).toBe(42)
    expect(result?.role).toBe('manager')
    // Pas de password_hash dans l'interface UserWithRole
    expect('password_hash' in (result ?? {})).toBe(false)
  })

  it('retourne null si introuvable (cas d\'erreur inattendu)', async () => {
    const db = createMockDatabase()

    const result = await findUserByEmailAfterActivation(db, 'ghost@test.fr')

    expect(result).toBeNull()
  })
})
