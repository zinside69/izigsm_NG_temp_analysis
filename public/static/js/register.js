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
    phoneLabel.textContent = `Saisissez le code reçu au ${w.phone_country} ${w.phone}. Il reste valide 10 minutes.`;
  }
}

// ======================== OTP ========================
function sendOtp() {
  const accepted = document.getElementById('accepted_terms')?.checked;
  if (!accepted) {
    showFlashRegister('⚠️ Vous devez accepter les conditions générales avant de continuer.', 'error');
    return;
  }

  // Générer un code OTP simulé
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  registerState.otp = otp;
  registerState.otpExpires = Date.now() + 600000; // 10 min

  console.log('[iziGSM démo] Code OTP :', otp); // Affiché dans la console pour la démo

  // Afficher la box OTP
  const otpBox = document.getElementById('otp-box');
  if (otpBox) otpBox.classList.remove('hidden');

  // Feedback utilisateur
  const phone = (registerState.workshop.phone_country || '+33') + ' ' + (registerState.workshop.phone || '');
  showFlashRegister(`✅ Code envoyé par SMS au ${phone} (mode démo : consultez la console pour le code)`, 'success');

  // Désactiver le bouton
  const btn = document.getElementById('btn-send-otp');
  if (btn) { btn.textContent = '✓ Code envoyé'; btn.disabled = true; }
}

function resendOtp() {
  registerState.otp = null;
  registerState.otpExpires = null;
  const btn = document.getElementById('btn-send-otp');
  if (btn) { btn.textContent = 'Envoyer le code →'; btn.disabled = false; }
  sendOtp();
}

function verifyOtp() {
  const code = document.getElementById('otp-input')?.value?.trim();

  if (!registerState.otp) {
    showFlashRegister('⚠️ Aucun code actif. Cliquez sur "Envoyer le code" pour recevoir un nouveau code.', 'error');
    return;
  }
  if (Date.now() > registerState.otpExpires) {
    showFlashRegister('⏱ Le code a expiré. Cliquez sur "Renvoyer le code".', 'error');
    return;
  }
  if (code !== registerState.otp) {
    showFlashRegister('❌ Code incorrect. Vérifiez le code reçu.', 'error');
    return;
  }

  // Succès — sauvegarder l'utilisateur
  const user = {
    name: registerState.account.firstName + ' ' + registerState.account.lastName,
    email: registerState.account.email,
    company: registerState.workshop.company_name,
    siret: registerState.workshop.siret,
    city: registerState.workshop.city,
    loggedAt: Date.now(),
  };
  localStorage.setItem('izigsm_user', JSON.stringify(user));
  localStorage.setItem('izigsm_session', JSON.stringify(user));
  localStorage.setItem('reg_email', user.email);

  // Appel API pour persister (sans auth — endpoint public, fallback gracieux)
  apiPostPublic('/api/register', {
    account:  registerState.account,
    workshop: registerState.workshop,
  }).catch(() => {}); // Ignorer les erreurs réseau

  // Afficher le succès
  goToStep('success');
  const emailEl = document.getElementById('success-email');
  if (emailEl) emailEl.textContent = registerState.account.email;
  const successChips = document.getElementById('success-chips');
  if (successChips) {
    successChips.innerHTML = [
      user.company,
      user.siret,
      user.city,
    ].map(c => `<span class="chip">${escapeHtml(c)}</span>`).join('');
  }
  const verifyBtn = document.getElementById('btn-go-verify');
  if (verifyBtn) verifyBtn.href = '/verify-email.html?email=' + encodeURIComponent(user.email);
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
