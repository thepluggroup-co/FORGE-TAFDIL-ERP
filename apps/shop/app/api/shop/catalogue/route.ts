import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient } from '@/lib/supabase'

const TVA_RATE = 0.1925

function disponibilite(stock: number, seuil: number): 'disponible' | 'stock_faible' | 'indisponible' {
  if (stock <= 0)     return 'indisponible'
  if (stock <= seuil) return 'stock_faible'
  return 'disponible'
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const categorie = searchParams.get('categorie')
  const q         = searchParams.get('q')

  try {
    const db = createPublicClient()

    let query = db
      .from('produits_shop')
      .select(`
        product_id,
        prix_public,
        description_longue,
        images,
        tags,
        delai_fabrication_jours,
        min_commande,
        produits!inner (
          ref, designation, categorie, stock_actuel, stock_min, unite, statut
        )
      `)
      .eq('visible_shop', true)
      .order('updated_at', { ascending: false })

    if (categorie) query = query.eq('produits.categorie', categorie)
    if (q)         query = query.ilike('produits.designation', `%${q}%`)

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: 'Erreur catalogue', code: 'DB_ERROR', details: error.message }, { status: 500 })
    }

    const catalogue = (data ?? []).map((row: any) => {
      const p = row.produits
      return {
        id:                      row.product_id,
        ref:                     p.ref,
        nom:                     p.designation,
        categorie:               p.categorie,
        unite:                   p.unite,
        stock_actuel:            p.stock_actuel,
        seuil_alerte:            p.stock_min,
        prix_public:             row.prix_public,
        description_longue:      row.description_longue,
        images:                  row.images ?? [],
        tags:                    row.tags ?? [],
        delai_fabrication_jours: row.delai_fabrication_jours,
        min_commande:            row.min_commande,
        disponibilite:           disponibilite(p.stock_actuel, p.stock_min),
      }
    })

    return NextResponse.json(
      { data: catalogue, total: catalogue.length },
      { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=30' } }
    )
  } catch (err) {
    return NextResponse.json({ error: 'Erreur serveur', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
