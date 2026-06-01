/**
 * iziGSM — dashboard.js
 */

document.addEventListener('DOMContentLoaded', function() {
  buildSidebar('dashboard');
  loadDashboard();
});

function loadDashboard() {
  const tickets = getDB('tickets');
  const devis = getDB('devis');
  const factures = getDB('factures');
  const qr = getDB('qualirepar');

  // KPIs
  const inProgress = tickets.filter(t => t.status === 'En cours' || t.status === 'Nouveau').length;
  const totalTickets = tickets.length;
  const devisPending = devis.filter(d => d.status === 'Envoyé').length;
  const qrCount = qr.length;
  const revenue = factures.filter(f=>f.status==='Payée').reduce((s,f)=>s+(f.totalTTC||0), 0);

  document.getElementById('kpi-tickets').textContent = totalTickets;
  document.getElementById('kpi-revenue').textContent = formatMoney(revenue);
  document.getElementById('kpi-devis').textContent = devisPending;
  document.getElementById('kpi-qr').textContent = qrCount;

  // Tickets récents
  const tbody = document.getElementById('recent-tickets');
  if (tbody) {
    const recent = tickets.slice(0, 6);
    tbody.innerHTML = recent.map(t => `
      <tr>
        <td><span style="font-weight:700;color:var(--primary);">#${String(t.id).slice(-4)}</span></td>
        <td>${escHtml(t.clientName)}</td>
        <td><span style="font-size:0.88rem;">${escHtml(t.deviceType)} ${escHtml(t.deviceModel)}</span></td>
        <td>${statusBadge(t.status)}</td>
        <td><span style="font-size:0.85rem;color:var(--muted);">${formatDate(t.createdAt, true)}</span></td>
        <td><a href="tickets.html" class="btn btn-ghost btn-sm">Voir →</a></td>
      </tr>
    `).join('');
    if (!recent.length) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--muted);">Aucune prise en charge</td></tr>';
  }

  // Activité récente
  const feed = document.getElementById('activity-feed');
  if (feed) {
    const activities = buildActivity(tickets, devis, factures, qr);
    feed.innerHTML = activities.slice(0,8).map(a => `
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <span style="font-size:1.1rem;flex-shrink:0;">${a.icon}</span>
        <div>
          <div style="font-size:0.88rem;font-weight:600;color:var(--navy);">${a.text}</div>
          <div style="font-size:0.8rem;color:var(--muted);margin-top:2px;">${a.time}</div>
        </div>
      </div>
    `).join('');
  }
}

function buildActivity(tickets, devis, factures, qr) {
  const items = [
    ...tickets.map(t => ({ icon:'🔧', text:`Ticket #${String(t.id).slice(-4)} — ${t.clientName}`, time: formatDate(t.createdAt), date: new Date(t.createdAt) })),
    ...devis.map(d => ({ icon:'📋', text:`Devis ${d.number} — ${d.clientName}`, time: formatDate(d.createdAt), date: new Date(d.createdAt) })),
    ...factures.map(f => ({ icon:'💶', text:`Facture ${f.number} — ${formatMoney(f.totalTTC)}`, time: formatDate(f.createdAt), date: new Date(f.createdAt) })),
    ...qr.map(q => ({ icon:'🌿', text:`QR ${q.number} — ${q.clientName}`, time: formatDate(q.createdAt), date: new Date(q.createdAt) })),
  ];
  return items.sort((a,b) => b.date - a.date);
}

function escHtml(s) { return String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
