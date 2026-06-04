import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Routes
import authRoutes       from './routes/auth'
import clientsRoutes    from './routes/clients'
import ticketsRoutes    from './routes/tickets'
import stocksRoutes     from './routes/stocks'
import facturationRoutes from './routes/facturation'
import personnelRoutes  from './routes/personnel'
import boutiquesRoutes  from './routes/boutiques'
import rachatsRoutes    from './routes/rachats'
import usersRoutes      from './routes/users'
import servicesRoutes      from './routes/services'
import fournisseursRoutes  from './routes/fournisseurs'

/**
 * iziGSM — API Backend Sprint 1 (Cloudflare Pages Functions)
 *
 * Architecture :
 * - HTML/CSS/JS dans dist/ → servis automatiquement par Cloudflare Pages CDN
 * - Hono Workers → gère uniquement les routes /api/*
 * - D1 (SQLite edge) → persistance de toutes les données
 * - KV → OTP (TTL 10min) + refresh tokens JWT (TTL 7j)
 *
 * Routes disponibles :
 *   /api/auth/*         → Authentification (register, login, refresh, logout, me)
 *   /api/clients/*      → CRUD clients + appareils
 *   /api/tickets/*      → CRUD tickets + machine à états statuts
 *   /api/produits/*     → CRUD produits + mouvements stock
 *   /api/categories/*   → CRUD catégories stock
 *   /api/devis/*        → CRUD devis + conversion → facture
 *   /api/factures/*     → CRUD factures + paiements
 *   /api/employes/*     → CRUD employés
 *   /api/pointage/*     → Pointage (machine à états) + rapports
 *   /api/boutiques/*    → CRUD boutiques + NF525 verify/cloture
 *   /api/stats          → KPIs dashboard (depuis D1)
 *   /api/health         → Health check
 */

type Bindings = {
  DB:         D1Database
  KV:         KVNamespace
  JWT_SECRET: string
}

const app = new Hono<{ Bindings: Bindings }>()

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use('/api/*', cors({
  origin: ['http://localhost:3000', 'https://izigsm.pages.dev'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}))

// ─── Health check (AVANT les routes avec :id dynamiques) ─────────────────────
app.get('/api/health', (c) => {
  return c.json({
    status:    'ok',
    app:       'iziGSM',
    version:   '2.5.0',
    sprint:    '2.5 — Fournisseurs + Bons de commande + CUMP',
    timestamp: new Date().toISOString(),
  })
})

// ─── Routes ───────────────────────────────────────────────────────────────────
// IMPORTANT : l'ordre est critique — les routes avec params dynamiques (:id)
// doivent venir APRÈS les routes à segments fixes (avoirs, factures, devis…)
app.route('/api/auth',       authRoutes)
app.route('/api',            facturationRoutes) // /api/devis/* + /api/factures/* + /api/avoirs/*
app.route('/api',            rachatsRoutes)        // /api/rachats/*
app.route('/api',            fournisseursRoutes)   // /api/fournisseurs/* + /api/bons-commande/*
app.route('/api',            usersRoutes)       // /api/users/* (PIN + permissions)
app.route('/api',            servicesRoutes)    // /api/services/* + /api/services/categories/*
app.route('/api',            ticketsRoutes)     // /api/tickets/*
app.route('/api',            stocksRoutes)      // /api/produits/* + /api/categories/*
app.route('/api',            clientsRoutes)     // /api/clients/* + /api/clients/:id  ← après routes fixes
app.route('/api',            personnelRoutes)   // /api/employes/* + /api/pointage/*
app.route('/api/boutiques',  boutiquesRoutes)

// ─── Dashboard stats (données réelles D1) ────────────────────────────────────
app.get('/api/stats', async (c) => {
  // Récupérer le JWT pour connaître la boutique
  const authHeader = c.req.header('Authorization')
  if (!authHeader) return c.json({ success: false, error: 'Non authentifié.' }, 401)

  const token = authHeader.slice(7)
  // Décoder le payload sans vérification (la vérification est dans authMiddleware)
  try {
    const [, payloadB64] = token.split('.')
    const pad = payloadB64.length % 4 === 0 ? '' : '='.repeat(4 - payloadB64.length % 4)
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/') + pad))
    const boutiqueId = payload.boutique_id ?? 1

    const [clients, tickets_en_cours, tickets_today, ca_mois, stock_bas, employes_en_poste] =
      await Promise.all([
        c.env.DB.prepare('SELECT COUNT(*) as cnt FROM clients WHERE boutique_id = ? AND actif = 1')
          .bind(boutiqueId).first<{ cnt: number }>(),
        c.env.DB.prepare("SELECT COUNT(*) as cnt FROM tickets WHERE boutique_id = ? AND statut NOT IN ('livre','annule') AND actif = 1")
          .bind(boutiqueId).first<{ cnt: number }>(),
        c.env.DB.prepare("SELECT COUNT(*) as cnt FROM tickets WHERE boutique_id = ? AND DATE(created_at) = DATE('now') AND actif = 1")
          .bind(boutiqueId).first<{ cnt: number }>(),
        c.env.DB.prepare("SELECT COALESCE(SUM(total_ttc),0) as ca FROM factures WHERE boutique_id = ? AND statut='payee' AND strftime('%Y-%m',date_emission) = strftime('%Y-%m','now')")
          .bind(boutiqueId).first<{ ca: number }>(),
        c.env.DB.prepare('SELECT COUNT(*) as cnt FROM produits WHERE boutique_id = ? AND stock_actuel <= stock_minimum AND actif = 1')
          .bind(boutiqueId).first<{ cnt: number }>(),
        c.env.DB.prepare("SELECT COUNT(*) as cnt FROM employes WHERE boutique_id = ? AND statut_pointage = 'en_poste' AND actif = 1")
          .bind(boutiqueId).first<{ cnt: number }>(),
      ])

    return c.json({
      success: true,
      data: {
        nb_clients:          clients?.cnt           ?? 0,
        tickets_en_cours:    tickets_en_cours?.cnt  ?? 0,
        tickets_aujourd_hui: tickets_today?.cnt     ?? 0,
        ca_mois:             ca_mois?.ca            ?? 0,
        stock_bas:           stock_bas?.cnt         ?? 0,
        employes_en_poste:   employes_en_poste?.cnt ?? 0,
      }
    })
  } catch {
    return c.json({ success: false, error: 'Erreur token.' }, 401)
  }
})

// ─── 404 fallback API ─────────────────────────────────────────────────────────
app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ success: false, error: `Route API introuvable : ${c.req.method} ${c.req.path}` }, 404)
  }
  // Pour les routes non-API, laisser Cloudflare Pages servir le HTML
  return c.notFound()
})

export default app
