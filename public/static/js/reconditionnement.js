/**
 * reconditionnement.js — Vue Reconditionnement + Bons d'achat (Sprint 2.16)
 * Rôle architectural : View (P2 — 100% via ApiService app.js, 0 fetch direct).
 *
 * Ce fichier gère deux panneaux activés via onglets :
 *   1. Ordres de reconditionnement — workflow rachat → appareil occasion en stock
 *   2. Bons d'achat — gestes commerciaux clients (code BA-XXXXXXXX)
 *
 * Fonctionnalités :
 *   - KPIs reconditionnement (en cours, terminés, marge estimée)
 *   - Liste ordres paginée + filtres statut / grade / search
 *   - CRUD ordre : création depuis rachat ou manuelle, modification, changement statut
 *   - Clôture d'ordre (terminer) : saisie prix revente + grade → produit occasion créé
 *   - Liste bons d'achat paginée + filtres
 *   - Émission d'un bon (génération code automatique côté API)
 *   - Vérification code en caisse (sans consommation)
 *   - Annulation bon non consommé
 */

'use strict';

// ─── État module ──────────────────────────────────────────────────────────────

/** @type {Array}   Cache liste ordres courante */
let _ordres      = [];

/** @type {Array}   Cache liste bons courante */
let _bons        = [];

/** @type {string}  Onglet actif : 'ordres' | 'bons' */
let _tabActive   = 'ordres';

/** @type {number}  Page courante — ordres */
let _pageOrdres  = 1;

/** @type {number}  Page courante — bons */
let _pageBons    = 1;

/** @type {number|null}  Timer debounce recherche ordres */
let _timerOrdres = null;

/** @type {number|null}  Timer debounce recherche bons */
let _timerBons   = null;

// ─── Constantes ───────────────────────────────────────────────────────────────

/** Labels statuts ordres (affichage badge + couleur CSS) */
const STATUTS_ORDRE = {
  brouillon:  { label: 'Brouillon',  cls: 'badge-gray'   },
  en_cours:   { label: 'En cours',   cls: 'badge-orange' },
  termine:    { label: 'Terminé',    cls: 'badge-green'  },
  abandonne:  { label: 'Abandonné',  cls: 'badge-red'    },
};

/** Labels statuts bons d'achat */
const STATUTS_BON = {
  actif:    { label: 'Actif',    cls: 'badge-green'  },
  utilise:  { label: 'Utilisé', cls: 'badge-gray'   },
  expire:   { label: 'Expiré',  cls: 'badge-orange' },
  annule:   { label: 'Annulé',  cls: 'badge-red'    },
};

/** Labels grades qualité */
const GRADES = {
  A: 'Grade A — Comme neuf',
  B: 'Grade B — Bon état',
  C: 'Grade C — Correct',
  D: 'Grade D — Fonctionnel',
};

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  requireAuth();
  buildSidebar('reconditionnement');
  loadKpis();
  loadOrdres();
  _renderPageActions();
});

// ─── Navigation onglets ───────────────────────────────────────────────────────

/**
 * Bascule vers le panneau demandé et met à jour l'état visuel des onglets.
 * Charge les données du panneau si ce n'est pas encore fait.
 *
 * @param {'ordres'|'bons'} tab - Identifiant du panneau cible
 */
function switchTab(tab) {
  _tabActive = tab;

  // Mise à jour des attributs ARIA et classes visuelles
  document.getElementById('tab-ordres').classList.toggle('tab-active', tab === 'ordres');
  document.getElementById('tab-bons').classList.toggle('tab-active',   tab === 'bons');
  document.getElementById('tab-ordres').setAttribute('aria-selected', String(tab === 'ordres'));
  document.getElementById('tab-bons').setAttribute('aria-selected',   String(tab === 'bons'));

  // Affichage / masquage des panneaux
  document.getElementById('panel-ordres').hidden = (tab !== 'ordres');
  document.getElementById('panel-bons').hidden   = (tab !== 'bons');

  // Charge les données du panneau si nécessaire
  if (tab === 'ordres') loadOrdres();
  if (tab === 'bons')   loadBons();

  _renderPageActions();
}

/**
 * Met à jour les boutons d'action de l'en-tête selon l'onglet actif.
 */
function _renderPageActions() {
  const el = document.getElementById('page-actions');
  if (!el) return;

  if (_tabActive === 'ordres') {
    el.innerHTML = `
      <button class="btn btn-primary" onclick="openNewOrdre()">+ Nouvel ordre</button>
    `;
  } else {
    el.innerHTML = `
      <button class="btn btn-secondary" onclick="openModalVerifier()">🔍 Vérifier un code</button>
      <button class="btn btn-primary"   onclick="openNewBon()">🎁 Émettre un bon</button>
    `;
  }
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────

/**
 * Charge et affiche les KPIs du module reconditionnement.
 * Utilise apiGet() de app.js (P2 — 0 fetch direct).
 */
async function loadKpis() {
  const bId = getCurrentBoutiqueId();
  const res  = await apiGet(`/api/reconditionnement/kpis?boutique_id=${bId}`);
  if (!res?.success) return;

  const d = res.data;
  _setText('kpi-en-cours',    d.nb_en_cours      ?? '—');
  _setText('kpi-termines',    d.nb_termines       ?? '—');
  _setText('kpi-cout-revient', _money(d.cout_revient_total));
  _setText('kpi-marge',        _money(d.marge_estimee));
}

// ─── Ordres — liste ───────────────────────────────────────────────────────────

/**
 * Charge la liste paginée des ordres de reconditionnement avec les filtres actifs.
 * Met à jour _ordres et rafraîchit le tableau.
 *
 * @param {number} [page=1] - Numéro de page (1-indexé)
 */
async function loadOrdres(page = 1) {
  _pageOrdres = page;
  const bId    = getCurrentBoutiqueId();
  const search = document.getElementById('search-ordres')?.value.trim() ?? '';
  const statut = document.getElementById('filter-statut-ordre')?.value ?? '';
  const grade  = document.getElementById('filter-grade')?.value ?? '';

  const params = new URLSearchParams({ boutique_id: bId, page, limit: 20 });
  if (search) params.set('search', search);
  if (statut) params.set('statut', statut);
  if (grade)  params.set('grade',  grade);

  const res = await apiGet(`/api/reconditionnement?${params}`);
  if (!res?.success) {
    _setText('tbody-ordres', '');
    document.querySelector('#tbody-ordres').innerHTML =
      '<tr><td colspan="9" class="empty-row">Erreur de chargement.</td></tr>';
    return;
  }

  _ordres = res.data ?? [];
  _renderTableOrdres(_ordres);
  renderPagination('pagination-ordres', res.pagination, (p) => loadOrdres(p));
}

/**
 * Génère les lignes HTML de la table des ordres depuis les données.
 *
 * @param {Array} ordres - Tableau d'OrdreRow enrichis
 */
function _renderTableOrdres(ordres) {
  const tbody = document.getElementById('tbody-ordres');
  if (!tbody) return;

  if (!ordres.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-row">Aucun ordre de reconditionnement.</td></tr>';
    return;
  }

  tbody.innerHTML = ordres.map(o => {
    const statutInfo = STATUTS_ORDRE[o.statut] ?? { label: o.statut, cls: 'badge-gray' };
    const gradeLabel = o.grade ? `<span class="badge badge-blue">${o.grade}</span>` : '—';
    const rachatLink = o.rachat_numero
      ? `<span class="text-muted text-sm">${_esc(o.rachat_numero)}</span>`
      : '<span class="text-muted">—</span>';

    return `
      <tr>
        <td><strong>${_esc(o.numero)}</strong></td>
        <td>${_esc(o.appareil_marque ?? '')} ${_esc(o.appareil_modele ?? '')}<br>
            ${o.couleur  ? `<span class="text-muted text-sm">${_esc(o.couleur)}</span>` : ''}
            ${o.capacite ? `<span class="text-muted text-sm"> · ${_esc(o.capacite)}</span>` : ''}
        </td>
        <td><code>${_esc(o.imei ?? '—')}</code></td>
        <td><span class="badge ${statutInfo.cls}">${statutInfo.label}</span></td>
        <td>${gradeLabel}</td>
        <td>${_money(o.cout_revient)}</td>
        <td>${o.prix_revente_ht != null ? _money(o.prix_revente_ht) : '—'}</td>
        <td>${rachatLink}</td>
        <td>${_actionsOrdre(o)}</td>
      </tr>
    `;
  }).join('');
}

/**
 * Génère les boutons d'action d'une ligne selon le statut de l'ordre.
 *
 * @param {object} o - OrdreRow
 * @returns {string} HTML des boutons
 */
function _actionsOrdre(o) {
  const btns = [];

  // Voir / modifier — disponible pour tous les statuts modifiables
  if (o.statut === 'brouillon' || o.statut === 'en_cours') {
    btns.push(`<button class="btn btn-xs btn-secondary" onclick="openEditOrdre(${o.id})">✏️</button>`);
  }

  // Transitions selon statut courant
  if (o.statut === 'brouillon') {
    btns.push(`<button class="btn btn-xs btn-primary" onclick="changerStatutOrdre(${o.id},'en_cours')">▶ Démarrer</button>`);
    btns.push(`<button class="btn btn-xs btn-danger"  onclick="changerStatutOrdre(${o.id},'abandonne')">✕</button>`);
  }
  if (o.statut === 'en_cours') {
    btns.push(`<button class="btn btn-xs btn-success" onclick="openTerminerOrdre(${o.id})">✅ Terminer</button>`);
    btns.push(`<button class="btn btn-xs btn-danger"  onclick="changerStatutOrdre(${o.id},'abandonne')">✕</button>`);
  }

  return `<div class="actions-cell">${btns.join('')}</div>`;
}

/** Lance un debounce de 350ms avant de recharger la liste ordres. */
function debounceSearchOrdres() {
  clearTimeout(_timerOrdres);
  _timerOrdres = setTimeout(() => loadOrdres(1), 350);
}

// ─── Bons d'achat — liste ─────────────────────────────────────────────────────

/**
 * Charge la liste paginée des bons d'achat avec les filtres actifs.
 *
 * @param {number} [page=1] - Numéro de page
 */
async function loadBons(page = 1) {
  _pageBons = page;
  const bId    = getCurrentBoutiqueId();
  const search = document.getElementById('search-bons')?.value.trim() ?? '';
  const statut = document.getElementById('filter-statut-bon')?.value ?? '';

  const params = new URLSearchParams({ boutique_id: bId, page, limit: 20 });
  if (search) params.set('search', search);
  if (statut) params.set('statut', statut);

  const res = await apiGet(`/api/bons-achat?${params}`);
  if (!res?.success) {
    document.getElementById('tbody-bons').innerHTML =
      '<tr><td colspan="9" class="empty-row">Erreur de chargement.</td></tr>';
    return;
  }

  _bons = res.data ?? [];
  _renderTableBons(_bons);
  renderPagination('pagination-bons', res.pagination, (p) => loadBons(p));
}

/**
 * Génère les lignes HTML de la table des bons d'achat.
 *
 * @param {Array} bons - Tableau de BonAchatRow enrichis
 */
function _renderTableBons(bons) {
  const tbody = document.getElementById('tbody-bons');
  if (!tbody) return;

  if (!bons.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-row">Aucun bon d\'achat.</td></tr>';
    return;
  }

  tbody.innerHTML = bons.map(b => {
    const statutInfo = STATUTS_BON[b.statut] ?? { label: b.statut, cls: 'badge-gray' };
    const clientNom  = b.client_nom
      ? `${_esc(b.client_prenom ?? '')} ${_esc(b.client_nom)}`
      : '<span class="text-muted">—</span>';
    const expiration = b.date_expiration
      ? _fmtDate(b.date_expiration)
      : '<span class="text-muted">Illimitée</span>';

    return `
      <tr>
        <td>
          <code style="font-size:1rem;letter-spacing:1px;font-weight:600;">${_esc(b.code)}</code>
        </td>
        <td>${clientNom}</td>
        <td>${_money(b.montant)}</td>
        <td>
          <strong style="color:${b.montant_restant > 0 ? 'var(--green)' : 'var(--muted)'}">
            ${_money(b.montant_restant)}
          </strong>
        </td>
        <td><span class="badge ${statutInfo.cls}">${statutInfo.label}</span></td>
        <td>${expiration}</td>
        <td>${_esc(b.motif ?? '—')}</td>
        <td>${_fmtDate(b.created_at)}</td>
        <td>${_actionsBon(b)}</td>
      </tr>
    `;
  }).join('');
}

/**
 * Génère les boutons d'action d'un bon d'achat selon son statut.
 *
 * @param {object} b - BonAchatRow
 * @returns {string} HTML des boutons
 */
function _actionsBon(b) {
  const btns = [];
  if (b.statut === 'actif') {
    btns.push(`<button class="btn btn-xs btn-danger" onclick="annulerBon(${b.id})">✕ Annuler</button>`);
  }
  return `<div class="actions-cell">${btns.join('')}</div>`;
}

/** Lance un debounce de 350ms avant de recharger la liste bons. */
function debounceSearchBons() {
  clearTimeout(_timerBons);
  _timerBons = setTimeout(() => loadBons(1), 350);
}

// ─── Modal Ordre — création ────────────────────────────────────────────────────

/** Ouvre le modal de création d'un nouvel ordre (formulaire vide). */
function openNewOrdre() {
  document.getElementById('modal-ordre-title').textContent = 'Nouvel ordre de reconditionnement';
  document.getElementById('btn-submit-ordre').textContent  = 'Créer l\'ordre';
  document.getElementById('form-ordre').reset();
  document.getElementById('ordre-id').value       = '';
  document.getElementById('display-cout-revient').textContent = '0,00 €';
  document.getElementById('modal-ordre').showModal();
}

/**
 * Ouvre le modal en mode édition avec les données de l'ordre sélectionné.
 * Charge le détail via l'API pour avoir les données complètes.
 *
 * @param {number} id - ID de l'ordre à modifier
 */
async function openEditOrdre(id) {
  const bId = getCurrentBoutiqueId();
  const res  = await apiGet(`/api/reconditionnement/${id}?boutique_id=${bId}`);
  if (!res?.success) return showToast('Erreur lors du chargement de l\'ordre.', 'error');

  const o = res.data;
  document.getElementById('modal-ordre-title').textContent = `Modifier l\'ordre ${o.numero}`;
  document.getElementById('btn-submit-ordre').textContent  = 'Enregistrer';

  _setVal('ordre-id',          o.id);
  _setVal('ordre-rachat-id',   o.rachat_id  ?? '');
  _setVal('ordre-marque',      o.appareil_marque  ?? '');
  _setVal('ordre-modele',      o.appareil_modele  ?? '');
  _setVal('ordre-imei',        o.imei       ?? '');
  _setVal('ordre-couleur',     o.couleur    ?? '');
  _setVal('ordre-capacite',    o.capacite   ?? '');
  _setVal('ordre-grade',       o.grade      ?? '');
  _setVal('ordre-prix-rachat', o.prix_rachat);
  _setVal('ordre-cout-mo',     o.cout_main_oeuvre);
  _setVal('ordre-cout-pieces', o.cout_pieces);
  _setVal('ordre-prix-revente', o.prix_revente_ht ?? '');
  _setVal('ordre-travaux',     o.description_travaux ?? '');
  updateCoutRevient();

  document.getElementById('modal-ordre').showModal();
}

/** Ferme le modal ordre. */
function closeModalOrdre() {
  document.getElementById('modal-ordre').close();
}

/**
 * Recalcule et affiche le coût de revient en temps réel lors de la saisie des coûts.
 * Coût = prix_rachat + cout_main_oeuvre + cout_pieces.
 */
function updateCoutRevient() {
  const rachat = parseFloat(document.getElementById('ordre-prix-rachat').value)   || 0;
  const mo     = parseFloat(document.getElementById('ordre-cout-mo').value)        || 0;
  const pieces = parseFloat(document.getElementById('ordre-cout-pieces').value)    || 0;
  const total  = rachat + mo + pieces;
  document.getElementById('display-cout-revient').textContent = _money(total);
}

/**
 * Soumet le formulaire ordre (création ou modification selon la présence de l'id).
 *
 * @param {SubmitEvent} e - Événement submit du formulaire
 */
async function submitOrdre(e) {
  e.preventDefault();
  const bId = getCurrentBoutiqueId();
  const fd   = new FormData(e.target);

  const payload = {
    boutique_id:         bId,
    rachat_id:           fd.get('rachat_id')          ? Number(fd.get('rachat_id'))     : undefined,
    appareil_marque:     fd.get('appareil_marque')    || undefined,
    appareil_modele:     fd.get('appareil_modele')    || undefined,
    imei:                fd.get('imei')               || undefined,
    couleur:             fd.get('couleur')            || undefined,
    capacite:            fd.get('capacite')           || undefined,
    grade:               fd.get('grade')              || undefined,
    prix_rachat:         parseFloat(fd.get('prix_rachat'))        || 0,
    cout_main_oeuvre:    parseFloat(fd.get('cout_main_oeuvre'))   || 0,
    cout_pieces:         parseFloat(fd.get('cout_pieces'))        || 0,
    prix_revente_ht:     fd.get('prix_revente_ht')    ? parseFloat(fd.get('prix_revente_ht')) : undefined,
    description_travaux: fd.get('description_travaux') || undefined,
  };

  const ordreId = fd.get('id');
  let res;

  if (ordreId) {
    // Mode édition
    res = await apiPut(`/api/reconditionnement/${ordreId}`, payload);
  } else {
    // Mode création
    res = await apiPost('/api/reconditionnement', payload);
  }

  if (res?.success) {
    showToast(ordreId ? 'Ordre mis à jour.' : 'Ordre créé.', 'success');
    closeModalOrdre();
    loadOrdres(_pageOrdres);
    loadKpis();
  } else {
    showToast(res?.error ?? 'Erreur lors de l\'enregistrement.', 'error');
  }
}

// ─── Changement de statut ordre ───────────────────────────────────────────────

/**
 * Change le statut d'un ordre après confirmation de l'utilisateur.
 *
 * @param {number} id     - ID de l'ordre
 * @param {string} statut - Nouveau statut cible
 */
async function changerStatutOrdre(id, statut) {
  const labels = { en_cours: 'Démarrer', abandonne: 'Abandonner' };
  const label  = labels[statut] ?? statut;

  if (!confirm(`Confirmer l'action : ${label} cet ordre ?`)) return;

  const bId = getCurrentBoutiqueId();
  const res  = await apiPatch(`/api/reconditionnement/${id}/statut`, { boutique_id: bId, statut });

  if (res?.success) {
    showToast(`Statut mis à jour : ${statut}.`, 'success');
    loadOrdres(_pageOrdres);
    loadKpis();
  } else {
    showToast(res?.error ?? 'Erreur changement statut.', 'error');
  }
}

// ─── Modal Terminer ────────────────────────────────────────────────────────────

/**
 * Ouvre le modal de clôture d'un ordre.
 * Affiche un résumé (numéro + coût de revient) pour aider la saisie du prix de revente.
 *
 * @param {number} id - ID de l'ordre à clôturer
 */
async function openTerminerOrdre(id) {
  const bId = getCurrentBoutiqueId();
  const res  = await apiGet(`/api/reconditionnement/${id}?boutique_id=${bId}`);
  if (!res?.success) return showToast('Erreur de chargement de l\'ordre.', 'error');

  const o = res.data;
  document.getElementById('terminer-id').value = o.id;

  const resume = document.getElementById('terminer-resume');
  resume.innerHTML = `
    <strong>${_esc(o.numero)}</strong> — 
    ${_esc(o.appareil_marque ?? '')} ${_esc(o.appareil_modele ?? '')}
    ${o.imei ? `(${_esc(o.imei)})` : ''}
    <br>
    Coût de revient : <strong>${_money(o.cout_revient)}</strong>
    ${o.rachat_numero ? ` · Rachat source : ${_esc(o.rachat_numero)}` : ''}
  `;

  // Pré-remplir prix si déjà renseigné
  _setVal('terminer-prix',    o.prix_revente_ht ?? '');
  _setVal('terminer-grade',   o.grade ?? '');
  _setVal('terminer-travaux', o.description_travaux ?? '');

  document.getElementById('modal-terminer').showModal();
}

/** Ferme le modal de clôture. */
function closeModalTerminer() {
  document.getElementById('modal-terminer').close();
}

/**
 * Soumet la clôture de l'ordre : valide la transition en_cours → termine
 * et crée le produit occasion dans le catalogue.
 *
 * @param {SubmitEvent} e - Événement submit
 */
async function submitTerminer(e) {
  e.preventDefault();
  const bId = getCurrentBoutiqueId();
  const id   = document.getElementById('terminer-id').value;
  const fd   = new FormData(e.target);

  const payload = {
    boutique_id:         bId,
    prix_revente_ht:     parseFloat(fd.get('prix_revente_ht')),
    grade:               fd.get('grade'),
    description_travaux: fd.get('description_travaux') || undefined,
  };

  const res = await apiPost(`/api/reconditionnement/${id}/terminer`, payload);

  if (res?.success) {
    showToast(res.message ?? 'Ordre clôturé. Produit créé en stock.', 'success');
    closeModalTerminer();
    loadOrdres(_pageOrdres);
    loadKpis();
  } else {
    showToast(res?.error ?? 'Erreur lors de la clôture.', 'error');
  }
}

// ─── Modal Bon d'achat — création ─────────────────────────────────────────────

/** Ouvre le modal d'émission d'un nouveau bon d'achat. */
function openNewBon() {
  document.getElementById('form-bon').reset();
  document.getElementById('modal-bon').showModal();
}

/** Ferme le modal bon d'achat. */
function closeModalBon() {
  document.getElementById('modal-bon').close();
}

/**
 * Soumet la création d'un bon d'achat.
 * Le code est généré côté API (format BA-XXXXXXXX).
 *
 * @param {SubmitEvent} e - Événement submit
 */
async function submitBon(e) {
  e.preventDefault();
  const bId = getCurrentBoutiqueId();
  const fd   = new FormData(e.target);

  const payload = {
    boutique_id:     bId,
    montant:         parseFloat(fd.get('montant')),
    client_id:       fd.get('client_id')      ? Number(fd.get('client_id'))   : undefined,
    date_expiration: fd.get('date_expiration') || undefined,
    source_type:     fd.get('source_type')    || 'manuel',
    motif:           fd.get('motif')          || undefined,
  };

  const res = await apiPost('/api/bons-achat', payload);

  if (res?.success) {
    const code = res.data?.code ?? '';
    showToast(`Bon émis : ${code} — ${_money(payload.montant)}`, 'success');
    closeModalBon();
    loadBons(_pageBons);
  } else {
    showToast(res?.error ?? 'Erreur création bon.', 'error');
  }
}

// ─── Vérification bon en caisse ───────────────────────────────────────────────

/** Ouvre le modal de vérification de code bon. */
function openModalVerifier() {
  document.getElementById('verifier-code').value     = '';
  document.getElementById('verifier-result').style.display = 'none';
  document.getElementById('modal-verifier').showModal();
  setTimeout(() => document.getElementById('verifier-code').focus(), 100);
}

/** Ferme le modal de vérification. */
function closeModalVerifier() {
  document.getElementById('modal-verifier').close();
}

/**
 * Envoie le code saisi vers l'API de vérification et affiche le résultat.
 * N'effectue PAS de consommation du bon.
 */
async function doVerifierBon() {
  const code    = document.getElementById('verifier-code').value.trim();
  const bId     = getCurrentBoutiqueId();
  const resultEl = document.getElementById('verifier-result');

  if (!code) return showToast('Saisissez un code.', 'error');

  const res = await apiPost('/api/bons-achat/verifier', { boutique_id: bId, code });
  resultEl.style.display = 'block';

  if (!res?.success) {
    resultEl.innerHTML = `<div class="alert alert-error">Erreur réseau.</div>`;
    return;
  }

  const { valide, bon, raison } = res.data;

  if (valide && bon) {
    resultEl.innerHTML = `
      <div class="alert alert-success">
        <strong>✅ Bon valide</strong><br>
        Code : <code>${_esc(bon.code)}</code> —
        Solde disponible : <strong>${_money(bon.montant_restant)}</strong>
        ${bon.client_nom ? `<br>Client : ${_esc(bon.client_prenom ?? '')} ${_esc(bon.client_nom)}` : ''}
        ${bon.date_expiration ? `<br>Expire le : ${_fmtDate(bon.date_expiration)}` : ''}
      </div>
    `;
  } else {
    resultEl.innerHTML = `
      <div class="alert alert-error">
        <strong>❌ Bon invalide</strong><br>${_esc(raison ?? 'Raison inconnue.')}
        ${bon ? `<br>Code : <code>${_esc(bon.code)}</code>` : ''}
      </div>
    `;
  }
}

// ─── Annulation bon ────────────────────────────────────────────────────────────

/**
 * Annule un bon d'achat après confirmation.
 * Seuls les bons avec statut 'actif' et montant_utilise = 0 peuvent être annulés.
 *
 * @param {number} id - ID du bon à annuler
 */
async function annulerBon(id) {
  if (!confirm('Annuler ce bon d\'achat ? Cette action est irréversible.')) return;

  const bId = getCurrentBoutiqueId();
  const res  = await apiPost(`/api/bons-achat/${id}/annuler`, { boutique_id: bId });

  if (res?.success) {
    showToast('Bon annulé.', 'success');
    loadBons(_pageBons);
  } else {
    showToast(res?.error ?? 'Erreur annulation.', 'error');
  }
}

// ─── Helpers privés ────────────────────────────────────────────────────────────

/**
 * Met à jour le textContent d'un élément par son id.
 *
 * @param {string} id    - ID de l'élément DOM
 * @param {string} value - Valeur à afficher
 */
function _setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/**
 * Définit la valeur d'un champ de formulaire par son id.
 *
 * @param {string} id    - ID de l'élément de formulaire
 * @param {*}      value - Valeur à assigner
 */
function _setVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? '';
}

/**
 * Échappe les caractères HTML pour éviter les injections XSS.
 *
 * @param {string} str - Chaîne à échapper
 * @returns {string} Chaîne sécurisée pour insertion dans le DOM
 */
function _esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
