/**
 * iziGSM — app.js
 * Fonctions partagées : auth guard, sidebar, modals, storage, utils
 */

// ======================== AUTH ========================
function requireAuth() {
  const session = JSON.parse(localStorage.getItem('izigsm_session') || 'null');
  if (!session) {
    window.location.href = '/login.html';
    return null;
  }
  return session;
}

function logout() {
  localStorage.removeItem('izigsm_session');
  window.location.href = '/login.html';
}

// ======================== SIDEBAR ========================
function buildSidebar(activePage) {
  const session = requireAuth();
  if (!session) return;

  const initials = ((session.name || 'JD').split(' ').map(w => w[0]).join('').toUpperCase()).slice(0,2);
  const company = session.company || 'Mon Atelier';

  const pages = [
    { id:'dashboard', icon:'🏠', label:'Tableau de bord', href:'dashboard.html', section:'principal', badge: null },
    { id:'tickets', icon:'🔧', label:'Prises en charge', href:'tickets.html', section:'principal', badge: getTicketBadge() },
    { id:'devis', icon:'📋', label:'Devis', href:'devis.html', section:'principal', badge: null },
    { id:'factures', icon:'💶', label:'Factures', href:'factures.html', section:'principal', badge: null },
    { id:'qualirepar', icon:'🌿', label:'QualiRépar', href:'qualirepar.html', section:'subvention', badge: getQRBadge() },
    { id:'stock', icon:'📦', label:'Stock', href:'stock.html', section:'gestion', badge: getStockAlert() },
    { id:'rachats', icon:'📒', label:'Livre de police', href:'rachats.html', section:'gestion', badge: null },
    { id:'clients', icon:'👥', label:'Clients', href:'clients.html', section:'gestion', badge: null },
    { id:'personnel', icon:'🕐', label:'Personnel', href:'personnel.html', section:'gestion', badge: null },
    { id:'settings', icon:'⚙️', label:'Paramètres', href:'settings.html', section:'config', badge: null },
    { id:'modules', icon:'🧩', label:'Modules', href:'modules.html', section:'config', badge: null },
  ];

  const sections = {
    principal: 'Principal',
    subvention: 'Subvention',
    gestion: 'Gestion',
    config: 'Configuration',
  };

  let sectionsRendered = {};
  let navHtml = '';
  pages.forEach(p => {
    if (!sectionsRendered[p.section]) {
      navHtml += `<div class="sidebar-section-title">${sections[p.section]}</div>`;
      sectionsRendered[p.section] = true;
    }
    const isActive = p.id === activePage;
    const badge = p.badge ? `<span class="nav-badge" style="${p.id==='qualirepar'?'background:#059669;':''}">${p.badge}</span>` : '';
    navHtml += `<a class="nav-item${isActive?' active':''}" href="${p.href}">
      <span class="nav-icon">${p.icon}</span> ${p.label} ${badge}
    </a>`;
  });

  const html = `
    <nav class="sidebar" id="sidebar">
      <div class="sidebar-logo">
        <span class="s-mark">i</span>
        <span class="s-name">iziGSM</span>
        <span class="s-plan">Essai</span>
      </div>
      <div class="sidebar-nav">${navHtml}</div>
      <div class="sidebar-footer">
        <div class="sidebar-user" onclick="window.location.href='settings.html'">
          <div class="user-avatar">${initials}</div>
          <div class="user-info">
            <div class="u-name">${session.name || 'Utilisateur'}</div>
            <div class="u-role">${company}</div>
          </div>
          <span class="user-chevron">›</span>
        </div>
        <a class="nav-item" href="#" onclick="logout()" style="margin-top:4px;">
          <span class="nav-icon">🚪</span> Se déconnecter
        </a>
      </div>
    </nav>`;

  const placeholder = document.getElementById('sidebar-placeholder');
  if (placeholder) placeholder.outerHTML = html;

  // Topbar avatar
  const av = document.getElementById('topbar-avatar');
  if (av) av.textContent = initials;
}

function getTicketBadge() {
  const tickets = getDB('tickets').filter(t => t.status === 'En cours' || t.status === 'Nouveau');
  return tickets.length > 0 ? tickets.length : null;
}
function getQRBadge() {
  const qr = getDB('qualirepar').filter(q => q.status === 'Soumis');
  return qr.length > 0 ? qr.length : null;
}
function getStockAlert() {
  const parts = getDB('stock').filter(p => p.qty <= p.threshold);
  return parts.length > 0 ? parts.length : null;
}

// ======================== STORAGE (localStorage comme DB simulée) ========================
function getDB(key) {
  try { return JSON.parse(localStorage.getItem('izigsm_' + key) || '[]'); }
  catch { return []; }
}
function setDB(key, data) {
  localStorage.setItem('izigsm_' + key, JSON.stringify(data));
}
function addToDB(key, item) {
  const data = getDB(key);
  const newItem = { ...item, id: Date.now(), createdAt: new Date().toISOString() };
  data.unshift(newItem);
  setDB(key, data);
  return newItem;
}
function updateInDB(key, id, updates) {
  const data = getDB(key);
  const idx = data.findIndex(i => i.id === id);
  if (idx !== -1) { data[idx] = { ...data[idx], ...updates, updatedAt: new Date().toISOString() }; setDB(key, data); }
}
function deleteFromDB(key, id) {
  const data = getDB(key).filter(i => i.id !== id);
  setDB(key, data);
}

// ======================== SEED DATA ========================
function initSeedData() {
  // Ne seeder qu'une fois
  if (localStorage.getItem('izigsm_seeded')) return;

  // Clients de démo
  const clients = [
    { id:1001, first:'Martin', last:'Dubois', email:'martin.dubois@gmail.com', phone:'+33 6 12 34 56 78', address:'14 Rue des Fleurs, 75001 Paris', createdAt:'2025-01-15T10:00:00Z' },
    { id:1002, first:'Sophie', last:'Bernard', email:'sophie.b@hotmail.fr', phone:'+33 7 98 76 54 32', address:'8 Avenue Victor Hugo, 69001 Lyon', createdAt:'2025-02-01T14:30:00Z' },
    { id:1003, first:'Lucas', last:'Martin', email:'l.martin@outlook.com', phone:'+33 6 55 44 33 22', address:'22 Bd Gambetta, 31000 Toulouse', createdAt:'2025-03-10T09:15:00Z' },
    { id:1004, first:'Camille', last:'Petit', email:'camille.petit@icloud.com', phone:'+33 6 77 88 99 00', address:'5 Rue de la République, 13001 Marseille', createdAt:'2025-04-05T16:45:00Z' },
    { id:1005, first:'Thomas', last:'Leroy', email:'thomas.leroy@gmail.com', phone:'+33 7 11 22 33 44', address:'30 Rue Nationale, 59000 Lille', createdAt:'2025-04-20T11:20:00Z' },
  ];
  setDB('clients', clients);

  // Tickets de démo
  const tickets = [
    { id:2001, clientId:1001, clientName:'Martin Dubois', deviceType:'iPhone', deviceModel:'iPhone 14 Pro Max', imei:'352999111234567', description:'Écran cassé suite à une chute', notes:'Client veut récupérer sous 48h', status:'En cours', priority:'Haute', technician:'Jean D.', price:189.90, hasSignature:true, attachments:[], createdAt:'2025-12-01T09:00:00Z' },
    { id:2002, clientId:1002, clientName:'Sophie Bernard', deviceType:'Samsung', deviceModel:'Galaxy S23', imei:'', description:'Batterie qui ne charge plus', notes:'', status:'Nouveau', priority:'Moyenne', technician:'Marie L.', price:79.00, hasSignature:false, attachments:[], createdAt:'2025-12-02T11:30:00Z' },
    { id:2003, clientId:1003, clientName:'Lucas Martin', deviceType:'iPhone', deviceModel:'iPhone 13', imei:'352111222333444', description:'Connecteur Lightning cassé', notes:'', status:'Terminé', priority:'Basse', technician:'Jean D.', price:59.00, hasSignature:true, attachments:[], createdAt:'2025-11-28T14:00:00Z' },
    { id:2004, clientId:1004, clientName:'Camille Petit', deviceType:'iPad', deviceModel:'iPad Pro 11"', imei:'', description:'Écran tactile non fonctionnel', notes:'Appareil professionnel - urgent', status:'En cours', priority:'Haute', technician:'Pierre M.', price:249.00, hasSignature:true, attachments:[], createdAt:'2025-12-03T08:30:00Z' },
    { id:2005, clientId:1005, clientName:'Thomas Leroy', deviceType:'Ordinateur', deviceModel:'MacBook Air M2', imei:'', description:'Ne démarre plus après une mise à jour', notes:'', status:'Nouveau', priority:'Moyenne', technician:'Non assigné', price:120.00, hasSignature:false, attachments:[], createdAt:'2025-12-04T10:00:00Z' },
  ];
  setDB('tickets', tickets);

  // Devis de démo
  const devis = [
    { id:3001, number:'DEV-2026-0001', clientId:1001, clientName:'Martin Dubois', ticketId:2001, description:'Remplacement écran iPhone 14 Pro Max', lines:[{desc:'Écran OLED iPhone 14 Pro Max',qty:1,unitPrice:159.90,total:159.90},{desc:'Main d\'œuvre',qty:1,unitPrice:30.00,total:30.00}], subtotalHT:189.90, tva:37.98, totalTTC:227.88, status:'Accepté', validity:30, createdAt:'2025-12-01T10:00:00Z' },
    { id:3002, number:'DEV-2026-0002', clientId:1002, clientName:'Sophie Bernard', ticketId:2002, description:'Remplacement batterie Samsung Galaxy S23', lines:[{desc:'Batterie Samsung S23',qty:1,unitPrice:49.00,total:49.00},{desc:'Main d\'œuvre',qty:1,unitPrice:30.00,total:30.00}], subtotalHT:79.00, tva:15.80, totalTTC:94.80, status:'Envoyé', validity:30, createdAt:'2025-12-02T12:00:00Z' },
    { id:3003, number:'DEV-2026-0003', clientId:1004, clientName:'Camille Petit', ticketId:2004, description:'Remplacement écran iPad Pro 11"', lines:[{desc:'Écran iPad Pro 11"',qty:1,unitPrice:219.00,total:219.00},{desc:'Main d\'œuvre',qty:1,unitPrice:30.00,total:30.00}], subtotalHT:249.00, tva:49.80, totalTTC:298.80, status:'Brouillon', validity:15, createdAt:'2025-12-03T09:00:00Z' },
  ];
  setDB('devis', devis);

  // Factures de démo
  const factures = [
    { id:4001, number:'FAC-2026-0001', clientId:1003, clientName:'Lucas Martin', devisId:null, description:'Réparation connecteur iPhone 13', lines:[{desc:'Connecteur Lightning',qty:1,unitPrice:29.00,total:29.00},{desc:'Main d\'œuvre',qty:1,unitPrice:30.00,total:30.00}], subtotalHT:59.00, tva:11.80, totalTTC:70.80, status:'Payée', paymentMethod:'Espèces', createdAt:'2025-11-29T15:00:00Z' },
    { id:4002, number:'FAC-2026-0002', clientId:1001, clientName:'Martin Dubois', devisId:3001, description:'Remplacement écran iPhone 14 Pro Max', lines:[{desc:'Écran OLED iPhone 14 Pro Max',qty:1,unitPrice:159.90,total:159.90},{desc:'Main d\'œuvre',qty:1,unitPrice:30.00,total:30.00}], subtotalHT:189.90, tva:37.98, totalTTC:227.88, status:'Envoyée', paymentMethod:'Virement bancaire', createdAt:'2025-12-01T16:00:00Z' },
  ];
  setDB('factures', factures);

  // QualiRépar de démo
  const qr = [
    { id:5001, number:'QR-2026-0001', ticketId:2003, clientName:'Lucas Martin', deviceType:'Smartphone', deviceModel:'iPhone 13', repairType:'Remplacement batterie', amount:59.00, bonus:25, status:'Validé', source:'ADEME', createdAt:'2025-11-30T10:00:00Z' },
    { id:5002, number:'QR-2026-0002', ticketId:2001, clientName:'Martin Dubois', deviceType:'Smartphone', deviceModel:'iPhone 14 Pro Max', repairType:'Remplacement écran', amount:189.90, bonus:25, status:'En instruction', source:'ADEME', createdAt:'2025-12-02T11:00:00Z' },
    { id:5003, number:'QR-2026-0003', ticketId:2004, clientName:'Camille Petit', deviceType:'Tablette', deviceModel:'iPad Pro 11"', repairType:'Remplacement écran', amount:249.00, bonus:45, status:'Soumis', source:'ADEME', createdAt:'2025-12-04T09:00:00Z' },
  ];
  setDB('qualirepar', qr);

  // Stock de démo
  const stock = [
    { id:6001, ref:'SCR-IPH14PM-001', name:'Écran OLED iPhone 14 Pro Max', category:'Écran', compat:'iPhone 14 Pro Max', qty:3, threshold:2, buyPrice:145.00, sellPrice:159.90 },
    { id:6002, ref:'BAT-SGS23-001', name:'Batterie Samsung Galaxy S23', category:'Batterie', compat:'Samsung S23', qty:8, threshold:3, buyPrice:32.00, sellPrice:49.00 },
    { id:6003, ref:'CNX-IPH13-001', name:'Connecteur Lightning iPhone 13', category:'Connecteur', compat:'iPhone 12/13', qty:1, threshold:2, buyPrice:18.00, sellPrice:29.00 },
    { id:6004, ref:'SCR-IPAD11-001', name:'Écran iPad Pro 11"', category:'Écran', compat:'iPad Pro 11" 3e gen', qty:2, threshold:1, buyPrice:185.00, sellPrice:219.00 },
    { id:6005, ref:'BAT-IPH14-001', name:'Batterie iPhone 14', category:'Batterie', compat:'iPhone 14', qty:5, threshold:3, buyPrice:28.00, sellPrice:45.00 },
    { id:6006, ref:'SCR-SGS22-001', name:'Écran Samsung Galaxy S22', category:'Écran', compat:'Samsung S22', qty:0, threshold:2, buyPrice:98.00, sellPrice:129.00 },
  ];
  setDB('stock', stock);

  localStorage.setItem('izigsm_seeded', '1');
}

// ======================== MODALS ========================
function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.add('open'); document.body.style.overflow = 'hidden'; }
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.remove('open'); document.body.style.overflow = ''; }
}

// Fermer modal en cliquant en dehors
document.addEventListener('click', function(e) {
  if (e.target.classList.contains('modal-overlay')) closeModal(e.target.id);
});

// ======================== TABS ========================
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  const tabEl = document.getElementById('tab-' + tabId);
  if (tabEl) tabEl.classList.add('active');
  if (event) event.currentTarget.classList.add('active');
}

// ======================== UTILS ========================
function formatDate(isoStr, short = false) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (short) return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'2-digit' });
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function formatMoney(val) {
  return new Intl.NumberFormat('fr-FR', { style:'currency', currency:'EUR' }).format(val || 0);
}

function statusBadge(status) {
  const map = {
    'Nouveau': 'status-new',
    'En cours': 'status-progress',
    'Terminé': 'status-done',
    'Annulé': 'status-cancelled',
    'Envoyé': 'status-sent',
    'Envoyée': 'status-sent',
    'Accepté': 'status-done',
    'Payée': 'status-paid',
    'Payé': 'status-paid',
    'Brouillon': 'status-draft',
    'Refusé': 'status-cancelled',
    'Expiré': 'status-cancelled',
    'Soumis': 'status-sent',
    'En instruction': 'status-pending',
    'Validé': 'status-done',
  };
  const cls = map[status] || 'status-draft';
  return `<span class="status-badge ${cls}">${status}</span>`;
}

function priorityLabel(p) {
  if (p === 'Haute') return `<span class="priority-high">↑ Haute</span>`;
  if (p === 'Moyenne') return `<span class="priority-medium">→ Moyenne</span>`;
  return `<span class="priority-low">↓ Basse</span>`;
}

function showFlash(msg, type='success') {
  const f = document.createElement('div');
  f.className = 'flash ' + type;
  f.style.cssText = 'position:fixed;top:24px;right:24px;z-index:9999;min-width:300px;max-width:420px;box-shadow:0 8px 30px rgba(0,0,0,0.15);';
  f.textContent = msg;
  document.body.appendChild(f);
  setTimeout(() => { f.style.opacity='0'; f.style.transition='opacity .4s'; setTimeout(()=>f.remove(), 400); }, 3000);
}

function generateNumber(prefix, items) {
  const n = (items.length + 1).toString().padStart(4, '0');
  return `${prefix}${n}`;
}

// ======================== INIT ========================
document.addEventListener('DOMContentLoaded', function() {
  initSeedData();
  // Mettre à jour l'avatar topbar si session
  const session = JSON.parse(localStorage.getItem('izigsm_session') || 'null');
  if (session) {
    const initials = (session.name || 'JD').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
    const av = document.getElementById('topbar-avatar');
    if (av) av.textContent = initials;
  }
});

// ======================== API HELPERS (JWT réel) ========================

/**
 * Récupère le JWT stocké (localStorage ou sessionStorage)
 */
function getToken() {
  return localStorage.getItem('izigsm_token') || sessionStorage.getItem('izigsm_token') || '';
}

/**
 * Stocke le JWT et la session après login
 * @param {string} token - JWT access token
 * @param {string} refreshToken - Refresh token
 * @param {object} user - Payload utilisateur { id, email, nom, prenom, role, boutique_id, boutique_name }
 * @param {boolean} remember - Si true, stocker en localStorage (persistant), sinon sessionStorage
 */
function storeSession(token, refreshToken, user, remember = true) {
  const session = {
    name:         `${user.prenom || ''} ${user.nom || ''}`.trim() || user.email,
    email:        user.email,
    role:         user.role,
    boutique_id:  user.boutique_id,
    boutique_name: user.boutique_name || 'Mon Atelier',
    company:      user.boutique_name || 'Mon Atelier',
  };

  if (remember) {
    localStorage.setItem('izigsm_token', token);
    localStorage.setItem('izigsm_refresh_token', refreshToken);
    localStorage.setItem('izigsm_session', JSON.stringify(session));
  } else {
    sessionStorage.setItem('izigsm_token', token);
    sessionStorage.setItem('izigsm_refresh_token', refreshToken);
    sessionStorage.setItem('izigsm_session', JSON.stringify(session));
  }
}

/**
 * Headers HTTP avec Authorization Bearer
 */
function authHeaders(extra = {}) {
  const token = getToken();
  const base = { 'Content-Type': 'application/json' };
  if (token) base['Authorization'] = `Bearer ${token}`;
  return { ...base, ...extra };
}

/**
 * Wrapper fetch avec gestion automatique 401 → refresh token → retry
 * Retourne { ok, data, status, error }
 */
async function api(method, url, body = null, opts = {}) {
  const options = {
    method: method.toUpperCase(),
    headers: authHeaders(opts.headers || {}),
  };
  if (body && method.toUpperCase() !== 'GET') {
    options.body = JSON.stringify(body);
  }

  let res = await fetch(url, options);

  // 401 → tentative de refresh (sauf si skipAuth : appels sans session comme /api/register)
  if (res.status === 401 && !opts._retry && !opts.skipAuth) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      return api(method, url, body, { ...opts, _retry: true });
    }
    // Refresh échoué → redirection login
    localStorage.removeItem('izigsm_token');
    localStorage.removeItem('izigsm_session');
    sessionStorage.removeItem('izigsm_token');
    sessionStorage.removeItem('izigsm_session');
    window.location.href = '/login.html';
    return { ok: false, status: 401, error: 'Session expirée' };
  }

  let data = null;
  try { data = await res.json(); } catch { data = null; }

  return {
    ok:     res.ok,
    status: res.status,
    data,
    error:  res.ok ? null : (data?.error || `Erreur HTTP ${res.status}`),
  };
}

/**
 * Tente de renouveler le JWT avec le refresh token
 * Retourne true si succès, false sinon
 */
async function tryRefreshToken() {
  const refresh = localStorage.getItem('izigsm_refresh_token') || sessionStorage.getItem('izigsm_refresh_token');
  const session = JSON.parse(localStorage.getItem('izigsm_session') || sessionStorage.getItem('izigsm_session') || 'null');
  if (!refresh || !session) return false;

  try {
    const res = await fetch('/api/auth/refresh', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ refresh_token: refresh, user_id: session.id }),
    });
    if (!res.ok) return false;

    const data = await res.json();
    if (!data.success || !data.access_token) return false;

    // Mettre à jour le token
    if (localStorage.getItem('izigsm_token')) {
      localStorage.setItem('izigsm_token', data.access_token);
      if (data.refresh_token) localStorage.setItem('izigsm_refresh_token', data.refresh_token);
    } else {
      sessionStorage.setItem('izigsm_token', data.access_token);
      if (data.refresh_token) sessionStorage.setItem('izigsm_refresh_token', data.refresh_token);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * GET helper
 */
async function apiGet(url, params = {}) {
  const qs = Object.keys(params).length
    ? '?' + new URLSearchParams(params).toString()
    : '';
  return api('GET', url + qs);
}

/**
 * POST helper
 */
async function apiPost(url, body) {
  return api('POST', url, body);
}

/**
 * PUT helper
 */
async function apiPut(url, body) {
  return api('PUT', url, body);
}

/**
 * DELETE helper
 */
async function apiDelete(url) {
  return api('DELETE', url);
}

/**
 * PATCH helper — mise à jour partielle d'une ressource
 */
async function apiPatch(url, body) {
  return api('PATCH', url, body);
}

/**
 * POST helper sans authentification — pour les endpoints publics (register, etc.)
 * N'effectue pas de redirect 401 si la session est absente.
 */
async function apiPostPublic(url, body) {
  return api('POST', url, body, { skipAuth: true });
}

/**
 * Téléchargement d'un fichier binaire (CSV, PDF…) via l'ApiService.
 * Gère le JWT automatiquement. Retourne un Blob ou null en cas d'erreur.
 * @param {string} url       - URL de l'endpoint (avec query string si nécessaire)
 * @param {string} filename  - Nom du fichier proposé au téléchargement
 */
async function apiBlobGet(url, filename) {
  const token = getToken();
  try {
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) { showFlash('⚠️ Export impossible.', 'error'); return null; }
    const blob = await res.blob();
    const burl = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = burl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(burl);
    return blob;
  } catch (err) {
    showFlash('⚠️ Erreur réseau lors du téléchargement.', 'error');
    return null;
  }
}

/**
 * logout amélioré : révoque le token côté serveur
 */
async function logout() {
  try {
    const token = getToken();
    if (token) {
      await fetch('/api/auth/logout', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
    }
  } catch { /* ignore */ }

  localStorage.removeItem('izigsm_token');
  localStorage.removeItem('izigsm_refresh_token');
  localStorage.removeItem('izigsm_session');
  sessionStorage.removeItem('izigsm_token');
  sessionStorage.removeItem('izigsm_refresh_token');
  sessionStorage.removeItem('izigsm_session');
  window.location.href = '/login.html';
}

/**
 * Vérifie l'auth : si pas de token → redirige
 * Compatible avec l'ancien requireAuth() qui retournait la session
 */
function requireAuth() {
  const token   = getToken();
  const session = JSON.parse(
    localStorage.getItem('izigsm_session') ||
    sessionStorage.getItem('izigsm_session') ||
    'null'
  );

  if (!token && !session) {
    window.location.href = '/login.html';
    return null;
  }
  return session;
}

/**
 * Vérifie si l'utilisateur a un rôle donné
 */
function hasRole(...roles) {
  const session = JSON.parse(
    localStorage.getItem('izigsm_session') ||
    sessionStorage.getItem('izigsm_session') ||
    'null'
  );
  if (!session) return false;
  return roles.includes(session.role);
}

/**
 * Retourne le boutique_id depuis la session
 */
function getBoutiqueId() {
  const session = JSON.parse(
    localStorage.getItem('izigsm_session') ||
    sessionStorage.getItem('izigsm_session') ||
    'null'
  );
  return session?.boutique_id ?? null;
}

// ══════════════════════════════════════════════════════════════════════════════
// PIN — Modal global (Sprint 2.3)
// ══════════════════════════════════════════════════════════════════════════════

let _pinCallback = null;

/**
 * Affiche le modal PIN et appelle callback() si PIN valide.
 * Si la session PIN est déjà active → callback direct sans modal.
 */
async function requirePinAction(callback) {
  // Vérifier si session PIN déjà active
  try {
    const result = await apiGet('/api/users/pin/status', {});
    if (result.ok && result.data?.session_active) {
      callback(); return;
    }
    // Vérifier si PIN configuré
    if (result.ok && !result.data?.pin_actif) {
      // Pas de PIN → demander au manager/admin de configurer
      showFlash('ℹ️ Aucun PIN configuré. Demandez à votre responsable.', 'info');
      return;
    }
  } catch { /* réseau KO, afficher le modal quand même */ }

  _pinCallback = callback;
  let modal = document.getElementById('modal-pin-global');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'modal-pin-global';
    modal.innerHTML = `
      <div class="modal" style="max-width:340px;text-align:center;">
        <div class="modal-header" style="justify-content:center;">
          <h2>🔐 Confirmation PIN</h2>
        </div>
        <div class="modal-body" style="padding:24px;">
          <p style="color:var(--muted);font-size:0.9rem;margin-bottom:20px;">
            Saisissez votre PIN pour confirmer cette action.
          </p>
          <input type="password" id="pin-input" inputmode="numeric" maxlength="6"
            placeholder="● ● ● ●" autocomplete="off"
            style="width:100%;text-align:center;font-size:1.5rem;letter-spacing:8px;
                   border:2px solid #e5e7eb;border-radius:12px;padding:12px;font:inherit;"
            onkeydown="if(event.key==='Enter') confirmPin()">
          <div id="pin-error" style="color:var(--red);font-size:0.82rem;margin-top:8px;min-height:18px;"></div>
        </div>
        <div class="modal-footer" style="justify-content:center;gap:12px;">
          <button class="btn btn-secondary" onclick="closeModal('modal-pin-global')">Annuler</button>
          <button class="btn btn-primary" onclick="confirmPin()">✓ Valider</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  // Reset
  const inp = document.getElementById('pin-input');
  const err = document.getElementById('pin-error');
  if (inp) inp.value = '';
  if (err) err.textContent = '';
  openModal('modal-pin-global');
  setTimeout(() => inp?.focus(), 100);
}

async function confirmPin() {
  const pin = document.getElementById('pin-input')?.value?.trim();
  const err = document.getElementById('pin-error');
  if (!pin) { if (err) err.textContent = 'PIN requis.'; return; }

  try {
    const result = await apiPost('/api/users/pin/verify', { pin });
    if (result.ok) {
      closeModal('modal-pin-global');
      if (_pinCallback) { _pinCallback(); _pinCallback = null; }
    } else {
      if (err) err.textContent = result.data?.error || 'PIN incorrect.';
      const inp = document.getElementById('pin-input');
      if (inp) { inp.value = ''; inp.focus(); }
    }
  } catch {
    if (err) err.textContent = 'Erreur réseau.';
  }
}

window.requirePinAction = requirePinAction;
window.confirmPin       = confirmPin;
