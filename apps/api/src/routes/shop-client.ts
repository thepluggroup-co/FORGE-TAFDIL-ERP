/**
 * FORGE ERP — Comptes clients du shop (email, Google, Facebook, téléphone).
 *
 * Appelé UNIQUEMENT par le serveur du shop (Next.js), jamais par le
 * navigateur : chaque requête porte l'en-tête x-shop-secret (SHOP_API_SECRET,
 * identique des deux côtés). Le shop vérifie lui-même la session du client
 * (cookie signé) et transmet l'identifiant du compte ; cette API applique les
 * règles métier (codes email, rattachement des comptes, devis du client).
 *
 * Les clients du shop ne sont pas des utilisateurs Supabase Auth : ils
 * n'obtiennent jamais de droits ERP.
 */
import { Hono, type MiddlewareHandler } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@forge/db'
import { sendEmailDirect } from '../services/email-queue.service'
import { appliquerDecisionClient, checkExpireDevis, chargerDevisPdf } from './commerce'

const db = supabaseAdmin!

export const shopClientRouter = new Hono()

// ── Authentification serveur à serveur ───────────────────────────────────────

const verifierSecret: MiddlewareHandler = async (c, next) => {
  const attendu = process.env.SHOP_API_SECRET ?? ''
  if (attendu.length < 16) return c.json({ error: 'SHOP_API_SECRET non configuré', code: 'CONFIG_ERROR' }, 503)
  const recu = c.req.header('x-shop-secret') ?? ''
  const a = Buffer.from(recu), b = Buffer.from(attendu)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return c.json({ error: 'Accès refusé', code: 'FORBIDDEN' }, 403)
  await next()
}
shopClientRouter.use('*', verifierSecret)

// ── Comptes ──────────────────────────────────────────────────────────────────

const CHAMPS_CLIENT = 'id, nom, email, telephone, email_verifie, avatar_url'
interface ClientShop {
  id: string; nom: string | null; email: string | null; telephone: string | null
  email_verifie: boolean; avatar_url: string | null
}

const chiffres = (t?: string | null) => (t ?? '').replace(/\D/g, '')
const emailNormalise = (e: string) => e.trim().toLowerCase()

async function clientParEmail(email: string): Promise<ClientShop | null> {
  const { data } = await db.from('clients_shop').select(CHAMPS_CLIENT).ilike('email', emailNormalise(email)).maybeSingle()
  return data as ClientShop | null
}

async function majConnexion(id: string, champs: Record<string, unknown> = {}): Promise<ClientShop> {
  const { data, error } = await db.from('clients_shop')
    .update({ ...champs, derniere_connexion: new Date().toISOString() })
    .eq('id', id).select(CHAMPS_CLIENT).single()
  if (error) throw error
  return data as ClientShop
}

// ── Connexion par email : code à 6 chiffres ──────────────────────────────────

const CODE_TTL_MIN   = 10
const CODE_MAX_ESSAIS = 5
const hacher = (code: string, salt: string) => createHash('sha256').update(salt).update(code).digest('hex')

shopClientRouter.post('/auth/email/code', zValidator('json', z.object({ email: z.string().email() })), async (c) => {
  const email = emailNormalise(c.req.valid('json').email)

  const { data: recent } = await db.from('shop_email_codes').select('created_at')
    .ilike('email', email).order('created_at', { ascending: false }).limit(1).maybeSingle()
  const dernier = (recent as { created_at: string } | null)?.created_at
  if (dernier && Date.now() - new Date(dernier).getTime() < 60_000) {
    return c.json({ error: 'Un code vient d\'être envoyé. Patientez une minute avant d\'en demander un autre.', code: 'TROP_TOT' }, 429)
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const salt = randomBytes(16).toString('hex')
  const { error } = await db.from('shop_email_codes').insert({
    email, code_hash: hacher(code, salt), salt,
    expires_at: new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(),
  })
  if (error) return c.json({ error: error.message }, 500)

  const envoi = await sendEmailDirect({
    to: email,
    subject: `Votre code de connexion TAFDIL : ${code}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px">
      <h2 style="color:#C62828;margin:0 0 12px">TAFDIL — Espace client</h2>
      <p>Voici votre code de connexion :</p>
      <p style="font-size:32px;font-weight:bold;letter-spacing:8px;margin:16px 0">${code}</p>
      <p style="color:#6B7280;font-size:13px">Valable ${CODE_TTL_MIN} minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
    </div>`,
  })
  if (!envoi.success) {
    if (process.env.NODE_ENV !== 'production') {
      console.info(`[shop-client] code email (dev) ${email} → ${code}`)
      return c.json({ envoye: false, dev: true })
    }
    return c.json({ error: 'L\'email n\'a pas pu être envoyé. Réessayez plus tard.', code: 'EMAIL_ECHEC' }, 502)
  }
  return c.json({ envoye: true })
})

shopClientRouter.post('/auth/email/verifier', zValidator('json', z.object({
  email: z.string().email(), code: z.string().regex(/^\d{6}$/),
})), async (c) => {
  const body  = c.req.valid('json')
  const email = emailNormalise(body.email)

  const { data } = await db.from('shop_email_codes').select('id, code_hash, salt, tentatives, expires_at')
    .ilike('email', email).order('created_at', { ascending: false }).limit(1).maybeSingle()
  const ligne = data as { id: string; code_hash: string; salt: string; tentatives: number; expires_at: string } | null
  if (!ligne || new Date(ligne.expires_at).getTime() < Date.now()) {
    return c.json({ error: 'Code expiré. Demandez un nouveau code.', code: 'CODE_EXPIRE' }, 401)
  }
  if (ligne.tentatives >= CODE_MAX_ESSAIS) {
    return c.json({ error: 'Trop d\'essais. Demandez un nouveau code.', code: 'TROP_ESSAIS' }, 429)
  }
  if (hacher(body.code, ligne.salt) !== ligne.code_hash) {
    await db.from('shop_email_codes').update({ tentatives: ligne.tentatives + 1 }).eq('id', ligne.id)
    return c.json({ error: 'Code incorrect', code: 'CODE_INCORRECT' }, 401)
  }
  await db.from('shop_email_codes').delete().ilike('email', email)

  const existant = await clientParEmail(email)
  if (existant) return c.json({ client: await majConnexion(existant.id, { email_verifie: true }) })

  const { data: cree, error } = await db.from('clients_shop')
    .insert({ email, email_verifie: true, derniere_connexion: new Date().toISOString() })
    .select(CHAMPS_CLIENT).single()
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ client: cree })
})

// ── Connexion Google / Facebook ──────────────────────────────────────────────
// Le shop a déjà échangé le code OAuth et lu le profil chez le fournisseur.
// Rattachement : même identifiant fournisseur, sinon même email VÉRIFIÉ.

shopClientRouter.post('/auth/oauth', zValidator('json', z.object({
  provider:     z.enum(['google', 'facebook']),
  providerId:   z.string().min(1),
  email:        z.string().email().nullable().optional(),
  emailVerifie: z.boolean().default(false),
  nom:          z.string().max(200).nullable().optional(),
  avatarUrl:    z.string().url().nullable().optional(),
})), async (c) => {
  const p = c.req.valid('json')
  const colonne = p.provider === 'google' ? 'google_id' : 'facebook_id'
  const email = p.email ? emailNormalise(p.email) : null

  const { data: parFournisseur } = await db.from('clients_shop').select(CHAMPS_CLIENT).eq(colonne, p.providerId).maybeSingle()
  let client = parFournisseur as ClientShop | null
  if (!client && email && p.emailVerifie) client = await clientParEmail(email)

  if (client) {
    return c.json({ client: await majConnexion(client.id, {
      [colonne]: p.providerId,
      nom:        client.nom || p.nom || null,
      avatar_url: p.avatarUrl ?? client.avatar_url,
      ...(email && p.emailVerifie && !client.email ? { email, email_verifie: true } : {}),
    }) })
  }

  // Email non vérifié par le fournisseur : on ne l'enregistre pas comme
  // identifiant (il pourrait appartenir à quelqu'un d'autre).
  const { data: cree, error } = await db.from('clients_shop').insert({
    [colonne]:     p.providerId,
    nom:           p.nom ?? null,
    avatar_url:    p.avatarUrl ?? null,
    email:         email && p.emailVerifie && !(await clientParEmail(email)) ? email : null,
    email_verifie: Boolean(email && p.emailVerifie),
    derniere_connexion: new Date().toISOString(),
  }).select(CHAMPS_CLIENT).single()
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ client: cree })
})

// ── Devis du client ──────────────────────────────────────────────────────────

async function chargerClient(id: string): Promise<ClientShop | null> {
  const { data } = await db.from('clients_shop').select(CHAMPS_CLIENT).eq('id', id).maybeSingle()
  return data as ClientShop | null
}

/**
 * Fiches clients ERP qui correspondent au compte shop : même email vérifié,
 * ou même numéro (comparé sur les 9 derniers chiffres — les numéros ERP sont
 * saisis sous des formats variés : « 699 10 90 68 », « +237699109068 »…).
 */
async function clientsErpDuCompte(client: ClientShop): Promise<string[]> {
  const ids = new Set<string>()
  if (client.email && client.email_verifie) {
    const { data } = await db.from('clients').select('id').ilike('email', client.email)
    for (const r of (data ?? []) as Array<{ id: string }>) ids.add(r.id)
  }
  const tel = chiffres(client.telephone).slice(-9)
  if (tel.length === 9) {
    const { data } = await db.from('clients').select('id, telephone').ilike('telephone', `%${tel.slice(-4)}%`)
    for (const r of (data ?? []) as Array<{ id: string; telephone: string | null }>) {
      if (chiffres(r.telephone).slice(-9) === tel) ids.add(r.id)
    }
  }
  return [...ids]
}

const CHAMPS_DEVIS = 'id, numero, statut, client_id, client_nom, date_emission, date_validite, total_ht_xaf, tva_xaf, total_ttc_xaf, approuve_par_client, approuve_at, commentaire_client, devis_lignes(designation, quantite, unite, prix_unitaire_ht_xaf, total_ht_xaf, ordre)'

async function devisDuCompte(client: ClientShop) {
  const ids = await clientsErpDuCompte(client)
  if (ids.length === 0) return []
  const { data, error } = await db.from('devis').select(CHAMPS_DEVIS).in('client_id', ids).order('date_emission', { ascending: false })
  if (error) throw error
  const devis = (data ?? []) as Array<{ id: string; numero: string; statut: string; date_validite: string; client_nom: string } & Record<string, unknown>>

  // Statut réel (un devis dépassé passe « expiré ») et commande issue du devis
  const { data: commandes } = devis.length
    ? await db.from('commandes').select('id, numero, statut, devis_id').in('devis_id', devis.map(d => d.id))
    : { data: [] }
  const commandeParDevis = new Map(((commandes ?? []) as Array<{ devis_id: string; numero: string; statut: string }>).map(c => [c.devis_id, c]))

  return Promise.all(devis.map(async d => ({
    ...d,
    statut:   await checkExpireDevis(d.id, d.date_validite, d.statut),
    commande: commandeParDevis.get(d.id) ? { numero: commandeParDevis.get(d.id)!.numero, statut: commandeParDevis.get(d.id)!.statut } : null,
  })))
}

shopClientRouter.get('/clients/:id', async (c) => {
  const client = await chargerClient(c.req.param('id'))
  if (!client) return c.json({ error: 'Compte introuvable', code: 'NOT_FOUND' }, 404)
  return c.json({ client })
})

shopClientRouter.get('/clients/:id/devis', async (c) => {
  const client = await chargerClient(c.req.param('id'))
  if (!client) return c.json({ error: 'Compte introuvable', code: 'NOT_FOUND' }, 404)
  return c.json({ data: await devisDuCompte(client) })
})

// PDF d'un devis du client (même gabarit que celui envoyé par TAFDIL)
shopClientRouter.get('/clients/:id/devis/:devisId/pdf', async (c) => {
  const client = await chargerClient(c.req.param('id'))
  if (!client) return c.json({ error: 'Compte introuvable', code: 'NOT_FOUND' }, 404)
  const possede = (await devisDuCompte(client)).some(d => d.id === c.req.param('devisId'))
  if (!possede) return c.json({ error: 'Devis introuvable', code: 'NOT_FOUND' }, 404)

  const charge = await chargerDevisPdf(c.req.param('devisId'))
  if (!charge?.pdfBuffer) return c.json({ error: 'PDF indisponible', code: 'PDF_GENERATION_FAILED' }, 500)
  c.header('Content-Type', 'application/pdf')
  c.header('Content-Disposition', `inline; filename="${charge.d.numero}.pdf"`)
  c.header('Cache-Control', 'no-store')
  return c.body(charge.pdfBuffer.buffer as ArrayBuffer)
})

// Le client valide (ou refuse) SON devis depuis son espace : mêmes effets que
// le lien d'approbation (statut, demande web liée, alertes au directeur).
shopClientRouter.post('/clients/:id/devis/:devisId/decision', zValidator('json', z.object({
  decision:    z.enum(['accepte', 'refuse']),
  commentaire: z.string().trim().max(1000).optional(),
})), async (c) => {
  const client = await chargerClient(c.req.param('id'))
  if (!client) return c.json({ error: 'Compte introuvable', code: 'NOT_FOUND' }, 404)
  const body = c.req.valid('json')

  const devis = (await devisDuCompte(client)).find(d => d.id === c.req.param('devisId'))
  if (!devis) return c.json({ error: 'Devis introuvable', code: 'NOT_FOUND' }, 404)
  if (devis.statut !== 'envoye') {
    return c.json({ error: devis.statut === 'expire'
      ? 'Ce devis a expiré. Contactez-nous pour le renouveler.'
      : 'Ce devis n\'est pas en attente de votre validation.', code: 'INVALID_STATUS' }, 422)
  }

  await appliquerDecisionClient(
    { id: devis.id, numero: devis.numero, client_nom: devis.client_nom, statut: devis.statut },
    body,
    `client connecté à son espace (${client.email ?? client.telephone ?? client.id})`,
  )
  return c.json({ succes: true, decision: body.decision })
})
