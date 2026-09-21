import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient } from '@/lib/supabase'

export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  try {
    const db = createPublicClient()

    const { data, error } = await db
      .from('commandes_shop')
      .select('ref, statut_commande, statut_paiement, mode_paiement, payment_reference, lignes, montant_ht, tva, montant_ttc, frais_livraison, created_at, updated_at, client_ville, photos_livraison')
      .eq('ref', params.ref.toUpperCase())
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'Commande introuvable', code: 'NOT_FOUND' }, { status: 404 })
    }

    return NextResponse.json({ data })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
