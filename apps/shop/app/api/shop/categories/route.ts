import { NextResponse } from 'next/server'
import { createPublicClient } from '@/lib/supabase'

export async function GET() {
  try {
    const db = createPublicClient()

    const { data, error } = await db
      .from('produits_shop')
      .select('produits!inner(categorie)')
      .eq('visible_shop', true)

    if (error) {
      return NextResponse.json({ error: 'Erreur catégories', code: 'DB_ERROR' }, { status: 500 })
    }

    const categories = [...new Set((data ?? []).map((r: any) => r.produits.categorie))].sort()

    return NextResponse.json(
      { data: categories },
      { headers: { 'Cache-Control': 'public, max-age=300' } }
    )
  } catch {
    return NextResponse.json({ error: 'Erreur serveur', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
