import type { MetadataRoute } from 'next'
import type { Produit } from '@/lib/types'

const SITE_URL = 'https://shop.tafdil.cm'
const API_URL  = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE_URL,                  lastModified: now, priority: 1.0, changeFrequency: 'daily' },
    { url: `${SITE_URL}/catalogue`,   lastModified: now, priority: 0.9, changeFrequency: 'daily' },
    { url: `${SITE_URL}/devis`,       lastModified: now, priority: 0.7, changeFrequency: 'monthly' },
    { url: `${SITE_URL}/suivi`,       lastModified: now, priority: 0.5, changeFrequency: 'monthly' },
  ]

  try {
    const res = await fetch(`${API_URL}/api/shop/catalogue?limit=500`, {
      next: { revalidate: 3600 },
    })
    if (!res.ok) return staticPages
    const json = await res.json()
    const produits: Produit[] = json.data ?? []

    const produitPages: MetadataRoute.Sitemap = produits.map((p) => ({
      url:             `${SITE_URL}/catalogue/${p.id}`,
      lastModified:    now,
      priority:        0.8,
      changeFrequency: 'weekly' as const,
    }))

    return [...staticPages, ...produitPages]
  } catch {
    return staticPages
  }
}
