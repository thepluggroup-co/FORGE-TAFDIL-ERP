import React, { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { Button, Modal } from '@forge/ui'
import { formatXAF } from '@/lib/utils'
import { useClients } from '@/hooks/useClients'
import { useCreditLimit, useCreateCreditLimit } from '@/hooks/useCredit'
import type { EligibilityType } from '@/hooks/useCredit'

interface Props {
  open:       boolean
  customerId?: string | null
  onClose:   () => void
  onSaved:   () => void
}

const ELIGIBILITY_OPTIONS: { value: EligibilityType; label: string }[] = [
  { value: 'INDIVIDUAL',   label: 'Particulier' },
  { value: 'PROFESSIONAL', label: 'Professionnel / Entreprise' },
  { value: 'VIP',          label: 'VIP' },
]

export function CreditLimitForm({ open, customerId: initCustomerId, onClose, onSaved }: Props) {
  const { data: clientsRes, isLoading: clientsLoading } = useClients()
  const clients = clientsRes?.data ?? []
  const { create, loading: saving } = useCreateCreditLimit()

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(initCustomerId ?? '')
  const [search, setSearch]                         = useState('')
  const [showDropdown, setShowDropdown]             = useState(false)

  const { data: existingLimits, loading: limitsLoading } = useCreditLimit(selectedCustomerId || null)
  const activeLimit = existingLimits.find(l => l.is_active)

  const [form, setForm] = useState({
    max_credit_amount:        activeLimit?.max_credit_amount ?? 0,
    eligibility_type:         (activeLimit?.eligibility_type ?? 'INDIVIDUAL') as EligibilityType,
    min_order_history_months: activeLimit?.min_order_history_months ?? 3,
    min_past_orders_count:    activeLimit?.min_past_orders_count ?? 5,
    is_active:                activeLimit?.is_active ?? true,
  })

  useEffect(() => {
    if (activeLimit) {
      setForm({
        max_credit_amount:        activeLimit.max_credit_amount,
        eligibility_type:         activeLimit.eligibility_type,
        min_order_history_months: activeLimit.min_order_history_months,
        min_past_orders_count:    activeLimit.min_past_orders_count,
        is_active:                activeLimit.is_active,
      })
    }
  }, [activeLimit])

  useEffect(() => {
    if (initCustomerId) setSelectedCustomerId(initCustomerId)
  }, [initCustomerId])

  const filteredClients = clients.filter(c =>
    c.nom.toLowerCase().includes(search.toLowerCase()),
  ).slice(0, 8)

  const selectedClient = clients.find(c => c.id === selectedCustomerId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedCustomerId) return

    await create({
      customer_id: selectedCustomerId,
      ...form,
    })
    onSaved()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Plafond de crédit client">
      <form onSubmit={handleSubmit} className="space-y-5 p-1">

        {/* Sélection client */}
        <div className="relative">
          <label className="block text-sm font-medium text-gray-700 mb-1">Client *</label>
          <input
            type="text"
            value={selectedClient ? selectedClient.nom : search}
            onChange={e => {
              setSearch(e.target.value)
              setSelectedCustomerId('')
              setShowDropdown(true)
            }}
            onFocus={() => setShowDropdown(true)}
            placeholder="Rechercher un client…"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={!!initCustomerId}
          />
          {showDropdown && !selectedCustomerId && filteredClients.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-auto">
              {filteredClients.map(c => (
                <li
                  key={c.id}
                  className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer flex justify-between"
                  onClick={() => {
                    setSelectedCustomerId(c.id)
                    setSearch('')
                    setShowDropdown(false)
                  }}
                >
                  <span>{c.nom}</span>
                  <span className="text-gray-400 text-xs">{c.type}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Encours actuel */}
        {selectedCustomerId && !limitsLoading && (
          <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">
            <span className="font-medium">Plafond actuel : </span>
            {activeLimit ? formatXAF(activeLimit.max_credit_amount) : 'Aucun'}
          </div>
        )}

        {/* Montant plafond */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Plafond crédit (FCFA) *</label>
          <input
            type="number"
            min={0}
            step={10000}
            value={form.max_credit_amount}
            onChange={e => setForm(f => ({ ...f, max_credit_amount: parseInt(e.target.value) || 0 }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          {form.max_credit_amount > 0 && (
            <p className="text-xs text-gray-500 mt-1">{formatXAF(form.max_credit_amount)}</p>
          )}
        </div>

        {/* Type d'éligibilité */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Type d'éligibilité</label>
          <select
            value={form.eligibility_type}
            onChange={e => setForm(f => ({ ...f, eligibility_type: e.target.value as EligibilityType }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {ELIGIBILITY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Critères minimums */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ancienneté min. (mois)</label>
            <input
              type="number" min={0} value={form.min_order_history_months}
              onChange={e => setForm(f => ({ ...f, min_order_history_months: parseInt(e.target.value) || 0 }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Commandes min.</label>
            <input
              type="number" min={0} value={form.min_past_orders_count}
              onChange={e => setForm(f => ({ ...f, min_past_orders_count: parseInt(e.target.value) || 0 }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Toggle actif */}
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <div
            className={`relative w-11 h-6 rounded-full transition-colors ${form.is_active ? 'bg-blue-600' : 'bg-gray-300'}`}
            onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
          >
            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.is_active ? 'translate-x-5' : 'translate-x-1'}`} />
          </div>
          <span className="text-sm text-gray-700">Plafond actif</span>
        </label>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
          <Button type="button" variant="outline" onClick={onClose}>Annuler</Button>
          <Button type="submit" disabled={!selectedCustomerId || saving} loading={saving}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Modal>
  )
}
