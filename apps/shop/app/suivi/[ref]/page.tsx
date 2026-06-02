import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { SuiviClient, type CommandeSuivi } from './SuiviClient'
import { createPublicClient } from '@/lib/supabase'

export async function generateMetadata({ params }: { params: { ref: string } }): Promise<Metadata> {
  return {
    title: `Commande ${params.ref} | FORGE TAFDIL`,
    robots: { index: false, follow: false },
  }
}

export default async function SuiviRefPage({ params }: { params: { ref: string } }) {
  const commandeRef = params.ref.toUpperCase()

  try {
    const db = createPublicClient()
    const { data, error } = await db
      .from('commandes_shop')
      .select('ref, statut_commande, statut_paiement, mode_paiement, payment_reference, lignes, montant_ttc, frais_livraison, created_at, updated_at, client_ville, photos_livraison')
      .eq('ref', commandeRef)
      .single()

    if (error || !data) notFound()

    return (
      <main className="mx-auto max-w-lg px-4 py-8">
        <SuiviClient commandeRef={commandeRef} initialCommande={data as CommandeSuivi} />
      </main>
    )
  } catch {
    notFound()
  }
}
