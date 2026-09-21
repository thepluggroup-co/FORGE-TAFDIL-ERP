import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow:    '/',
        disallow: ['/api/', '/compte/', '/commander/', '/paiement-en-cours/'],
      },
    ],
    sitemap: 'https://shop.tafdil.cm/sitemap.xml',
  }
}
