/**
 * iziGSM — tickets.js
 */

let currentTicketId = null;
let sigCanvas = null, sigCtx = null, sigDrawing = false;
let attachmentFiles = [];

document.addEventListener('DOMContentLoaded', function() {
  buildSidebar('tickets');
  renderTickets();
  initSignature();
  populateClients();
});

function renderTickets(filter = '') {
  let data = getDB('tickets');
  const statusFilter = document.getElementById('filter-status')?.value || '';
  const priorityFilter = document.getElementById('filter-priority')?.value || '';

  if (filter) {
    const q = filter.toLowerCase();
    data = data.filter(t =>
      t.clientName?.toLowerCase().includes(q) ||
      t.deviceModel?.toLowerCase().includes(q) ||
      t.deviceType?.toLowerCase().includes(q) ||
      String(t.id).includes(q)
    );
  }
  if (statusFilter) data = data.filter(t => t.status === statusFilter);
  if (priorityFilter) data = data.filter(t => t.priority === priorityFilter);

  const tbody = document.getElementById('tickets-table');
  const empty = document.getElementById('tickets-empty');
  if (!tbody) return;

  if (!data.length) {
    tbody.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');

  tbody.innerHTML = data.map(t => `
    <tr>
      <td><span style="font-weight:700;color:var(--primary);font-size:0.9rem;">#${String(t.id).slice(-4)}</span></td>
      <td>
        <div style="font-weight:600;">${esc(t.clientName)}</div>
        ${t.phone ? `<div style="font-size:0.8rem;color:var(--muted);">${esc(t.phone)}</div>` : ''}
      </td>
      <td>
        <div style="font-size:0.9rem;">${esc(t.deviceType)} ${esc(t.deviceModel)}</div>
        ${t.imei ? `<div style="font-size:0.78rem;color:var(--muted);">IMEI: ${esc(t.imei)}</div>` : ''}
      </td>
      <td>${esc(t.description).slice(0,50)}${t.description?.length > 50 ? '…' : ''}</td>
      <td>${statusBadge(t.status)}</td>
      <td>${priorityLabel(t.priority)}</td>
      <td><span style="font-size:0.88rem;">${esc(t.technician)}</span></td>
      <td><span style="font-size:0.85rem;color:var(--muted);">${formatDate(t.createdAt, true)}</span></td>
      <td>
        <div class="row-actions">
          <button class="btn btn-ghost btn-icon" title="Voir" onclick="viewTicket(${t.id})">👁</button>
          <button class="btn btn-ghost btn-icon" title="Modifier" onclick="editTicket(${t.id})">✏️</button>
          <button class="btn btn-ghost btn-icon" title="Supprimer" onclick="deleteTicket(${t.id})" style="color:var(--red);">🗑</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function filterTickets() { renderTickets(document.getElementById('search-tickets')?.value || ''); }

function openNewTicket() {
  currentTicketId = null;
  document.getElementById('modal-ticket-title').textContent = 'Nouvelle prise en charge';
  clearTicketForm();
  openModal('modal-ticket');
  switchTab('info');
}

function editTicket(id) {
  const ticket = getDB('tickets').find(t => t.id === id);
  if (!ticket) return;
  currentTicketId = id;
  document.getElementById('modal-ticket-title').textContent = `Modifier la prise en charge #${String(id).slice(-4)}`;
  document.getElementById('t-new-client').value = ticket.clientName || '';
  document.getElementById('t-phone').value = ticket.phone || '';
  document.getElementById('t-email').value = ticket.email || '';
  document.getElementById('t-device-type').value = ticket.deviceType || 'iPhone';
  document.getElementById('t-device-model').value = ticket.deviceModel || '';
  document.getElementById('t-imei').value = ticket.imei || '';
  document.getElementById('t-priority').value = ticket.priority || 'Moyenne';
  document.getElementById('t-technician').value = ticket.technician || 'Non assigné';
  document.getElementById('t-price').value = ticket.price || '';
  document.getElementById('t-description').value = ticket.description || '';
  document.getElementById('t-notes').value = ticket.notes || '';
  openModal('modal-ticket');
}

function viewTicket(id) {
  const ticket = getDB('tickets').find(t => t.id === id);
  if (!ticket) return;
  currentTicketId = id;
  document.getElementById('detail-title').textContent = `Prise en charge #${String(id).slice(-4)}`;
  document.getElementById('detail-body').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div>
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Client</div>
        <div style="font-weight:600;">${esc(ticket.clientName)}</div>
        ${ticket.phone ? `<div style="font-size:0.88rem;color:var(--muted);">${esc(ticket.phone)}</div>` : ''}
      </div>
      <div>
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Appareil</div>
        <div style="font-weight:600;">${esc(ticket.deviceType)} ${esc(ticket.deviceModel)}</div>
        ${ticket.imei ? `<div style="font-size:0.88rem;color:var(--muted);">IMEI: ${esc(ticket.imei)}</div>` : ''}
      </div>
      <div>
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Statut</div>
        ${statusBadge(ticket.status)}
      </div>
      <div>
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Priorité</div>
        ${priorityLabel(ticket.priority)}
      </div>
      <div>
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Technicien</div>
        <div>${esc(ticket.technician)}</div>
      </div>
      <div>
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Prix estimé</div>
        <div style="font-weight:700;color:var(--primary);">${formatMoney(ticket.price)}</div>
      </div>
      <div class="full" style="grid-column:1/-1;">
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Description</div>
        <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:12px;font-size:0.92rem;">${esc(ticket.description)}</div>
      </div>
      ${ticket.notes ? `<div class="full" style="grid-column:1/-1;">
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Notes internes</div>
        <div style="background:#fff9ec;border:1px solid #ffe0a1;border-radius:10px;padding:12px;font-size:0.88rem;color:#7a5a1a;">${esc(ticket.notes)}</div>
      </div>` : ''}
      <div>
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Signature</div>
        <span class="${ticket.hasSignature ? 'status-badge status-done' : 'status-badge status-draft'}">${ticket.hasSignature ? '✓ Signée' : 'Non signée'}</span>
      </div>
      <div>
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Créé le</div>
        <div style="font-size:0.9rem;">${formatDate(ticket.createdAt)}</div>
      </div>
    </div>
    <div style="margin-top:16px;">
      <label style="font-size:0.78rem;font-weight:700;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:8px;">Changer le statut</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${['Nouveau','En cours','Terminé','Annulé'].map(s => `
          <button class="btn btn-sm ${ticket.status===s?'btn-primary':'btn-ghost'}" onclick="changeStatus(${ticket.id},'${s}')">${s}</button>
        `).join('')}
      </div>
    </div>
  `;
  openModal('modal-ticket-detail');
}

function changeStatus(id, status) {
  updateInDB('tickets', id, { status });
  closeModal('modal-ticket-detail');
  renderTickets();
  showFlash(`✓ Statut mis à jour : ${status}`);
}

function deleteTicket(id) {
  if (!confirm('Supprimer cette prise en charge ?')) return;
  deleteFromDB('tickets', id);
  renderTickets();
  showFlash('✓ Prise en charge supprimée', 'info');
}

function createDevisFromTicket() {
  if (currentTicketId) {
    localStorage.setItem('izigsm_new_devis_from_ticket', String(currentTicketId));
    window.location.href = 'devis.html';
  }
}

function saveTicket() {
  const clientName = document.getElementById('t-new-client').value.trim() || 'Client inconnu';
  const description = document.getElementById('t-description').value.trim();
  if (!description) { showFlash('❌ La description est requise.', 'error'); return; }

  const ticket = {
    clientName,
    phone: document.getElementById('t-phone').value.trim(),
    email: document.getElementById('t-email').value.trim(),
    deviceType: document.getElementById('t-device-type').value,
    deviceModel: document.getElementById('t-device-model').value.trim(),
    imei: document.getElementById('t-imei').value.trim(),
    priority: document.getElementById('t-priority').value,
    technician: document.getElementById('t-technician').value,
    price: parseFloat(document.getElementById('t-price').value) || 0,
    description,
    notes: document.getElementById('t-notes').value.trim(),
    status: 'Nouveau',
    hasSignature: !!sigCanvas && !isSigEmpty(),
    attachments: attachmentFiles.map(f => ({ name: f.name, size: f.size, type: f.type })),
  };

  if (currentTicketId) {
    updateInDB('tickets', currentTicketId, ticket);
    showFlash('✓ Prise en charge mise à jour');
  } else {
    addToDB('tickets', ticket);
    showFlash('✓ Prise en charge créée');
  }

  closeModal('modal-ticket');
  renderTickets();
}

function clearTicketForm() {
  ['t-new-client','t-phone','t-email','t-device-model','t-imei','t-price','t-description','t-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  attachmentFiles = [];
  document.getElementById('attachments-list').innerHTML = '';
  clearSignature();
}

function exportTickets() { showFlash('📥 Export CSV — disponible en production avec backend', 'info'); }

// ======================== SIGNATURE ========================
function initSignature() {
  sigCanvas = document.getElementById('sig-canvas');
  if (!sigCanvas) return;
  sigCtx = sigCanvas.getContext('2d');
  resizeSigCanvas();

  const area = document.getElementById('sig-area');
  area.addEventListener('mousedown', startDraw);
  area.addEventListener('mousemove', draw);
  area.addEventListener('mouseup', stopDraw);
  area.addEventListener('mouseleave', stopDraw);
  area.addEventListener('touchstart', e => { e.preventDefault(); startDraw(e.touches[0]); }, { passive:false });
  area.addEventListener('touchmove', e => { e.preventDefault(); draw(e.touches[0]); }, { passive:false });
  area.addEventListener('touchend', stopDraw);
  window.addEventListener('resize', resizeSigCanvas);
}

function resizeSigCanvas() {
  if (!sigCanvas) return;
  const area = document.getElementById('sig-area');
  if (!area) return;
  const rect = area.getBoundingClientRect();
  const data = sigCanvas.toDataURL();
  sigCanvas.width = rect.width;
  sigCanvas.height = rect.height;
  const img = new Image();
  img.onload = () => sigCtx.drawImage(img, 0, 0, sigCanvas.width, sigCanvas.height);
  img.src = data;
}

function getPos(e) {
  const rect = sigCanvas.getBoundingClientRect();
  return { x: (e.clientX || e.pageX) - rect.left, y: (e.clientY || e.pageY) - rect.top };
}
function startDraw(e) {
  sigDrawing = true;
  const pos = getPos(e);
  sigCtx.beginPath();
  sigCtx.moveTo(pos.x, pos.y);
  document.getElementById('sig-placeholder').style.display = 'none';
}
function draw(e) {
  if (!sigDrawing) return;
  const pos = getPos(e);
  sigCtx.lineWidth = 2.5;
  sigCtx.lineCap = 'round';
  sigCtx.strokeStyle = '#101828';
  sigCtx.lineTo(pos.x, pos.y);
  sigCtx.stroke();
  sigCtx.beginPath();
  sigCtx.moveTo(pos.x, pos.y);
}
function stopDraw() { sigDrawing = false; updateSigStatus(); }
function clearSignature() {
  if (!sigCtx || !sigCanvas) return;
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  const ph = document.getElementById('sig-placeholder');
  if (ph) ph.style.display = '';
  updateSigStatus();
}
function isSigEmpty() {
  if (!sigCanvas) return true;
  const data = sigCtx.getImageData(0, 0, sigCanvas.width, sigCanvas.height).data;
  return !data.some(v => v !== 0);
}
function updateSigStatus() {
  const status = document.getElementById('sig-status');
  if (status) {
    const signed = !isSigEmpty();
    status.textContent = signed ? '✓ Signé' : '✓ Non signé';
    status.className = signed ? 'btn btn-sm status-badge status-done' : 'btn btn-ghost btn-sm';
  }
}

// Signature factures
function clearSig(canvasId, placeholderId) {
  const c = document.getElementById(canvasId);
  const p = document.getElementById(placeholderId);
  if (c) { const ctx = c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height); }
  if (p) p.style.display = '';
}

// ======================== PIÈCES JOINTES ========================
function handleDragOver(e) { e.preventDefault(); document.getElementById('dropzone').classList.add('dragging'); }
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('dropzone').classList.remove('dragging');
  addFiles(e.dataTransfer.files);
}
function handleFiles(e) { addFiles(e.target.files); }
function addFiles(files) {
  Array.from(files).forEach(file => {
    attachmentFiles.push(file);
    addAttachmentItem(file);
  });
}
function addAttachmentItem(file) {
  const list = document.getElementById('attachments-list');
  if (!list) return;
  const icon = file.type.startsWith('image/') ? '🖼' : '📄';
  const size = file.size < 1024*1024 ? `${Math.round(file.size/1024)} Ko` : `${(file.size/1024/1024).toFixed(1)} Mo`;
  const item = document.createElement('div');
  item.className = 'attachment-item';
  item.innerHTML = `
    <span class="att-icon">${icon}</span>
    <span class="att-name">${esc(file.name)}</span>
    <span class="att-size">${size}</span>
    <span class="att-remove" onclick="this.parentElement.remove()">✕</span>
  `;
  list.appendChild(item);
}

// ======================== CLIENT LIST ========================
function populateClients() {
  const clients = getDB('clients');
  const select = document.getElementById('t-client');
  if (select) {
    clients.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.first} ${c.last}`;
      select.appendChild(opt);
    });
    select.addEventListener('change', function() {
      const client = clients.find(c => c.id == this.value);
      if (client) {
        document.getElementById('t-new-client').value = client.first + ' ' + client.last;
        document.getElementById('t-phone').value = client.phone || '';
        document.getElementById('t-email').value = client.email || '';
      }
    });
  }
}

function esc(s) { return String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
