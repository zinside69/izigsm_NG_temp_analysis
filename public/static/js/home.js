/**
 * iziGSM — Landing Page
 * Smooth scroll, animations, compteurs KPI, interactions publiques
 */

'use strict';

document.addEventListener('DOMContentLoaded', () => {
  initSmoothScroll();
  initNavScroll();
  initCounters();
  initScrollReveal();
  initFAQ();
  initMobileMenu();
  initCookieBanner();
});

// ─── Smooth scroll pour les ancres internes ─────────────────────────────────
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', e => {
      const target = document.querySelector(link.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      const offset = 80; // hauteur de la navbar fixe
      const top    = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });
}

// ─── Navbar : fond au scroll ────────────────────────────────────────────────
function initNavScroll() {
  const nav = document.querySelector('.navbar, nav, header');
  if (!nav) return;

  function updateNav() {
    if (window.scrollY > 40) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
  }

  window.addEventListener('scroll', updateNav, { passive: true });
  updateNav();
}

// ─── Compteurs animés (KPIs hero) ──────────────────────────────────────────
function initCounters() {
  const counters = document.querySelectorAll('[data-counter]');
  if (!counters.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCounter(entry.target);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  counters.forEach(el => observer.observe(el));
}

function animateCounter(el) {
  const target   = parseInt(el.dataset.counter)   || 0;
  const duration = parseInt(el.dataset.duration)  || 2000;
  const suffix   = el.dataset.suffix || '';
  const prefix   = el.dataset.prefix || '';
  const start    = performance.now();

  function step(now) {
    const elapsed  = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const value    = Math.floor(easeOutQuart(progress) * target);
    el.textContent = prefix + value.toLocaleString('fr-FR') + suffix;
    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

function easeOutQuart(t) {
  return 1 - Math.pow(1 - t, 4);
}

// ─── Scroll reveal : apparition au scroll ──────────────────────────────────
function initScrollReveal() {
  const elements = document.querySelectorAll(
    '.feature-card, .testimonial-card, .pricing-card, .stat-card, [data-reveal]'
  );
  if (!elements.length) return;

  // Initialiser opacité 0
  elements.forEach((el, i) => {
    if (!el.style.opacity) {
      el.style.opacity       = '0';
      el.style.transform     = 'translateY(30px)';
      el.style.transition    = `opacity .5s ease ${i % 4 * 0.1}s, transform .5s ease ${i % 4 * 0.1}s`;
    }
  });

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity   = '1';
        entry.target.style.transform = 'translateY(0)';
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  elements.forEach(el => observer.observe(el));
}

// ─── FAQ accordion ──────────────────────────────────────────────────────────
function initFAQ() {
  document.querySelectorAll('.faq-question, .accordion-header').forEach(btn => {
    btn.addEventListener('click', () => {
      const item   = btn.closest('.faq-item, .accordion-item');
      const answer = item?.querySelector('.faq-answer, .accordion-body');
      if (!answer) return;

      const isOpen = item.classList.contains('open');

      // Fermer tous
      document.querySelectorAll('.faq-item.open, .accordion-item.open').forEach(el => {
        el.classList.remove('open');
        const a = el.querySelector('.faq-answer, .accordion-body');
        if (a) a.style.maxHeight = '0';
      });

      if (!isOpen) {
        item.classList.add('open');
        answer.style.maxHeight = answer.scrollHeight + 'px';
      }
    });
  });
}

// ─── Menu mobile (burger) ───────────────────────────────────────────────────
function initMobileMenu() {
  const burger  = document.getElementById('mobile-menu-btn');
  const menu    = document.getElementById('mobile-menu');
  if (!burger || !menu) return;

  burger.addEventListener('click', () => {
    const open = menu.classList.toggle('open');
    burger.setAttribute('aria-expanded', open);
    burger.innerHTML = open
      ? '<i class="fas fa-times"></i>'
      : '<i class="fas fa-bars"></i>';
  });

  // Fermer au clic sur lien
  menu.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      menu.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
      burger.innerHTML = '<i class="fas fa-bars"></i>';
    });
  });

  // Fermer au clic hors menu
  document.addEventListener('click', e => {
    if (!menu.contains(e.target) && !burger.contains(e.target)) {
      menu.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
      burger.innerHTML = '<i class="fas fa-bars"></i>';
    }
  });
}

// ─── Bannière cookies ────────────────────────────────────────────────────────
function initCookieBanner() {
  const banner = document.getElementById('cookie-banner');
  if (!banner) return;

  // Vérifier si déjà accepté
  if (localStorage.getItem('izigsm_cookies_accepted')) {
    banner.style.display = 'none';
    return;
  }

  banner.style.display = 'flex';

  const acceptBtn = document.getElementById('cookie-accept');
  const refuseBtn = document.getElementById('cookie-refuse');

  if (acceptBtn) {
    acceptBtn.addEventListener('click', () => {
      localStorage.setItem('izigsm_cookies_accepted', '1');
      hideBanner(banner);
    });
  }

  if (refuseBtn) {
    refuseBtn.addEventListener('click', () => {
      localStorage.setItem('izigsm_cookies_accepted', '0');
      hideBanner(banner);
    });
  }
}

function hideBanner(banner) {
  banner.style.opacity    = '0';
  banner.style.transition = 'opacity .3s ease';
  setTimeout(() => { banner.style.display = 'none'; }, 350);
}

// ─── Utilitaires publics ────────────────────────────────────────────────────

/**
 * CTA "Essai gratuit" — redirige vers register
 */
function goToRegister(source) {
  const src = source || 'homepage';
  window.location.href = '/register?utm_source=' + src;
}

/**
 * Démo vidéo — ouvre un modal ou une URL
 */
function openDemoVideo() {
  const modal = document.getElementById('modal-demo');
  if (modal) {
    openModal('modal-demo');
  } else {
    // Fallback : ouvrir dans un nouvel onglet
    window.open('https://www.youtube.com/watch?v=8M_mjm7LGm8', '_blank');
  }
}

/**
 * Notification du form contact / newsletter
 */
function submitContact(e) {
  if (e && e.preventDefault) e.preventDefault();
  const form  = e ? e.target : document.getElementById('contact-form');
  const email = form ? form.querySelector('[type="email"]') : null;
  if (!email || !email.value.includes('@')) {
    alert('Veuillez entrer une adresse email valide.');
    return;
  }
  // Simulation d'envoi
  const btn = form ? form.querySelector('[type="submit"]') : null;
  if (btn) {
    btn.disabled     = true;
    btn.textContent  = 'Envoi…';
  }
  setTimeout(() => {
    if (form) form.reset();
    if (btn) {
      btn.disabled    = false;
      btn.textContent = 'Envoyer';
    }
    // Affiche un message de succès inline
    const msg = document.getElementById('contact-success');
    if (msg) {
      msg.style.display = 'block';
      setTimeout(() => { msg.style.display = 'none'; }, 5000);
    } else {
      alert('Message envoyé ! Nous vous répondrons sous 24h.');
    }
  }, 1200);
}

// ─── Exposer globalement ────────────────────────────────────────────────────
window.goToRegister   = goToRegister;
window.openDemoVideo  = openDemoVideo;
window.submitContact  = submitContact;
