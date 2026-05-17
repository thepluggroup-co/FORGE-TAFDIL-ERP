import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { Toaster } from 'sonner'
import { Providers } from './providers'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'
import { CartDrawer } from '@/components/cart/CartDrawer'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'FORGE Shop - TAFDIL',
    template: '%s | FORGE Shop',
  },
  description: 'Boutique en ligne TAFDIL — Tuyaux, raccords et fournitures industrielles à Douala, Cameroun.',
  keywords: ['tuyaux', 'raccords', 'fournitures industrielles', 'Douala', 'Cameroun', 'TAFDIL', 'FORGE'],
  openGraph: {
    title: 'FORGE Shop - TAFDIL',
    description: 'Boutique en ligne TAFDIL — Tuyaux, raccords et fournitures industrielles à Douala, Cameroun.',
    url: process.env.NEXT_PUBLIC_SITE_URL,
    siteName: 'FORGE Shop',
    locale: 'fr_CM',
    type: 'website',
  },
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://shop.tafdil.cm'),
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-white font-forge text-forge-dark antialiased">
        <Providers>
          <div className="flex min-h-screen flex-col">
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
          <CartDrawer />
          <Toaster position="top-right" richColors closeButton />
        </Providers>
      </body>
    </html>
  )
}
