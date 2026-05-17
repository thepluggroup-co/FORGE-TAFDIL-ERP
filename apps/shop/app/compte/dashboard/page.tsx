import { headers } from 'next/headers'
import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase'
import { DashboardClient } from './DashboardClient'

export const metadata: Metadata = {
  title: 'Mon espace | FORGE TAFDIL Shop',
  robots: { index: false, follow: false },
}

export default async function DashboardPage() {
  const hdrs      = headers()
  const clientId  = hdrs.get('x-client-id')  ?? ''
  const telephone = hdrs.get('x-client-telephone') ?? ''
  const nom       = hdrs.get('x-client-nom') ?? ''

  const db = createServiceClient()

  // Charger les commandes, devis et factures du client
  const [commandesRes, devisRes, facturesRes] = await Promise.all([
    db
      .from('commandes_shop')
      .select('ref, statut_commande, statut_paiement, montant_ttc, lignes, created_at, updated_at')
      .eq('client_telephone', telephone)
      .order('created_at', { ascending: false })
      .limit(50),

    db
      .from('demandes_devis_web')
      .select('id, description, statut, created_at')
      .eq('telephone', telephone)
      .order('created_at', { ascending: false })
      .limit(20),

    db
      .from('factures')
      .select('id, numero, montant_ttc_xaf, statut, date_emission, pdf_url')
      .eq('client_telephone', telephone)
      .order('date_emission', { ascending: false })
      .limit(20),
  ])

  const commandes = commandesRes.data
  const devis     = devisRes.data
  // factures table may not exist yet — treat any error as empty
  const factures  = facturesRes.error ? [] : facturesRes.data

  const client = {
    id:        clientId,
    telephone,
    nom,
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <DashboardClient
        client={client}
        commandes={(commandes ?? []) as CommandeShop[]}
        devis={(devis ?? []) as DevisWeb[]}
        factures={(factures ?? []) as Facture[]}
      />
    </main>
  )
}

// ── Types exportés (utilisés par DashboardClient) ──────────────────────────────

export interface CommandeShop {
  ref:              string
  statut_commande:  string
  statut_paiement:  string
  montant_ttc:      number
  lignes:           Array<{ designation: string; quantite: number; prix_unitaire: number; product_id?: string }>
  created_at:       string
  updated_at:       string
}

export interface DevisWeb {
  id:          string
  description: string
  statut:      string
  created_at:  string
}

export interface Facture {
  id:               string
  numero:           string
  montant_ttc_xaf:  number
  statut:           string
  date_emission:    string
  pdf_url:          string | null
}

export interface Client {
  id:        string
  telephone: string
  nom:       string
}
