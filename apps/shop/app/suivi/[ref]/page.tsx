import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { SuiviClient, type CommandeSuivi } from './SuiviClient'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export async function generateMetadata({ params }: { params: { ref: string } }): Promise<Metadata> {
  return {
    title: `Commande ${params.ref} | FORGE TAFDIL`,
    robots: { index: false, follow: false },
  }
}

export default async function SuiviRefPage({ params }: { params: { ref: string } }) {
  const commandeRef = params.ref.toUpperCase()

  const res = await fetch(`${API_URL}/api/shop/commandes/${commandeRef}`, {
    cache: 'no-store',
  })

  if (res.status === 404) notFound()

  const json = await res.json().catch(() => null)
  if (!json?.data) notFound()

  return (
    <main className="mx-auto max-w-lg px-4 py-8">
      <SuiviClient commandeRef={commandeRef} initialCommande={json.data as CommandeSuivi} />
    </main>
  )
}
