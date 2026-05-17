import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

const JWT_SECRET_KEY = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'dev-secret-change-in-production-32chars-min'
)
const COOKIE_NAME = 'forge-shop-token'
const TOKEN_TTL   = '30d'

export interface ShopTokenPayload extends JWTPayload {
  sub:       string  // client_shop.id
  telephone: string
  nom?:      string
}

export async function signToken(payload: Omit<ShopTokenPayload, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT(payload as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(JWT_SECRET_KEY)
}

export async function verifyToken(token: string): Promise<ShopTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET_KEY)
    return payload as ShopTokenPayload
  } catch {
    return null
  }
}

export { COOKIE_NAME }
