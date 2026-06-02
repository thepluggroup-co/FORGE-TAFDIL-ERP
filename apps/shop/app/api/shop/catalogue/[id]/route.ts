import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient } from '@/lib/supabase'

function disponibilite(stock: number, seuil: number): 'disponible' | 'stock_faible' | 'indisponible' {
  if (stock <= 0)     return 'indisponible'
  if (stock <= seuil) return 'stock_faible'
  return 'disponible'
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const db = createPublicClient()

    const { data, error } = await db
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
          ref, designation, description, categorie, stock_actuel, stock_min, stock_critique, unite, statut, fournisseur
        )
      `)
      .eq('product_id', params.id)
      .eq('visible_shop', true)
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'Produit introuvable', code: 'NOT_FOUND' }, { status: 404 })
    }

    const p = (data as any).produits
    return NextResponse.json({
      data: {
        id:                      data.product_id,
        ref:                     p.ref,
        nom:                     p.designation,
        description:             p.description,
        categorie:               p.categorie,
        unite:                   p.unite,
        stock_actuel:            p.stock_actuel,
        seuil_alerte:            p.stock_min,
        prix_public:             data.prix_public,
        description_longue:      data.description_longue,
        images:                  data.images ?? [],
        tags:                    data.tags ?? [],
        delai_fabrication_jours: data.delai_fabrication_jours,
        min_commande:            data.min_commande,
        disponibilite:           disponibilite(p.stock_actuel, p.stock_min),
      },
    })
  } catch {
    return NextResponse.json({ error: 'Erreur serveur', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
