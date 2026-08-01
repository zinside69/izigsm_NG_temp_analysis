#!/usr/bin/env node
/**
 * @file scripts/verifier-deploiement.mjs
 * @description Impose la fenêtre de propagation après un déploiement Cloudflare Pages, et
 * refuse de rendre la main tant que le domaine ne sert pas le nouveau code.
 *
 * ── Pourquoi ce script existe ────────────────────────────────────────────────────────
 *
 * Incident du 2026-08-01. Une page a été ouverte sur `repairdesk.fr` immédiatement après
 * « Deployment complete! », donc **avant** que l'origine ne dispose du nouvel asset hashé.
 * L'edge Cloudflare a reçu le catch-all HTML en `200` pour `/static/js/app.<hash>.js` et
 * l'a mis en cache. Les assets hashés étant servis `immutable`, cette réponse est restée
 * **figée** : `app.js` ne définissait plus aucune fonction et tout le site était mort,
 * pour tous les rôles, sans erreur visible.
 *
 * Deux parades ont été posées ce jour-là. La première est dans le Worker : un `/static/*`
 * absent répond désormais `404` (`src/index.tsx`), donc plus aucune réponse empoisonnée
 * ne peut être figée. Ce script est la seconde : **personne ne doit ouvrir le domaine
 * avant que la vérification soit passée**.
 *
 * ── Ordre des contrôles, et pourquoi cet ordre ───────────────────────────────────────
 *
 * 1. L'**URL d'aperçu** du déploiement d'abord (`<hash>.izigsm.pages.dev`). Elle ne
 *    partage pas le cache de l'apex : l'interroger ne peut rien empoisonner, et elle dit
 *    si le déploiement lui-même est bon.
 * 2. Le **domaine** ensuite, et seulement après la fenêtre d'attente.
 *
 * Interroger l'apex en premier, c'est exactement le geste qui a causé l'incident.
 *
 * ── En cas d'échec ───────────────────────────────────────────────────────────────────
 *
 * Le script **s'arrête en erreur** avec le diagnostic. Il ne reforge pas de hash tout
 * seul : cela produirait un commit et un second déploiement, ce que la règle « déploiement
 * jamais automatique » du projet interdit. La commande de réparation est affichée.
 *
 * Usage : node scripts/verifier-deploiement.mjs [url-apercu] [--domaine=https://repairdesk.fr]
 *
 * L'URL d'aperçu est **facultative** : `npm run deploy` chaîne ce script sans elle, parce
 * que l'invocation `wrangler pages deploy` doit rester exactement celle qui passe la règle
 * de permission du poste (voir `CLAUDE.md` § Déploiement). Sans aperçu, le contrôle du
 * déploiement lui-même est sauté — la fenêtre et le contrôle du domaine, eux, s'appliquent
 * toujours. Fournir l'URL affichée par wrangler quand on relance le script à la main.
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Fenêtre de propagation avant de toucher au domaine, en millisecondes. */
const ATTENTE_MS = 25_000
/** Nombre de tentatives sur le domaine, espacées de ce délai. */
const TENTATIVES = 4
const INTERVALLE_MS = 15_000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Récupère une URL et dit si la réponse est bien l'asset attendu.
 *
 * Le critère est le **contenu**, pas le statut : c'est tout le sujet de l'incident, où la
 * mauvaise réponse arrivait en `200`. Une page HTML commence par `<`.
 */
async function inspecter(url) {
  try {
    const rep = await fetch(url, { cache: 'no-store' })
    const corps = await rep.text()
    return {
      statut: rep.status,
      octets: corps.length,
      estHtml: corps.trimStart().startsWith('<'),
      cache: rep.headers.get('cf-cache-status') ?? '—',
    }
  } catch (err) {
    return { erreur: err.message }
  }
}

const apercu = process.argv.slice(2).find((a) => !a.startsWith('--'))
const domaine =
  (process.argv.find((a) => a.startsWith('--domaine=')) ?? '--domaine=https://repairdesk.fr').split('=')[1]

// L'asset hashé attendu vient du manifeste de build : c'est le seul nom qui fasse foi.
// Ne jamais vérifier `/static/js/app.js` — ce nom n'existe pas dans `dist/`, et c'est
// précisément lui qui renvoyait 200 + HTML avant le correctif du Worker.
const manifeste = JSON.parse(readFileSync(resolve(RACINE, 'dist/static/manifest.json'), 'utf8'))
const chemin = manifeste['static/js/app.js']
if (!chemin) {
  console.error('✗ `static/js/app.js` absent de dist/static/manifest.json — build incomplet ?')
  process.exit(2)
}

console.log(`\nAsset de référence : ${chemin}`)

// ── 1. L'aperçu du déploiement (si fourni) ────────────────────────────────────────────
if (apercu) {
  const surApercu = await inspecter(`${apercu.replace(/\/$/, '')}/${chemin}`)
  if (surApercu.erreur || surApercu.statut !== 200 || surApercu.estHtml) {
    console.error(`\n✗ L'aperçu du déploiement ne sert pas l'asset.`)
    console.error(`  ${apercu}/${chemin} → ${JSON.stringify(surApercu)}`)
    console.error(`\n  Le déploiement lui-même a échoué : ne pas ouvrir ${domaine}, relancer \`npm run deploy\`.`)
    process.exit(1)
  }
  console.log(`✓ Aperçu       : ${surApercu.octets} octets de JavaScript`)
} else {
  console.log(`· Aperçu       : non fourni, contrôle sauté (voir l'en-tête du script)`)
}

// ── 2. La fenêtre de propagation ──────────────────────────────────────────────────────
console.log(`\n⏳ Fenêtre de propagation : ${ATTENTE_MS / 1000} s avant de toucher ${domaine}.`)
console.log(`   Ne pas ouvrir le site dans un navigateur pendant ce temps — c'est le geste`)
console.log(`   qui a figé une mauvaise réponse sur un edge le 2026-08-01.`)
await sleep(ATTENTE_MS)

// ── 3. Le domaine ─────────────────────────────────────────────────────────────────────
for (let essai = 1; essai <= TENTATIVES; essai++) {
  const surDomaine = await inspecter(`${domaine}/${chemin}`)

  if (!surDomaine.erreur && surDomaine.statut === 200 && !surDomaine.estHtml) {
    console.log(`✓ ${domaine} : ${surDomaine.octets} octets de JavaScript (cf-cache ${surDomaine.cache})`)
    console.log(`\n✓ Déploiement vérifié. Le domaine sert bien le nouveau code.\n`)
    process.exit(0)
  }

  if (surDomaine.estHtml) {
    // Ne pas réessayer : un edge qui a figé du HTML sur un asset `immutable` ne se
    // corrigera pas tout seul. Réessayer ne ferait que confirmer le même cache.
    console.error(`\n✗ ${domaine}/${chemin} renvoie du HTML (${surDomaine.octets} octets, cf-cache ${surDomaine.cache}).`)
    console.error(`\n  Un edge a figé la réponse du catch-all sur un asset immutable.`)
    console.error(`  La purge de cache n'est pas disponible sur ce jeton : le seul recours est`)
    console.error(`  de forcer un nouveau nom de fichier.`)
    console.error(`\n  Réparation : modifier l'empreinte de build en tête de`)
    console.error(`  public/static/js/app.js, puis \`npm run deploy\`.\n`)
    process.exit(1)
  }

  console.log(`  tentative ${essai}/${TENTATIVES} : ${JSON.stringify(surDomaine)} — nouvel essai dans ${INTERVALLE_MS / 1000} s`)
  if (essai < TENTATIVES) await sleep(INTERVALLE_MS)
}

console.error(`\n✗ ${domaine} ne sert toujours pas l'asset après ${TENTATIVES} tentatives.`)
console.error(`  Ne pas conclure au succès : vérifier le déploiement dans le tableau de bord Cloudflare.\n`)
process.exit(1)
