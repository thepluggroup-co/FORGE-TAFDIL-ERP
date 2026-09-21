import type { Metadata } from 'next'
import { CatalogueClient } from './CatalogueClient'
import { fetchCatalogueProduits } from '@/lib/catalogue'

export const revalidate = 60

export const metadata: Metadata = {
  title: 'Catalogue Produits | FORGE TAFDIL',
  description: 'Decouvrez notre catalogue complet : aluminium, ferronnerie, construction metallique et formations. Commandez en ligne ou demandez un devis.',
  openGraph: {
    title: 'Catalogue Produits FORGE TAFDIL',
    description: 'Aluminium, ferronnerie, construction metallique et formations a Douala.',
  },
}

interface CataloguePageProps {
  searchParams?: {
    q?: string
    categorie?: string
  }
}

export default async function CataloguePage({ searchParams }: CataloguePageProps) {
  const initialSearch = searchParams?.q ?? ''
  const initialCategorie = searchParams?.categorie ?? 'Tout'
  const produits = await fetchCatalogueProduits()

  return (
    <main>
      <CatalogueClient initialProduits={produits} initialSearch={initialSearch} initialCategorie={initialCategorie} />
    </main>
  )
}
