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

// ======================== API HELPER (page register — app.js non chargé ici) ========================

/**
 * POST JSON minimal, sans gestion JWT (endpoints publics /api/auth/*).
 * app.js (qui expose apiPostPublic) n'est pas chargé sur cette page — voir register.html.
 * @param {string} url  Chemin de l'endpoint (ex: '/api/auth/register')
 * @param {object} body Corps JSON de la requête
 * @returns {Promise<{ok: boolean, status: number, data: object|null}>}
 */
async function apiPost(url, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null };
  }
}

// ======================== OTP ========================

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
  const r = await apiPost('/api/auth/register', {
    email:        a.email,
    password:     a.password,
    prenom:       a.firstName,
    nom:          a.lastName,
    telephone:    w.phone || null,
    workshopName: w.company_name || null,
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

  const r = await apiPost('/api/auth/resend-otp', { email: registerState.account.email });

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

  const r = await apiPost('/api/auth/verify-otp', { email: registerState.account.email, otp: code });

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
