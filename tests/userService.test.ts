import { describe, it, expect } from 'vitest'
import { createMockDatabase } from './helpers/mockDatabase'
import { listUsers } from '../src/services/userService'

const SQL_LIST_ADMIN = `SELECT u.id, u.email, u.prenom, u.nom, u.telephone, u.actif, u.pin_actif, r.nom as role, u.boutique_id, b.nom as boutique_nom, u.created_at FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN boutiques b ON b.id = u.boutique_id ORDER BY u.created_at ASC`

const SQL_LIST_MANAGER = `SELECT u.id, u.email, u.prenom, u.nom, u.telephone, u.actif, u.pin_actif, r.nom as role, u.boutique_id, u.created_at FROM users u JOIN roles r ON r.id = u.role_id WHERE u.boutique_id = ? ORDER BY u.created_at ASC`

describe('listUsers', () => {
  it('admin : retourne tous les utilisateurs toutes boutiques confondues', async () => {
    const db = createMockDatabase()
    db.__setListResponse(SQL_LIST_ADMIN, [
      { id: 1, prenom: 'Ana',  nom: 'Admin', role: 'admin' },
      { id: 2, prenom: 'Jean', nom: 'Tech',  role: 'technicien' },
    ])

    const result = await listUsers(db, { role: 'admin' }, 1)

    expect(result).toHaveLength(2)
  })

  it('manager : requête filtrée sur boutique_id (requête différente de admin)', async () => {
    const db = createMockDatabase()
    db.__setListResponse(SQL_LIST_MANAGER, [
      { id: 3, prenom: 'Marie', nom: 'Manager', role: 'manager' },
    ])

    const result = await listUsers(db, { role: 'manager' }, 42)

    expect(result).toHaveLength(1)
    const calls = db.__getCalls()
    const managerCall = calls.find(c => c.sql === SQL_LIST_MANAGER)
    expect(managerCall).toBeDefined()
    expect(managerCall!.params[0]).toBe(42)
  })

  it('manager : tableau vide si aucun utilisateur dans la boutique', async () => {
    const db = createMockDatabase()
    db.__setListResponse(SQL_LIST_MANAGER, [])

    const result = await listUsers(db, { role: 'manager' }, 99)

    expect(result).toHaveLength(0)
  })
})
