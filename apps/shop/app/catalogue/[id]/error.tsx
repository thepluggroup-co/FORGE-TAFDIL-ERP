'use client'

import { useEffect } from 'react'
import { AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function ProduitError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[produit] error:', error)
  }, [error])

  return (
    <main className="flex min-h-[50vh] flex-col items-center justify-center gap-5 px-4 text-center">
      <div className="rounded-2xl bg-amber-50 p-5">
        <AlertTriangle size={32} className="mx-auto text-amber-500" />
      </div>
      <div>
        <h2 className="text-lg font-black text-forge-dark">Produit inaccessible</h2>
        <p className="mt-1 text-sm text-forge-steel">Impossible de charger ce produit. Réessayez ou parcourez le catalogue.</p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="flex items-center gap-2 rounded-xl bg-forge-red px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700 transition"
        >
          <RefreshCw size={14} /> Réessayer
        </button>
        <Link
          href="/catalogue"
          className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-forge-steel hover:border-forge-red hover:text-forge-red transition"
        >
          <ArrowLeft size={14} /> Catalogue
        </Link>
      </div>
    </main>
  )
}
