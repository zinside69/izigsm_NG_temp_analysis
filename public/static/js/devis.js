/**
 * iziGSM — devis.js
 */

let devisLines = [];
let currentDevisId = null;

document.addEventListener('DOMContentLoaded', function() {
  buildSidebar('devis');
  renderDevis();
  populateDevisClients();
  checkFromTicket();
  addLine(); // Une ligne par défaut
});

function checkFromTicket() {
  const ticketId = localStorage.getItem('izigsm_new_devis_from_ticket');
  if (ticketId) {
    localStorage.removeItem('izigsm_new_devis_from_ticket');
    const ticket = getDB('tickets').find(t => t.id === parseInt(ticketId));
    if (ticket) {
      openNewDevis();
      document.getElementById('d-description').value = ticket.description;
      // Trouver le client
      const clientSelect = document.getElementById('d-client');
      const clients = getDB('clients');
      const client = clients.find(c => (c.first + ' ' + c.last) === ticket.clientName);
      if (client && clientSelect) clientSelect.value = client.id;
      // Pré-remplir une ligne
      devisLines = [];
      document.getElementById('devis-lines').innerHTML = '';
      addLine();
      const firstLine = devisLines[0];
      if (firstLine) {
        document.getElementById('dl-desc-' + firstLine).value = ticket.description;
        document.getElementById('dl-price-' + firstLine).value = ticket.price || '';
        updateLineTotals(firstLine);
      }
    }
  }
}

function renderDevis(filter = '', statusFilter = '') {
  let data = getDB('devis');
  if (filter) { const q = filter.toLowerCase(); data = data.filter(d => d.clientName?.toLowerCase().includes(q) || d.number?.toLowerCase().includes(q)); }
  if (statusFilter) data = data.filter(d => d.status === statusFilter);

  const tbody = document.getElementById('devis-table');
  const empty = document.getElementById('devis-empty');
  if (!tbody) return;

  if (!data.length) { tbody.innerHTML = ''; empty?.classList.remove('hidden'); return; }
  empty?.classList.add('hidden');

  tbody.innerHTML = data.map(d => `
    <tr>
      <td><span style="font-weight:700;color:var(--primary);">${esc(d.number)}</span></td>
      <td>${esc(d.clientName)}</td>
      <td><span style="font-size:0.88rem;color:var(--muted);">${esc(d.description || '').slice(0,40)}…</span></td>
      <td>${formatMoney(d.subtotalHT)}</td>
      <td>${formatMoney(d.tva)}</td>
      <td><strong>${formatMoney(d.totalTTC)}</strong></td>
      <td>${statusBadge(d.status)}</td>
      <td>${formatDate(d.createdAt, true)}</td>
      <td><span style="font-size:0.85rem;color:var(--muted);">${d.validity}j</span></td>
      <td>
        <div class="row-actions">
          <button class="btn btn-ghost btn-sm" onclick="convertToFacture(${d.id})">→ Facture</button>
          <button class="btn btn-ghost btn-icon" onclick="deleteDevis(${d.id})" style="color:var(--red);">🗑</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function filterDevis(val) { renderDevis(val, document.getElementById('filter-devis-status')?.value || ''); }
function filterDevisStatus(val) { renderDevis(document.getElementById('search-devis')?.value || '', val); }

function openNewDevis() {
  currentDevisId = null;
  devisLines = [];
  document.getElementById('devis-lines').innerHTML = '';
  ['d-description','d-notes'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('d-status').value = 'Brouillon';
  document.getElementById('d-validity').value = '30';
  const dTicket = document.getElementById('d-ticket');
  if (dTicket) {
    dTicket.innerHTML = '<option value="">Aucun</option>';
    getDB('tickets').forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `#${String(t.id).slice(-4)} — ${t.clientName} (${t.deviceType} ${t.deviceModel})`;
      dTicket.appendChild(opt);
    });
  }
  addLine();
  updateDevisTotals();
  openModal('modal-devis');
}

function saveDevis(status) {
  const clientSelect = document.getElementById('d-client');
  const clientName = clientSelect?.options[clientSelect.selectedIndex]?.text || 'Client';
  const description = document.getElementById('d-description').value.trim();

  const lines = devisLines.map(lid => ({
    desc: document.getElementById('dl-desc-'+lid)?.value || '',
    qty: parseFloat(document.getElementById('dl-qty-'+lid)?.value) || 1,
    unitPrice: parseFloat(document.getElementById('dl-price-'+lid)?.value) || 0,
    get total() { return this.qty * this.unitPrice; }
  }));
  const linesData = lines.map(l => ({ desc: l.desc, qty: l.qty, unitPrice: l.unitPrice, total: l.qty * l.unitPrice }));
  const subtotalHT = linesData.reduce((s,l) => s + l.total, 0);
  const tva = subtotalHT * 0.2;

  const existing = getDB('devis');
  const item = {
    number: generateNumber('DEV-2026-', existing),
    clientId: clientSelect?.value || null,
    clientName,
    ticketId: document.getElementById('d-ticket')?.value || null,
    description,
    lines: linesData,
    subtotalHT,
    tva,
    totalTTC: subtotalHT + tva,
    status,
    validity: parseInt(document.getElementById('d-validity')?.value) || 30,
    notes: document.getElementById('d-notes')?.value || '',
  };

  addToDB('devis', item);
  closeModal('modal-devis');
  renderDevis();
  showFlash(`✓ Devis ${item.number} ${status === 'Envoyé' ? 'envoyé' : 'enregistré en brouillon'}`);
}

function convertToFacture(id) {
  const d = getDB('devis').find(x => x.id === id);
  if (!d) return;
  localStorage.setItem('izigsm_devis_to_facture', JSON.stringify(d));
  window.location.href = 'factures.html';
}

function deleteDevis(id) {
  if (!confirm('Supprimer ce devis ?')) return;
  deleteFromDB('devis', id);
  renderDevis();
  showFlash('✓ Devis supprimé', 'info');
}

// ======================== LIGNES ========================
function addLine() {
  const lid = Date.now();
  devisLines.push(lid);
  const tbody = document.getElementById('devis-lines');
  if (!tbody) return;
  const tr = document.createElement('tr');
  tr.id = 'dl-row-' + lid;
  tr.innerHTML = `
    <td style="padding:6px 8px;">
      <input type="text" id="dl-desc-${lid}" placeholder="Description…" style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:6px 10px;font:inherit;font-size:0.88rem;">
    </td>
    <td style="padding:6px 8px;">
      <input type="number" id="dl-qty-${lid}" value="1" min="1" style="width:70px;border:1px solid #e5e7eb;border-radius:8px;padding:6px 8px;font:inherit;font-size:0.88rem;text-align:right;" oninput="updateLineTotals(${lid})">
    </td>
    <td style="padding:6px 8px;">
      <input type="number" id="dl-price-${lid}" value="" min="0" step="0.01" placeholder="0.00" style="width:100px;border:1px solid #e5e7eb;border-radius:8px;padding:6px 8px;font:inherit;font-size:0.88rem;text-align:right;" oninput="updateLineTotals(${lid})">
    </td>
    <td style="padding:6px 12px;text-align:right;">
      <span id="dl-total-${lid}" style="font-weight:600;font-size:0.92rem;">0,00 €</span>
    </td>
    <td style="padding:6px 4px;text-align:center;">
      <button onclick="removeLine(${lid})" style="border:none;background:none;cursor:pointer;color:var(--muted);font-size:1rem;">✕</button>
    </td>
  `;
  tbody.appendChild(tr);
}

function removeLine(lid) {
  if (devisLines.length <= 1) return;
  devisLines = devisLines.filter(l => l !== lid);
  document.getElementById('dl-row-' + lid)?.remove();
  updateDevisTotals();
}

function updateLineTotals(lid) {
  const qty = parseFloat(document.getElementById('dl-qty-'+lid)?.value) || 0;
  const price = parseFloat(document.getElementById('dl-price-'+lid)?.value) || 0;
  const total = qty * price;
  const el = document.getElementById('dl-total-'+lid);
  if (el) el.textContent = formatMoney(total);
  updateDevisTotals();
}

function updateDevisTotals() {
  const subtotal = devisLines.reduce((s, lid) => {
    const qty = parseFloat(document.getElementById('dl-qty-'+lid)?.value) || 0;
    const price = parseFloat(document.getElementById('dl-price-'+lid)?.value) || 0;
    return s + qty * price;
  }, 0);
  const tva = subtotal * 0.2;
  const ttc = subtotal + tva;
  const s = document.getElementById('subtotal-ht'); if(s) s.textContent = formatMoney(subtotal);
  const t = document.getElementById('total-tva'); if(t) t.textContent = formatMoney(tva);
  const c = document.getElementById('total-ttc'); if(c) c.textContent = formatMoney(ttc);
}

function populateDevisClients() {
  const clients = getDB('clients');
  const select = document.getElementById('d-client');
  if (select) clients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.first} ${c.last}`;
    select.appendChild(opt);
  });
}

function esc(s) { return String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
