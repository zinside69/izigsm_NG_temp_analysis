/**
 * lib/xlsx.ts — Écrivain minimal de classeur Excel (.xlsx), sans dépendance.
 *
 * Créé le 2026-10-02 pour l'export comptable mensuel (ticket 001 `export-comptable-mensuel`) :
 * le dépôt n'a aucune librairie Excel (`dependencies` : hono seul), et un Worker Cloudflare n'a ni
 * système de fichiers ni module natif. Un .xlsx n'est qu'une archive ZIP de fichiers XML
 * (SpreadsheetML) : on l'écrit à la main, **sans compression** (méthode 0, « stored »), avec le
 * CRC-32 exigé par le format.
 *
 * Volontairement petit : cellules texte ou nombre, une poignée de styles fixes, largeurs de
 * colonnes, volets figés. ⊥ formules, ⊥ fusion, ⊥ date Excel (les dates sont écrites en texte
 * lisible, c'est un document à lire, pas à recalculer).
 *
 * @module lib/xlsx
 */

/** Styles disponibles — index dans `cellXfs` de `styles.xml` (ordre figé, voir STYLES_XML). */
const STYLES = {
  normal:    0,
  gras:      1,
  euro:      2,
  euroGras:  3,
  grise:     4,
  euroGrise: 5,
  entete:    6,
  titre:     7,
  note:      8,
  entier:    9,
  entierGras: 10,
} as const

export type StyleCellule = keyof typeof STYLES

/** Une cellule : texte, nombre ou vide (`null`), avec un style facultatif. */
export interface Cellule {
  v:      string | number | null
  style?: StyleCellule
}

/** Un onglet : nom (≤ 31 caractères), lignes de cellules, largeurs de colonnes facultatives. */
export interface Onglet {
  nom:       string
  lignes:    Cellule[][]
  largeurs?: number[]
  /** Nombre de lignes figées en haut (en-tête qui reste visible au défilement). */
  figerLignes?: number
}

// ─── XML ──────────────────────────────────────────────────────────────────────

/** Échappe un texte pour un contenu ou un attribut XML. */
function xml(texte: string): string {
  return texte
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Caractères de contrôle interdits en XML 1.0 (hors tabulation et sauts de ligne)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

/** Référence de colonne Excel : 0 → A, 25 → Z, 26 → AA. */
function colonne(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

function feuilleXml(o: Onglet): string {
  const cols = o.largeurs?.length
    ? `<cols>${o.largeurs.map((l, i) => `<col min="${i + 1}" max="${i + 1}" width="${l}" customWidth="1"/>`).join('')}</cols>`
    : ''
  const volets = o.figerLignes
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${o.figerLignes}" topLeftCell="A${o.figerLignes + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
  const lignes = o.lignes.map((ligne, r) => {
    const cellules = ligne.map((c, k) => {
      const ref = `${colonne(k)}${r + 1}`
      const s = c.style ? ` s="${STYLES[c.style]}"` : ''
      if (c.v === null || c.v === '') return `<c r="${ref}"${s}/>`
      if (typeof c.v === 'number' && Number.isFinite(c.v)) return `<c r="${ref}"${s}><v>${c.v}</v></c>`
      return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(String(c.v))}</t></is></c>`
    }).join('')
    return `<row r="${r + 1}">${cellules}</row>`
  }).join('')
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + volets + cols + `<sheetData>${lignes}</sheetData>`
    + '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>'
    + '<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>'
    + '</worksheet>'
}

/**
 * Styles : polices (0 normale, 1 grasse, 2 titre, 3 grise italique, 4 en-tête blanche grasse),
 * fonds (2 gris clair, 3 violet iziGSM), bordure fine (1), formats `#,##0.00 €` (164) et `0`.
 * L'ordre de `cellXfs` doit rester celui de `STYLES`.
 */
const STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/></numFmts>'
  + '<fonts count="5">'
  + '<font><sz val="10"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="10"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="14"/><color rgb="FF4F46E5"/><name val="Calibri"/></font>'
  + '<font><i/><sz val="9"/><color rgb="FF6B7280"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
  + '</fonts>'
  + '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FF4F46E5"/><bgColor indexed="64"/></patternFill></fill>'
  + '</fills>'
  + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
  + '<border><left style="thin"><color rgb="FFE5E7EB"/></left><right style="thin"><color rgb="FFE5E7EB"/></right>'
  + '<top style="thin"><color rgb="FFE5E7EB"/></top><bottom style="thin"><color rgb="FFE5E7EB"/></bottom><diagonal/></border>'
  + '</borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="11">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>'                                        // normal
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>'              // gras
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>'                  // euro
  + '<xf numFmtId="164" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>' // euroGras
  + '<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>'              // grise
  + '<xf numFmtId="164" fontId="3" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>' // euroGrise
  + '<xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' // entete
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'                                          // titre
  + '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>'                                          // note
  + '<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>'                    // entier
  + '<xf numFmtId="1" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>' // entierGras
  + '</cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>'

// ─── ZIP (méthode 0, sans compression) ────────────────────────────────────────

const TABLE_CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(octets: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < octets.length; i++) c = TABLE_CRC[(c ^ octets[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function zip(fichiers: { nom: string; contenu: string }[]): Uint8Array {
  const enc = new TextEncoder()
  const locaux: Uint8Array[] = []
  const centraux: Uint8Array[] = []
  let decalage = 0
  for (const f of fichiers) {
    const nom = enc.encode(f.nom)
    const donnees = enc.encode(f.contenu)
    const crc = crc32(donnees)
    const local = new Uint8Array(30 + nom.length + donnees.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true) // noms UTF-8
    lv.setUint16(8, 0, true); lv.setUint16(10, 0, true); lv.setUint16(12, 0x21, true)          // méthode 0, date 1980-01-01
    lv.setUint32(14, crc, true); lv.setUint32(18, donnees.length, true); lv.setUint32(22, donnees.length, true)
    lv.setUint16(26, nom.length, true); lv.setUint16(28, 0, true)
    local.set(nom, 30); local.set(donnees, 30 + nom.length)
    locaux.push(local)

    const central = new Uint8Array(46 + nom.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true)
    cv.setUint32(16, crc, true); cv.setUint32(20, donnees.length, true); cv.setUint32(24, donnees.length, true)
    cv.setUint16(28, nom.length, true); cv.setUint32(42, decalage, true)
    central.set(nom, 46)
    centraux.push(central)
    decalage += local.length
  }
  const tailleCentrale = centraux.reduce((s, c) => s + c.length, 0)
  const fin = new Uint8Array(22)
  const fv = new DataView(fin.buffer)
  fv.setUint32(0, 0x06054b50, true)
  fv.setUint16(8, fichiers.length, true); fv.setUint16(10, fichiers.length, true)
  fv.setUint32(12, tailleCentrale, true); fv.setUint32(16, decalage, true)

  const total = new Uint8Array(decalage + tailleCentrale + 22)
  let p = 0
  for (const b of [...locaux, ...centraux, fin]) { total.set(b, p); p += b.length }
  return total
}

// ─── Classeur ─────────────────────────────────────────────────────────────────

/**
 * Construit un classeur .xlsx (octets) à partir d'onglets.
 * @param onglets Au moins un onglet ; noms uniques, ≤ 31 caractères, sans `[]:*?/\`
 */
export function construireXlsx(onglets: Onglet[]): Uint8Array {
  if (!onglets.length) throw new Error('Un classeur doit avoir au moins un onglet.')
  const nom = (o: Onglet) => o.nom.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31)
  const fichiers = [
    {
      nom: '[Content_Types].xml',
      contenu: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + onglets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
        + '</Types>',
    },
    {
      nom: '_rels/.rels',
      contenu: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        + '</Relationships>',
    },
    {
      nom: 'xl/workbook.xml',
      contenu: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        + '<sheets>' + onglets.map((o, i) => `<sheet name="${xml(nom(o))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets>'
        + '</workbook>',
    },
    {
      nom: 'xl/_rels/workbook.xml.rels',
      contenu: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + onglets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
        + `<Relationship Id="rId${onglets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
        + '</Relationships>',
    },
    { nom: 'xl/styles.xml', contenu: STYLES_XML },
    ...onglets.map((o, i) => ({ nom: `xl/worksheets/sheet${i + 1}.xml`, contenu: feuilleXml(o) })),
  ]
  return zip(fichiers)
}
