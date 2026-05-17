import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'

export const config = {
  matcher: ['/compte/:path*'],
}

export async function middleware(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value

  if (!token) {
    return NextResponse.redirect(new URL('/compte/login', req.url))
  }

  const payload = await verifyToken(token)
  if (!payload) {
    const res = NextResponse.redirect(new URL('/compte/login', req.url))
    res.cookies.delete(COOKIE_NAME)
    return res
  }

  // Passer les infos client via headers (lisibles côté Server Component)
  const headers = new Headers(req.headers)
  headers.set('x-client-id',        payload.sub)
  headers.set('x-client-telephone', payload.telephone)
  headers.set('x-client-nom',       payload.nom ?? '')

  return NextResponse.next({ request: { headers } })
}
