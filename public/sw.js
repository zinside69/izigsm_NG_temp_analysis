/**
 * sw.js — Service Worker iziGSM
 * Sprint 2.14 — Cache offline + install prompt
 *
 * Stratégie :
 *   - App Shell (HTML/CSS/JS) : Cache First → offline garanti
 *   - API (/api/*) : Network First → données fraîches, fallback cache
 *   - Assets statiques : Cache First avec revalidation en arrière-plan (Stale-While-Revalidate)
 *
 * Versioning : incrémenter CACHE_VERSION à chaque déploiement majeur
 */

const CACHE_VERSION  = 'izigsm-v2.60'
const CACHE_STATIC   = `${CACHE_VERSION}-static`
const CACHE_PAGES    = `${CACHE_VERSION}-pages`
const CACHE_API      = `${CACHE_VERSION}-api`

// ─── App Shell : fichiers mis en cache à l'installation ──────────────────────
const APP_SHELL = [
  '/dashboard',
  '/tickets',
  '/clients',
  '/factures',
  '/caisse',
  '/agenda',
  '/stock',
  '/sav',
  '/settings',
  '/login',
  '/static/css/main.css',
  '/static/css/print.css',
  '/static/js/app.js',
  '/static/js/dashboard.js',
  '/static/js/tickets.js',
  '/static/js/factures.js',
  '/static/js/caisse.js',
  '/static/js/agenda.js',
  '/static/js/clients.js',
  '/static/js/stock.js',
  '/static/js/sav.js',
  '/manifest.json',
  '/favicon.svg',
  '/static/img/icon-192.svg',
  '/static/img/icon-512.svg',
  // Chart.js CDN (préchargé)
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
]

// ─── Patterns API à mettre en cache (GET seulement, TTL court) ───────────────
const API_CACHE_PATTERNS = [
  /\/api\/boutiques/,
  /\/api\/services/,
  /\/api\/produits/,
]

// ─── Install : précache App Shell ────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Install v' + CACHE_VERSION)
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => {
        // Précache le Shell en ignorant les erreurs individuelles (fichier manquant = non bloquant)
        return Promise.allSettled(
          APP_SHELL.map(url =>
            cache.add(url).catch(err =>
              console.warn('[SW] Précache ignoré :', url, err.message)
            )
          )
        )
      })
      .then(() => self.skipWaiting()) // Prendre le contrôle immédiatement
  )
})

// ─── Activate : purger les anciens caches ────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activate v' + CACHE_VERSION)
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_STATIC && k !== CACHE_PAGES && k !== CACHE_API)
            .map(k => {
              console.log('[SW] Suppression ancien cache :', k)
              return caches.delete(k)
            })
      )
    ).then(() => self.clients.claim())
  )
})

// ─── Fetch : stratégies différenciées ────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  // Ignorer les requêtes non-GET et les extensions Chrome
  if (request.method !== 'GET') return
  if (url.protocol === 'chrome-extension:') return

  // ── 1. Requêtes API : Network First + cache court ──────────────────────────
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstApi(request, url))
    return
  }

  // ── 2. Assets statiques CDN : Stale-While-Revalidate ─────────────────────
  if (url.hostname.includes('jsdelivr') ||
      url.hostname.includes('googleapis') ||
      url.hostname.includes('gstatic')) {
    event.respondWith(staleWhileRevalidate(request, CACHE_STATIC))
    return
  }

  // ── 3. Pages HTML et assets locaux : Cache First ──────────────────────────
  event.respondWith(cacheFirst(request))
})

// ─── Stratégie Network First (API) ───────────────────────────────────────────
async function networkFirstApi(request, url) {
  try {
    const response = await fetch(request.clone())

    // Mettre en cache uniquement les GET réussis sur endpoints sûrs
    if (response.ok && API_CACHE_PATTERNS.some(p => p.test(url.pathname))) {
      const cache = await caches.open(CACHE_API)
      cache.put(request, response.clone())
    }

    return response
  } catch {
    // Offline : retourner le cache si disponible
    const cached = await caches.match(request)
    if (cached) return cached

    // Fallback JSON pour les API sans cache
    return new Response(
      JSON.stringify({ success: false, error: 'Hors ligne — données non disponibles.', offline: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// ─── Stratégie Cache First ────────────────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request.clone())
    if (response.ok) {
      const cache = await caches.open(CACHE_PAGES)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    // Offline et pas en cache → retourner la page login comme fallback
    const fallback = await caches.match('/login')
    return fallback || new Response('Hors ligne', { status: 503 })
  }
}

// ─── Stratégie Stale-While-Revalidate (CDN) ──────────────────────────────────
async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName)
  const cached = await cache.match(request)

  const networkFetch = fetch(request.clone())
    .then(response => {
      if (response.ok) cache.put(request, response.clone())
      return response
    })
    .catch(() => cached) // Si réseau down, garder le cache silencieusement

  return cached || networkFetch
}

// ─── Messages depuis l'app ────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    event.ports[0]?.postMessage({ success: true })
  }
})
