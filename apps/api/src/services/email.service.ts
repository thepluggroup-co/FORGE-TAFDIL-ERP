/**
 * email.service.ts — Envoi d'emails transactionnels TAFDIL
 *
 * T03 — Envoi du BL signé au client après livraison.
 *
 * Provider pluggable via env var `EMAIL_PROVIDER` :
 *   - 'console' (défaut) : log dry-run, aucun envoi (utile en dev/test)
 *   - 'resend'           : via Resend (https://resend.com)
 *   - 'brevo'            : via Brevo / Sendinblue
 *
 * Configurer `EMAIL_API_KEY` + `EMAIL_FROM` (format "Nom <email@domaine>")
 *
 * En cas de non-configuration complète → fallback console (mode dev).
 */

const FROM_DEFAULT = process.env.EMAIL_FROM ?? 'TAFDIL <noreply@tafdil.cm>'
const LOGO_URL     = process.env.EMAIL_LOGO_URL ?? 'https://shop.tafdil.cm/logo-tafdil.png'
const PUBLIC_URL   = process.env.SITE_URL ?? 'https://shop.tafdil.cm'

export interface SendEmailInput {
  to:       string | null | undefined
  subject:  string
  html:     string
  text?:    string
}

export interface SendBlEmailInput {
  to:           string | null | undefined
  clientNom:    string
  numeroBl:     string
  commandeRef:  string
  blSignedUrl:  string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildBlEmailHtml({
  clientNom, numeroBl, commandeRef, blSignedUrl,
}: { clientNom: string; numeroBl: string; commandeRef: string; blSignedUrl: string }): string {
  const prenom = escapeHtml(clientNom.split(' ')[0] || 'client')
  const ref    = escapeHtml(commandeRef)
  const bl     = escapeHtml(numeroBl)
  const url    = escapeHtml(blSignedUrl)

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>TAFDIL — Bon de livraison ${bl}</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F3F4F6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="background:#C62828;padding:24px 32px;text-align:left;">
              <img src="${LOGO_URL}" alt="TAFDIL" height="40" style="display:block;" />
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px 0;font-size:14px;color:#6B7280;">Bonjour <strong style="color:#111827;">${prenom}</strong>,</p>
              <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:800;color:#111827;">Votre commande ${ref} a été livrée ✅</h1>
              <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#374151;">
                Vous trouverez ci-dessous le bon de livraison signé <strong>${bl}</strong>, à conserver comme justificatif de réception.
              </p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FEF2F2;border-left:4px solid #C62828;border-radius:8px;margin:0 0 24px 0;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 4px 0;font-size:11px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.1em;">Référence bon de livraison</p>
                    <p style="margin:0;font-size:18px;font-weight:800;color:#C62828;">${bl}</p>
                  </td>
                </tr>
              </table>

              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="background:#C62828;border-radius:12px;">
                    <a href="${url}" target="_blank" rel="noopener noreferrer"
                       style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">
                      📄 Télécharger mon BL signé (PDF)
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:#6B7280;">
                ⏰ <em>Lien valide pendant 7 jours. Téléchargez le document dès réception.</em>
              </p>
              <p style="margin:0 0 24px 0;font-size:13px;line-height:1.6;color:#6B7280;">
                Pour toute réclamation, contactez notre service client dans les 48h suivant la réception, en précisant la référence <strong>${bl}</strong>.
              </p>

              <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;" />

              <p style="margin:0;font-size:12px;line-height:1.6;color:#9CA3AF;">
                TAFDIL SARL — Micro-usine métallurgique & BTP<br/>
                Kotto Mairyvanas, Douala, Cameroun<br/>
                Tél : +237 695 884 528 — ${PUBLIC_URL}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// ── Drivers ───────────────────────────────────────────────────────────────────

async function sendViaResend(input: SendEmailInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = process.env.EMAIL_API_KEY
  if (!apiKey) return { ok: false, error: 'EMAIL_API_KEY manquant' }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    FROM_DEFAULT,
        to:      input.to,
        subject: input.subject,
        html:    input.html,
        text:    input.text,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 200)}` }
    }
    const json = await res.json() as { id?: string }
    return { ok: true, id: json.id }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

async function sendViaBrevo(input: SendEmailInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = process.env.EMAIL_API_KEY
  if (!apiKey) return { ok: false, error: 'EMAIL_API_KEY manquant' }

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key':       apiKey,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        sender:  { name: 'TAFDIL', email: FROM_DEFAULT.match(/<(.+)>/)?.[1] ?? 'noreply@tafdil.cm' },
        to:      [{ email: input.to }],
        subject: input.subject,
        htmlContent: input.html,
        textContent: input.text,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `Brevo ${res.status}: ${body.slice(0, 200)}` }
    }
    const json = await res.json() as { messageId?: string }
    return { ok: true, id: json.messageId }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ── API publique ──────────────────────────────────────────────────────────────

export async function sendEmail(input: SendEmailInput): Promise<{ ok: boolean; skipped?: boolean; id?: string; error?: string }> {
  if (!input.to) return { ok: false, skipped: true, error: 'Destinataire manquant' }

  const provider = (process.env.EMAIL_PROVIDER ?? 'console').toLowerCase()

  if (provider === 'console' || !process.env.EMAIL_API_KEY) {
    console.info('[email:dry-run]', {
      to:      input.to,
      subject: input.subject,
      bytes:   input.html.length,
    })
    return { ok: true, skipped: true }
  }

  if (provider === 'resend')  return sendViaResend(input)
  if (provider === 'brevo')   return sendViaBrevo(input)

  console.warn(`[email] Provider "${provider}" inconnu, fallback console`)
  return { ok: true, skipped: true }
}

export async function sendBlEmail(input: SendBlEmailInput): Promise<{ ok: boolean; skipped?: boolean; id?: string; error?: string }> {
  const html = buildBlEmailHtml({
    clientNom:   input.clientNom,
    numeroBl:    input.numeroBl,
    commandeRef: input.commandeRef,
    blSignedUrl: input.blSignedUrl,
  })

  const text =
    `Bonjour ${input.clientNom.split(' ')[0] || 'client'},\n\n` +
    `Votre commande ${input.commandeRef} a été livrée.\n\n` +
    `Bon de livraison signé : ${input.numeroBl}\n` +
    `Téléchargez votre BL : ${input.blSignedUrl}\n\n` +
    `Lien valide 7 jours. Pour toute réclamation, contactez notre service client dans les 48h.\n\n` +
    `TAFDIL SARL`

  return sendEmail({
    to:      input.to,
    subject: `TAFDIL — Votre bon de livraison ${input.numeroBl}`,
    html,
    text,
  })
}
