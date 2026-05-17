import { Suspense } from 'react'
import type { Metadata } from 'next'
import { PaymentWaitClient } from './PaymentWaitClient'

export const metadata: Metadata = {
  title: 'Paiement en cours… | FORGE TAFDIL',
  robots: { index: false, follow: false },
}

export default function PaiementEnCoursPage() {
  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <Suspense fallback={
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-forge-red" />
          <p className="text-sm text-forge-steel">Chargement…</p>
        </div>
      }>
        <PaymentWaitClient />
      </Suspense>
    </main>
  )
}
