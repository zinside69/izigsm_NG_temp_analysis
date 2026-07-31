import { test, expect, type APIRequestContext } from '@playwright/test'
import { createTenantAdmin } from './fixtures/tenant'

/**
 * Isolation des routes par ID — voir
 * docs/superpowers/specs/2026-07-31-isolation-routes-par-id-design.md
 *
 * Trois cas par domaine : l'etranger est refuse, le proprietaire passe,
 * l'admin plateforme passe (capacite de depannage, garantie par test).
 */

const PRODUIT_BOUTIQUE_1 = 1   // seed.sql : produits ids 1..9, boutique 1
const EMPLOYE_BOUTIQUE_1 = 1   // seed.sql : employes ids 1,2,3 — boutique 1
// seed.sql : ticket 5 (boutique 1, statut 'livre') — pas le ticket 1 ('en_reparation') :
// archiveTicket() rejette tout statut hors livre/annule avec un 422 qui masquerait la
// garde d'isolation sur le cas admin (l'admin passe la garde mais heurterait quand meme
// la regle metier, faux negatif constate au RED).
const TICKET_BOUTIQUE_1  = 5

/** Connexion au compte admin plateforme du seed (boutique_id NULL). */
async function loginSeedAdmin(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/auth/login', {
    data: { email: 'admin@izigsm.fr', password: 'Admin@2026!' },
  })
  if (!res.ok()) throw new Error(`login admin seed failed: ${res.status()} ${await res.text()}`)
  return (await res.json()).accessToken
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` }
}

test.describe('Isolation — Stock', () => {
  test('un manager d\'une autre boutique ne peut pas lire un produit qui ne lui appartient pas', async ({ request }) => {
    const etranger = await createTenantAdmin(request)
    const res = await request.get(`/api/produits/${PRODUIT_BOUTIQUE_1}`, {
      headers: authHeader(etranger.accessToken),
    })
    expect([403, 404]).toContain(res.status())
  })

  test('un manager d\'une autre boutique ne peut pas modifier un produit qui ne lui appartient pas', async ({ request }) => {
    const etranger = await createTenantAdmin(request)
    const res = await request.put(`/api/produits/${PRODUIT_BOUTIQUE_1}`, {
      headers: authHeader(etranger.accessToken),
      data: { nom: 'Renomme par un tenant etranger' },
    })
    expect([403, 404]).toContain(res.status())
  })

  test('un manager d\'une autre boutique ne peut pas supprimer un produit qui ne lui appartient pas', async ({ request }) => {
    const etranger = await createTenantAdmin(request)
    const res = await request.delete(`/api/produits/${PRODUIT_BOUTIQUE_1}`, {
      headers: authHeader(etranger.accessToken),
    })
    expect([403, 404]).toContain(res.status())
  })

  test('l\'admin plateforme lit le produit de n\'importe quelle boutique', async ({ request }) => {
    const token = await loginSeedAdmin(request)
    const res = await request.get(`/api/produits/${PRODUIT_BOUTIQUE_1}`, { headers: authHeader(token) })
    expect(res.status()).toBe(200)
  })

  test('le proprietaire legitime lit et modifie son propre produit', async ({ request }) => {
    const proprio = await createTenantAdmin(request)
    const creation = await request.post('/api/produits', {
      headers: authHeader(proprio.accessToken),
      data: { nom: 'Produit du proprietaire', prix_vente_ht: 10, tva_taux: 20 },
    })
    expect(creation.status()).toBe(201)
    const produitId = (await creation.json()).id

    const lecture = await request.get(`/api/produits/${produitId}`, { headers: authHeader(proprio.accessToken) })
    expect(lecture.status()).toBe(200)

    const modif = await request.put(`/api/produits/${produitId}`, {
      headers: authHeader(proprio.accessToken),
      data: { nom: 'Renomme par son proprietaire' },
    })
    expect(modif.status()).toBe(200)
  })
})

test.describe('Isolation — Personnel', () => {
  test('un manager d\'une autre boutique ne peut pas lire la fiche d\'un employe etranger', async ({ request }) => {
    const etranger = await createTenantAdmin(request)
    const res = await request.get(`/api/employes/${EMPLOYE_BOUTIQUE_1}`, {
      headers: authHeader(etranger.accessToken),
    })
    expect([403, 404]).toContain(res.status())
  })

  // Body partiel volontaire ({ poste }) : ce test n'exerce jamais updateEmploye() car la
  // garde court-circuite avant la mutation — sans la garde, la route renverrait 500 (bug
  // NOT NULL sur prenom/nom dans updateEmploye()), jamais 200, donc ce refus seul ne prouve
  // pas que la garde compare le bon champ (voir tests propriétaire/admin ci-dessous).
  test('un manager d\'une autre boutique ne peut pas modifier la fiche d\'un employe etranger', async ({ request }) => {
    const etranger = await createTenantAdmin(request)
    const res = await request.put(`/api/employes/${EMPLOYE_BOUTIQUE_1}`, {
      headers: authHeader(etranger.accessToken),
      data: { poste: 'modifie par un tenant etranger' },
    })
    expect([403, 404]).toContain(res.status())
  })

  test('un manager d\'une autre boutique ne peut pas lire le pointage d\'un employe etranger', async ({ request }) => {
    const etranger = await createTenantAdmin(request)
    const res = await request.get(`/api/pointage/${EMPLOYE_BOUTIQUE_1}/aujourd-hui`, {
      headers: authHeader(etranger.accessToken),
    })
    expect([403, 404]).toContain(res.status())
  })

  test('l\'admin plateforme lit la fiche employe de n\'importe quelle boutique', async ({ request }) => {
    const token = await loginSeedAdmin(request)
    const res = await request.get(`/api/employes/${EMPLOYE_BOUTIQUE_1}`, { headers: authHeader(token) })
    expect(res.status()).toBe(200)
  })

  test('le proprietaire legitime lit la fiche de son propre employe', async ({ request }) => {
    const proprio = await createTenantAdmin(request)
    const creation = await request.post('/api/employes', {
      headers: authHeader(proprio.accessToken),
      data: { prenom: 'Employe', nom: 'DuProprietaire', poste: 'technicien' },
    })
    expect(creation.status()).toBe(201)
    const employeId = (await creation.json()).id

    const res = await request.get(`/api/employes/${employeId}`, { headers: authHeader(proprio.accessToken) })
    expect(res.status()).toBe(200)
  })

  test('le proprietaire legitime modifie la fiche de son propre employe', async ({ request }) => {
    const proprio = await createTenantAdmin(request)
    const creation = await request.post('/api/employes', {
      headers: authHeader(proprio.accessToken),
      data: { prenom: 'Employe', nom: 'AModifier', poste: 'technicien' },
    })
    expect(creation.status()).toBe(201)
    const employeId = (await creation.json()).id

    // Body complet (prenom/nom obligatoires) pour ne pas retomber sur le bug NOT NULL
    // de updateEmploye() et prouver que la garde laisse bien passer le proprietaire.
    const res = await request.put(`/api/employes/${employeId}`, {
      headers: authHeader(proprio.accessToken),
      data: {
        prenom: 'Employe', nom: 'Modifie', poste: 'vendeur',
        email: 'employe.modifie@e2e-test.local', telephone: '0600000000',
        taux_horaire: 12, commission_pct: 5,
      },
    })
    expect(res.status()).toBe(200)
  })

  test('l\'admin plateforme modifie la fiche employe de n\'importe quelle boutique', async ({ request }) => {
    const proprio = await createTenantAdmin(request)
    const creation = await request.post('/api/employes', {
      headers: authHeader(proprio.accessToken),
      data: { prenom: 'Employe', nom: 'PourAdmin', poste: 'technicien' },
    })
    expect(creation.status()).toBe(201)
    const employeId = (await creation.json()).id

    const token = await loginSeedAdmin(request)
    const res = await request.put(`/api/employes/${employeId}`, {
      headers: authHeader(token),
      data: {
        prenom: 'Employe', nom: 'ModifieParAdmin', poste: 'vendeur',
        email: 'employe.admin@e2e-test.local', telephone: '0600000001',
        taux_horaire: 15, commission_pct: 3,
      },
    })
    expect(res.status()).toBe(200)
  })

  test('le proprietaire legitime lit le pointage de son propre employe', async ({ request }) => {
    const proprio = await createTenantAdmin(request)
    const creation = await request.post('/api/employes', {
      headers: authHeader(proprio.accessToken),
      data: { prenom: 'Employe', nom: 'Pointage', poste: 'technicien' },
    })
    expect(creation.status()).toBe(201)
    const employeId = (await creation.json()).id

    const res = await request.get(`/api/pointage/${employeId}/aujourd-hui`, { headers: authHeader(proprio.accessToken) })
    expect(res.status()).toBe(200)
  })

  test('l\'admin plateforme lit le pointage d\'un employe de n\'importe quelle boutique', async ({ request }) => {
    const token = await loginSeedAdmin(request)
    const res = await request.get(`/api/pointage/${EMPLOYE_BOUTIQUE_1}/aujourd-hui`, { headers: authHeader(token) })
    expect(res.status()).toBe(200)
  })
})

test.describe('Isolation — Tickets', () => {
  test('un manager d\'une autre boutique ne peut pas archiver un ticket qui ne lui appartient pas', async ({ request }) => {
    const etranger = await createTenantAdmin(request)
    const res = await request.post(`/api/tickets/${TICKET_BOUTIQUE_1}/archiver`, {
      headers: authHeader(etranger.accessToken),
    })
    expect([403, 404]).toContain(res.status())
  })

  // Le proprietaire cree et fait transiter son propre ticket (recu -> annule, transition
  // directe autorisee) pour maitriser un etat archivable sans dependre du seed — la
  // garde doit laisser passer un 200 strict, pas un 403/404 ni un 409 ambigu.
  test('le proprietaire legitime archive son propre ticket', async ({ request }) => {
    const proprio = await createTenantAdmin(request)
    const auth = authHeader(proprio.accessToken)

    const clientRes = await request.post('/api/clients', {
      headers: auth,
      data: { prenom: 'E2E', nom: 'ProprietaireTicket' },
    })
    expect(clientRes.status()).toBe(201)
    const clientId = (await clientRes.json()).id

    const ticketRes = await request.post('/api/tickets', {
      headers: auth,
      data: {
        client_id: clientId,
        appareil_marque: 'Apple',
        appareil_modele: 'iPhone 12',
        description_panne: 'Ecran casse',
      },
    })
    expect(ticketRes.status()).toBe(201)
    const ticketId = (await ticketRes.json()).id

    const statutRes = await request.put(`/api/tickets/${ticketId}/statut`, {
      headers: auth,
      data: { statut: 'annule' },
    })
    expect(statutRes.status()).toBe(200)

    const res = await request.post(`/api/tickets/${ticketId}/archiver`, { headers: auth })
    expect(res.status()).toBe(200)
  })

  test('l\'admin plateforme n\'est pas bloque par la garde d\'archivage', async ({ request }) => {
    const token = await loginSeedAdmin(request)
    const res = await request.post(`/api/tickets/${TICKET_BOUTIQUE_1}/archiver`, { headers: authHeader(token) })
    // 200 (archive) ou 409 (deja archive) : les deux prouvent que la garde a laisse
    // passer l'admin. Un 403 signalerait une sur-restriction.
    expect([200, 409]).toContain(res.status())
  })
})

/** Cree un fournisseur cote boutique 1 via l'API (aucun fournisseur dans seed.sql). */
async function createFournisseurBoutique1(request: APIRequestContext): Promise<number> {
  const token = await loginSeedAdmin(request)
  const res = await request.post('/api/fournisseurs', {
    headers: authHeader(token),
    data: { nom: 'Fournisseur Boutique 1 (fixture e2e)', boutique_id: 1 },
  })
  if (!res.ok()) throw new Error(`creation fournisseur failed: ${res.status()} ${await res.text()}`)
  return (await res.json()).id
}

test.describe('Isolation — Fournisseurs', () => {
  test('un manager d\'une autre boutique ne peut pas lire un fournisseur etranger', async ({ request }) => {
    const fournisseurId = await createFournisseurBoutique1(request)
    const etranger = await createTenantAdmin(request)
    const res = await request.get(`/api/fournisseurs/${fournisseurId}`, {
      headers: authHeader(etranger.accessToken),
    })
    expect([403, 404]).toContain(res.status())
  })

  test('un manager d\'une autre boutique ne peut pas modifier un fournisseur etranger', async ({ request }) => {
    const fournisseurId = await createFournisseurBoutique1(request)
    const etranger = await createTenantAdmin(request)
    const res = await request.put(`/api/fournisseurs/${fournisseurId}`, {
      headers: authHeader(etranger.accessToken),
      data: { nom: 'Renomme par un tenant etranger' },
    })
    expect([403, 404]).toContain(res.status())
  })

  test('un manager d\'une autre boutique ne peut pas desactiver un fournisseur etranger', async ({ request }) => {
    const fournisseurId = await createFournisseurBoutique1(request)
    const etranger = await createTenantAdmin(request)
    const res = await request.delete(`/api/fournisseurs/${fournisseurId}`, {
      headers: authHeader(etranger.accessToken),
    })
    expect([403, 404]).toContain(res.status())
  })

  test('un manager d\'une autre boutique ne peut pas changer le statut d\'un bon de commande etranger', async ({ request }) => {
    const fournisseurId = await createFournisseurBoutique1(request)
    const token = await loginSeedAdmin(request)
    const creation = await request.post('/api/bons-commande', {
      headers: authHeader(token),
      data: {
        fournisseur_id: fournisseurId,
        boutique_id: 1,
        lignes: [{ designation: 'Ecran de test', quantite_commandee: 2, prix_achat_ht: 30 }],
      },
    })
    if (!creation.ok()) throw new Error(`creation bon failed: ${creation.status()} ${await creation.text()}`)
    const bonId = (await creation.json()).id

    const etranger = await createTenantAdmin(request)
    const res = await request.patch(`/api/bons-commande/${bonId}/statut`, {
      headers: authHeader(etranger.accessToken),
      data: { statut: 'cancelled' },
    })
    expect([403, 404]).toContain(res.status())
  })

  test('l\'admin plateforme lit le fournisseur de n\'importe quelle boutique', async ({ request }) => {
    const fournisseurId = await createFournisseurBoutique1(request)
    const token = await loginSeedAdmin(request)
    const res = await request.get(`/api/fournisseurs/${fournisseurId}`, { headers: authHeader(token) })
    expect(res.status()).toBe(200)
  })

  test('le proprietaire legitime lit son propre fournisseur', async ({ request }) => {
    const proprio = await createTenantAdmin(request)
    const creation = await request.post('/api/fournisseurs', {
      headers: authHeader(proprio.accessToken),
      data: { nom: 'Fournisseur du proprietaire' },
    })
    expect(creation.status()).toBe(201)
    const fournisseurId = (await creation.json()).id

    const res = await request.get(`/api/fournisseurs/${fournisseurId}`, { headers: authHeader(proprio.accessToken) })
    expect(res.status()).toBe(200)
  })

  test('le proprietaire legitime modifie son propre fournisseur', async ({ request }) => {
    const proprio = await createTenantAdmin(request)
    const creation = await request.post('/api/fournisseurs', {
      headers: authHeader(proprio.accessToken),
      data: { nom: 'Fournisseur a modifier' },
    })
    expect(creation.status()).toBe(201)
    const fournisseurId = (await creation.json()).id

    const res = await request.put(`/api/fournisseurs/${fournisseurId}`, {
      headers: authHeader(proprio.accessToken),
      data: { nom: 'Fournisseur modifie par son proprietaire' },
    })
    expect(res.status()).toBe(200)
  })

  test('l\'admin plateforme modifie le fournisseur de n\'importe quelle boutique', async ({ request }) => {
    const fournisseurId = await createFournisseurBoutique1(request)
    const token = await loginSeedAdmin(request)
    const res = await request.put(`/api/fournisseurs/${fournisseurId}`, {
      headers: authHeader(token),
      data: { nom: 'Fournisseur modifie par admin' },
    })
    expect(res.status()).toBe(200)
  })

  test('le proprietaire legitime desactive son propre fournisseur', async ({ request }) => {
    const proprio = await createTenantAdmin(request)
    const creation = await request.post('/api/fournisseurs', {
      headers: authHeader(proprio.accessToken),
      data: { nom: 'Fournisseur a desactiver' },
    })
    expect(creation.status()).toBe(201)
    const fournisseurId = (await creation.json()).id

    const res = await request.delete(`/api/fournisseurs/${fournisseurId}`, { headers: authHeader(proprio.accessToken) })
    expect(res.status()).toBe(200)
  })

  test('l\'admin plateforme desactive le fournisseur de n\'importe quelle boutique', async ({ request }) => {
    const proprio = await createTenantAdmin(request)
    const creation = await request.post('/api/fournisseurs', {
      headers: authHeader(proprio.accessToken),
      data: { nom: 'Fournisseur pour admin delete' },
    })
    expect(creation.status()).toBe(201)
    const fournisseurId = (await creation.json()).id

    const token = await loginSeedAdmin(request)
    const res = await request.delete(`/api/fournisseurs/${fournisseurId}`, { headers: authHeader(token) })
    expect(res.status()).toBe(200)
  })

  test('le proprietaire legitime change le statut de son propre bon de commande', async ({ request }) => {
    const proprio = await createTenantAdmin(request)
    const auth = authHeader(proprio.accessToken)
    const fournisseurRes = await request.post('/api/fournisseurs', {
      headers: auth,
      data: { nom: 'Fournisseur pour bon proprietaire' },
    })
    expect(fournisseurRes.status()).toBe(201)
    const fournisseurId = (await fournisseurRes.json()).id

    const bonRes = await request.post('/api/bons-commande', {
      headers: auth,
      data: {
        fournisseur_id: fournisseurId,
        lignes: [{ designation: 'Ecran proprietaire', quantite_commandee: 1, prix_achat_ht: 20 }],
      },
    })
    expect(bonRes.status()).toBe(201)
    const bonId = (await bonRes.json()).id

    const res = await request.patch(`/api/bons-commande/${bonId}/statut`, {
      headers: auth,
      data: { statut: 'cancelled' },
    })
    expect(res.status()).toBe(200)
  })

  test('l\'admin plateforme change le statut du bon de commande de n\'importe quelle boutique', async ({ request }) => {
    const fournisseurId = await createFournisseurBoutique1(request)
    const token = await loginSeedAdmin(request)
    const bonRes = await request.post('/api/bons-commande', {
      headers: authHeader(token),
      data: {
        fournisseur_id: fournisseurId,
        boutique_id: 1,
        lignes: [{ designation: 'Ecran admin', quantite_commandee: 1, prix_achat_ht: 20 }],
      },
    })
    expect(bonRes.status()).toBe(201)
    const bonId = (await bonRes.json()).id

    const res = await request.patch(`/api/bons-commande/${bonId}/statut`, {
      headers: authHeader(token),
      data: { statut: 'cancelled' },
    })
    expect(res.status()).toBe(200)
  })
})

/** Cree une categorie de services cote boutique 1 (aucune dans seed.sql). */
async function createCategorieBoutique1(request: APIRequestContext): Promise<number> {
  const token = await loginSeedAdmin(request)
  const res = await request.post('/api/services/categories', {
    headers: authHeader(token),
    data: { nom: 'Categorie Boutique 1 (fixture e2e)', boutique_id: 1 },
  })
  if (!res.ok()) throw new Error(`creation categorie failed: ${res.status()} ${await res.text()}`)
  return (await res.json()).id
}

test.describe('Isolation — Categories de services', () => {
  test('un manager d\'une autre boutique ne peut pas modifier une categorie etrangere', async ({ request }) => {
    const categorieId = await createCategorieBoutique1(request)
    const etranger = await createTenantAdmin(request)
    const res = await request.put(`/api/services/categories/${categorieId}`, {
      headers: authHeader(etranger.accessToken),
      data: { nom: 'Renommee par un tenant etranger' },
    })
    expect([403, 404]).toContain(res.status())
  })

  test('un manager d\'une autre boutique ne peut pas desactiver une categorie etrangere', async ({ request }) => {
    const categorieId = await createCategorieBoutique1(request)
    const etranger = await createTenantAdmin(request)
    const res = await request.delete(`/api/services/categories/${categorieId}`, {
      headers: authHeader(etranger.accessToken),
    })
    expect([403, 404]).toContain(res.status())
  })

  test('l\'admin plateforme modifie la categorie de n\'importe quelle boutique', async ({ request }) => {
    const categorieId = await createCategorieBoutique1(request)
    const token = await loginSeedAdmin(request)
    const res = await request.put(`/api/services/categories/${categorieId}`, {
      headers: authHeader(token),
      data: { nom: 'Renommee par l\'admin plateforme' },
    })
    expect(res.status()).toBe(200)
  })

  test('le proprietaire legitime modifie sa propre categorie', async ({ request }) => {
    const proprio = await createTenantAdmin(request)
    const creation = await request.post('/api/services/categories', {
      headers: authHeader(proprio.accessToken),
      data: { nom: 'Categorie du proprietaire' },
    })
    expect(creation.status()).toBe(201)
    const categorieId = (await creation.json()).id

    const res = await request.put(`/api/services/categories/${categorieId}`, {
      headers: authHeader(proprio.accessToken),
      data: { nom: 'Renommee par son proprietaire' },
    })
    expect(res.status()).toBe(200)
  })

  test('le proprietaire legitime desactive sa propre categorie', async ({ request }) => {
    const proprio = await createTenantAdmin(request)
    const creation = await request.post('/api/services/categories', {
      headers: authHeader(proprio.accessToken),
      data: { nom: 'Categorie a desactiver par son proprietaire' },
    })
    expect(creation.status()).toBe(201)
    const categorieId = (await creation.json()).id

    const res = await request.delete(`/api/services/categories/${categorieId}`, { headers: authHeader(proprio.accessToken) })
    expect(res.status()).toBe(200)
  })

  test('l\'admin plateforme desactive la categorie de n\'importe quelle boutique', async ({ request }) => {
    const categorieId = await createCategorieBoutique1(request)
    const token = await loginSeedAdmin(request)
    const res = await request.delete(`/api/services/categories/${categorieId}`, { headers: authHeader(token) })
    expect(res.status()).toBe(200)
  })
})

/**
 * Referentiel marques/modeles GLOBAL (migration 0031, Sprint 2.39) : pas de
 * boutique_id, aucun proprietaire legitime a tester ici — seulement manager
 * refuse vs admin plateforme autorise. Un suffixe aleatoire evite les
 * collisions sur la contrainte UNIQUE(nom) de marques_appareils.
 */
function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Cree une marque du referentiel global via l'API admin (seed.sql n'en contient aucune). */
async function createMarqueGlobal(request: APIRequestContext, prefix: string): Promise<number> {
  const token = await loginSeedAdmin(request)
  const res = await request.post('/api/services/marques', {
    headers: authHeader(token),
    data: { nom: `${prefix}-${uniqueSuffix()}` },
  })
  if (!res.ok()) throw new Error(`creation marque failed: ${res.status()} ${await res.text()}`)
  return (await res.json()).id
}

/** Cree un modele du referentiel global via l'API admin, rattache a une marque donnee. */
async function createModeleGlobal(request: APIRequestContext, marqueId: number, prefix: string): Promise<number> {
  const token = await loginSeedAdmin(request)
  const res = await request.post('/api/services/modeles', {
    headers: authHeader(token),
    data: { nom: `${prefix}-${uniqueSuffix()}`, marque_id: marqueId },
  })
  if (!res.ok()) throw new Error(`creation modele failed: ${res.status()} ${await res.text()}`)
  return (await res.json()).id
}

test.describe('Referentiel global — ecriture reservee a l\'admin plateforme', () => {
  test('un manager ne peut pas modifier une marque du referentiel partage', async ({ request }) => {
    const marqueId = await createMarqueGlobal(request, 'MarqueTest')
    const manager = await createTenantAdmin(request)
    const res = await request.put(`/api/services/marques/${marqueId}`, {
      headers: authHeader(manager.accessToken),
      data: { nom: 'Renommee par un manager' },
    })
    expect(res.status()).toBe(403)
  })

  test('l\'admin plateforme modifie une marque du referentiel partage', async ({ request }) => {
    const marqueId = await createMarqueGlobal(request, 'MarqueAdmin')
    const token = await loginSeedAdmin(request)
    const res = await request.put(`/api/services/marques/${marqueId}`, {
      headers: authHeader(token),
      data: { nom: 'MarqueAdmin renommee' },
    })
    expect(res.status()).toBe(200)
  })

  test('un manager ne peut pas modifier un modele du referentiel partage', async ({ request }) => {
    const marqueId  = await createMarqueGlobal(request, 'MarqueModelesModifManager')
    const modeleId  = await createModeleGlobal(request, marqueId, 'ModeleTest')
    const manager   = await createTenantAdmin(request)
    const res = await request.put(`/api/services/modeles/${modeleId}`, {
      headers: authHeader(manager.accessToken),
      data: { nom: 'Renomme par un manager' },
    })
    expect(res.status()).toBe(403)
  })

  test('l\'admin plateforme modifie un modele du referentiel partage', async ({ request }) => {
    const marqueId = await createMarqueGlobal(request, 'MarqueModelesModifAdmin')
    const modeleId = await createModeleGlobal(request, marqueId, 'ModeleAdmin')
    const token    = await loginSeedAdmin(request)
    const res = await request.put(`/api/services/modeles/${modeleId}`, {
      headers: authHeader(token),
      data: { nom: 'ModeleAdmin renomme' },
    })
    expect(res.status()).toBe(200)
  })

  // Modele frais par test : DELETE desactive reellement la ressource (actif = 0).
  test('un manager ne peut pas desactiver un modele du referentiel partage', async ({ request }) => {
    const marqueId = await createMarqueGlobal(request, 'MarqueModelesDelManager')
    const modeleId = await createModeleGlobal(request, marqueId, 'ModeleDelManager')
    const manager  = await createTenantAdmin(request)
    const res = await request.delete(`/api/services/modeles/${modeleId}`, {
      headers: authHeader(manager.accessToken),
    })
    expect(res.status()).toBe(403)
  })

  test('l\'admin plateforme desactive un modele du referentiel partage', async ({ request }) => {
    const marqueId = await createMarqueGlobal(request, 'MarqueModelesDelAdmin')
    const modeleId = await createModeleGlobal(request, marqueId, 'ModeleDelAdmin')
    const token    = await loginSeedAdmin(request)
    const res = await request.delete(`/api/services/modeles/${modeleId}`, {
      headers: authHeader(token),
    })
    expect(res.status()).toBe(200)
  })

  // Fix round 1 : DELETE /services/marques/:id oublie dans l'enumeration initiale du
  // brief alors que le commentaire de justification (ci-dessus, sur PUT) couvrait deja
  // "renomme ou desactive". Cascade reelle dans deleteMarque() (modeles_appareils.actif
  // = 0 WHERE marque_id = ?) : le cas le plus dommageable des 4 routes. Marque fraiche
  // par test — la desactivation est persistante, jamais de marque reutilisee.
  test('un manager ne peut pas desactiver une marque du referentiel partage', async ({ request }) => {
    const marqueId = await createMarqueGlobal(request, 'MarqueDelManager')
    const manager  = await createTenantAdmin(request)
    const res = await request.delete(`/api/services/marques/${marqueId}`, {
      headers: authHeader(manager.accessToken),
    })
    expect(res.status()).toBe(403)
  })

  test('l\'admin plateforme desactive une marque du referentiel partage', async ({ request }) => {
    const marqueId = await createMarqueGlobal(request, 'MarqueDelAdmin')
    const token    = await loginSeedAdmin(request)
    const res = await request.delete(`/api/services/marques/${marqueId}`, {
      headers: authHeader(token),
    })
    expect(res.status()).toBe(200)
  })
})

/**
 * Tache 9-10 : rachats (livre de police, art. 321-7) et devis. Aucune fixture
 * rachats/devis dans seed.sql — creees via l'API, comme fournisseurs/categories
 * ci-dessus. Pour l'admin plateforme (boutique_id NULL), boutique_id: 1 est
 * fourni explicitement dans le body de creation.
 */

/** Cree un rachat cote boutique 1 via l'API admin (aucun rachat dans seed.sql). */
async function createRachatBoutique1(request: APIRequestContext): Promise<number> {
  const token = await loginSeedAdmin(request)
  return createRachat(request, token, { boutique_id: 1 })
}

/** Cree un rachat avec le token fourni (boutique derivee du JWT si non-admin). */
async function createRachat(
  request: APIRequestContext, token: string, overrides: Record<string, any> = {}
): Promise<number> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const res = await request.post('/api/rachats', {
    headers: authHeader(token),
    data: {
      vendeur_nom:       'Dupont',
      vendeur_prenom:    'Jean',
      vendeur_piece:     'CNI',
      vendeur_piece_num: `ID-${suffix}`,
      marque:            'Apple',
      modele:            'iPhone 12',
      prix_rachat:       50,
      ...overrides,
    },
  })
  if (!res.ok()) throw new Error(`creation rachat failed: ${res.status()} ${await res.text()}`)
  return (await res.json()).id
}

test.describe('Isolation — Rachats', () => {
  test('un manager d\'une autre boutique ne peut pas lire un rachat qui ne lui appartient pas', async ({ request }) => {
    const rachatId = await createRachatBoutique1(request)
    const etranger = await createTenantAdmin(request)
    const res = await request.get(`/api/rachats/${rachatId}`, {
      headers: authHeader(etranger.accessToken),
    })
    expect([403, 404]).toContain(res.status())
  })

  test('le proprietaire legitime lit son propre rachat', async ({ request }) => {
    const proprio  = await createTenantAdmin(request)
    const rachatId = await createRachat(request, proprio.accessToken)

    const res = await request.get(`/api/rachats/${rachatId}`, { headers: authHeader(proprio.accessToken) })
    expect(res.status()).toBe(200)
  })

  test('l\'admin plateforme lit le rachat de n\'importe quelle boutique', async ({ request }) => {
    const rachatId = await createRachatBoutique1(request)
    const token     = await loginSeedAdmin(request)
    const res = await request.get(`/api/rachats/${rachatId}`, { headers: authHeader(token) })
    expect(res.status()).toBe(200)
  })

  // Ressource fraiche par test : PATCH .../statut modifie un etat persistant.
  test('un manager d\'une autre boutique ne peut pas changer le statut d\'un rachat qui ne lui appartient pas', async ({ request }) => {
    const rachatId = await createRachatBoutique1(request)
    const etranger = await createTenantAdmin(request)
    const res = await request.patch(`/api/rachats/${rachatId}/statut`, {
      headers: authHeader(etranger.accessToken),
      data: { statut: 'vendu' },
    })
    expect([403, 404]).toContain(res.status())
  })

  test('le proprietaire legitime change le statut de son propre rachat', async ({ request }) => {
    const proprio  = await createTenantAdmin(request)
    const rachatId = await createRachat(request, proprio.accessToken)

    const res = await request.patch(`/api/rachats/${rachatId}/statut`, {
      headers: authHeader(proprio.accessToken),
      data: { statut: 'vendu' },
    })
    expect(res.status()).toBe(200)
  })

  test('l\'admin plateforme change le statut du rachat de n\'importe quelle boutique', async ({ request }) => {
    const rachatId = await createRachatBoutique1(request)
    const token     = await loginSeedAdmin(request)
    const res = await request.patch(`/api/rachats/${rachatId}/statut`, {
      headers: authHeader(token),
      data: { statut: 'vendu' },
    })
    expect(res.status()).toBe(200)
  })
})

/** Cree un client via l'API avec le token fourni (email requis par POST /devis/:id/envoyer). */
async function createClientPourDevis(
  request: APIRequestContext, token: string, overrides: Record<string, any> = {}
): Promise<number> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const res = await request.post('/api/clients', {
    headers: authHeader(token),
    data: {
      prenom: 'Client',
      nom:    `E2E-${suffix}`,
      email:  `client-${suffix}@e2e-test.local`,
      ...overrides,
    },
  })
  if (!res.ok()) throw new Error(`creation client failed: ${res.status()} ${await res.text()}`)
  return (await res.json()).id
}

/** Cree un devis via l'API avec le token fourni (boutique derivee du JWT si non-admin). */
async function createDevisAvec(
  request: APIRequestContext, token: string, clientId: number, overrides: Record<string, any> = {}
): Promise<number> {
  const res = await request.post('/api/devis', {
    headers: authHeader(token),
    data: {
      client_id: clientId,
      lignes: [{ description: 'Ecran remplace', quantite: 1, prix_unitaire_ht: 100, tva_taux: 20 }],
      ...overrides,
    },
  })
  if (!res.ok()) throw new Error(`creation devis failed: ${res.status()} ${await res.text()}`)
  return (await res.json()).id
}

/** Cree un devis (avec client email) cote boutique 1 via l'API admin. */
async function createDevisBoutique1(request: APIRequestContext): Promise<number> {
  const token    = await loginSeedAdmin(request)
  const clientId = await createClientPourDevis(request, token, { boutique_id: 1 })
  return createDevisAvec(request, token, clientId, { boutique_id: 1 })
}

test.describe('Isolation — Devis', () => {
  test('un manager d\'une autre boutique ne peut pas lire un devis qui ne lui appartient pas', async ({ request }) => {
    const devisId  = await createDevisBoutique1(request)
    const etranger = await createTenantAdmin(request)
    const res = await request.get(`/api/devis/${devisId}`, { headers: authHeader(etranger.accessToken) })
    expect([403, 404]).toContain(res.status())
  })

  test('le proprietaire legitime lit son propre devis', async ({ request }) => {
    const proprio  = await createTenantAdmin(request)
    const clientId = await createClientPourDevis(request, proprio.accessToken)
    const devisId  = await createDevisAvec(request, proprio.accessToken, clientId)

    const res = await request.get(`/api/devis/${devisId}`, { headers: authHeader(proprio.accessToken) })
    expect(res.status()).toBe(200)
  })

  test('l\'admin plateforme lit le devis de n\'importe quelle boutique', async ({ request }) => {
    const devisId = await createDevisBoutique1(request)
    const token    = await loginSeedAdmin(request)
    const res = await request.get(`/api/devis/${devisId}`, { headers: authHeader(token) })
    expect(res.status()).toBe(200)
  })

  test('un manager d\'une autre boutique ne peut pas modifier un devis qui ne lui appartient pas', async ({ request }) => {
    const devisId  = await createDevisBoutique1(request)
    const etranger = await createTenantAdmin(request)
    const res = await request.put(`/api/devis/${devisId}`, {
      headers: authHeader(etranger.accessToken),
      data: { notes: 'modifie par un tenant etranger' },
    })
    expect([403, 404]).toContain(res.status())
  })

  test('le proprietaire legitime modifie son propre devis', async ({ request }) => {
    const proprio  = await createTenantAdmin(request)
    const clientId = await createClientPourDevis(request, proprio.accessToken)
    const devisId  = await createDevisAvec(request, proprio.accessToken, clientId)

    const res = await request.put(`/api/devis/${devisId}`, {
      headers: authHeader(proprio.accessToken),
      data: { notes: 'modifie par son proprietaire' },
    })
    expect(res.status()).toBe(200)
  })

  test('l\'admin plateforme modifie le devis de n\'importe quelle boutique', async ({ request }) => {
    const devisId = await createDevisBoutique1(request)
    const token    = await loginSeedAdmin(request)
    const res = await request.put(`/api/devis/${devisId}`, {
      headers: authHeader(token),
      data: { notes: 'modifie par l\'admin plateforme' },
    })
    expect(res.status()).toBe(200)
  })

  // Ressource fraiche par test : PUT .../statut fait transiter un etat persistant.
  test('un manager d\'une autre boutique ne peut pas changer le statut d\'un devis qui ne lui appartient pas', async ({ request }) => {
    const devisId  = await createDevisBoutique1(request)
    const etranger = await createTenantAdmin(request)
    const res = await request.put(`/api/devis/${devisId}/statut`, {
      headers: authHeader(etranger.accessToken),
      data: { statut: 'envoye' },
    })
    expect([403, 404]).toContain(res.status())
  })

  test('le proprietaire legitime change le statut de son propre devis', async ({ request }) => {
    const proprio  = await createTenantAdmin(request)
    const clientId = await createClientPourDevis(request, proprio.accessToken)
    const devisId  = await createDevisAvec(request, proprio.accessToken, clientId)

    const res = await request.put(`/api/devis/${devisId}/statut`, {
      headers: authHeader(proprio.accessToken),
      data: { statut: 'envoye' },
    })
    expect(res.status()).toBe(200)
  })

  test('l\'admin plateforme change le statut du devis de n\'importe quelle boutique', async ({ request }) => {
    const devisId = await createDevisBoutique1(request)
    const token    = await loginSeedAdmin(request)
    const res = await request.put(`/api/devis/${devisId}/statut`, {
      headers: authHeader(token),
      data: { statut: 'envoye' },
    })
    expect(res.status()).toBe(200)
  })

  // Ressource fraiche par test : POST .../accord-manuel fait transiter un etat persistant.
  // La garde precede le controle metier (statut === 'envoye') : un devis fraichement
  // cree (statut draft) suffit pour prouver le refus, sans avoir a le faire transiter.
  test('un manager d\'une autre boutique ne peut pas valider manuellement l\'accord d\'un devis qui ne lui appartient pas', async ({ request }) => {
    const devisId  = await createDevisBoutique1(request)
    const etranger = await createTenantAdmin(request)
    const res = await request.post(`/api/devis/${devisId}/accord-manuel`, {
      headers: authHeader(etranger.accessToken),
    })
    expect([403, 404]).toContain(res.status())
  })

  test('le proprietaire legitime valide manuellement l\'accord de son propre devis', async ({ request }) => {
    const proprio  = await createTenantAdmin(request)
    const auth     = authHeader(proprio.accessToken)
    const clientId = await createClientPourDevis(request, proprio.accessToken)
    const devisId  = await createDevisAvec(request, proprio.accessToken, clientId)

    const envoiRes = await request.put(`/api/devis/${devisId}/statut`, { headers: auth, data: { statut: 'envoye' } })
    expect(envoiRes.status()).toBe(200)

    const res = await request.post(`/api/devis/${devisId}/accord-manuel`, { headers: auth })
    expect(res.status()).toBe(200)
  })

  test('l\'admin plateforme valide manuellement l\'accord du devis de n\'importe quelle boutique', async ({ request }) => {
    const devisId = await createDevisBoutique1(request)
    const token    = await loginSeedAdmin(request)
    const auth     = authHeader(token)

    const envoiRes = await request.put(`/api/devis/${devisId}/statut`, { headers: auth, data: { statut: 'envoye' } })
    expect(envoiRes.status()).toBe(200)

    const res = await request.post(`/api/devis/${devisId}/accord-manuel`, { headers: auth })
    expect(res.status()).toBe(200)
  })

  // Ressource fraiche par test : POST .../envoyer fait transiter un etat persistant et
  // declenche un envoi d'email best-effort (waitUntil(), catch() non bloquant dans le
  // handler — voir routes/facturation.ts). Aucune cle RESEND_API_KEY n'est configuree
  // dans cet environnement local (.dev.vars), donc l'email echoue reellement en
  // arriere-plan sans jamais impacter la reponse HTTP testee ici : ce test verifie la
  // garde d'isolation et le code de statut de la reponse, pas la livraison de l'email
  // (non testable proprement sans mock Resend ou vraie cle API).
  test('un manager d\'une autre boutique ne peut pas envoyer un devis qui ne lui appartient pas', async ({ request }) => {
    const devisId  = await createDevisBoutique1(request)
    const etranger = await createTenantAdmin(request)
    const res = await request.post(`/api/devis/${devisId}/envoyer`, {
      headers: authHeader(etranger.accessToken),
    })
    expect([403, 404]).toContain(res.status())
  })

  test('le proprietaire legitime envoie son propre devis', async ({ request }) => {
    const proprio  = await createTenantAdmin(request)
    const clientId = await createClientPourDevis(request, proprio.accessToken)
    const devisId  = await createDevisAvec(request, proprio.accessToken, clientId)

    const res = await request.post(`/api/devis/${devisId}/envoyer`, { headers: authHeader(proprio.accessToken) })
    expect(res.status()).toBe(200)
  })

  test('l\'admin plateforme envoie le devis de n\'importe quelle boutique', async ({ request }) => {
    const devisId = await createDevisBoutique1(request)
    const token    = await loginSeedAdmin(request)
    const res = await request.post(`/api/devis/${devisId}/envoyer`, { headers: authHeader(token) })
    expect(res.status()).toBe(200)
  })
})
