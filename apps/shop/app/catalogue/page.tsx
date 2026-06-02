import type { Metadata } from 'next'
import { CatalogueClient } from './CatalogueClient'
import { createServiceClient } from '@/lib/supabase'
import type { Produit, Disponibilite } from '@/lib/types'

export const revalidate = 60

export const metadata: Metadata = {
  title: 'Catalogue Produits | FORGE TAFDIL',
  description: 'Découvrez notre catalogue complet : aluminium, ferronnerie, construction métallique et formations. Commandez en ligne ou demandez un devis.',
  openGraph: {
    title: 'Catalogue Produits FORGE TAFDIL',
    description: 'Aluminium, ferronnerie, construction métallique et formations à Douala.',
  },
}

function disponibilite(stock: number, seuil: number): Disponibilite {
  if (stock <= 0)     return 'indisponible'
  if (stock <= seuil) return 'stock_faible'
  return 'disponible'
}

async function fetchProduits(): Promise<Produit[]> {
  try {
    const db = createServiceClient()
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
          ref, designation, categorie, stock_actuel, stock_min, unite, statut
        )
      `)
      .eq('visible_shop', true)
      .order('updated_at', { ascending: false })

    if (error || !data) return []

    return data.map((row: any) => {
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
      } as Produit
    })
  } catch {
    return []
  }
}

export default async function CataloguePage() {
  const produits = await fetchProduits()

  return (
    <main>
      {/* En-tête */}
      <div className="border-b border-gray-100 bg-white px-4 py-10">
        <div className="mx-auto max-w-7xl">
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-forge-red">Catalogue</p>
          <h1 className="text-3xl font-black text-forge-dark sm:text-4xl">Nos produits &amp; services</h1>
          <p className="mt-2 max-w-xl text-sm text-forge-steel">
            Aluminium, ferronnerie, construction métallique et formations professionnelles.
            Fabrication sur mesure disponible pour tous les produits.
          </p>
        </div>
      </div>

      <CatalogueClient initialProduits={produits} />
    </main>
  )
}
