/**
 * iziGSM — register.js
 * Gestion du tunnel d'inscription 3 étapes
 */

let registerState = {
  step: 1,
  account: {},
  workshop: {},
  otp: null,
  otpExpires: null,
};

// ======================== ÉTAPES ========================
function goToStep(n) {
  // Masquer toutes les étapes
  document.querySelectorAll('.step-panel').forEach(el => el.classList.add('hidden'));
  // Afficher la bonne
  const panel = document.getElementById('step-' + n);
  if (panel) panel.classList.remove('hidden');
  // Mettre à jour la barre de progression
  const bar = document.getElementById('progress-bar');
  if (bar) {
    bar.className = 'progress-bar progress-step-' + n;
  }
  // Mettre à jour la sidebar promo
  document.querySelectorAll('.steps-list li').forEach((li, idx) => {
    li.classList.toggle('active', idx + 1 <= n);
  });
  registerState.step = n;
  clearFlashes();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ======================== VALIDATION ÉTAPE 1 ========================
function submitStep1() {
  const errors = {};
  const firstName = document.getElementById('first_name').value.trim();
  const lastName = document.getElementById('last_name').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const passwordConfirm = document.getElementById('password_confirm').value;

  if (!firstName) errors.first_name = 'Le prénom est requis.';
  if (!lastName) errors.last_name = 'Le nom est requis.';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Email professionnel invalide.';
  if (password.length < 8) errors.password = 'Minimum 8 caractères.';
  if (!/\d/.test(password)) errors.password = 'Le mot de passe doit contenir au moins 1 chiffre.';
  if (password !== passwordConfirm) errors.password_confirm = 'Les mots de passe ne correspondent pas.';

  if (Object.keys(errors).length > 0) {
    showFieldErrors(errors);
    return;
  }

  registerState.account = { firstName, lastName, email, password };
  localStorage.setItem('reg_email', email);
  goToStep(2);
}

// ======================== VALIDATION ÉTAPE 2 ========================
function submitStep2() {
  const errors = {};
  const fields = ['status', 'vat_zone', 'company_name', 'siret', 'address', 'zip', 'city', 'phone'];
  const data = {};

  fields.forEach(f => {
    data[f] = document.getElementById(f)?.value?.trim() || '';
    if (!data[f] && ['status', 'vat_zone', 'company_name', 'siret', 'address', 'zip', 'city', 'phone'].includes(f)) {
      errors[f] = 'Ce champ est requis.';
    }
  });

  if (data.siret && !/^\d{14}$/.test(data.siret.replace(/\s/g, ''))) {
    errors.siret = '14 chiffres requis.';
  }

  if (Object.keys(errors).length > 0) {
    showFieldErrors(errors);
    return;
  }

  registerState.workshop = {
    ...data,
    legal_form: document.getElementById('legal_form')?.value || '',
    vat_number: document.getElementById('vat_number')?.value?.trim() || '',
    phone_country: document.getElementById('phone_country')?.value || '+33',
    search: document.getElementById('search')?.value?.trim() || '',
  };

  // Remplir le récapitulatif étape 3
  buildRecap();
  goToStep(3);
}

// ======================== RÉCAPITULATIF ========================
function buildRecap() {
  const a = registerState.account;
  const w = registerState.workshop;
  const chips = [
    a.email,
    a.firstName + ' ' + a.lastName,
    w.company_name,
    w.zip + ' ' + w.city,
    w.vat_zone,
  ].filter(Boolean);

  const container = document.getElementById('recap-chips');
  if (container) {
    container.innerHTML = chips.map(c => `<span class="chip">${escapeHtml(c)}</span>`).join('');
  }

  const phoneLabel = document.getElementById('otp-phone-label');
  if (phoneLabel) {
    phoneLabel.textContent = `Saisissez le code reçu par email à ${a.email}. Il reste valide 10 minutes.`;
  }
}

// ======================== OTP ========================
// Endpoints publics (register/resend-otp/verify-otp) → apiPostPublic() (app.js, Principe 2
// ARCHITECTURAL_PRINCIPLES.md : aucun fetch() direct hors app.js).

/**
 * Crée le compte (POST /api/auth/register) et déclenche l'envoi du code OTP par email.
 * Le compte est créé inactif côté backend — verifyOtp() l'active après saisie du code.
 * `otpDemo` n'est renvoyé par le backend que si RESEND_API_KEY n'est pas configurée
 * (dev local) — jamais en prod, voir auth.ts.
 */
async function sendOtp() {
  const accepted = document.getElementById('accepted_terms')?.checked;
  if (!accepted) {
    showFlashRegister('⚠️ Vous devez accepter les conditions générales avant de continuer.', 'error');
    return;
  }

  const btn = document.getElementById('btn-send-otp');
  if (btn) { btn.disabled = true; btn.textContent = 'Envoi en cours…'; }

  const a = registerState.account;
  const w = registerState.workshop;
  const r = await apiPostPublic('/api/auth/register', {
    email:        a.email,
    password:     a.password,
    prenom:       a.firstName,
    nom:          a.lastName,
    telephone:    w.phone || null,
    workshopName: w.company_name || null,
    // Détails boutique — préremplis via searchEntreprise() ou saisis manuellement à l'étape 2
    siret:        w.siret      || null,
    tvaNumero:    w.vat_number || null,
    adresse:      w.address    || null,
    codePostal:   w.zip        || null,
    ville:        w.city       || null,
  });

  if (!r.ok) {
    if (btn) { btn.disabled = false; btn.textContent = 'Envoyer le code →'; }
    showFlashRegister('❌ ' + (r.data?.error || 'Erreur lors de la création du compte.'), 'error');
    return;
  }

  registerState.otpDemo = r.data?.otpDemo || null;

  const otpBox = document.getElementById('otp-box');
  if (otpBox) otpBox.classList.remove('hidden');

  showFlashRegister(
    registerState.otpDemo
      ? `✅ Compte créé (mode démo, pas de clé email configurée) — code : ${registerState.otpDemo}`
      : `✅ Un email contenant votre code de vérification a été envoyé à ${a.email}.`,
    'success'
  );

  if (btn) { btn.textContent = '✓ Code envoyé'; }
}

/**
 * Régénère et renvoie l'OTP (POST /api/auth/resend-otp) pour le compte en cours d'inscription.
 * Réponse backend volontairement générique (anti-énumération de comptes) — voir auth.ts.
 */
async function resendOtp() {
  const btn = document.querySelector('#otp-box .btn-ghost');
  if (btn) { btn.disabled = true; }

  const r = await apiPostPublic('/api/auth/resend-otp', { email: registerState.account.email });

  if (!r.ok) {
    showFlashRegister('❌ ' + (r.data?.error || 'Erreur lors du renvoi du code.'), 'error');
    if (btn) { btn.disabled = false; }
    return;
  }

  registerState.otpDemo = r.data?.otpDemo || null;
  showFlashRegister(
    registerState.otpDemo
      ? `✅ Nouveau code (mode démo) : ${registerState.otpDemo}`
      : `✅ Un nouveau code a été envoyé à ${registerState.account.email}.`,
    'success'
  );
  if (btn) { btn.disabled = false; }
}

/**
 * Valide le code saisi (POST /api/auth/verify-otp) : active le compte, récupère les
 * vrais tokens JWT et affiche l'étape de succès. `registerState.account.boutique_id`
 * n'est jamais renseigné ici (le wizard ne crée pas de boutique via ce champ) —
 * conservé pour cohérence avec la forme de session utilisée par app.js/login.html.
 */
async function verifyOtp() {
  const code = document.getElementById('otp-input')?.value?.trim();
  if (!code) {
    showFlashRegister('⚠️ Saisissez le code reçu par email.', 'error');
    return;
  }

  const r = await apiPostPublic('/api/auth/verify-otp', { email: registerState.account.email, otp: code });

  if (!r.ok) {
    showFlashRegister('❌ ' + (r.data?.error || 'Code incorrect ou expiré.'), 'error');
    return;
  }

  // Compte activé — session réelle (mêmes clés que app.js/login.js)
  const { accessToken, refreshToken, user } = r.data;
  const session = {
    name:          `${user.prenom || ''} ${user.nom || ''}`.trim() || user.email,
    email:         user.email,
    role:          user.role,
    boutique_id:   registerState.account.boutique_id ?? null,
    boutique_name: registerState.workshop.company_name || 'Mon Atelier',
    company:       registerState.workshop.company_name || 'Mon Atelier',
  };
  localStorage.setItem('izigsm_token', accessToken);
  localStorage.setItem('izigsm_refresh_token', refreshToken);
  localStorage.setItem('izigsm_session', JSON.stringify(session));
  localStorage.setItem('reg_email', user.email);

  goToStep('success');
  const emailEl = document.getElementById('success-email');
  if (emailEl) emailEl.textContent = user.email;
  const successChips = document.getElementById('success-chips');
  if (successChips) {
    successChips.innerHTML = [
      registerState.workshop.company_name,
      registerState.workshop.siret,
      registerState.workshop.city,
    ].filter(Boolean).map(c => `<span class="chip">${escapeHtml(c)}</span>`).join('');
  }
  const verifyBtn = document.getElementById('btn-go-verify');
  if (verifyBtn) { verifyBtn.href = '/dashboard'; verifyBtn.textContent = 'Accéder à mon espace →'; }
}

// ======================== RECHERCHE ENTREPRISE (SIRENE) ========================
// Autocomplete "Rechercher mon entreprise" — GET /api/public/entreprise-search
// (recherche-entreprises.api.gouv.fr, gratuite/sans clé). Préremplit les champs
// déjà visibles (company_name/siret/address/zip/city) — saisie manuelle reste
// possible, ces champs ne sont jamais masqués (voir #workshop-fields).

let searchDebounceTimer = null;
let searchResultsCache  = [];

/** Debounce 350ms sur l'input #search — évite un appel API à chaque frappe. */
function onSearchInput() {
  clearTimeout(searchDebounceTimer);
  const query = document.getElementById('search')?.value?.trim() || '';
  if (query.length < 3) {
    hideSearchResults();
    return;
  }
  searchDebounceTimer = setTimeout(() => searchEntreprise(query), 350);
}

/**
 * Interroge GET /api/public/entreprise-search et affiche les résultats.
 * Échoue silencieusement (pas de flash d'erreur) — c'est une aide optionnelle,
 * la saisie manuelle reste toujours disponible en dessous.
 * @param {string} query
 */
async function searchEntreprise(query) {
  const res = await apiGet('/api/public/entreprise-search', { q: query });
  if (!res.ok || !Array.isArray(res.data?.data) || res.data.data.length === 0) {
    hideSearchResults();
    return;
  }
  searchResultsCache = res.data.data;
  renderSearchResults(searchResultsCache);
}

/** Construit la dropdown de résultats (nom + adresse), un item par entreprise. */
function renderSearchResults(results) {
  const box = document.getElementById('search-results');
  if (!box) return;
  box.innerHTML = results.map((r, i) => `
    <div onclick="selectEntreprise(${i})" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #f1f5f9;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
      <div style="font-weight:600;">${escapeHtml(r.nom)}</div>
      <div style="font-size:0.85rem;color:var(--muted,#667085);">${escapeHtml(r.adresse)} ${escapeHtml(r.code_postal)} ${escapeHtml(r.ville)} · SIRET ${escapeHtml(r.siret)}</div>
    </div>
  `).join('');
  box.classList.remove('hidden');
}

function hideSearchResults() {
  const box = document.getElementById('search-results');
  if (box) box.classList.add('hidden');
}

/**
 * Sélectionne un résultat de recherche : préremplit company_name/siret/address/
 * zip/city (champs déjà visibles, jamais masqués) puis ferme la dropdown.
 * @param {number} idx  Index dans searchResultsCache
 */
function selectEntreprise(idx) {
  const r = searchResultsCache[idx];
  if (!r) return;

  const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value || ''; };
  set('company_name', r.nom);
  set('siret',         r.siret);
  set('address',       r.adresse);
  set('zip',           r.code_postal);
  set('city',          r.ville);

  const searchInput = document.getElementById('search');
  if (searchInput) searchInput.value = r.nom;
  hideSearchResults();
}

// ======================== SAISIE MANUELLE ========================
function toggleManual(e) {
  e.preventDefault();
  // Le formulaire est déjà affiché, juste focus sur company_name
  document.getElementById('company_name')?.focus();
}

// ======================== FLASH REGISTER ========================
function showFlashRegister(msg, type='info') {
  const area = document.getElementById('flash-area');
  if (!area) return;
  area.style.display = 'grid';
  area.innerHTML = `<div class="flash ${type}">${escapeHtml(msg)}</div>`;
}
function clearFlashes() {
  const area = document.getElementById('flash-area');
  if (area) { area.style.display = 'none'; area.innerHTML = ''; }
  // Effacer les erreurs de champs
  document.querySelectorAll('.field-error').forEach(el => el.textContent = '');
  document.querySelectorAll('input.error, select.error').forEach(el => el.classList.remove('error'));
}
function showFieldErrors(errors) {
  clearFlashes();
  Object.entries(errors).forEach(([field, msg]) => {
    const errEl = document.getElementById('err-' + field);
    if (errEl) errEl.textContent = msg;
    const input = document.getElementById(field);
    if (input) input.classList.add('error');
  });
  // Flash global aussi
  const area = document.getElementById('flash-area');
  if (area) {
    area.style.display = 'grid';
    area.innerHTML = `<div class="flash error">❌ Veuillez corriger les erreurs ci-dessous.</div>`;
  }
}

// ======================== UTILS ========================
function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  goToStep(1);
});
