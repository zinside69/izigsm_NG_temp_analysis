import { describe, it, expect } from 'vitest'
// @ts-ignore node:fs types not available without @types/node
import { readdirSync, readFileSync } from 'node:fs'
// @ts-ignore node:path types not available without @types/node
import { join } from 'node:path'

/**
 * Conformite d'isolation multi-tenant.
 *
 * Toute route dont le chemin porte un parametre d'identifiant doit soit verifier
 * l'appartenance de la ressource a la boutique appelante, soit figurer dans
 * EXEMPTIONS avec un motif. Trois campagnes de correction (2026-07-19, 07-30,
 * 07-31) ont chacune laisse des routes ouvertes faute d'un tel garde-fou.
 *
 * IMPORTANT (task 7) : au premier lancement, ce test a remonte 23 routes qui ne
 * sont NI gardees NI dans les exemptions ci-dessous, en plus des cas legitimes
 * traites par elargissement de aUneGarde() ou par exemption motivee. Ces 23
 * routes sont de vraies failles d'isolation non corrigees par ce chantier (hors
 * perimetre de la tache 7, qui ne modifie aucune route applicative) : elles
 * laissent volontairement le test ROUGE plutot que d'etre exemptees pour faire
 * du vert de facade. Voir task-7-report.md pour le detail et le classement
 * complet des 28 routes remontees au premier lancement.
 */

// @ts-ignore process types not available without @types/node
const ROUTES_DIR = join(process.cwd(), 'src', 'routes')

/** Routes sans garde d'isolation, volontairement et avec motif. */
const EXEMPTIONS: Record<string, string> = {
  'personnel.ts DELETE /employes/:id':               'admin-only : requireRole(admin) seul, l\'admin plateforme traverse par conception',
  'public.ts GET /token-for-ticket/:id':             'endpoint desactive : repond toujours 405 sans jamais lire ni ecrire aucune ressource, le param :id n\'est meme pas lu dans le handler',
  'services.ts PUT /services/marques/:id':           'referentiel-global : ecriture restreinte a requireRole(admin)',
  'services.ts DELETE /services/marques/:id':        'referentiel-global : ecriture restreinte a requireRole(admin)',
  'services.ts PUT /services/modeles/:id':           'referentiel-global : ecriture restreinte a requireRole(admin)',
  'services.ts DELETE /services/modeles/:id':        'referentiel-global : ecriture restreinte a requireRole(admin)',
}

const DECL = /^\s*\w+\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]*)['"`]/

/**
 * Certains routers definissent un helper local `ctx(c)` qui derive lui-meme
 * boutiqueId via getBoutiqueId() avant de le retourner (sav.ts) : les handlers
 * font `const { boutiqueId } = ctx(c)` puis passent `boutiqueId` aux services,
 * mais le texte "getBoutiqueId" n'apparait alors jamais dans le corps du
 * handler individuel — seulement dans le helper partage, une fois, en tete de
 * fichier. D'autres fichiers (clients.ts, stocks.ts, tickets.ts, reconditionnement.ts)
 * definissent aussi un `ctx(c)`, mais sans y deriver boutiqueId (ils se contentent
 * d'extraire `queryBoutiqueId` brut) : la garde reste alors explicite dans chaque
 * handler individuel et est deja couverte par `getBoutiqueId` ci-dessous — cette
 * fonction ne les concerne pas.
 *
 * Verifie manuellement (task 7, 2026-07-31) : getGarantie/getSav/updateSavStatut
 * (src/services/garantiesService.ts) filtrent bien `WHERE ... AND boutique_id = ?`
 * avec la valeur issue de ce helper avant d'elargir la detection sur ce patron.
 */
function fichierDeriveBoutiqueIdViaCtx(texteFichier: string): boolean {
  const m = texteFichier.match(/function\s+ctx\s*\(c[^)]*\)\s*\{([\s\S]*?)\n\}/)
  return !!m && /getBoutiqueId\(/.test(m[1])
}

/** Signaux acceptes comme garde d'isolation. */
function aUneGarde(corps: string, texteFichier: string): boolean {
  if (/assertBoutiqueOwnership/.test(corps))  return true
  if (/boutique_id\s*!==/.test(corps))        return true
  if (/getBoutiqueId/.test(corps))            return true
  if (/boutique_id\s*=\s*\?/.test(corps))     return true
  // boutiques.ts s'identifie par `id`, pas par `boutique_id`
  if (/user\.boutique_id/.test(corps))        return true
  // Fonctions de service dediees creees pendant ce chantier pour eviter le SQL
  // inline dans les controllers : elles encapsulent la verification d'appartenance
  // sans que "boutique_id" apparaisse tel quel dans le handler (voir
  // ticketService.ts, fournisseursService.ts, servicesService.ts).
  if (/getTicketBoutiqueId/.test(corps))      return true
  if (/getBonCommandeBoutiqueId/.test(corps)) return true
  if (/getCategorieBoutiqueId/.test(corps))   return true
  // resetPINAdmin() (src/services/userService.ts) compare en interne
  // target.boutique_id a adminUser.boutique_id — adminUser est c.get('user')
  // (payload JWT signe), jamais une valeur fournie par l'appelant. Verifie
  // manuellement le 2026-07-31 (task 7) avant d'elargir la detection.
  if (/resetPINAdmin\(/.test(corps))          return true
  // Helper local ctx(c) qui derive boutiqueId via getBoutiqueId() avant de le
  // retourner (voir fichierDeriveBoutiqueIdViaCtx ci-dessus).
  if (/\bctx\(c\)/.test(corps) && /\bboutiqueId\b/.test(corps) && fichierDeriveBoutiqueIdViaCtx(texteFichier))
    return true
  return false
}

function routesParId() {
  const trouvees: Array<{ cle: string; corps: string; texteFichier: string }> = []
  for (const fichier of readdirSync(ROUTES_DIR).filter((f: string) => f.endsWith('.ts'))) {
    const texteFichier: string = readFileSync(join(ROUTES_DIR, fichier), 'utf8')
    const lignes = texteFichier.split('\n')
    const decls: Array<{ i: number; verbe: string; chemin: string }> = []
    lignes.forEach((l: string, i: number) => {
      const m = l.match(DECL)
      if (m) decls.push({ i, verbe: m[1].toUpperCase(), chemin: m[2] })
    })
    decls.forEach((d, k) => {
      if (!/:\w*[iI]d/.test(d.chemin)) return
      const fin = k + 1 < decls.length ? decls[k + 1].i : lignes.length
      trouvees.push({
        cle:          `${fichier} ${d.verbe} ${d.chemin}`,
        corps:        lignes.slice(d.i, fin).join('\n'),
        texteFichier,
      })
    })
  }
  return trouvees
}

describe('Conformite isolation multi-tenant', () => {
  it('toute route par ID a une garde d\'isolation ou une exemption motivee', () => {
    const manquantes = routesParId()
      .filter(r => !aUneGarde(r.corps, r.texteFichier))
      .filter(r => !(r.cle in EXEMPTIONS))
      .map(r => r.cle)

    expect(manquantes,
      `Routes par ID sans garde d'isolation :\n  ${manquantes.join('\n  ')}\n\n` +
      `Ajoutez assertBoutiqueOwnership() dans le handler, ou inscrivez la route ` +
      `dans EXEMPTIONS avec un motif si l'absence de garde est deliberee. ` +
      `Voir task-7-report.md si cette liste contient des routes deja connues comme ` +
      `failles reelles non corrigees (ne pas les exempter pour faire passer ce test).`
    ).toEqual([])
  })

  it('chaque exemption porte un motif non vide', () => {
    for (const [cle, motif] of Object.entries(EXEMPTIONS)) {
      expect(motif.trim().length, `Exemption sans motif : ${cle}`).toBeGreaterThan(0)
    }
  })

  it('aucune exemption ne designe une route disparue', () => {
    const existantes = new Set(routesParId().map(r => r.cle))
    const orphelines = Object.keys(EXEMPTIONS).filter(c => !existantes.has(c))
    expect(orphelines, `Exemptions obsoletes a supprimer :\n  ${orphelines.join('\n  ')}`).toEqual([])
  })
})
