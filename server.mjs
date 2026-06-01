import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, 'dist')
const PORT = 3000

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
}

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0]

  // Retirer le trailing slash sauf pour /
  if (urlPath !== '/' && urlPath.endsWith('/')) urlPath = urlPath.slice(0, -1)

  // Mapping URL → fichier HTML
  const htmlMap = {
    '/':           'index.html',
    '/login':      'login.html',
    '/register':   'register.html',
    '/verify-email': 'verify-email.html',
    '/legal':      'legal.html',
    '/dashboard':  'dashboard.html',
    '/tickets':    'tickets.html',
    '/devis':      'devis.html',
    '/factures':   'factures.html',
    '/clients':    'clients.html',
    '/stock':      'stock.html',
    '/qualirepar': 'qualirepar.html',
    '/settings':   'settings.html',
    '/modules':    'modules.html',
  }

  // Route vers fichier HTML mappé
  if (htmlMap[urlPath]) {
    const file = path.join(DIST, htmlMap[urlPath])
    if (fs.existsSync(file)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      fs.createReadStream(file).pipe(res)
      return
    }
  }

  // Fichier statique (CSS, JS, images, etc.)
  const filePath = path.join(DIST, urlPath)
  const ext = path.extname(filePath)
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    fs.createReadStream(filePath).pipe(res)
    return
  }

  // 404 — renvoyer index.html pour SPA
  const idx = path.join(DIST, 'index.html')
  if (fs.existsSync(idx)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    fs.createReadStream(idx).pipe(res)
  } else {
    res.writeHead(404)
    res.end('404 Not Found')
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`iziGSM server running on http://0.0.0.0:${PORT}`)
})
