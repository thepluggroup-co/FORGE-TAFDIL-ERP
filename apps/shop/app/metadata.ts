import type { Metadata } from 'next'

const SITE_URL = 'https://shop.tafdil.cm'

export const siteMetadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  icons: {
    icon: [{ url: '/metalforge-icon.svg', type: 'image/svg+xml' }],
    shortcut: '/metalforge-icon.svg',
  },
  title: {
    default: 'FORGE Shop — TAFDIL | Menuiserie & Métallurgie Douala',
    template: '%s | FORGE TAFDIL',
  },
  description:
    'Commandez vos menuiseries aluminium, ferronneries et structures métalliques en ligne. Fabrication sur mesure à Douala, Cameroun. Devis gratuit sous 24h.',
  keywords: [
    'menuiserie aluminium douala',
    'ferronnerie cameroun',
    'porte aluminium cameroun',
    'grille métallique douala',
    'construction métallique cameroun',
    'structure métallique douala',
    'TAFDIL forge',
    'menuisier douala',
  ],
  authors: [{ name: 'TAFDIL FORGE', url: SITE_URL }],
  creator: 'TAFDIL FORGE',
  openGraph: {
    type:      'website',
    locale:    'fr_CM',
    url:       SITE_URL,
    siteName:  'FORGE Shop — TAFDIL',
    title:     'FORGE Shop — TAFDIL | Menuiserie & Métallurgie Douala',
    description:
      'Commandez vos menuiseries aluminium, ferronneries et structures métalliques en ligne. Fabrication sur mesure à Douala.',
    images: [
      {
        url:    '/og-image.jpg',
        width:  1200,
        height: 630,
        alt:    'FORGE Shop — TAFDIL Menuiserie & Métallurgie Douala',
      },
    ],
  },
  twitter: {
    card:        'summary_large_image',
    title:       'FORGE Shop — TAFDIL | Menuiserie & Métallurgie Douala',
    description: 'Menuiserie aluminium, ferronneries et métallurgie à Douala. Commande en ligne, livraison Cameroun.',
    images:      ['/og-image.jpg'],
  },
  alternates: {
    canonical: SITE_URL,
  },
  robots: {
    index:            true,
    follow:           true,
    googleBot: {
      index:               true,
      follow:              true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet':       -1,
    },
  },
}
