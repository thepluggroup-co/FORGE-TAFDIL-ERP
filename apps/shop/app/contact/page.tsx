import type { Metadata } from 'next'
import { ContactSection } from '@/components/home/ContactSection'

export const metadata: Metadata = {
  title: 'Contact & Devis | FORGE TAFDIL',
  description: 'Demandez un devis ou parlez-nous de votre projet. Menuiserie aluminium, ferronnerie, construction métallique à Douala. Réponse sous 24h.',
  openGraph: {
    title: 'Contact & Devis — FORGE TAFDIL',
    description: 'Décrivez votre projet et obtenez un devis personnalisé sous 24h.',
  },
}

export default function ContactPage() {
  return (
    <main>
      <div className="border-b border-gray-100 bg-white px-4 py-10">
        <div className="mx-auto max-w-7xl">
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-forge-red">Contact</p>
          <h1 className="text-3xl font-black text-forge-dark sm:text-4xl">Parlons de votre projet</h1>
          <p className="mt-2 max-w-xl text-sm text-forge-steel">
            Remplissez le formulaire ci-dessous pour demander un devis ou nous soumettre un projet.
            Notre équipe vous répond sous <strong>24h</strong>.
          </p>
        </div>
      </div>
      <ContactSection />
    </main>
  )
}
