import type { MetadataRoute } from 'next'
import { createServiceClient } from '@/lib/supabase'

const SITE_URL = 'https://shop.tafdil.cm'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE_URL,                lastModified: now, priority: 1.0, changeFrequency: 'daily' },
    { url: `${SITE_URL}/catalogue`, lastModified: now, priority: 0.9, changeFrequency: 'daily' },
    { url: `${SITE_URL}/devis`,     lastModified: now, priority: 0.7, changeFrequency: 'monthly' },
    { url: `${SITE_URL}/suivi`,     lastModified: now, priority: 0.5, changeFrequency: 'monthly' },
  ]

  try {
    const db = createServiceClient()
    const { data } = await db
      .from('produits_shop')
      .select('product_id, updated_at')
      .eq('visible_shop', true)
      .limit(500)

    const produitPages: MetadataRoute.Sitemap = (data ?? []).map((p: any) => ({
      url:             `${SITE_URL}/catalogue/${p.product_id}`,
      lastModified:    new Date(p.updated_at ?? now),
      priority:        0.8,
      changeFrequency: 'weekly' as const,
    }))

    return [...staticPages, ...produitPages]
  } catch {
    return staticPages
  }
}
