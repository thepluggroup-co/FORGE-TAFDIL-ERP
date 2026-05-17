'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, ArrowRight } from 'lucide-react'

export function SuiviSearchClient() {
  const router  = useRouter()
  const params  = useSearchParams()
  const [ref, setRef] = useState(params.get('ref') ?? '')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const cleaned = ref.trim().toUpperCase()
    if (cleaned) router.push(`/suivi/${encodeURIComponent(cleaned)}`)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="relative">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={ref}
          onChange={(e) => setRef(e.target.value.toUpperCase())}
          placeholder="WEB-2026-XXXX"
          autoFocus
          className="w-full rounded-2xl border-2 border-gray-200 py-4 pl-11 pr-5 font-mono text-base font-bold uppercase tracking-widest outline-none transition placeholder:font-normal placeholder:tracking-normal placeholder:text-gray-400 focus:border-forge-red focus:ring-4 focus:ring-forge-red/10"
        />
      </div>
      <button
        type="submit"
        disabled={!ref.trim()}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-forge-red py-4 text-sm font-bold text-white transition disabled:opacity-50 hover:bg-red-700"
      >
        Suivre ma commande <ArrowRight size={16} />
      </button>
      <p className="text-center text-xs text-gray-400">
        La référence figure dans votre SMS de confirmation (format WEB-2026-XXXX)
      </p>
    </form>
  )
}
