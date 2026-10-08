import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_ETAT, estFournisseur, profilDepuisCode } from '@/lib/oauth'
import { appelApiClient, ouvrirSession, type CompteClient } from '@/lib/compte-client'

// Retour du fournisseur : vérifie le state, lit le profil, rattache ou crée
// le compte côté API FORGE, ouvre la session et renvoie vers l'espace client.
export async function GET(req: NextRequest, { params }: { params: { provider: string } }) {
  const echec = (motif: string) => {
    const res = NextResponse.redirect(new URL(`/compte/login?erreur=${motif}`, req.url))
    res.cookies.delete(COOKIE_ETAT)
    return res
  }

  if (!estFournisseur(params.provider)) return echec('fournisseur')
  const code  = req.nextUrl.searchParams.get('code')
  const etat  = req.nextUrl.searchParams.get('state')
  const attendu = req.cookies.get(COOKIE_ETAT)?.value
  if (!code) return echec('annule')                                    // le client a refusé chez le fournisseur
  if (!etat || attendu !== `${params.provider}:${etat}`) return echec('session')

  try {
    const profil = await profilDepuisCode(params.provider, code)
    const res = await appelApiClient<{ client?: CompteClient; error?: string }>('/auth/oauth', {
      method: 'POST', body: JSON.stringify({ provider: params.provider, ...profil }),
    })
    if (!res.ok || !res.data.client) return echec('compte')

    const redirection = NextResponse.redirect(new URL('/compte/dashboard', req.url))
    redirection.cookies.delete(COOKIE_ETAT)
    return ouvrirSession(redirection, res.data.client)
  } catch (e) {
    console.error(`[oauth:${params.provider}]`, e)
    return echec('fournisseur')
  }
}
