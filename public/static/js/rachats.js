/**
 * iziGSM — rachats.js
 * Livre de police — Rachats d'appareils d'occasion
 * Connecté à /api/rachats via api() wrapper (JWT auto-refresh)
 * Conformité : Code pénal art. 321-7
 */

// ─── État module ──────────────────────────────────────────────────────────────
let allRachatsCache  = [];
let rachatsUseApi    = true;
let _currentRachatId = null;   // pour le modal détail/litige

// Filtres actifs
let _filtreTexte  = '';
let _filtreStatut = '';
let _filtreDebut  = '';
let _filtreFin    = '';

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async function () {
  const session = requireAuth();
  if (!session) return;

  buildSidebar('rachats');
  updateTopbarAvatar(session);
  await loadRachats();
});

function updateTopbarAvatar(session) {
  const el = document.getElementById('topbar-avatar');
  if (!el || !session) return;
  const name = session.name || session.email || '';
  el.textContent = name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2) || 'U';
}

// ─── Chargement principal ─────────────────────────────────────────────────────
async function loadRachats() {
  const session    = requireAuth();
  const boutiqueId = getBoutiqueId ? getBoutiqueId() : (session?.boutique_id ?? null);

  if (!boutiqueId) {
    rachatsUseApi = false;
    allRachatsCache = [];
    renderRachats();
    return;
  }

  const params = { limit: 500, boutique_id: boutiqueId };
  if (_filtreStatut) params.statut     = _filtreStatut;
  if (_filtreDebut)  params.date_debut = _filtreDebut;
  if (_filtreFin)    params.date_fin   = _filtreFin;

  try {
    const result = await apiGet('/api/rachats', params);
    if (result.ok) {
      allRachatsCache = result.data?.data || [];
      rachatsUseApi   = true;
    } else {
      console.warn('[rachats] API KO', result.status);
      rachatsUseApi = false;
    }
  } catch (err) {
    console.warn('[rachats] Erreur réseau', err);
    rachatsUseApi = false;
  }

  renderRachats();
}

// ─── Rendu table + KPIs ───────────────────────────────────────────────────────
function renderRachats() {
  let data = allRachatsCache;

  // Filtre texte local
  if (_filtreTexte) {
    const q = _filtreTexte.toLowerCase();
    data = data.filter(r =>
      r.vendeur_nom?.toLowerCase().includes(q)    ||
      r.vendeur_prenom?.toLowerCase().includes(q) ||
      r.numero?.toLowerCase().includes(q)         ||
      r.imei?.includes(q)                         ||
      r.marque?.toLowerCase().includes(q)         ||
      r.modele?.toLowerCase().includes(q)
    );
  }

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const all = allRachatsCache;
  const kpiEnStock  = all.filter(r => r.statut === 'en_stock').length;
  const kpiVendus   = all.filter(r => r.statut === 'vendu').length;
  const kpiDecaisse = all.reduce((s, r) => s + (parseFloat(r.prix_rachat) || 0), 0);
  const kpiLitiges  = all.filter(r => r.statut === 'litige').length;

  const setKpi = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = typeof val === 'number' && id !== 'kpi-enstock' && id !== 'kpi-vendus' && id !== 'kpi-litiges'
      ? formatMoney(val)
      : val;
  };
  setKpi('kpi-enstock',  kpiEnStock);
  setKpi('kpi-vendus',   kpiVendus);
  setKpi('kpi-decaisse', kpiDecaisse);
  setKpi('kpi-litiges',  kpiLitiges);

  // ── Table ─────────────────────────────────────────────────────────────────
  const tbody = document.getElementById('rachats-table');
  const empty = document.getElementById('rachats-empty');
  if (!tbody) return;

  if (!data.length) {
    tbody.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');

  tbody.innerHTML = data.map(r => {
    const vendeurNom = `${esc(r.vendeur_prenom)} ${esc(r.vendeur_nom)}`;
    const appareil   = `${esc(r.marque)} ${esc(r.modele)}`;
    const imeiCell   = r.imei
      ? `<span style="font-family:monospace;font-size:0.82rem;">${esc(r.imei)}</span>`
      : '<span style="color:var(--muted);font-size:0.82rem;">—</span>';
    const prix = formatMoney(parseFloat(r.prix_rachat) || 0);
    const modePaiement = { especes: '💵 Espèces', virement: '🏦 Virement', cheque: '📄 Chèque' }[r.mode_paiement] || r.mode_paiement;

    return `
    <tr>
      <td><span style="font-weight:700;color:var(--primary);font-size:0.9rem;">${esc(r.numero)}</span></td>
      <td style="font-size:0.88rem;white-space:nowrap;">${formatDate(r.date_rachat, true)}</td>
      <td>
        <div style="font-weight:600;font-size:0.9rem;">${vendeurNom}</div>
        ${r.operateur_nom ? `<div style="font-size:0.78rem;color:var(--muted);">par ${esc(r.operateur_nom)}</div>` : ''}
      </td>
      <td>
        <div style="font-weight:600;font-size:0.9rem;">${appareil}</div>
        ${r.couleur || r.capacite ? `<div style="font-size:0.78rem;color:var(--muted);">${[r.couleur, r.capacite].filter(Boolean).map(esc).join(' — ')}</div>` : ''}
      </td>
      <td>${imeiCell}</td>
      <td>${etatBadge(r.etat)}</td>
      <td><strong>${prix}</strong></td>
      <td style="font-size:0.85rem;">${modePaiement}</td>
      <td>${statutBadgeRachat(r.statut)}</td>
      <td style="font-size:0.82rem;color:var(--muted);">${esc(r.operateur_nom || '—')}</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-ghost btn-sm" onclick="voirDetailRachat(${r.id})" title="Voir le détail">👁</button>
          ${r.statut === 'en_stock'
            ? `<button class="btn btn-ghost btn-icon" onclick="marquerVendu(${r.id})" title="Marquer comme vendu" style="color:var(--green);">✅</button>`
            : ''}
          ${r.statut !== 'litige'
            ? `<button class="btn btn-ghost btn-icon" onclick="ouvrirSignalement(${r.id})" title="Signaler un litige" style="color:var(--red);">⚠️</button>`
            : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ─── Badges ───────────────────────────────────────────────────────────────────
function etatBadge(etat) {
  const map = {
    neuf:    { cls: 'status-done',      label: '✨ Neuf'     },
    bon:     { cls: 'status-done',      label: '👍 Bon'      },
    correct: { cls: 'status-progress',  label: '👌 Correct'  },
    mauvais: { cls: 'status-cancelled', label: '👎 Mauvais'  },
    hs:      { cls: 'status-cancelled', label: '💀 HS'       },
  };
  const e = map[etat] || { cls: 'status-badge', label: esc(etat) };
  return `<span class="status-badge ${e.cls}" style="font-size:0.78rem;">${e.label}</span>`;
}

function statutBadgeRachat(statut) {
  const map = {
    en_stock: { cls: 'status-new',       label: '📦 En stock' },
    vendu:    { cls: 'status-done',      label: '✅ Vendu'    },
    retourne: { cls: 'status-progress',  label: '↩️ Retourné' },
    litige:   { cls: 'status-cancelled', label: '⚠️ Litige'   },
  };
  const s = map[statut] || { cls: 'status-badge', label: esc(statut) };
  return `<span class="status-badge ${s.cls}" style="font-size:0.78rem;">${s.label}</span>`;
}

// ─── Filtres ──────────────────────────────────────────────────────────────────
function filterRachats(val) {
  _filtreTexte = val;
  renderRachats();
}

function filterRachatStatut(val) {
  _filtreStatut = val;
  loadRachats();
}

function filterRachatDate() {
  _filtreDebut = document.getElementById('filtre-debut')?.value || '';
  _filtreFin   = document.getElementById('filtre-fin')?.value   || '';
  loadRachats();
}

// ─── Vérification IMEI (doublon en temps réel) ────────────────────────────────
async function verifierImei(imei) {
  const alerte = document.getElementById('r-imei-alerte');
  if (!alerte) return;
  if (!imei || imei.length < 15) { alerte.style.display = 'none'; return; }
  // Vérification Luhn simple
  if (!/^\d{15}$/.test(imei)) {
    alerte.textContent = '⚠️ IMEI invalide (15 chiffres requis).';
    alerte.style.display = 'block';
    return;
  }
  alerte.style.display = 'none';
}

// ─── Ouverture modal nouveau rachat ──────────────────────────────────────────
function openNewRachat() {
  // Reset formulaire
  ['r-nom','r-prenom','r-naissance','r-telephone','r-adresse','r-cp','r-ville',
   'r-piece-num','r-marque','r-modele','r-imei','r-imei2','r-couleur',
   'r-capacite','r-accessoires','r-observations','r-prix','r-ref-paiement'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const piece  = document.getElementById('r-piece');  if (piece)  piece.value  = 'CNI';
  const etat   = document.getElementById('r-etat');   if (etat)   etat.value   = 'bon';
  const mode   = document.getElementById('r-mode');   if (mode)   mode.value   = 'especes';
  const alerte = document.getElementById('r-imei-alerte'); if (alerte) alerte.style.display = 'none';

  openModal('modal-rachat');
  // Focus sur le nom
  setTimeout(() => document.getElementById('r-nom')?.focus(), 100);
}

// ─── Sauvegarde rachat (POST /api/rachats) ────────────────────────────────────
async function saveRachat() {
  const nom      = document.getElementById('r-nom')?.value.trim().toUpperCase();
  const prenom   = document.getElementById('r-prenom')?.value.trim();
  const piece    = document.getElementById('r-piece')?.value;
  const pieceNum = document.getElementById('r-piece-num')?.value.trim();
  const marque   = document.getElementById('r-marque')?.value.trim();
  const modele   = document.getElementById('r-modele')?.value.trim();
  const imei     = document.getElementById('r-imei')?.value.trim() || null;
  const prix     = parseFloat(document.getElementById('r-prix')?.value) || null;

  // Validation obligatoire
  if (!nom)      { showFlash('⚠️ Nom du vendeur obligatoire.', 'error'); document.getElementById('r-nom')?.focus(); return; }
  if (!prenom)   { showFlash('⚠️ Prénom du vendeur obligatoire.', 'error'); document.getElementById('r-prenom')?.focus(); return; }
  if (!pieceNum) { showFlash('⚠️ Numéro de pièce d\'identité obligatoire.', 'error'); document.getElementById('r-piece-num')?.focus(); return; }
  if (!marque)   { showFlash('⚠️ Marque de l\'appareil obligatoire.', 'error'); document.getElementById('r-marque')?.focus(); return; }
  if (!modele)   { showFlash('⚠️ Modèle de l\'appareil obligatoire.', 'error'); document.getElementById('r-modele')?.focus(); return; }
  if (prix === null || prix < 0) { showFlash('⚠️ Prix de rachat obligatoire (≥ 0).', 'error'); document.getElementById('r-prix')?.focus(); return; }

  const session    = requireAuth();
  const boutiqueId = getBoutiqueId ? getBoutiqueId() : (session?.boutique_id ?? null);

  const payload = {
    boutique_id:        boutiqueId,
    vendeur_nom:        nom,
    vendeur_prenom:     prenom,
    vendeur_naissance:  document.getElementById('r-naissance')?.value || null,
    vendeur_adresse:    document.getElementById('r-adresse')?.value.trim() || null,
    vendeur_cp:         document.getElementById('r-cp')?.value.trim() || null,
    vendeur_ville:      document.getElementById('r-ville')?.value.trim() || null,
    vendeur_piece:      piece,
    vendeur_piece_num:  pieceNum,
    vendeur_telephone:  document.getElementById('r-telephone')?.value.trim() || null,
    marque,
    modele,
    imei,
    imei2:              document.getElementById('r-imei2')?.value.trim() || null,
    couleur:            document.getElementById('r-couleur')?.value.trim() || null,
    capacite:           document.getElementById('r-capacite')?.value.trim() || null,
    etat:               document.getElementById('r-etat')?.value || 'bon',
    accessoires:        document.getElementById('r-accessoires')?.value.trim() || null,
    observations:       document.getElementById('r-observations')?.value.trim() || null,
    prix_rachat:        prix,
    mode_paiement:      document.getElementById('r-mode')?.value || 'especes',
    reference_paiement: document.getElementById('r-ref-paiement')?.value.trim() || null,
  };

  try {
    const result = await apiPost('/api/rachats', payload);
    if (result.ok) {
      const numero = result.data?.numero || '?';
      closeModal('modal-rachat');
      showFlash(`✅ ${numero} — Rachat enregistré dans le livre de police.`, 'success');
      await loadRachats();
    } else {
      const msg = result.data?.error || 'Erreur lors de l\'enregistrement.';
      if (result.status === 409) {
        // Doublon IMEI
        showFlash(`⚠️ ${msg}`, 'error');
      } else {
        showFlash(`⚠️ ${msg}`, 'error');
      }
    }
  } catch (err) {
    console.warn('[rachats] saveRachat erreur réseau', err);
    showFlash('⚠️ Erreur réseau — réessayez.', 'error');
  }
}

// ─── Voir détail rachat ───────────────────────────────────────────────────────
async function voirDetailRachat(id) {
  _currentRachatId = id;

  try {
    const result = await apiGet(`/api/rachats/${id}`, {});
    if (!result.ok) { showFlash('⚠️ Impossible de charger le détail.', 'error'); return; }

    const r = result.data?.data;
    const numEl  = document.getElementById('detail-numero');
    const bodyEl = document.getElementById('detail-body');
    if (numEl)  numEl.textContent = r.numero;
    if (bodyEl) bodyEl.innerHTML  = buildDetailHtml(r);

    openModal('modal-rachat-detail');
  } catch (err) {
    showFlash('⚠️ Erreur réseau.', 'error');
  }
}

function buildDetailHtml(r) {
  const row = (label, val) => val
    ? `<tr><td style="color:var(--muted);font-size:0.88rem;padding:6px 12px 6px 0;width:180px;white-space:nowrap;">${label}</td><td style="font-size:0.88rem;padding:6px 0;">${esc(String(val))}</td></tr>`
    : '';

  const pieceLabelMap = { CNI:'Carte nationale d\'identité', PASSEPORT:'Passeport', SEJOUR:'Titre de séjour', PERMIS:'Permis de conduire' };
  const modeMap = { especes:'💵 Espèces', virement:'🏦 Virement', cheque:'📄 Chèque' };

  return `
  <div style="display:grid;gap:20px;">
    <!-- Bandeau numéro + statut -->
    <div style="display:flex;align-items:center;justify-content:space-between;background:var(--bg-light,#f8fafc);border-radius:10px;padding:12px 16px;">
      <div>
        <div style="font-size:1.1rem;font-weight:700;color:var(--primary);">${esc(r.numero)}</div>
        <div style="font-size:0.82rem;color:var(--muted);">${formatDate(r.date_rachat, true)}</div>
      </div>
      <div>${statutBadgeRachat(r.statut)}</div>
    </div>

    <!-- Vendeur -->
    <div>
      <h4 style="font-size:0.9rem;color:var(--primary);margin:0 0 8px;">👤 Identité du vendeur</h4>
      <table style="width:100%;border-collapse:collapse;">
        ${row('Nom', r.vendeur_nom)}
        ${row('Prénom', r.vendeur_prenom)}
        ${row('Date de naissance', r.vendeur_naissance)}
        ${row('Adresse', [r.vendeur_adresse, r.vendeur_cp, r.vendeur_ville].filter(Boolean).join(' '))}
        ${row('Téléphone', r.vendeur_telephone)}
        ${row('Pièce d\'identité', pieceLabelMap[r.vendeur_piece] || r.vendeur_piece)}
        ${row('N° de pièce', r.vendeur_piece_num)}
      </table>
    </div>

    <!-- Appareil -->
    <div>
      <h4 style="font-size:0.9rem;color:var(--primary);margin:0 0 8px;">📱 Appareil racheté</h4>
      <table style="width:100%;border-collapse:collapse;">
        ${row('Marque / Modèle', r.marque + ' ' + r.modele)}
        ${row('IMEI 1', r.imei)}
        ${row('IMEI 2', r.imei2)}
        ${row('Couleur', r.couleur)}
        ${row('Capacité', r.capacite)}
        ${row('État', r.etat)}
        ${row('Accessoires', r.accessoires)}
        ${row('Observations', r.observations)}
      </table>
    </div>

    <!-- Prix -->
    <div>
      <h4 style="font-size:0.9rem;color:var(--primary);margin:0 0 8px;">💶 Prix de rachat</h4>
      <table style="width:100%;border-collapse:collapse;">
        ${row('Montant versé', formatMoney(parseFloat(r.prix_rachat) || 0))}
        ${row('Mode de paiement', modeMap[r.mode_paiement] || r.mode_paiement)}
        ${row('Référence', r.reference_paiement)}
      </table>
    </div>

    <!-- Opérateur -->
    <div style="font-size:0.82rem;color:var(--muted);padding-top:8px;border-top:1px solid #e5e7eb;">
      Enregistré par <strong>${esc(r.operateur_nom || '—')}</strong>
      ${r.boutique_nom ? ` — ${esc(r.boutique_nom)}` : ''}
    </div>
  </div>`;
}

// ─── Marquer vendu ────────────────────────────────────────────────────────────
async function marquerVendu(id) {
  const rachat = allRachatsCache.find(r => r.id == id);
  if (!rachat) return;
  if (!confirm(`Marquer ${esc(rachat.numero)} comme vendu ?`)) return;

  try {
    const result = await apiPatch(`/api/rachats/${id}/statut`, { statut: 'vendu' });
    if (result.ok) {
      showFlash(`✅ ${esc(rachat.numero)} — marqué vendu.`, 'success');
      await loadRachats();
    } else {
      showFlash(`⚠️ ${result.data?.error || 'Erreur.'}`, 'error');
    }
  } catch (err) {
    showFlash('⚠️ Erreur réseau.', 'error');
  }
}

// ─── Signalement litige ───────────────────────────────────────────────────────
function ouvrirSignalement(id) {
  _currentRachatId = id;
  const rachat = allRachatsCache.find(r => r.id == id);
  if (!rachat) return;

  if (!confirm(
    `Signaler un litige pour ${esc(rachat.numero)} ?\n\n` +
    `L'appareil sera marqué "Litige" et vous devrez contacter les autorités compétentes ` +
    `(Police/Gendarmerie) si vous suspectez un recel.\n\n` +
    `Confirmer le signalement ?`
  )) return;

  signalerLitige(id);
}

async function signalerLitige(id) {
  const targetId = id || _currentRachatId;
  if (!targetId) return;
  const rachat = allRachatsCache.find(r => r.id == targetId);

  try {
    const result = await apiPatch(`/api/rachats/${targetId}/statut`, { statut: 'litige' });
    if (result.ok) {
      closeModal('modal-rachat-detail');
      showFlash(`⚠️ ${rachat ? esc(rachat.numero) : ''} — Signalé comme litige. Conservez une copie du registre.`, 'error');
      await loadRachats();
    } else {
      showFlash(`⚠️ ${result.data?.error || 'Erreur.'}`, 'error');
    }
  } catch (err) {
    showFlash('⚠️ Erreur réseau.', 'error');
  }
}

// ─── Export CSV livre de police ───────────────────────────────────────────────
async function exportLivrePolice() {
  const session    = requireAuth();
  const boutiqueId = getBoutiqueId ? getBoutiqueId() : (session?.boutique_id ?? null);
  if (!boutiqueId) { showFlash('⚠️ boutique_id requis pour l\'export.', 'error'); return; }

  const debut = document.getElementById('filtre-debut')?.value || '';
  const fin   = document.getElementById('filtre-fin')?.value   || '';

  let url = `/api/rachats/export?boutique_id=${boutiqueId}`;
  if (debut) url += `&date_debut=${debut}`;
  if (fin)   url += `&date_fin=${fin}`;

  // Téléchargement via <a> temporaire
  const token = getToken();
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { showFlash('⚠️ Export impossible.', 'error'); return; }
    const blob = await res.blob();
    const burl  = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href     = burl;
    a.download = `livre-police-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(burl);
    showFlash('✅ Export CSV téléchargé.', 'success');
  } catch (err) {
    showFlash('⚠️ Erreur réseau lors de l\'export.', 'error');
  }
}

// ─── Utilitaires ──────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Exposition globale ───────────────────────────────────────────────────────
window.openNewRachat       = openNewRachat;
window.saveRachat          = saveRachat;
window.filterRachats       = filterRachats;
window.filterRachatStatut  = filterRachatStatut;
window.filterRachatDate    = filterRachatDate;
window.voirDetailRachat    = voirDetailRachat;
window.marquerVendu        = marquerVendu;
window.ouvrirSignalement   = ouvrirSignalement;
window.signalerLitige      = signalerLitige;
window.exportLivrePolice   = exportLivrePolice;
window.verifierImei        = verifierImei;
