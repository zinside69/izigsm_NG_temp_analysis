/**
 * iziGSM — qualirepar.js
 */

document.addEventListener('DOMContentLoaded', function() {
  buildSidebar('qualirepar');
  renderQR();
  populateQRSelects();
});

function renderQR(filter = '', statusFilter = '') {
  let data = getDB('qualirepar');
  if (filter) { const q = filter.toLowerCase(); data = data.filter(r => r.clientName?.toLowerCase().includes(q) || r.number?.toLowerCase().includes(q)); }
  if (statusFilter) data = data.filter(r => r.status === statusFilter);

  // KPIs
  const all = getDB('qualirepar');
  document.getElementById('qr-total').textContent = all.length;
  document.getElementById('qr-validated').textContent = all.filter(r => r.status === 'Validé').length;
  document.getElementById('qr-amount').textContent = formatMoney(all.filter(r => r.status === 'Validé').reduce((s,r) => s + (r.bonus||0), 0));

  const tbody = document.getElementById('qr-table');
  const empty = document.getElementById('qr-empty');
  if (!tbody) return;

  if (!data.length) { tbody.innerHTML = ''; empty?.classList.remove('hidden'); return; }
  empty?.classList.add('hidden');

  tbody.innerHTML = data.map(r => `
    <tr>
      <td><span style="font-weight:700;color:#059669;">${esc(r.number)}</span></td>
      <td>${esc(r.clientName)}</td>
      <td><span style="font-size:0.88rem;">${esc(r.deviceType)} — ${esc(r.deviceModel||'')}</span></td>
      <td>${esc(r.repairType)}</td>
      <td>${formatMoney(r.amount)}</td>
      <td><strong style="color:#059669;">${formatMoney(r.bonus)}</strong></td>
      <td>${statusBadge(r.status)}</td>
      <td>${formatDate(r.createdAt, true)}</td>
      <td><span class="chip" style="font-size:0.8rem;">${esc(r.source)}</span></td>
      <td>
        <div class="row-actions">
          <button class="btn btn-ghost btn-sm" onclick="validateQR(${r.id})">✓ Valider</button>
          <button class="btn btn-ghost btn-icon" onclick="deleteQR(${r.id})" style="color:var(--red);">🗑</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function filterQR(val) { renderQR(val); }
function filterQRStatus(val) { renderQR('', val); }

function openNewQR() {
  ['qr-client','qr-model','qr-amount','qr-notes'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('qr-bonus-display').value = '—';
  document.getElementById('qr-device').value = '';
  openModal('modal-qr');
}

function updateBonus() {
  const deviceSelect = document.getElementById('qr-device');
  const amountInput = document.getElementById('qr-amount');
  const bonusDisplay = document.getElementById('qr-bonus-display');
  
  const selectedOption = deviceSelect?.options[deviceSelect.selectedIndex];
  const maxBonus = parseInt(selectedOption?.dataset?.bonus || 0);
  const amount = parseFloat(amountInput?.value) || 0;

  // Le bonus est le minimum entre 25% du montant et le plafond par catégorie
  const calculatedBonus = Math.min(amount * 0.25, maxBonus);
  if (bonusDisplay) {
    bonusDisplay.value = maxBonus > 0 && amount > 0 ? formatMoney(calculatedBonus) + ' (max ' + formatMoney(maxBonus) + ')' : '—';
  }
}

function saveQR(status) {
  const deviceSelect = document.getElementById('qr-device');
  const deviceType = deviceSelect?.value;
  if (!deviceType) { showFlash('❌ Veuillez sélectionner un type d\'appareil.', 'error'); return; }

  const amount = parseFloat(document.getElementById('qr-amount')?.value) || 0;
  const selectedOption = deviceSelect?.options[deviceSelect.selectedIndex];
  const maxBonus = parseInt(selectedOption?.dataset?.bonus || 0);
  const bonus = Math.min(amount * 0.25, maxBonus);

  const existing = getDB('qualirepar');
  const item = {
    number: generateNumber('QR-2026-', existing),
    ticketId: document.getElementById('qr-ticket')?.value || null,
    clientName: document.getElementById('qr-client')?.value || 'Client',
    deviceType,
    deviceModel: document.getElementById('qr-model')?.value || '',
    repairType: document.getElementById('qr-repair-type')?.value || '',
    amount,
    bonus,
    status,
    source: document.getElementById('qr-source')?.value || 'ADEME',
    notes: document.getElementById('qr-notes')?.value || '',
  };

  addToDB('qualirepar', item);
  closeModal('modal-qr');
  renderQR();
  showFlash(`✓ Dossier ${item.number} ${status === 'Soumis' ? 'soumis' : 'enregistré en brouillon'}`);
}

function validateQR(id) {
  updateInDB('qualirepar', id, { status: 'Validé' });
  renderQR();
  showFlash('✓ Dossier QualiRépar validé !', 'success');
}

function deleteQR(id) {
  if (!confirm('Supprimer ce dossier QualiRépar ?')) return;
  deleteFromDB('qualirepar', id);
  renderQR();
  showFlash('✓ Dossier supprimé', 'info');
}

function populateQRSelects() {
  const tickets = getDB('tickets').filter(t => t.status === 'Terminé' || t.status === 'En cours');
  const tSelect = document.getElementById('qr-ticket');
  if (tSelect) tickets.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `#${String(t.id).slice(-4)} — ${t.clientName} (${t.deviceType} ${t.deviceModel})`;
    tSelect.appendChild(opt);
    tSelect.addEventListener('change', function() {
      const ticket = tickets.find(x => x.id == this.value);
      if (ticket) {
        document.getElementById('qr-client').value = ticket.clientName || '';
        document.getElementById('qr-model').value = ticket.deviceModel || '';
        document.getElementById('qr-amount').value = ticket.price || '';
        updateBonus();
      }
    });
  });

  const factures = getDB('factures');
  const fSelect = document.getElementById('qr-facture');
  if (fSelect) factures.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = `${f.number} — ${f.clientName}`;
    fSelect.appendChild(opt);
  });
}

function esc(s) { return String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
