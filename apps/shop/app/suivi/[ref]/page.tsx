import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { SuiviClient, type CommandeSuivi } from './SuiviClient'
import { forgeApiBaseUrl } from '@/lib/forge-api'

function normalizePhone(value?: string | null) {
  return (value ?? '').replace(/\D/g, '')
}

export async function generateMetadata({ params }: { params: { ref: string } }): Promise<Metadata> {
  return {
    title: `Commande ${params.ref} | FORGE TAFDIL`,
    robots: { index: false, follow: false },
  }
}

export default async function SuiviRefPage({ params, searchParams }: {
  params: { ref: string }
  searchParams?: { tel?: string }
}) {
  const commandeRef = params.ref.toUpperCase()
  const telephone = searchParams?.tel

  // Lecture via l'API FORGE (clé service côté serveur) : la table commandes_shop
  // n'est plus lisible avec la clé anonyme. Ville et photos de livraison ne
  // reviennent que si ?tel= correspond.
  const tel = normalizePhone(telephone)
  const res = await fetch(
    `${forgeApiBaseUrl()}/api/shop/commandes/${encodeURIComponent(commandeRef)}${tel ? `?tel=${tel}` : ''}`,
    { cache: 'no-store' },
  ).catch(() => null)
  if (!res?.ok) notFound()

  const payload = await res.json().catch(() => null) as { data?: Omit<CommandeSuivi, 'client_ville' | 'photos_livraison'> & Partial<CommandeSuivi>; telephone_verifie?: boolean } | null
  if (!payload?.data) notFound()
  if (tel && !payload.telephone_verifie) notFound()

  const initialCommande: CommandeSuivi = { client_ville: null, photos_livraison: null, ...payload.data }

  return (
    <main className="mx-auto max-w-lg px-4 py-8">
      <SuiviClient commandeRef={commandeRef} telephone={tel || undefined} initialCommande={initialCommande} />
    </main>
  )
}
