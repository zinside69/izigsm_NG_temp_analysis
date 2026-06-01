/**
 * iziGSM — factures.js
 */

let factureLines = [];

document.addEventListener('DOMContentLoaded', function() {
  buildSidebar('factures');
  renderFactures();
  populateFactureClients();
  populateDevisSelect();
  checkFromDevis();
  addFactureLine();
  initSigPad();
});

function checkFromDevis() {
  const stored = localStorage.getItem('izigsm_devis_to_facture');
  if (!stored) return;
  localStorage.removeItem('izigsm_devis_to_facture');
  const d = JSON.parse(stored);
  openNewFacture();
  setTimeout(() => {
    const desc = document.getElementById('f-description');
    if (desc) desc.value = d.description || '';
    const client = document.getElementById('f-client');
    if (client && d.clientId) client.value = d.clientId;
    // Pré-remplir les lignes
    factureLines = [];
    document.getElementById('facture-lines').innerHTML = '';
    (d.lines || []).forEach(l => {
      addFactureLine();
      const lid = factureLines[factureLines.length - 1];
      const descEl = document.getElementById('fl-desc-' + lid);
      const qtyEl = document.getElementById('fl-qty-' + lid);
      const priceEl = document.getElementById('fl-price-' + lid);
      if (descEl) descEl.value = l.desc || '';
      if (qtyEl) qtyEl.value = l.qty || 1;
      if (priceEl) priceEl.value = l.unitPrice || '';
      updateFactureLineTotals(lid);
    });
  }, 100);
}

function renderFactures(filter = '', statusFilter = '') {
  let data = getDB('factures');
  if (filter) { const q = filter.toLowerCase(); data = data.filter(f => f.clientName?.toLowerCase().includes(q) || f.number?.toLowerCase().includes(q)); }
  if (statusFilter) data = data.filter(f => f.status === statusFilter);

  // KPIs
  const all = getDB('factures');
  const paid = all.filter(f => f.status === 'Payée').reduce((s,f) => s+f.totalTTC, 0);
  const pending = all.filter(f => f.status === 'Envoyée').reduce((s,f) => s+f.totalTTC, 0);
  document.getElementById('kpi-ca').textContent = formatMoney(all.reduce((s,f)=>s+f.totalTTC,0));
  document.getElementById('kpi-paid').textContent = formatMoney(paid);
  document.getElementById('kpi-pending').textContent = formatMoney(pending);

  const tbody = document.getElementById('factures-table');
  const empty = document.getElementById('factures-empty');
  if (!tbody) return;

  if (!data.length) { tbody.innerHTML = ''; empty?.classList.remove('hidden'); return; }
  empty?.classList.add('hidden');

  tbody.innerHTML = data.map(f => `
    <tr>
      <td><span style="font-weight:700;color:var(--primary);">${esc(f.number)}</span></td>
      <td>${esc(f.clientName)}</td>
      <td><span style="font-size:0.88rem;">${esc(f.description||'').slice(0,40)}…</span></td>
      <td>${formatMoney(f.subtotalHT)}</td>
      <td>${formatMoney(f.tva)}</td>
      <td><strong>${formatMoney(f.totalTTC)}</strong></td>
      <td>${statusBadge(f.status)}</td>
      <td>${formatDate(f.createdAt, true)}</td>
      <td><span style="font-size:0.85rem;color:var(--muted);">30j</span></td>
      <td>
        <div class="row-actions">
          <button class="btn btn-ghost btn-sm" onclick="printFacture(${f.id})">🖨 PDF</button>
          <button class="btn btn-ghost btn-icon" onclick="markAsPaid(${f.id})" title="Marquer payée" style="color:var(--green);">💰</button>
          <button class="btn btn-ghost btn-icon" onclick="deleteFacture(${f.id})" style="color:var(--red);">🗑</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function filterFactures(val) { renderFactures(val); }
function filterFactureStatus(val) { renderFactures('', val); }

function openNewFacture() {
  factureLines = [];
  document.getElementById('facture-lines').innerHTML = '';
  ['f-description','f-notes'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('f-status').value = 'Brouillon';
  addFactureLine();
  updateFactureTotals();
  openModal('modal-facture');
}

function saveFacture(status) {
  const clientSelect = document.getElementById('f-client');
  const clientName = clientSelect?.options[clientSelect.selectedIndex]?.text || 'Client';
  const description = document.getElementById('f-description').value.trim();

  const linesData = factureLines.map(lid => ({
    desc: document.getElementById('fl-desc-'+lid)?.value || '',
    qty: parseFloat(document.getElementById('fl-qty-'+lid)?.value) || 1,
    unitPrice: parseFloat(document.getElementById('fl-price-'+lid)?.value) || 0,
    total: (parseFloat(document.getElementById('fl-qty-'+lid)?.value)||1) * (parseFloat(document.getElementById('fl-price-'+lid)?.value)||0),
  }));

  const subtotalHT = linesData.reduce((s,l) => s + l.total, 0);
  const tva = subtotalHT * 0.2;
  const existing = getDB('factures');

  const item = {
    number: generateNumber('FAC-2026-', existing),
    clientId: clientSelect?.value || null,
    clientName,
    description,
    lines: linesData,
    subtotalHT,
    tva,
    totalTTC: subtotalHT + tva,
    status,
    paymentMethod: document.getElementById('f-payment')?.value || 'Virement bancaire',
    notes: document.getElementById('f-notes')?.value || '',
  };

  addToDB('factures', item);
  closeModal('modal-facture');
  renderFactures();
  showFlash(`✓ Facture ${item.number} ${status === 'Envoyée' ? 'envoyée' : 'enregistrée'}`);
}

function markAsPaid(id) {
  updateInDB('factures', id, { status: 'Payée' });
  renderFactures();
  showFlash('✓ Facture marquée comme payée', 'success');
}

function deleteFacture(id) {
  if (!confirm('Supprimer cette facture ?')) return;
  deleteFromDB('factures', id);
  renderFactures();
  showFlash('✓ Facture supprimée', 'info');
}

function printFacture(id) {
  showFlash('🖨 Génération PDF — disponible avec backend PHP en production', 'info');
}

// ======================== LIGNES FACTURE ========================
function addFactureLine() {
  const lid = Date.now();
  factureLines.push(lid);
  const tbody = document.getElementById('facture-lines');
  if (!tbody) return;
  const tr = document.createElement('tr');
  tr.id = 'fl-row-' + lid;
  tr.innerHTML = `
    <td style="padding:6px 8px;">
      <input type="text" id="fl-desc-${lid}" placeholder="Description…" style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:6px 10px;font:inherit;font-size:0.88rem;">
    </td>
    <td style="padding:6px 8px;">
      <input type="number" id="fl-qty-${lid}" value="1" min="1" style="width:70px;border:1px solid #e5e7eb;border-radius:8px;padding:6px 8px;font:inherit;font-size:0.88rem;text-align:right;" oninput="updateFactureLineTotals(${lid})">
    </td>
    <td style="padding:6px 8px;">
      <input type="number" id="fl-price-${lid}" value="" min="0" step="0.01" placeholder="0.00" style="width:100px;border:1px solid #e5e7eb;border-radius:8px;padding:6px 8px;font:inherit;font-size:0.88rem;text-align:right;" oninput="updateFactureLineTotals(${lid})">
    </td>
    <td style="padding:6px 12px;text-align:right;">
      <span id="fl-total-${lid}" style="font-weight:600;font-size:0.92rem;">0,00 €</span>
    </td>
    <td style="padding:6px 4px;text-align:center;">
      <button onclick="removeFactureLine(${lid})" style="border:none;background:none;cursor:pointer;color:var(--muted);font-size:1rem;">✕</button>
    </td>
  `;
  tbody.appendChild(tr);
}

function removeFactureLine(lid) {
  if (factureLines.length <= 1) return;
  factureLines = factureLines.filter(l => l !== lid);
  document.getElementById('fl-row-' + lid)?.remove();
  updateFactureTotals();
}

function updateFactureLineTotals(lid) {
  const qty = parseFloat(document.getElementById('fl-qty-'+lid)?.value) || 0;
  const price = parseFloat(document.getElementById('fl-price-'+lid)?.value) || 0;
  const total = qty * price;
  const el = document.getElementById('fl-total-'+lid);
  if (el) el.textContent = formatMoney(total);
  updateFactureTotals();
}

function updateFactureTotals() {
  const subtotal = factureLines.reduce((s, lid) => {
    const qty = parseFloat(document.getElementById('fl-qty-'+lid)?.value) || 0;
    const price = parseFloat(document.getElementById('fl-price-'+lid)?.value) || 0;
    return s + qty * price;
  }, 0);
  const tva = subtotal * 0.2;
  const ttc = subtotal + tva;
  const s = document.getElementById('f-subtotal-ht'); if(s) s.textContent = formatMoney(subtotal);
  const t = document.getElementById('f-total-tva'); if(t) t.textContent = formatMoney(tva);
  const c = document.getElementById('f-total-ttc'); if(c) c.textContent = formatMoney(ttc);
}

function populateFactureClients() {
  const clients = getDB('clients');
  const select = document.getElementById('f-client');
  if (select) clients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.first} ${c.last}`;
    select.appendChild(opt);
  });
}

function populateDevisSelect() {
  const devis = getDB('devis').filter(d => d.status === 'Accepté' || d.status === 'Envoyé');
  const select = document.getElementById('f-devis');
  if (select) devis.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.number} — ${d.clientName}`;
    select.appendChild(opt);
  });
}

// Signature sur canvas facture
function initSigPad() {
  const canvas = document.getElementById('f-sig-canvas');
  if (!canvas) return;
  const area = document.getElementById('f-sig-area');
  const ctx = canvas.getContext('2d');
  let drawing = false;

  function resize() {
    if (!area) return;
    const rect = area.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  }
  resize();
  window.addEventListener('resize', resize);

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x:(e.clientX||e.pageX)-rect.left, y:(e.clientY||e.pageY)-rect.top };
  }

  area.addEventListener('mousedown', e => { drawing=true; const p=getPos(e); ctx.beginPath(); ctx.moveTo(p.x,p.y); document.getElementById('f-sig-placeholder').style.display='none'; });
  area.addEventListener('mousemove', e => { if(!drawing)return; const p=getPos(e); ctx.lineWidth=2.5;ctx.lineCap='round';ctx.strokeStyle='#101828';ctx.lineTo(p.x,p.y);ctx.stroke();ctx.beginPath();ctx.moveTo(p.x,p.y); });
  area.addEventListener('mouseup', ()=>{ drawing=false; });
  area.addEventListener('mouseleave', ()=>{ drawing=false; });
}

function esc(s) { return String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
