import type { Metadata } from 'next'
import { Suspense } from 'react'
import { SuiviSearchClient } from './SuiviSearchClient'

export const metadata: Metadata = {
  title: 'Suivi de commande | FORGE TAFDIL',
  description: 'Suivez votre commande FORGE TAFDIL en temps réel.',
}

export default function SuiviPage() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <div className="mb-8 text-center">
        <span className="inline-block rounded-xl bg-forge-red px-4 py-1.5 text-xs font-black uppercase tracking-[.2em] text-white">
          FORGE TAFDIL
        </span>
        <h1 className="mt-4 text-2xl font-black text-forge-dark">Suivi de commande</h1>
        <p className="mt-1 text-sm text-forge-steel">Entrez votre référence de commande pour suivre son avancement.</p>
      </div>
      <Suspense>
        <SuiviSearchClient />
      </Suspense>
    </main>
  )
}
