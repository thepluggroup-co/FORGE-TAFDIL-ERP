import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { dbGetClients, dbGetClient, dbCreateClient, dbUpdateClient } from '@/lib/db'
import { apiClient } from '@/lib/api-client'

export interface Client {
  id: string; nom: string; type: 'entreprise' | 'particulier' | 'institution'
  telephone: string; email: string; adresse: string; ville?: string; pays?: string; notes?: string
  commandes_count: number; encours_credit_xaf: number; total_ca_xaf: number
  score_fiabilite: number; statut: 'actif' | 'inactif' | 'bloque'
}

export interface CreateClientPayload {
  nom: string; type: 'entreprise' | 'particulier' | 'institution'
  telephone?: string; email?: string; adresse?: string; ville?: string; pays?: string; notes?: string
  statut?: 'actif' | 'inactif' | 'bloque'; score_fiabilite?: number
}

interface ClientsResponse { data: Client[]; total: number }

export function useClient(id: string) {
  return useQuery({
    queryKey:  ['clients', id],
    queryFn:   () => dbGetClient(id) as Promise<Client>,
    staleTime: 60_000,
    enabled:   !!id,
  })
}

export function useClients(params?: { search?: string; statut?: string; enabled?: boolean }) {
  return useQuery({
    queryKey:  ['clients', { search: params?.search, statut: params?.statut }],
    queryFn:   () => dbGetClients(params) as Promise<ClientsResponse>,
    staleTime: 60_000,
    enabled:   params?.enabled !== false,
  })
}

/**
 * Recherche clients par nom avec debounce 300ms.
 * Utilise l'endpoint /clients/recherche qui classe par pertinence.
 */
export function useSearchClients(query: string, limit = 10) {
  const [debouncedQuery, setDebouncedQuery] = useState(query)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(timer)
  }, [query])

  return useQuery({
    queryKey:  ['clients', 'recherche', debouncedQuery, limit],
    queryFn:   () => apiClient.get<{ data: Client[] }>(
      `/api/clients/recherche?q=${encodeURIComponent(debouncedQuery)}&limit=${limit}`
    ),
    staleTime: 30_000,
    enabled:   debouncedQuery.trim().length >= 2,
  })
}

export function useCreateClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateClientPayload) =>
      dbCreateClient({
        nom: payload.nom, type: payload.type,
        telephone: payload.telephone ?? null, email: payload.email ?? null,
        adresse: payload.adresse ?? null, ville: payload.ville ?? null,
        pays: payload.pays ?? 'Cameroun', statut: payload.statut ?? 'actif',
        score_fiabilite: payload.score_fiabilite ?? 50, notes: payload.notes ?? null,
      }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['clients'] }); toast.success('Client créé') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useUpdateClientStatut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut }: { id: string; statut: Client['statut'] }) =>
      dbUpdateClient(id, { statut }),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['clients'] })
      const labels: Record<Client['statut'], string> = { actif: 'Actif', inactif: 'Inactif', bloque: 'Bloqué' }
      toast.success(`Statut → ${labels[variables.statut]}`)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
