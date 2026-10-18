import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

// Clé de signature des sessions client. En production, JWT_SECRET est
// OBLIGATOIRE : la valeur de secours ci-dessous est publique (dépôt), n'importe
// qui pourrait s'en servir pour fabriquer la session d'un autre client. Sans
// secret, aucune session n'est émise ni acceptée.
// Lu à l'usage et non au chargement du module, pour ne pas faire échouer le build.
let secretCourtSignale = false
function cleSignature(): Uint8Array {
  const secret = process.env.JWT_SECRET ?? ''
  if (process.env.NODE_ENV === 'production') {
    if (!secret) throw new Error('JWT_SECRET manquant — sessions du shop désactivées')
    if (secret.length < 32 && !secretCourtSignale) {
      secretCourtSignale = true
      console.warn('[shop-auth] JWT_SECRET fait moins de 32 caractères : à remplacer par une valeur aléatoire plus longue')
    }
  }
  return new TextEncoder().encode(secret || 'dev-secret-change-in-production-32chars-min')
}
const COOKIE_NAME = 'forge-shop-token'
const TOKEN_TTL   = '30d'

export interface ShopTokenPayload extends JWTPayload {
  sub:        string  // client_shop.id
  telephone?: string  // absent pour un compte email / Google / Facebook sans téléphone
  email?:     string
  nom?:       string
}

export async function signToken(payload: Omit<ShopTokenPayload, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT(payload as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(cleSignature())
}

export async function verifyToken(token: string): Promise<ShopTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, cleSignature(), { algorithms: ['HS256'] })
    return payload as ShopTokenPayload
  } catch (e) {
    // Jeton invalide ou expiré : silencieux. Secret absent : à voir dans les logs.
    if (e instanceof Error && e.message.startsWith('JWT_SECRET')) console.error('[shop-auth]', e.message)
    return null
  }
}

/** Empreinte d'un code OTP : la base ne garde jamais le code en clair. */
export async function empreinteOtp(telephone: string, code: string): Promise<string> {
  const octets = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${telephone}:${code.trim()}`))
  return Array.from(new Uint8Array(octets), (o) => o.toString(16).padStart(2, '0')).join('')
}

export { COOKIE_NAME }
