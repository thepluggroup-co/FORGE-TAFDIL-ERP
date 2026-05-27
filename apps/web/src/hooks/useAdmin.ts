import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'

// ── Types ──────────────────────────────────────────────────────────────────────

export type ForgeRole = 'admin' | 'directeur' | 'operateur' | 'viewer'

export interface UserProfile {
  id:          string
  email:       string
  nom:         string
  role:        ForgeRole
  telephone?:  string
  actif:       boolean
  created_at:  string
}

interface UsersResponse {
  data: UserProfile[]
}

// ── Hooks ──────────────────────────────────────────────────────────────────────

export function useAdminUsers() {
  return useQuery({
    queryKey:  ['admin', 'users'],
    queryFn:   () => apiClient.get<UsersResponse>('/api/admin/users'),
    staleTime: 30_000,
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id, role, actif, nom,
    }: { id: string; role?: ForgeRole; actif?: boolean; nom?: string }) =>
      apiClient.patch<{ success: boolean }>(`/api/admin/users/${id}`, { role, actif, nom }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })
}

export function useInviteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { email: string; role: ForgeRole; nom: string }) =>
      apiClient.post<{ success: boolean; userId?: string }>('/api/admin/users/invite', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })
}
