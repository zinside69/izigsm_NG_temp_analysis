/**
 * @module emailService
 * @description Model P1 : Notifications email transactionnelles via Resend.
 *
 * Rôle architectural (P1 MVC) : Model exclusif — tout le SQL et les appels API ici.
 * Les routes ne font jamais d'appel direct à Resend.
 *
 * Provider : Resend (API REST, compatible Cloudflare Workers).
 * Pas de Node Mailer — Cloudflare Workers n'a pas de runtime Node.js.
 *
 * Stratégie non-bloquante :
 *  - L'envoi est toujours logé dans `email_logs` (succès, erreur ou simulé).
 *  - Mode simulé automatique si `email_api_key` non configurée → zéro dépendance en dev.
 *  - La route appelante ne recevra jamais d'erreur liée à l'email — les échecs sont logés.
 *
 * Règles métier :
 *  - Chaque boutique configure sa propre clé API Resend + adresse expéditeur.
 *  - Un email = une entrée dans `email_logs` (audit complet, consultable en backoffice).
 *  - Déduplication : pas de double envoi pour le même `(entite_id, type)` dans les 5 min.
 *  - Chaque type de notification peut être activé/désactivé dans `boutique_settings`.
 *
 * Sprint 2.11 — MOD-11 Notifications email
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type EmailType = 'ticket_cree' | 'ticket_termine' | 'ticket_livre' | 'sav_ouvert' | 'relance' | 'relance_devis' | 'autre'

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

/**
 * Lit la configuration email d'une boutique depuis `boutique_settings`.
 * Applique des valeurs par défaut si aucune configuration n'existe :
 * provider=resend, from=nom_boutique<email_boutique>, toutes notifs activées.
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @returns           Configuration complète avec clé API, expéditeur et flags notifications
 */
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
 * Envoie un email transactionnel via Resend, ou simule l'envoi si clé API absente.
 * Logue systématiquement le résultat dans `email_logs` — toujours, sans exception.
 *
 * Logique de décision (dans l'ordre) :
 *  1. Déduplication : si même `(entite_id, type)` envoyé dans les 5 dernières minutes → skip
 *  2. Notification désactivée dans settings → simule (success=true, simulated=true)
 *  3. Clé API absente → log statut='simule'
 *  4. Envoi via Resend REST API → log statut='envoye' ou 'erreur'
 *
 * @param params  Paramètres de l'email (`SendEmailParams`)
 * @returns       `{ success: boolean, simulated: boolean }` — ne jette jamais d'exception
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
    ticket_livre:   config.notif_ticket_termine, // même flag que termine
    sav_ouvert:     config.notif_sav_ouvert,
    relance:        config.notif_relance,
    relance_devis:  config.notif_relance,         // même flag que relance — G07 Sprint 2.40
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

// ─── Email système (hors contexte boutique) ────────────────────────────────────

/**
 * Envoie l'email de vérification (code OTP) lors de l'inscription d'un nouveau compte.
 * Email système : contrairement aux emails métier ci-dessous, il n'y a pas encore de
 * boutique au moment de l'inscription — utilise directement la clé Resend globale du
 * compte Cloudflare (`RESEND_API_KEY`) et le domaine d'envoi vérifié `mail.repairdesk.fr`,
 * plutôt que le système `sendEmail()`/`email_logs` scopé par `boutique_id` (NOT NULL).
 *
 * @param apiKey  Clé API Resend (c.env.RESEND_API_KEY)
 * @param to      Email du nouvel utilisateur
 * @param prenom  Prénom pour la personnalisation
 * @param otp     Code à 6 chiffres à afficher dans l'email
 * @returns       { success: boolean } — ne jette jamais d'exception
 */
export async function sendOtpInscription(
  apiKey: string,
  to:     string,
  prenom: string,
  otp:    string
): Promise<{ success: boolean }> {
  const html = baseLayout(`
    <p>Bonjour <strong>${prenom}</strong>,</p>
    <p>Merci de votre inscription sur iziGSM. Voici votre code de vérification :</p>
    <div class="info-box" style="text-align:center; font-size:28px; font-weight:700; letter-spacing:6px; color:#4f46e5;">
      ${otp}
    </div>
    <p>Ce code est valable 10 minutes. Saisissez-le sur la page d'inscription pour activer votre compte.</p>
    <p>Si vous n'êtes pas à l'origine de cette inscription, ignorez cet email.</p>
  `, 'iziGSM')

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    'iziGSM <noreply@mail.repairdesk.fr>',
        to:      [to],
        subject: 'Votre code de vérification iziGSM',
        html,
      }),
    })
    return { success: resp.ok }
  } catch (e) {
    console.error('[sendOtpInscription]', e)
    return { success: false }
  }
}

// ─── Emails métier ────────────────────────────────────────────────────────────

/**
 * Envoie l'email de confirmation de dépôt au client (ticket créé).
 * Inclut un lien de suivi si `tracking_token` est disponible.
 * Opération silencieuse : les erreurs d'envoi sont logées sans propager d'exception.
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique (pour config email + nom expéditeur)
 * @param ticket      Données du ticket (numéro, appareil, client, tracking_token)
 * @param frontendUrl URL de base du frontend (ex: "https://izigsm.pages.dev")
 * @returns           void
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
 * Envoie la notification de fin de réparation au client.
 * Déclenché quand un ticket passe au statut `termine`.
 * Inclut les informations de garantie si disponibles (durée + date fin).
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @param ticket      Données du ticket terminé (prix_final, diagnostic, tracking_token)
 * @param garantie    Données garantie `{ date_fin, garantie_jours }` ou `null`
 * @param frontendUrl URL de base du frontend
 * @returns           void
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
 * Envoie la notification de remise de l'appareil au client.
 * Déclenché quand un ticket passe au statut `livre`.
 * Message court confirmant que l'appareil a été récupéré et rappelant la garantie.
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @param ticket      Données du ticket livré (prix_final, diagnostic, tracking_token)
 * @param frontendUrl URL de base du frontend
 * @returns           void
 */
export async function sendTicketLivre(
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

  const html = baseLayout(`
    <p>Bonjour <strong>${ticket.client_prenom}</strong>,</p>
    <p>Votre appareil vous a bien été remis. Merci pour votre confiance ! 👍</p>
    <div class="info-box">
      <div><strong>N° de ticket :</strong> <span class="badge badge-green">${ticket.numero}</span></div>
      <div><strong>Appareil :</strong> ${ticket.appareil_marque} ${ticket.appareil_modele}</div>
      ${ticket.diagnostic ? `<div><strong>Travaux effectués :</strong> ${ticket.diagnostic}</div>` : ''}
      ${ticket.prix_final != null ? `<div><strong>Montant réglé :</strong> ${Number(ticket.prix_final).toFixed(2)} €</div>` : ''}
    </div>
    ${lienSuivi ? `<p>Retrouvez le récapitulatif complet de votre réparation :</p>
    <a class="btn" href="${lienSuivi}">📋 Voir le récapitulatif</a>` : ''}
    ${tel ? `<p>Pour toute question ou réclamation, contactez-nous au <strong>${tel}</strong>.</p>` : ''}
    <p>À bientôt,<br><strong>${nomB}</strong></p>
  `, nomB)

  await sendEmail({
    db, boutiqueId,
    to:         ticket.client_email,
    sujet:      `[${ticket.numero}] Votre ${ticket.appareil_marque} ${ticket.appareil_modele} — Remise effectuée`,
    html,
    type:       'ticket_livre',
    entiteType: 'ticket',
    entiteId:   ticket.id,
  })
}

/**
 * Envoie la confirmation d'ouverture de dossier SAV au client.
 * Déclenché à la création d'un dossier SAV (garantie ou hors-garantie).
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @param dossier     Données du dossier SAV (numéro, motif, client, appareil)
 * @returns           void
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
 * Envoie un email de relance pour un ticket en attente sans réponse.
 * Le statut du ticket est traduit en libellé lisible dans l'email.
 * Appelé individuellement ou par `processRelances()`.
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @param ticket      Données du ticket (numéro, appareil, statut, client)
 * @returns           void
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
 * Traitement batch : envoie les relances pour tous les tickets en attente.
 *
 * Critères d'éligibilité cumulés :
 *  - Statut du ticket parmi : `attente_accord`, `a_commander`, `commande`, `en_diagnostic`
 *  - Aucune relance envoyée dans les `delai_relance_jours` jours (configuré par boutique)
 *  - Client possède un email valide
 *  - Limité à 50 tickets par exécution (protection anti-spam)
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @param frontendUrl URL de base du frontend (non utilisée ici, par cohérence d'interface)
 * @returns           Nombre de relances envoyées
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

// ─── Relances devis ───────────────────────────────────────────────────────────

/**
 * Envoie un email de relance pour un devis envoyé sans réponse.
 * Contient un lien public direct vers la page de réponse du devis.
 * Appelé individuellement ou par `processRelancesDevis()`.
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @param devis       Données du devis (numéro, client, token, montant, date validité)
 * @param frontendUrl URL de base du frontend (pour lien public)
 */
export async function sendRelanceDevis(
  db:         D1Database,
  boutiqueId: number,
  devis: {
    id:            number
    numero:        string
    client_email:  string
    client_prenom: string
    montant_ttc:   number
    date_validite: string | null
    public_token:  string
  },
  frontendUrl: string
): Promise<void> {
  if (!devis.client_email) return

  const boutique = await db.prepare(
    'SELECT nom, telephone FROM boutiques WHERE id = ? LIMIT 1'
  ).bind(boutiqueId).first<{ nom: string; telephone: string | null }>()
  const nomB = boutique?.nom  ?? 'iziGSM'
  const tel  = boutique?.telephone ?? ''

  const lienDevis = `${frontendUrl}/devis-public.html?token=${devis.public_token}`
  const montantFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(devis.montant_ttc ?? 0)
  const validiteStr = devis.date_validite
    ? new Date(devis.date_validite).toLocaleDateString('fr-FR')
    : null

  const html = baseLayout(`
    <p>Bonjour <strong>${devis.client_prenom}</strong>,</p>
    <p>Nous revenons vers vous concernant le devis que nous vous avons transmis :</p>
    <div class="info-box">
      <div><strong>N° de devis :</strong> <span class="badge badge-blue">${devis.numero}</span></div>
      <div><strong>Montant TTC :</strong> ${montantFmt}</div>
      ${validiteStr ? `<div><strong>Valide jusqu'au :</strong> ${validiteStr}</div>` : ''}
    </div>
    <p>Vous pouvez accepter ou refuser ce devis directement en cliquant sur le bouton ci-dessous :</p>
    <div style="text-align:center;margin:24px 0;">
      <a href="${lienDevis}"
         style="background:#6366f1;color:#fff;padding:12px 28px;border-radius:8px;
                text-decoration:none;font-weight:600;font-size:15px;">
        📋 Consulter le devis
      </a>
    </div>
    <p style="font-size:0.85rem;color:#667085;">
      Ou copiez ce lien : <a href="${lienDevis}">${lienDevis}</a>
    </p>
    ${tel ? `<p>📞 <strong>${tel}</strong></p>` : ''}
    <p>Cordialement,<br><strong>${nomB}</strong></p>
  `, nomB)

  await sendEmail({
    db, boutiqueId,
    to:         devis.client_email,
    sujet:      `[${devis.numero}] Rappel — Votre devis est en attente de réponse`,
    html,
    type:       'relance_devis',
    entiteType: 'devis',
    entiteId:   devis.id,
  })
}

/**
 * Traitement batch : envoie les relances pour tous les devis envoyés sans réponse.
 *
 * Critères d'éligibilité cumulés :
 *  - Statut devis = `envoye`
 *  - `envoye_le` > `delai_relance_jours` jours (délai boutique, défaut 3j)
 *  - Pas encore expiré (`date_validite` IS NULL ou dans le futur)
 *  - Aucune relance_devis envoyée dans les `delai_relance_jours` jours
 *  - Client possède un email valide
 *  - Limité à 30 devis par exécution
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @param frontendUrl URL de base du frontend (pour lien public devis)
 * @returns           Nombre de relances envoyées
 */
export async function processRelancesDevis(
  db:          D1Database,
  boutiqueId:  number,
  frontendUrl: string
): Promise<number> {
  const settings = await db.prepare(`
    SELECT delai_relance_jours FROM boutique_settings WHERE boutique_id = ?
  `).bind(boutiqueId).first<{ delai_relance_jours: number }>()
  const delai = settings?.delai_relance_jours ?? 3

  const rows = await db.prepare(`
    SELECT d.id, d.numero, d.montant_ttc, d.date_validite, d.public_token,
           c.email  AS client_email,
           c.prenom AS client_prenom
    FROM   devis d
    JOIN   clients c ON c.id = d.client_id
    WHERE  d.boutique_id = ?
      AND  d.statut = 'envoye'
      AND  d.envoye_le < datetime('now', ? || ' days')
      AND  (d.date_validite IS NULL OR d.date_validite > datetime('now'))
      AND  c.email IS NOT NULL
      AND  d.id NOT IN (
        SELECT entite_id FROM email_logs
        WHERE  boutique_id = ? AND type = 'relance_devis' AND entite_type = 'devis'
          AND  created_at > datetime('now', ? || ' days')
      )
    LIMIT 30
  `).bind(boutiqueId, `-${delai}`, boutiqueId, `-${delai}`).all<any>()

  let count = 0
  for (const devis of rows.results ?? []) {
    await sendRelanceDevis(db, boutiqueId, devis, frontendUrl)
    count++
  }
  return count
}

// ─── KPIs email ───────────────────────────────────────────────────────────────

/**
 * Retourne les statistiques d'envoi email pour le tableau de bord.
 * Exécute 3 requêtes en parallèle via `Promise.all` (total, mois courant, par type).
 *
 * @param db          Binding D1 Cloudflare
 * @param boutiqueId  Identifiant de la boutique
 * @returns           `{ envoyes_total, envoyes_mois, erreurs_mois, simules_mois, par_type }`
 *                    — `par_type` : nombre d'emails par type sur le mois courant
 */
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

// ─── Helpers pour routes/notifications.ts ─────────────────────────────────────

/**
 * Retourne le journal paginé des emails d'une boutique.
 * Supporte les filtres `type` et `statut` en clause WHERE dynamique.
 *
 * @param db         - Instance D1Database
 * @param boutiqueId - ID de la boutique
 * @param opts       - Pagination + filtres facultatifs
 * @returns          `{ rows, total }` — rows = entrées de logs, total = count sans LIMIT
 */
export async function listEmailLogs(
  db:         D1Database,
  boutiqueId: number,
  opts: {
    page?:   number
    limit?:  number
    offset?: number
    type?:   string | null
    statut?: string | null
  }
): Promise<{ rows: any[]; total: number }> {
  const { limit = 20, offset = 0, type = null, statut = null } = opts

  const conditions: string[] = ['boutique_id = ?']
  const params: any[] = [boutiqueId]
  if (type)   { conditions.push('type = ?');   params.push(type) }
  if (statut) { conditions.push('statut = ?'); params.push(statut) }
  const where = conditions.join(' AND ')

  const [countRow, rows] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as cnt FROM email_logs WHERE ${where}`)
      .bind(...params).first<{ cnt: number }>(),
    db.prepare(`
      SELECT id, destinataire, sujet, type, entite_type, entite_id,
             statut, erreur, created_at
      FROM   email_logs
      WHERE  ${where}
      ORDER  BY created_at DESC
      LIMIT  ? OFFSET ?
    `).bind(...params, limit, offset).all<any>(),
  ])

  return {
    rows:  rows.results ?? [],
    total: countRow?.cnt ?? 0,
  }
}

/**
 * Retourne le nom d'une boutique par son ID.
 * Utilisé par le handler `POST /api/notifications/test` pour personnaliser l'email.
 *
 * @param db         - Instance D1Database
 * @param boutiqueId - ID de la boutique
 * @returns          Nom de la boutique ou `null`
 */
export async function getBoutiqueNomById(
  db:         D1Database,
  boutiqueId: number
): Promise<string | null> {
  const row = await db.prepare('SELECT nom FROM boutiques WHERE id = ?')
    .bind(boutiqueId).first<{ nom: string }>()
  return row?.nom ?? null
}
