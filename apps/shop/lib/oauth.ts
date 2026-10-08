/**
 * Connexion Google / Facebook (OAuth 2.0, « authorization code ») — serveur
 * uniquement. Le profil lu chez le fournisseur est transmis à l'API FORGE, qui
 * rattache ou crée le compte client du shop.
 *
 * Variables : GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, FACEBOOK_APP_ID /
 * FACEBOOK_APP_SECRET. URL de retour à déclarer chez chaque fournisseur :
 *   <NEXT_PUBLIC_SITE_URL>/api/auth/shop/oauth/google/callback
 *   <NEXT_PUBLIC_SITE_URL>/api/auth/shop/oauth/facebook/callback
 */
import { urlShop } from './compte-client'

export type Fournisseur = 'google' | 'facebook'

export interface ProfilFournisseur {
  providerId:   string
  email:        string | null
  emailVerifie: boolean
  nom:          string | null
  avatarUrl:    string | null
}

export const COOKIE_ETAT = 'forge-shop-oauth-state'
const FB_VERSION = 'v19.0'

export function estFournisseur(v: string): v is Fournisseur {
  return v === 'google' || v === 'facebook'
}

export function urlRetour(f: Fournisseur): string {
  return `${urlShop()}/api/auth/shop/oauth/${f}/callback`
}

function identifiants(f: Fournisseur): { id: string; secret: string } | null {
  const id     = f === 'google' ? process.env.GOOGLE_CLIENT_ID     : process.env.FACEBOOK_APP_ID
  const secret = f === 'google' ? process.env.GOOGLE_CLIENT_SECRET : process.env.FACEBOOK_APP_SECRET
  return id && secret ? { id, secret } : null
}

export function estConfigure(f: Fournisseur): boolean {
  return identifiants(f) !== null
}

export function urlAutorisation(f: Fournisseur, etat: string): string | null {
  const cle = identifiants(f)
  if (!cle) return null
  if (f === 'google') {
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    u.searchParams.set('client_id', cle.id)
    u.searchParams.set('redirect_uri', urlRetour(f))
    u.searchParams.set('response_type', 'code')
    u.searchParams.set('scope', 'openid email profile')
    u.searchParams.set('state', etat)
    u.searchParams.set('prompt', 'select_account')
    return u.toString()
  }
  const u = new URL(`https://www.facebook.com/${FB_VERSION}/dialog/oauth`)
  u.searchParams.set('client_id', cle.id)
  u.searchParams.set('redirect_uri', urlRetour(f))
  u.searchParams.set('state', etat)
  u.searchParams.set('scope', 'email,public_profile')
  return u.toString()
}

/** Échange le code contre un jeton puis lit le profil du client chez le fournisseur. */
export async function profilDepuisCode(f: Fournisseur, code: string): Promise<ProfilFournisseur> {
  const cle = identifiants(f)
  if (!cle) throw new Error(`Connexion ${f} non configurée`)

  if (f === 'google') {
    const jeton = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: cle.id, client_secret: cle.secret,
        redirect_uri: urlRetour(f), grant_type: 'authorization_code',
      }),
    }).then(r => r.json()) as { access_token?: string; error_description?: string }
    if (!jeton.access_token) throw new Error(jeton.error_description ?? 'Échange Google refusé')

    const p = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${jeton.access_token}` },
    }).then(r => r.json()) as { sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string }
    return { providerId: p.sub, email: p.email ?? null, emailVerifie: p.email_verified === true, nom: p.name ?? null, avatarUrl: p.picture ?? null }
  }

  const urlJeton = new URL(`https://graph.facebook.com/${FB_VERSION}/oauth/access_token`)
  urlJeton.searchParams.set('client_id', cle.id)
  urlJeton.searchParams.set('client_secret', cle.secret)
  urlJeton.searchParams.set('redirect_uri', urlRetour(f))
  urlJeton.searchParams.set('code', code)
  const jeton = await fetch(urlJeton).then(r => r.json()) as { access_token?: string; error?: { message?: string } }
  if (!jeton.access_token) throw new Error(jeton.error?.message ?? 'Échange Facebook refusé')

  const urlProfil = new URL(`https://graph.facebook.com/${FB_VERSION}/me`)
  urlProfil.searchParams.set('fields', 'id,name,email,picture.type(large)')
  urlProfil.searchParams.set('access_token', jeton.access_token)
  const p = await fetch(urlProfil).then(r => r.json()) as { id: string; name?: string; email?: string; picture?: { data?: { url?: string } } }
  // Facebook ne renvoie que des emails confirmés par l'utilisateur
  return { providerId: p.id, email: p.email ?? null, emailVerifie: Boolean(p.email), nom: p.name ?? null, avatarUrl: p.picture?.data?.url ?? null }
}
