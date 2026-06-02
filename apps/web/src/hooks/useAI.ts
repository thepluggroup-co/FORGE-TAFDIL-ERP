import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'

export interface AiMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface StockReco {
  produit: string
  urgence: 'critique' | 'important' | 'conseil'
  message: string
  action: string
}

export interface AlerteIA {
  id: string
  module: string
  severite: 'critique' | 'alerte' | 'info'
  titre: string
  description: string
  ts: string
  lien?: string
}

export function useAiChat() {
  return useMutation({
    mutationFn: async (messages: AiMessage[]) => {
      // Le backend attend { message: string, history: AiMessage[] }
      // On sépare le dernier message utilisateur de l'historique
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')
      const history     = messages.filter(m => m !== lastUserMsg)

      const data = await apiClient.post<{ reply: string; response?: string }>(
        '/api/ai/chat',
        { message: lastUserMsg?.content ?? '', history },
      )
      // Normalise : backend retourne "reply", page consomme "response"
      return { response: data.reply ?? data.response ?? '' }
    },
    onError: (err: Error) => toast.error(err.message || 'Erreur IA'),
  })
}

export function useAiRecommandations() {
  return useQuery({
    queryKey: ['ai', 'recommandations'],
    queryFn:  () => apiClient.get<{ recommandations: StockReco[] }>('/api/ai/recommandations/stock'),
    staleTime: 5 * 60_000,
    enabled: false,
  })
}

export function useAiAlertes() {
  return useQuery({
    queryKey: ['ai', 'alertes'],
    queryFn:  () => apiClient.get<{ alertes: AlerteIA[] }>('/api/ai/alertes'),
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  })
}
