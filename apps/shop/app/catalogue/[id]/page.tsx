import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { ProductDetailClient } from './ProductDetailClient'
import { ProductCard } from '../ProductCard'
import { fetchCatalogueProduit, fetchCatalogueProduits } from '@/lib/catalogue'
import type { Produit } from '@/lib/types'

export const revalidate = 30

async function fetchProduit(id: string): Promise<Produit | null> {
  return fetchCatalogueProduit(id)
}

async function fetchSimilaires(categorie: string, excludeId: string): Promise<Produit[]> {
  const produits = await fetchCatalogueProduits({ categorie })
  return produits.filter((p) => p.id !== excludeId).slice(0, 3)
}

export async function generateStaticParams() {
  const produits = await fetchCatalogueProduits()
  return produits.slice(0, 200).map((p) => ({ id: p.id }))
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const produit = await fetchProduit(params.id)
  if (!produit) return { title: 'Produit introuvable | FORGE TAFDIL' }
  const description = produit.description_longue ?? `${produit.nom} — Réf. ${produit.ref}. Disponible chez FORGE TAFDIL à Douala, Cameroun.`
  const ogImages = produit.images[0]
    ? [{ url: produit.images[0], width: 1200, height: 630, alt: produit.nom }]
    : [{ url: '/og-image.jpg', width: 1200, height: 630, alt: produit.nom }]
  return {
    title:      `${produit.nom} — TAFDIL Douala`,
    description,
    alternates: { canonical: `https://shop.tafdil.cm/catalogue/${produit.id}` },
    openGraph: { title: produit.nom, description, images: ogImages, type: 'website', locale: 'fr_CM' },
    twitter:   { card: 'summary_large_image', title: produit.nom, description, images: [ogImages[0].url] },
  }
}

function ProductJsonLd({ produit }: { produit: Produit }) {
  const schema = {
    '@context': 'https://schema.org',
    '@type':    'Product',
    name:        produit.nom,
    description: produit.description_longue ?? produit.nom,
    image:       produit.images,
    sku:         produit.ref,
    brand:       { '@type': 'Brand', name: 'TAFDIL FORGE' },
    offers: {
      '@type':       'Offer',
      price:          produit.prix_public ?? 0,
      priceCurrency: 'XAF',
      availability:   produit.disponibilite === 'indisponible'
        ? 'https://schema.org/OutOfStock'
        : 'https://schema.org/InStock',
      seller: { '@type': 'Organization', name: 'TAFDIL FORGE' },
    },
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
}

export default async function ProduitPage({ params }: { params: { id: string } }) {
  const produit = await fetchProduit(params.id)
  if (!produit) notFound()

  const similaires = await fetchSimilaires(produit.categorie, produit.id)

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <ProductJsonLd produit={produit} />
      <nav className="mb-6 flex items-center gap-1.5 text-xs text-gray-400">
        <Link href="/" className="hover:text-forge-red transition-colors">Accueil</Link>
        <ChevronRight size={12} />
        <Link href="/catalogue" className="hover:text-forge-red transition-colors">Catalogue</Link>
        <ChevronRight size={12} />
        <span className="text-forge-dark font-medium truncate max-w-[180px]">{produit.nom}</span>
      </nav>

      <ProductDetailClient produit={produit} />

      {similaires.length > 0 && (
        <section className="mt-16">
          <h2 className="mb-6 text-xl font-black text-forge-dark">Produits similaires</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {similaires.map((p) => <ProductCard key={p.id} produit={p} />)}
          </div>
        </section>
      )}
    </main>
  )
}
