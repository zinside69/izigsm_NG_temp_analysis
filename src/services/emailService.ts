/**
 * emailService.ts — Notifications email transactionnelles (Sprint 2.11)
 *
 * Provider : Resend (API REST, compatible Cloudflare Workers)
 * Fallback : mode "simulé" si pas de clé API configurée (log en DB sans envoi réel)
 *
 * Règles métier :
 *  - Chaque boutique configure sa propre clé API + adresse expéditeur
 *  - Un email = une entrée dans email_logs (audit complet)
 *  - Mode simulé si email_api_key absent → aucune dépendance externe en dev
 *  - Déduplication : pas de double envoi pour le même (entite_id, type) dans les 5min
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type EmailType = 'ticket_cree' | 'ticket_termine' | 'sav_ouvert' | 'relance' | 'autre'

export interface EmailConfig {
  provider:    string
  api_key:     string | null
  from:        string
  notif_ticket_cree:    boolean
  notif_ticket_termine: boolean
  notif_sav_ouvert:     boolean
  notif_relance:        boolean
}

export interface SendEmailParams {
  db:          D1Database
  boutiqueId:  number
  to:          string
  sujet:       string
  html:        string
  type:        EmailType
  entiteType?: string
  entiteId?:   number
}

// ─── Config boutique ──────────────────────────────────────────────────────────

export async function getEmailConfig(
  db:         D1Database,
  boutiqueId: number
): Promise<EmailConfig> {
  const s = await db.prepare(`
    SELECT email_provider, email_api_key, email_from,
           email_notif_ticket_cree, email_notif_ticket_termine,
           email_notif_sav_ouvert,  email_notif_relance,
           b.nom AS boutique_nom, b.email AS boutique_email
    FROM   boutique_settings bs
    JOIN   boutiques b ON b.id = bs.boutique_id
    WHERE  bs.boutique_id = ?
  `).bind(boutiqueId).first<any>()

  const nom   = s?.boutique_nom   ?? 'iziGSM'
  const email = s?.boutique_email ?? 'noreply@izigsm.fr'

  return {
    provider:             s?.email_provider    ?? 'resend',
    api_key:              s?.email_api_key     ?? null,
    from:                 s?.email_from        ?? `${nom} <${email}>`,
    notif_ticket_cree:    (s?.email_notif_ticket_cree    ?? 1) === 1,
    notif_ticket_termine: (s?.email_notif_ticket_termine ?? 1) === 1,
    notif_sav_ouvert:     (s?.email_notif_sav_ouvert     ?? 1) === 1,
    notif_relance:        (s?.email_notif_relance        ?? 1) === 1,
  }
}

// ─── Envoi core ───────────────────────────────────────────────────────────────

/**
 * Envoie un email via Resend (ou simule si pas de clé API).
 * Logue toujours dans email_logs.
 */
export async function sendEmail(params: SendEmailParams): Promise<{ success: boolean; simulated: boolean }> {
  const { db, boutiqueId, to, sujet, html, type, entiteType, entiteId } = params

  // Déduplication : même email dans les 5 dernières minutes ?
  if (entiteId && entiteType) {
    const recent = await db.prepare(`
      SELECT id FROM email_logs
      WHERE boutique_id = ? AND entite_type = ? AND entite_id = ? AND type = ?
        AND statut IN ('envoye','simule')
        AND created_at > datetime('now', '-5 minutes')
      LIMIT 1
    `).bind(boutiqueId, entiteType, entiteId, type).first()
    if (recent) return { success: true, simulated: false }  // déjà envoyé récemment
  }

  const config = await getEmailConfig(db, boutiqueId)

  // Vérifier si la notif est activée
  const notifMap: Record<EmailType, boolean> = {
    ticket_cree:    config.notif_ticket_cree,
    ticket_termine: config.notif_ticket_termine,
    sav_ouvert:     config.notif_sav_ouvert,
    relance:        config.notif_relance,
    autre:          true,
  }
  if (!notifMap[type]) {
    return { success: true, simulated: true }  // notif désactivée pour ce type
  }

  // Mode simulé si pas de clé API
  if (!config.api_key) {
    await logEmail(db, { boutiqueId, destinataire: to, sujet, type, entiteType, entiteId, statut: 'simule' })
    return { success: true, simulated: true }
  }

  // Envoi via Resend
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${config.api_key}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    config.from,
        to:      [to],
        subject: sujet,
        html,
      }),
    })

    const body = await resp.json() as any

    if (resp.ok) {
      await logEmail(db, {
        boutiqueId, destinataire: to, sujet, type, entiteType, entiteId,
        statut: 'envoye', providerId: body.id,
      })
      return { success: true, simulated: false }
    } else {
      await logEmail(db, {
        boutiqueId, destinataire: to, sujet, type, entiteType, entiteId,
        statut: 'erreur', erreur: body.message ?? JSON.stringify(body),
      })
      return { success: false, simulated: false }
    }
  } catch (e: any) {
    await logEmail(db, {
      boutiqueId, destinataire: to, sujet, type, entiteType, entiteId,
      statut: 'erreur', erreur: e.message,
    })
    return { success: false, simulated: false }
  }
}

async function logEmail(
  db:  D1Database,
  p:   {
    boutiqueId:   number
    destinataire: string
    sujet:        string
    type:         EmailType
    entiteType?:  string
    entiteId?:    number
    statut:       'envoye' | 'erreur' | 'simule'
    erreur?:      string
    providerId?:  string
  }
): Promise<void> {
  await db.prepare(`
    INSERT INTO email_logs
      (boutique_id, destinataire, sujet, type, entite_type, entite_id, statut, erreur, provider_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    p.boutiqueId, p.destinataire, p.sujet, p.type,
    p.entiteType ?? null, p.entiteId  ?? null,
    p.statut, p.erreur ?? null, p.providerId ?? null
  ).run()
}

// ─── Templates email ──────────────────────────────────────────────────────────

function baseLayout(content: string, boutiqueName: string): string {
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${boutiqueName}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background:#f8fafc; margin:0; padding:0; }
  .wrapper { max-width:560px; margin:32px auto; background:#fff;
             border-radius:12px; overflow:hidden;
             box-shadow:0 2px 8px rgba(0,0,0,.08); }
  .header { background:#4f46e5; padding:24px 32px; }
  .header h1 { color:#fff; margin:0; font-size:20px; }
  .body { padding:28px 32px; color:#374151; line-height:1.6; }
  .info-box { background:#f1f5f9; border-radius:8px; padding:16px 20px;
              margin:16px 0; font-size:14px; }
  .info-box strong { display:inline-block; width:140px; color:#6b7280; }
  .btn { display:inline-block; background:#4f46e5; color:#fff;
         padding:12px 24px; border-radius:8px; text-decoration:none;
         font-weight:600; margin:16px 0; }
  .footer { background:#f8fafc; padding:16px 32px;
            color:#9ca3af; font-size:12px; text-align:center; border-top:1px solid #e5e7eb; }
  .badge { display:inline-block; padding:3px 10px; border-radius:20px;
           font-size:12px; font-weight:600; }
  .badge-blue   { background:#dbeafe; color:#1d4ed8; }
  .badge-green  { background:#dcfce7; color:#15803d; }
  .badge-orange { background:#ffedd5; color:#c2410c; }
</style>
</head>
<body>
<div class="wrapper">
  <div class="header"><h1>🔧 ${boutiqueName}</h1></div>
  <div class="body">${content}</div>
  <div class="footer">Ce message a été envoyé automatiquement par iziGSM. Ne pas répondre à cet email.</div>
</div>
</body></html>`
}

// ─── Emails métier ────────────────────────────────────────────────────────────

/**
 * Email de confirmation de dépôt (ticket créé).
 */
export async function sendTicketCree(
  db:         D1Database,
  boutiqueId: number,
  ticket: {
    id:              number
    numero:          string
    tracking_token:  string | null
    client_email:    string
    client_prenom:   string
    appareil_marque: string
    appareil_modele: string
    description_panne: string
  },
  frontendUrl: string
): Promise<void> {
  if (!ticket.client_email) return

  const boutique = await db.prepare(
    'SELECT nom FROM boutiques WHERE id = ? LIMIT 1'
  ).bind(boutiqueId).first<{ nom: string }>()
  const nomB = boutique?.nom ?? 'iziGSM'

  const lienSuivi = ticket.tracking_token
    ? `${frontendUrl}/suivi.html?token=${ticket.tracking_token}`
    : null

  const html = baseLayout(`
    <p>Bonjour <strong>${ticket.client_prenom}</strong>,</p>
    <p>Votre appareil a bien été pris en charge. Voici le récapitulatif de votre dépôt :</p>
    <div class="info-box">
      <div><strong>N° de ticket :</strong> <span class="badge badge-blue">${ticket.numero}</span></div>
      <div><strong>Appareil :</strong> ${ticket.appareil_marque} ${ticket.appareil_modele}</div>
      <div><strong>Panne déclarée :</strong> ${ticket.description_panne}</div>
    </div>
    ${lienSuivi ? `<p>Suivez l'avancement de votre réparation en temps réel :</p>
    <a class="btn" href="${lienSuivi}">📱 Suivre ma réparation</a>` : ''}
    <p>Nous vous contacterons dès que votre appareil sera prêt.</p>
    <p>Merci de votre confiance,<br><strong>${nomB}</strong></p>
  `, nomB)

  await sendEmail({
    db, boutiqueId,
    to:         ticket.client_email,
    sujet:      `[${ticket.numero}] Confirmation de dépôt — ${ticket.appareil_marque} ${ticket.appareil_modele}`,
    html,
    type:       'ticket_cree',
    entiteType: 'ticket',
    entiteId:   ticket.id,
  })
}

/**
 * Email de notification de fin de réparation (ticket terminé).
 */
export async function sendTicketTermine(
  db:         D1Database,
  boutiqueId: number,
  ticket: {
    id:              number
    numero:          string
    tracking_token:  string | null
    client_email:    string
    client_prenom:   string
    appareil_marque: string
    appareil_modele: string
    prix_final:      number | null
    diagnostic:      string | null
  },
  garantie: { date_fin: string; garantie_jours: number } | null,
  frontendUrl: string
): Promise<void> {
  if (!ticket.client_email) return

  const boutique = await db.prepare(
    'SELECT nom, telephone FROM boutiques WHERE id = ? LIMIT 1'
  ).bind(boutiqueId).first<{ nom: string; telephone: string | null }>()
  const nomB = boutique?.nom ?? 'iziGSM'
  const tel  = boutique?.telephone ?? ''

  const lienSuivi = ticket.tracking_token
    ? `${frontendUrl}/suivi.html?token=${ticket.tracking_token}`
    : null
  const dateFinGarantie = garantie
    ? new Date(garantie.date_fin).toLocaleDateString('fr-FR', { day:'2-digit', month:'long', year:'numeric' })
    : null

  const html = baseLayout(`
    <p>Bonjour <strong>${ticket.client_prenom}</strong>,</p>
    <p>Bonne nouvelle ! Votre appareil est <strong>réparé</strong> et prêt à être récupéré. 🎉</p>
    <div class="info-box">
      <div><strong>N° de ticket :</strong> <span class="badge badge-green">${ticket.numero}</span></div>
      <div><strong>Appareil :</strong> ${ticket.appareil_marque} ${ticket.appareil_modele}</div>
      ${ticket.diagnostic ? `<div><strong>Travaux effectués :</strong> ${ticket.diagnostic}</div>` : ''}
      ${ticket.prix_final != null ? `<div><strong>Montant :</strong> ${Number(ticket.prix_final).toFixed(2)} €</div>` : ''}
    </div>
    ${dateFinGarantie ? `
    <div class="info-box">
      <div>🛡️ <strong>Garantie :</strong> ${garantie!.garantie_jours} jours — jusqu'au ${dateFinGarantie}</div>
    </div>` : ''}
    ${lienSuivi ? `<a class="btn" href="${lienSuivi}">📋 Voir le détail de ma réparation</a>` : ''}
    ${tel ? `<p>Pour toute question, contactez-nous au <strong>${tel}</strong>.</p>` : ''}
    <p>À bientôt,<br><strong>${nomB}</strong></p>
  `, nomB)

  await sendEmail({
    db, boutiqueId,
    to:         ticket.client_email,
    sujet:      `[${ticket.numero}] Votre ${ticket.appareil_marque} ${ticket.appareil_modele} est prêt !`,
    html,
    type:       'ticket_termine',
    entiteType: 'ticket',
    entiteId:   ticket.id,
  })
}

/**
 * Email de confirmation d'ouverture de dossier SAV.
 */
export async function sendSavOuvert(
  db:         D1Database,
  boutiqueId: number,
  dossier: {
    id:            number
    numero:        string
    client_email:  string
    client_prenom: string
    motif:         string
    appareil_marque?: string
    appareil_modele?: string
  }
): Promise<void> {
  if (!dossier.client_email) return

  const boutique = await db.prepare(
    'SELECT nom, telephone FROM boutiques WHERE id = ? LIMIT 1'
  ).bind(boutiqueId).first<{ nom: string; telephone: string | null }>()
  const nomB = boutique?.nom ?? 'iziGSM'
  const tel  = boutique?.telephone ?? ''

  const html = baseLayout(`
    <p>Bonjour <strong>${dossier.client_prenom}</strong>,</p>
    <p>Votre dossier SAV a bien été ouvert. Notre équipe va l'examiner dans les plus brefs délais.</p>
    <div class="info-box">
      <div><strong>N° dossier SAV :</strong> <span class="badge badge-orange">${dossier.numero}</span></div>
      ${dossier.appareil_marque ? `<div><strong>Appareil :</strong> ${dossier.appareil_marque} ${dossier.appareil_modele ?? ''}</div>` : ''}
      <div><strong>Motif :</strong> ${dossier.motif}</div>
    </div>
    <p>Conservez ce numéro de dossier pour tout suivi.</p>
    ${tel ? `<p>Pour toute question, contactez-nous au <strong>${tel}</strong>.</p>` : ''}
    <p>Cordialement,<br><strong>${nomB}</strong></p>
  `, nomB)

  await sendEmail({
    db, boutiqueId,
    to:         dossier.client_email,
    sujet:      `[${dossier.numero}] Ouverture de votre dossier SAV`,
    html,
    type:       'sav_ouvert',
    entiteType: 'sav',
    entiteId:   dossier.id,
  })
}

/**
 * Email de relance client — ticket sans réponse depuis N jours.
 */
export async function sendRelance(
  db:         D1Database,
  boutiqueId: number,
  ticket: {
    id:              number
    numero:          string
    client_email:    string
    client_prenom:   string
    appareil_marque: string
    appareil_modele: string
    statut:          string
  }
): Promise<void> {
  if (!ticket.client_email) return

  const boutique = await db.prepare(
    'SELECT nom, telephone FROM boutiques WHERE id = ? LIMIT 1'
  ).bind(boutiqueId).first<{ nom: string; telephone: string | null }>()
  const nomB = boutique?.nom ?? 'iziGSM'
  const tel  = boutique?.telephone ?? ''

  const STATUT_LABELS: Record<string, string> = {
    attente_accord: 'En attente de votre accord',
    a_commander:    'En attente de commande de pièces',
    commande:       'Pièces commandées',
    en_diagnostic:  'En cours de diagnostic',
  }
  const statutLabel = STATUT_LABELS[ticket.statut] ?? ticket.statut

  const html = baseLayout(`
    <p>Bonjour <strong>${ticket.client_prenom}</strong>,</p>
    <p>Nous souhaitons vous informer de l'état de votre réparation :</p>
    <div class="info-box">
      <div><strong>N° de ticket :</strong> <span class="badge badge-blue">${ticket.numero}</span></div>
      <div><strong>Appareil :</strong> ${ticket.appareil_marque} ${ticket.appareil_modele}</div>
      <div><strong>Statut actuel :</strong> ${statutLabel}</div>
    </div>
    <p>Si vous souhaitez annuler ou obtenir plus d'informations, n'hésitez pas à nous contacter.</p>
    ${tel ? `<p>📞 <strong>${tel}</strong></p>` : ''}
    <p>Cordialement,<br><strong>${nomB}</strong></p>
  `, nomB)

  await sendEmail({
    db, boutiqueId,
    to:         ticket.client_email,
    sujet:      `[${ticket.numero}] Votre ${ticket.appareil_marque} ${ticket.appareil_modele} — Point de situation`,
    html,
    type:       'relance',
    entiteType: 'ticket',
    entiteId:   ticket.id,
  })
}

// ─── Batch relances ───────────────────────────────────────────────────────────

/**
 * Envoie des relances pour tous les tickets en attente depuis delai_relance_jours.
 * Retourne le nombre de relances envoyées.
 */
export async function processRelances(
  db:         D1Database,
  boutiqueId: number,
  frontendUrl: string
): Promise<number> {
  const settings = await db.prepare(`
    SELECT delai_relance_jours FROM boutique_settings WHERE boutique_id = ?
  `).bind(boutiqueId).first<{ delai_relance_jours: number }>()
  const delai = settings?.delai_relance_jours ?? 3

  // Tickets en attente depuis plus de N jours, sans relance récente
  const rows = await db.prepare(`
    SELECT t.id, t.numero, t.statut, t.appareil_marque, t.appareil_modele,
           c.email AS client_email, c.prenom AS client_prenom
    FROM   tickets t
    JOIN   clients c ON c.id = t.client_id
    WHERE  t.boutique_id = ?
      AND  t.statut IN ('attente_accord','a_commander','commande','en_diagnostic')
      AND  t.actif = 1
      AND  c.email IS NOT NULL
      AND  t.updated_at < datetime('now', ? || ' days')
      AND  t.id NOT IN (
        SELECT entite_id FROM email_logs
        WHERE  boutique_id = ? AND type = 'relance' AND entite_type = 'ticket'
          AND  created_at > datetime('now', ? || ' days')
      )
    LIMIT 50
  `).bind(boutiqueId, `-${delai}`, boutiqueId, `-${delai}`).all<any>()

  let count = 0
  for (const ticket of rows.results ?? []) {
    await sendRelance(db, boutiqueId, ticket)
    count++
  }
  return count
}

// ─── KPIs email ───────────────────────────────────────────────────────────────

export async function getEmailStats(
  db:         D1Database,
  boutiqueId: number
): Promise<{
  envoyes_total:  number
  envoyes_mois:   number
  erreurs_mois:   number
  simules_mois:   number
  par_type:       Record<string, number>
}> {
  const [total, mois, parType] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as cnt FROM email_logs WHERE boutique_id = ? AND statut='envoye'`)
      .bind(boutiqueId).first<{ cnt: number }>(),
    db.prepare(`
      SELECT
        SUM(CASE WHEN statut='envoye'  THEN 1 ELSE 0 END) AS envoyes,
        SUM(CASE WHEN statut='erreur'  THEN 1 ELSE 0 END) AS erreurs,
        SUM(CASE WHEN statut='simule'  THEN 1 ELSE 0 END) AS simules
      FROM email_logs
      WHERE boutique_id = ?
        AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
    `).bind(boutiqueId).first<{ envoyes: number; erreurs: number; simules: number }>(),
    db.prepare(`
      SELECT type, COUNT(*) as cnt
      FROM   email_logs
      WHERE  boutique_id = ?
        AND  strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
      GROUP  BY type
    `).bind(boutiqueId).all<{ type: string; cnt: number }>(),
  ])

  const byType: Record<string, number> = {}
  for (const r of parType.results ?? []) byType[r.type] = r.cnt

  return {
    envoyes_total: total?.cnt        ?? 0,
    envoyes_mois:  mois?.envoyes     ?? 0,
    erreurs_mois:  mois?.erreurs     ?? 0,
    simules_mois:  mois?.simules     ?? 0,
    par_type:      byType,
  }
}
