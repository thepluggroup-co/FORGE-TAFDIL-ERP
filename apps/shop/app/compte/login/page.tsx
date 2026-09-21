import type { Metadata } from 'next'
import { LoginClient } from './LoginClient'

export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: 'Connexion | FORGE TAFDIL Shop',
  robots: { index: false, follow: false },
}

export default function LoginPage() {
  return (
    <main className="flex min-h-[80vh] items-center justify-center px-4 py-12">
      <LoginClient />
    </main>
  )
}
