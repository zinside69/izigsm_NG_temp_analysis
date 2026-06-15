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
import agendaRoutes        from './routes/agenda'
import publicRoutes        from './routes/public'
import savRoutes           from './routes/sav'
import notificationsRoutes from './routes/notifications'
import caisseRoutes        from './routes/caisse'
import statsRoutes         from './routes/stats'
import { getOrCreateIcalToken, generateIcal } from './services/agendaService'

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
 *   /api/stats          → KPIs + graphiques dashboard (statsService.ts)
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
    version:   '2.13.0',
    sprint:    '2.13 — Export PDF + Dashboard graphiques',
    timestamp: new Date().toISOString(),
  })
})

// ─── Route iCal publique (SANS auth — avant tous les routers avec use('*', authMiddleware)) ──
// Accessible via webcal:// par les clients de calendrier (Google, Apple, Outlook…)
app.get('/api/calendar/:filename', async (c) => {
  try {
    const filename = c.req.param('filename')
    const token    = filename.endsWith('.ics') ? filename.slice(0, -4) : filename
    if (!token || token.length < 10)
      return c.json({ success: false, error: 'Token iCal invalide.' }, 400)

    const bt = await c.env.DB.prepare(
      'SELECT boutique_id FROM boutique_ical_tokens WHERE token = ?'
    ).bind(token).first<{ boutique_id: number }>()

    if (!bt) return c.json({ success: false, error: 'Token iCal invalide.' }, 404)

    const ics = await generateIcal(c.env.DB, bt.boutique_id)
    return new Response(ics, {
      headers: {
        'Content-Type':        'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="agenda-izigsm.ics"',
        'Cache-Control':       'no-cache, no-store',
      }
    })
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500)
  }
})

// ─── Routes ───────────────────────────────────────────────────────────────────
// IMPORTANT : l'ordre est critique — les routes avec params dynamiques (:id)
// doivent venir APRÈS les routes à segments fixes (avoirs, factures, devis…)
app.route('/api/auth',       authRoutes)
app.route('/api/public',     publicRoutes)         // /api/public/* (sans auth) ← AVANT tout router /api avec authMiddleware
app.route('/api',            facturationRoutes) // /api/devis/* + /api/factures/* + /api/avoirs/*
app.route('/api',            rachatsRoutes)        // /api/rachats/*
app.route('/api',            fournisseursRoutes)   // /api/fournisseurs/* + /api/bons-commande/*
app.route('/api',            agendaRoutes)         // /api/agenda/* + /api/calendar/*.ics
app.route('/api',            usersRoutes)       // /api/users/* (PIN + permissions)
app.route('/api',            servicesRoutes)    // /api/services/* + /api/services/categories/*
app.route('/api/tickets',    ticketsRoutes)     // /api/tickets/*
app.route('/api',            stocksRoutes)      // /api/produits/* + /api/categories/*
app.route('/api',            savRoutes)         // /api/garanties/* + /api/sav/* ← AVANT clients (évite capture par /:id)
app.route('/api',            notificationsRoutes) // /api/notifications/*
app.route('/api',            caisseRoutes)       // /api/caisse/* (POS + NF525)
app.route('/api',            statsRoutes)        // /api/stats/* (KPIs + graphiques) ← extraction violation backlog
app.route('/api/clients',    clientsRoutes)     // /api/clients/* + /api/clients/:id
app.route('/api',            personnelRoutes)   // /api/employes/* + /api/pointage/*
app.route('/api/boutiques',  boutiquesRoutes)

// ─── 404 fallback API ─────────────────────────────────────────────────────────
app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ success: false, error: `Route API introuvable : ${c.req.method} ${c.req.path}` }, 404)
  }
  // Pour les routes non-API, laisser Cloudflare Pages servir le HTML
  return c.notFound()
})

export default app
