import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { ProductDetailClient } from './ProductDetailClient'
import { ProductCard } from '../ProductCard'
import { createServiceClient } from '@/lib/supabase'
import type { Produit, Disponibilite } from '@/lib/types'

export const revalidate = 30

function disponibilite(stock: number, seuil: number): Disponibilite {
  if (stock <= 0)     return 'indisponible'
  if (stock <= seuil) return 'stock_faible'
  return 'disponible'
}

async function fetchProduit(id: string): Promise<Produit | null> {
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
          ref, designation, description, categorie, stock_actuel, stock_min, stock_critique, unite, statut, fournisseur
        )
      `)
      .eq('product_id', id)
      .eq('visible_shop', true)
      .single()

    if (error || !data) return null
    const p = (data as any).produits
    return {
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
    } as Produit
  } catch {
    return null
  }
}

async function fetchSimilaires(categorie: string, excludeId: string): Promise<Produit[]> {
  try {
    const db = createServiceClient()
    const { data } = await db
      .from('produits_shop')
      .select(`
        product_id, prix_public, description_longue, images, tags, delai_fabrication_jours, min_commande,
        produits!inner ( ref, designation, categorie, stock_actuel, stock_min, unite, statut )
      `)
      .eq('visible_shop', true)
      .eq('produits.categorie', categorie)
      .neq('product_id', excludeId)
      .limit(3)

    return (data ?? []).map((row: any) => {
      const p = row.produits
      return {
        id: row.product_id, ref: p.ref, nom: p.designation, categorie: p.categorie,
        unite: p.unite, stock_actuel: p.stock_actuel, seuil_alerte: p.stock_min,
        prix_public: row.prix_public, description_longue: row.description_longue,
        images: row.images ?? [], tags: row.tags ?? [],
        delai_fabrication_jours: row.delai_fabrication_jours, min_commande: row.min_commande,
        disponibilite: disponibilite(p.stock_actuel, p.stock_min),
      } as Produit
    })
  } catch {
    return []
  }
}

export async function generateStaticParams() {
  try {
    const db = createServiceClient()
    const { data } = await db
      .from('produits_shop')
      .select('product_id')
      .eq('visible_shop', true)
      .limit(200)
    return (data ?? []).map((r: any) => ({ id: r.product_id }))
  } catch {
    return []
  }
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
