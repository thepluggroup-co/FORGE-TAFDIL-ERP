import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'

function queryString(params?: Record<string, string | number | boolean | undefined>) {
  const qs = new URLSearchParams()
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== '') qs.set(key, String(value))
  })
  const value = qs.toString()
  return value ? `?${value}` : ''
}

export interface Client {
  id: string; nom: string; type: 'entreprise' | 'particulier' | 'institution'
  telephone: string; email: string; adresse: string; ville?: string; pays?: string; notes?: string
  niu?: string; rccm?: string; numero_cni?: string; profession?: string
  identifiant_administratif?: string; service?: string
  commandes_count: number; encours_credit_xaf: number; total_ca_xaf: number
  score_fiabilite: number; statut: 'actif' | 'inactif' | 'bloque'
}

export interface CreateClientPayload {
  nom: string; type: 'entreprise' | 'particulier' | 'institution'
  telephone?: string; email?: string; adresse?: string; ville?: string; pays?: string; notes?: string
  niu?: string; rccm?: string; numero_cni?: string; profession?: string
  identifiant_administratif?: string; service?: string
  statut?: 'actif' | 'inactif' | 'bloque'; score_fiabilite?: number
}

interface ClientsResponse { data: Client[]; total: number }

export function useClient(id: string) {
  return useQuery({
    queryKey:  ['clients', id],
    queryFn:   () => apiClient.get<Client>(`/api/clients/${id}`),
    staleTime: 60_000,
    enabled:   !!id,
  })
}

export function useClients(params?: { search?: string; statut?: string; enabled?: boolean }) {
  return useQuery({
    queryKey:  ['clients', { search: params?.search, statut: params?.statut }],
    queryFn:   () => apiClient.get<ClientsResponse>(
      `/api/clients${queryString({ search: params?.search, statut: params?.statut })}`,
    ),
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
    // Champs optionnels omis (undefined) plutôt que null : le zod côté API
    // (clientSchema, apps/api/src/routes/commerce.ts) utilise .optional(),
    // pas .nullable() — un null explicite serait rejeté par la validation.
    mutationFn: (payload: CreateClientPayload) =>
      apiClient.post<Client>('/api/clients', {
        nom: payload.nom, type: payload.type,
        telephone: payload.telephone || undefined, email: payload.email || undefined,
        adresse: payload.adresse || undefined, ville: payload.ville || undefined,
        pays: payload.pays ?? 'Cameroun', statut: payload.statut ?? 'actif',
        score_fiabilite: payload.score_fiabilite, notes: payload.notes || undefined,
        niu: payload.niu || undefined, rccm: payload.rccm || undefined,
        numero_cni: payload.numero_cni || undefined, profession: payload.profession || undefined,
        identifiant_administratif: payload.identifiant_administratif || undefined,
        service: payload.service || undefined,
      }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['clients'] }); toast.success('Client créé') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useUpdateClientStatut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut }: { id: string; statut: Client['statut'] }) =>
      apiClient.put<Client>(`/api/clients/${id}`, { statut }),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['clients'] })
      const labels: Record<Client['statut'], string> = { actif: 'Actif', inactif: 'Inactif', bloque: 'Bloqué' }
      toast.success(`Statut → ${labels[variables.statut]}`)
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
