import React, { useState, useRef, useEffect, useCallback } from 'react'
import { OctagonX, Building2, User, Landmark } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import type { Client } from '@/hooks/useClients'

interface ClientComboboxProps {
  value:          string
  onChange:       (nom: string) => void
  onClientSelect: (client: Client | null) => void
  placeholder?:   string
  required?:      boolean
  disabled?:      boolean
  className?:     string
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  entreprise: Building2, particulier: User, institution: Landmark,
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debouncedValue
}

export function ClientCombobox({
  value, onChange, onClientSelect,
  placeholder = 'ex. CAMRAIL SA',
  required = false, disabled = false, className = '',
}: ClientComboboxProps) {
  const [open, setOpen]                       = useState(false)
  const [results, setResults]                 = useState<Client[]>([])
  const [selectedClient, setSelectedClient]   = useState<Client | null>(null)
  const [loading, setLoading]                 = useState(false)
  const containerRef                          = useRef<HTMLDivElement>(null)
  const debouncedValue                        = useDebounce(value, 300)

  // Recherche via endpoint /clients/recherche
  useEffect(() => {
    if (!debouncedValue.trim() || debouncedValue.length < 2) {
      setResults([])
      return
    }
    let cancelled = false
    setLoading(true)
    apiClient.get<{ data: Client[] }>(`/api/clients/recherche?q=${encodeURIComponent(debouncedValue)}&limit=8`)
      .then(res => {
        if (!cancelled) setResults(res.data ?? [])
      })
      .catch(() => {
        if (!cancelled) setResults([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [debouncedValue])

  // Fermeture au clic extérieur
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [open])

  const handleSelect = useCallback((client: Client) => {
    setSelectedClient(client)
    onChange(client.nom)
    onClientSelect(client)
    setOpen(false)
    setResults([])
  }, [onChange, onClientSelect])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    onChange(val)
    // Si la valeur change, effacer le client sélectionné
    if (selectedClient && val !== selectedClient.nom) {
      setSelectedClient(null)
      onClientSelect(null)
    }
    setOpen(true)
  }, [onChange, onClientSelect, selectedClient])

  const isBlocked = selectedClient?.statut === 'bloque'
  const borderColor = isBlocked ? '#dc2626' : '#e5e7eb'

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={handleInputChange}
        onFocus={() => { if (value.length >= 2) setOpen(true) }}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className={`w-full px-3 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C62828] disabled:opacity-50 ${className}`}
        style={{ borderColor }}
      />

      {/* Dropdown résultats */}
      {open && (results.length > 0 || loading) && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white rounded-xl border border-gray-200 shadow-xl max-h-52 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-3 text-xs text-gray-400 gap-2">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-[#C62828] border-t-transparent" />
              Recherche…
            </div>
          )}
          {!loading && results.map((client) => {
            const Icon = TYPE_ICONS[client.type] ?? User
            return (
              <button
                key={client.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(client)}
                className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0 text-left"
              >
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 shrink-0">
                  <Icon className="h-3 w-3 text-gray-500" />
                </div>
                <span className="flex-1 font-medium text-[#212121] truncate">{client.nom}</span>
                {client.statut === 'bloque' ? (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full shrink-0">
                    <OctagonX className="h-2.5 w-2.5" /> Bloqué
                  </span>
                ) : client.statut === 'inactif' ? (
                  <span className="text-[10px] font-medium text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded-full shrink-0">
                    Inactif
                  </span>
                ) : (
                  <span className="text-[10px] text-gray-300 shrink-0">
                    {client.type}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Alerte client bloqué */}
      {isBlocked && (
        <div className="flex items-center gap-2 mt-1.5 px-2.5 py-2 bg-red-50 border border-red-200 rounded-lg">
          <OctagonX className="h-3.5 w-3.5 text-red-600 shrink-0" />
          <p className="text-xs text-red-700 font-medium">
            Client bloqué — commande/devis impossible. Débloquez-le dans sa fiche.
          </p>
        </div>
      )}
    </div>
  )
}
