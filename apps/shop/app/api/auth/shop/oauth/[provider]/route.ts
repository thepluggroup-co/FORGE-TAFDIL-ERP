import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { COOKIE_ETAT, estFournisseur, urlAutorisation } from '@/lib/oauth'

// Démarre la connexion Google / Facebook : jeton anti-falsification (state)
// en cookie, puis redirection vers l'écran de connexion du fournisseur.
export async function GET(req: NextRequest, { params }: { params: { provider: string } }) {
  if (!estFournisseur(params.provider)) {
    return NextResponse.redirect(new URL('/compte/login?erreur=fournisseur', req.url))
  }

  const etat = randomBytes(24).toString('hex')
  const url  = urlAutorisation(params.provider, etat)
  if (!url) return NextResponse.redirect(new URL('/compte/login?erreur=non-configure', req.url))

  const res = NextResponse.redirect(url)
  res.cookies.set(COOKIE_ETAT, `${params.provider}:${etat}`, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 600,
  })
  return res
}
