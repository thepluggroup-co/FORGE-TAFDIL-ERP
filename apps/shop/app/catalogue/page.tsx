import type { Metadata } from 'next'
import { CatalogueClient } from './CatalogueClient'
import type { Produit } from '@/lib/types'

export const revalidate = 60

export const metadata: Metadata = {
  title: 'Catalogue Produits | FORGE TAFDIL',
  description: 'Découvrez notre catalogue complet : aluminium, ferronnerie, construction métallique et formations. Commandez en ligne ou demandez un devis.',
  openGraph: {
    title: 'Catalogue Produits FORGE TAFDIL',
    description: 'Aluminium, ferronnerie, construction métallique et formations à Douala.',
  },
}

async function fetchProduits(): Promise<Produit[]> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
  try {
    const res = await fetch(`${apiUrl}/api/shop/catalogue?limit=100`, {
      next: { revalidate: 60 },
    })
    if (!res.ok) return []
    const json = await res.json()
    return (json.data ?? []) as Produit[]
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
