import React, { useEffect, useMemo, useState } from 'react'
import { TopBar } from '../components/TopBar'
import { Card, ChipRow, EmptyState, SearchField, Spinner, StatusPill, formatDateShort, formatXAF, type PillTone } from '../components/ui'
import { fetchFactures, type ApiFacture } from '../lib/api'
import { factureEtat, type FactureEtat } from '@forge/shared'

type Filter = 'all' | 'payee' | 'attente' | 'retard'
const ETAT_UI: Record<FactureEtat, { label: string; tone: PillTone }> = {
  payee:     { label: 'Payée',      tone: 'green' },
  attente:   { label: 'En attente', tone: 'orange' },
  retard:    { label: 'En retard',  tone: 'red' },
  annulee:   { label: 'Annulée',    tone: 'gray' },
  brouillon: { label: 'Brouillon',  tone: 'gray' },
}

export function FacturesPage() {
  const [factures, setFactures] = useState<ApiFacture[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchFactures({ per_page: 200 })
      .then((r) => { if (!cancelled) setFactures(r.data) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Erreur de chargement des factures') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return [...factures]
      .sort((a, b) => b.date_emission.localeCompare(a.date_emission))
      .filter((f) => {
        const etat = factureEtat(f)
        if (filter === 'payee' && etat !== 'payee') return false
        if (filter === 'attente' && etat !== 'attente') return false
        if (filter === 'retard' && etat !== 'retard') return false
        return !q || f.numero.toLowerCase().includes(q) || f.client_nom.toLowerCase().includes(q)
      })
  }, [factures, filter, search])

  return (
    <div>
      <TopBar title="Factures" back />
      <div className="px-4 py-4 space-y-3">
        <SearchField value={search} onChange={setSearch} placeholder="Rechercher une facture…" />
        <ChipRow<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Toutes' },
            { value: 'payee', label: 'Payées' },
            { value: 'attente', label: 'En attente' },
            { value: 'retard', label: 'En retard' },
          ]}
        />
        {loading ? <Spinner /> : error ? (
          <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</p>
        ) : rows.length === 0 ? (
          <EmptyState title="Aucune facture" hint="Aucune facture ne correspond à ce filtre." />
        ) : rows.map((f) => {
          const ui = ETAT_UI[factureEtat(f)]
          return (
            <Card key={f.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-bold text-gray-900">{f.numero}</p>
                <StatusPill label={ui.label} tone={ui.tone} />
              </div>
              <p className="text-xs text-gray-500 mt-1">Client : {f.client_nom}</p>
              <div className="flex items-end justify-between mt-1">
                <p className="text-xs text-gray-500">Montant : <span className="font-semibold text-gray-800">{formatXAF(f.net_a_payer_xaf ?? f.total_ttc_xaf)}</span></p>
                <p className="text-[11px] text-gray-400">{formatDateShort(f.date_emission)}</p>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
