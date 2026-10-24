import React, { useEffect, useMemo, useState } from 'react'
import { TopBar } from '../components/TopBar'
import { Card, ChipRow, EmptyState, SearchField, Spinner, StatusPill, formatDateShort, formatXAF, type PillTone } from '../components/ui'
import { fetchCommandes, type ApiCommandeClient } from '../lib/api'

// Valeurs réelles de commandes.statut (commandeStatutEnum, packages/db/src/schema.pg.ts).
type Filter = 'all' | 'en_cours' | 'livrees' | 'annulees'

const STATUT_UI: Record<string, { label: string; tone: PillTone }> = {
  confirmed:     { label: 'Confirmée',     tone: 'orange' },
  in_production: { label: 'En production', tone: 'red' },
  pret:          { label: 'Prête',         tone: 'blue' },
  delivered:     { label: 'Livrée',        tone: 'green' },
  cancelled:     { label: 'Annulée',       tone: 'gray' },
}

function inFilter(statut: string, filter: Filter): boolean {
  if (filter === 'all') return true
  if (filter === 'en_cours') return ['confirmed', 'in_production', 'pret'].includes(statut)
  if (filter === 'livrees') return statut === 'delivered'
  return statut === 'cancelled'
}

export function OrdersPage() {
  const [orders, setOrders] = useState<ApiCommandeClient[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchCommandes({ per_page: 100 })
      .then((r) => { if (!cancelled) setOrders(r.data) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Erreur de chargement des commandes') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return [...orders]
      .sort((a, b) => b.date_commande.localeCompare(a.date_commande))
      .filter((o) => inFilter(o.statut, filter))
      .filter((o) => !q || o.reference.toLowerCase().includes(q) || (o.client?.nom ?? '').toLowerCase().includes(q))
  }, [orders, filter, search])

  return (
    <div>
      <TopBar title="Commandes" back />
      <div className="px-4 py-4 space-y-3">
        <SearchField value={search} onChange={setSearch} placeholder="Rechercher une commande…" />
        <ChipRow<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Toutes' },
            { value: 'en_cours', label: 'En cours' },
            { value: 'livrees', label: 'Livrées' },
            { value: 'annulees', label: 'Annulées' },
          ]}
        />
        {loading ? <Spinner /> : error ? (
          <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</p>
        ) : rows.length === 0 ? (
          <EmptyState title="Aucune commande" hint="Aucune commande ne correspond à ce filtre." />
        ) : rows.map((o) => {
          const ui = STATUT_UI[o.statut] ?? { label: o.statut, tone: 'gray' as PillTone }
          return (
            <Card key={o.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-bold text-gray-900">{o.reference}</p>
                <StatusPill label={ui.label} tone={ui.tone} />
              </div>
              <p className="text-xs text-gray-500 mt-1">Client : {o.client?.nom ?? '—'}</p>
              <div className="flex items-end justify-between mt-1">
                <p className="text-xs text-gray-500">Montant : <span className="font-semibold text-gray-800">{formatXAF(o.montant_ttc_xaf)}</span></p>
                <p className="text-[11px] text-gray-400">{formatDateShort(o.date_commande)}</p>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
