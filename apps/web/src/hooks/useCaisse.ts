import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'

// ── Types (alignés sur apps/api/src/routes/caisse.ts) ─────────────────────────

export type ModePaiementCaisse = 'espece' | 'orange_money' | 'mtn_momo' | 'credit' | 'carte'

export interface CaisseSession {
  id:                  string
  caissier_id:         string
  date_ouverture:      string
  date_fermeture:      string | null
  fond_ouverture_xaf:  number
  fond_fermeture_xaf:  number | null
  total_especes_xaf:   number
  total_om_xaf:        number
  total_momo_xaf:      number
  total_credit_xaf:    number
  ecart_xaf:           number | null
  statut:              'ouverte' | 'fermee'
}

export interface LigneTicketPayload {
  produit_id?:        string
  designation:        string
  unite:               string
  quantite:            number
  prix_unitaire_xaf:  number
}

export interface PaiementTicketPayload {
  mode:                ModePaiementCaisse
  montant_xaf:         number
  montant_recu_xaf?:   number
  reference?:          string
}

export interface TicketVente {
  id:              string
  op_id:           string
  numero_facture:  string | null
  numero_local:    string | null
  session_id:      string
  client_id:       string | null
  client_nom:      string | null
  total_ht_xaf:    number
  tva_xaf:         number
  total_ttc_xaf:   number
  remise_xaf:      number
  statut:          string
  oversell:        boolean
  lignes:          Array<LigneTicketPayload & { total_ligne_xaf: number }>
  paiements:       Array<PaiementTicketPayload & { rendu_xaf: number | null }>
  idempotent?:     boolean
}

export interface RapportZTicket {
  id:              string
  numero_facture:  string | null
  numero_local:    string | null
  statut:          string
  total_ttc_xaf:   number
  oversell:        boolean
  created_at:      string
}

export interface RapportZ {
  session:                CaisseSession
  tickets_count:          number
  total_ttc_xaf:          number
  par_mode:                Record<string, number>
  ventes_oversell:         number
  tickets:                 RapportZTicket[]
  ecart_xaf?:              number
  montant_theorique_xaf?:  number
}

// ── Session ─────────────────────────────────────────────────────────────────

/** Session ouverte de l'utilisateur courant, ou null. Source de vérité au chargement. */
export function useSessionCourante() {
  return useQuery({
    queryKey: ['caisse', 'session-courante'],
    queryFn:  () => apiClient.get<CaisseSession | null>('/api/caisse/sessions/courante'),
    staleTime: 10_000,
  })
}

export function useOuvrirSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (fond_ouverture_xaf: number) =>
      apiClient.post<CaisseSession>('/api/caisse/sessions', { fond_ouverture_xaf }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['caisse', 'session-courante'] })
      toast.success('Session de caisse ouverte')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useFermerSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sessionId, fond_fermeture_xaf }: { sessionId: string; fond_fermeture_xaf: number }) =>
      apiClient.patch<RapportZ>(`/api/caisse/sessions/${sessionId}/close`, { fond_fermeture_xaf }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['caisse', 'session-courante'] })
      toast.success('Session fermée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useRapportZ(sessionId: string | null) {
  return useQuery({
    queryKey: ['caisse', 'rapport-z', sessionId],
    queryFn:  () => apiClient.get<RapportZ>(`/api/caisse/sessions/${sessionId}/rapport-z`),
    enabled:  Boolean(sessionId),
    staleTime: 5_000,
  })
}

// ── Ticket ──────────────────────────────────────────────────────────────────

export interface CreerTicketPayload {
  op_id:         string
  numero_local?: string
  session_id:    string
  client_id?:    string
  client_nom?:   string
  remise_xaf?:   number
  lignes:        LigneTicketPayload[]
  paiements:     PaiementTicketPayload[]
}

export function useCreerTicket() {
  const qc = useQueryClient()
  return useMutation({
    // Timeout élargi (défaut 15s) : création de ticket = plusieurs écritures
    // DB (ticket + lignes + paiements + décrément stock par ligne) — plus
    // lourd qu'un GET classique, surtout sur connexion Supabase à froid.
    mutationFn: (payload: CreerTicketPayload) =>
      apiClient.post<TicketVente>('/api/caisse/tickets', payload, 30_000),
    onSuccess: (ticket) => {
      void qc.invalidateQueries({ queryKey: ['caisse', 'session-courante'] })
      void qc.invalidateQueries({ queryKey: ['caisse', 'historique'] })
      void qc.invalidateQueries({ queryKey: ['stocks'] })
      if (ticket.oversell) {
        toast.warning(`Ticket ${ticket.numero_facture} enregistré — stock insuffisant sur au moins un article, réappro alerté`)
      } else {
        toast.success(`Ticket ${ticket.numero_facture ?? ''} encaissé`)
      }
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Historique des ventes ──────────────────────────────────────────────────────

export interface HistoriqueTicket {
  id:              string
  numero_facture:  string | null
  numero_local:    string | null
  caissier_id:     string
  client_id:       string | null
  client_nom:      string | null
  total_ht_xaf:    number
  tva_xaf:         number
  total_ttc_xaf:   number
  remise_xaf:      number
  statut:          string
  oversell:        boolean
  created_at:      string
}

interface HistoriqueResponse {
  data:        HistoriqueTicket[]
  total:       number
  page:        number
  per_page:    number
  total_pages: number
}

export function useHistoriqueTickets(params?: {
  page?:        number
  per_page?:    number
  statut?:      string
  date_debut?:  string
  date_fin?:    string
  caissier_id?: string
}) {
  return useQuery({
    queryKey: ['caisse', 'historique', params],
    queryFn:  () => {
      const qs = new URLSearchParams()
      if (params?.page)        qs.set('page', String(params.page))
      if (params?.per_page)    qs.set('per_page', String(params.per_page))
      if (params?.statut)      qs.set('statut', params.statut)
      if (params?.date_debut)  qs.set('date_debut', params.date_debut)
      if (params?.date_fin)    qs.set('date_fin', params.date_fin)
      if (params?.caissier_id) qs.set('caissier_id', params.caissier_id)
      const q = qs.toString()
      return apiClient.get<HistoriqueResponse>(`/api/caisse/tickets${q ? `?${q}` : ''}`)
    },
    staleTime: 15_000,
  })
}

/** Détail d'un ticket (lignes + paiements) — pour le clic "voir détail" depuis l'historique. */
export function useTicketDetail(ticketId: string | null) {
  return useQuery({
    queryKey: ['caisse', 'ticket', ticketId],
    queryFn:  () => apiClient.get<TicketVente>(`/api/caisse/tickets/${ticketId}`),
    enabled:  Boolean(ticketId),
    staleTime: 30_000,
  })
}

// ── Envoi du reçu (WhatsApp / SMS) ──────────────────────────────────────────────

export function useEnvoyerRecu() {
  return useMutation({
    mutationFn: ({ ticketId, canal, telephone }: { ticketId: string; canal: 'whatsapp' | 'sms'; telephone?: string }) =>
      apiClient.post<{ ok: boolean; canal: string; telephone: string; skipped: boolean }>(
        `/api/caisse/tickets/${ticketId}/envoyer`,
        { canal, telephone },
      ),
    onSuccess: (res) => {
      toast.success(
        res.skipped
          ? `Envoi ${res.canal === 'whatsapp' ? 'WhatsApp' : 'SMS'} simulé (non configuré en environnement de dev)`
          : `Reçu envoyé par ${res.canal === 'whatsapp' ? 'WhatsApp' : 'SMS'}`,
      )
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Remboursement d'un crédit comptoir ──────────────────────────────────────────

export function useRembourserCreditCaisse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (paiementId: string) =>
      apiClient.patch<{ ok: boolean; paiement_id: string; en_retard: boolean; score?: number }>(
        `/api/caisse/paiements/${paiementId}/rembourser`,
        {},
      ),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['caisse', 'historique'] })
      toast.success(
        res.en_retard
          ? `Crédit soldé — remboursé en retard, score de fiabilité caisse impacté${res.score != null ? ` (désormais ${res.score}/10)` : ''}`
          : 'Crédit soldé dans les temps',
      )
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
