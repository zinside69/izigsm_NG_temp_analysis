/**
 * pwa.js — Enregistrement Service Worker + Install Prompt iziGSM
 * Sprint 2.14
 * À charger en dernier <script> dans chaque page (après app.js)
 */

(function () {
  'use strict'

  // ─── Enregistrement SW ────────────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
        console.log('[PWA] Service Worker enregistré :', reg.scope)

        // Détecter une mise à jour disponible
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing
          if (!newWorker) return
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              _showUpdateBanner()
            }
          })
        })
      } catch (err) {
        console.warn('[PWA] SW registration failed:', err)
      }
    })
  }

  // ─── Install Prompt (A2HS — Add to Home Screen) ───────────────────────────
  let deferredPrompt = null

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault()
    deferredPrompt = e

    // N'afficher le banner que si non déjà installé et pas déjà refusé
    const dismissed = sessionStorage.getItem('pwa_prompt_dismissed')
    if (!dismissed) {
      _showInstallBanner()
    }
  })

  window.addEventListener('appinstalled', () => {
    console.log('[PWA] Application installée')
    deferredPrompt = null
    _hideInstallBanner()
    sessionStorage.setItem('pwa_installed', '1')
  })

  // ─── Banner install ───────────────────────────────────────────────────────
  function _showInstallBanner() {
    if (document.getElementById('pwa-install-banner')) return

    const banner = document.createElement('div')
    banner.id = 'pwa-install-banner'
    banner.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #1e1b4b;
      color: #fff;
      border-radius: 14px;
      padding: 14px 20px;
      display: flex;
      align-items: center;
      gap: 14px;
      box-shadow: 0 8px 32px rgba(99,102,241,.35);
      z-index: 9999;
      max-width: 420px;
      width: calc(100% - 32px);
      animation: slideUp .3s ease;
    `
    banner.innerHTML = `
      <style>
        @keyframes slideUp { from { transform: translateX(-50%) translateY(100%); opacity:0; } to { transform: translateX(-50%) translateY(0); opacity:1; } }
      </style>
      <span style="font-size:1.6rem;flex-shrink:0;">📲</span>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:.9rem;">Installer iziGSM</div>
        <div style="font-size:.78rem;opacity:.8;margin-top:2px;">Accès rapide, fonctionne hors ligne</div>
      </div>
      <button id="pwa-install-btn" style="
        background:#6366f1;color:#fff;border:none;border-radius:8px;
        padding:8px 14px;font-size:.82rem;font-weight:700;cursor:pointer;
        flex-shrink:0;
      ">Installer</button>
      <button id="pwa-dismiss-btn" style="
        background:transparent;color:rgba(255,255,255,.6);border:none;
        font-size:1.1rem;cursor:pointer;line-height:1;flex-shrink:0;padding:4px;
      ">✕</button>
    `
    document.body.appendChild(banner)

    document.getElementById('pwa-install-btn').addEventListener('click', _triggerInstall)
    document.getElementById('pwa-dismiss-btn').addEventListener('click', () => {
      sessionStorage.setItem('pwa_prompt_dismissed', '1')
      _hideInstallBanner()
    })

    // Auto-masquer après 12 secondes
    setTimeout(_hideInstallBanner, 12000)
  }

  async function _triggerInstall() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    console.log('[PWA] Install outcome:', outcome)
    deferredPrompt = null
    _hideInstallBanner()
    if (outcome === 'dismissed') {
      sessionStorage.setItem('pwa_prompt_dismissed', '1')
    }
  }

  function _hideInstallBanner() {
    const banner = document.getElementById('pwa-install-banner')
    if (banner) {
      banner.style.animation = 'none'
      banner.style.opacity = '0'
      banner.style.transition = 'opacity .2s'
      setTimeout(() => banner.remove(), 200)
    }
  }

  // ─── Banner mise à jour ───────────────────────────────────────────────────
  function _showUpdateBanner() {
    if (document.getElementById('pwa-update-banner')) return

    const banner = document.createElement('div')
    banner.id = 'pwa-update-banner'
    banner.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      background: #6366f1;
      color: #fff;
      border-radius: 12px;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      box-shadow: 0 4px 20px rgba(99,102,241,.4);
      z-index: 9999;
      font-size: .85rem;
      max-width: 320px;
    `
    banner.innerHTML = `
      <span style="font-size:1.2rem;">🔄</span>
      <div style="flex:1;">
        <strong>Mise à jour disponible</strong>
        <div style="font-size:.78rem;opacity:.85;margin-top:2px;">Rechargez pour appliquer</div>
      </div>
      <button onclick="window.location.reload()" style="
        background:#fff;color:#6366f1;border:none;border-radius:6px;
        padding:6px 10px;font-size:.78rem;font-weight:700;cursor:pointer;
      ">Recharger</button>
      <button onclick="this.parentElement.remove()" style="
        background:transparent;color:rgba(255,255,255,.7);border:none;
        cursor:pointer;font-size:1rem;line-height:1;
      ">✕</button>
    `
    document.body.appendChild(banner)
  }

  // ─── Indicateur hors-ligne ────────────────────────────────────────────────
  function _updateOnlineStatus() {
    const bar = document.getElementById('offline-bar')
    if (!navigator.onLine) {
      if (!bar) {
        const el = document.createElement('div')
        el.id = 'offline-bar'
        el.style.cssText = `
          position: fixed; top: 0; left: 0; right: 0;
          background: #dc2626; color: #fff;
          text-align: center; padding: 6px;
          font-size: .82rem; font-weight: 600;
          z-index: 10000;
        `
        el.textContent = '⚠️ Mode hors ligne — les modifications seront synchronisées dès la reconnexion'
        document.body.prepend(el)
      }
    } else {
      bar?.remove()
    }
  }

  window.addEventListener('online',  _updateOnlineStatus)
  window.addEventListener('offline', _updateOnlineStatus)
  _updateOnlineStatus() // Vérification initiale

})()
