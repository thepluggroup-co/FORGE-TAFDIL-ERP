import type { Metadata } from 'next'
import { DevisClient } from './DevisClient'

export const metadata: Metadata = {
  title: 'Demande de devis & Projets | FORGE TAFDIL',
  description: 'Demandez un devis personnalisé ou soumettez votre projet de menuiserie aluminium, ferronnerie ou construction métallique à TAFDIL Douala.',
  openGraph: {
    title: 'Devis & Projets — FORGE TAFDIL',
    description: 'Obtenez un devis sur mesure sous 24h pour vos projets aluminium, ferronnerie et construction métallique.',
  },
}

export default function DevisPage() {
  return (
    <main>
      <div className="border-b border-gray-100 bg-white px-4 py-10">
        <div className="mx-auto max-w-7xl">
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-forge-red">Devis & Projets</p>
          <h1 className="text-3xl font-black text-forge-dark sm:text-4xl">Demandez votre devis</h1>
          <p className="mt-2 max-w-xl text-sm text-forge-steel">
            Renseignez le formulaire ci-dessous. Notre équipe étudie votre demande
            et vous rappelle sous <strong>24h</strong> avec un devis détaillé.
          </p>
        </div>
      </div>
      <DevisClient />
    </main>
  )
}
