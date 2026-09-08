import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { useAuth } from '@/context/AuthContext'

// ── Détection Electron (PROMPT 5) ────────────────────────────────────────────
// Quand window.forge existe, les écritures Caisse (ouverture/fermeture de
// session, création de ticket) passent par les handlers IPC dédiés
// (apps/desktop/src/main/ipc/db-handler.ts, calqués sur credit:recordPaymentOffline) :
// écriture SQLite locale + sync_queue, offline-capable. Le SyncManager pousse
// ensuite la sync_queue vers POST /api/caisse/tickets à la reconnexion
// (apps/desktop/src/main/ipc/sync-handler.ts::pushTicketViaApi), pas un
// upsert brut — l'idempotence op_id s'applique aussi bien en ligne qu'après
// une synchro tardive. En navigateur pur (pas de window.forge), tout passe
// par apiClient comme avant. L'UI (Caisse.tsx) ne change pas.
const isElectron = typeof window !== 'undefined' && 'forge' in window

interface ForgeCaisseBridge {
  openSessionOffline:        (payload: { caissierId: string; fondOuvertureXaf: number }) => Promise<CaisseSession & { offline?: boolean }>
  getSessionCouranteOffline: (caissierId: string) => Promise<CaisseSession | null>
  closeSessionOffline:       (payload: { sessionId: string; fondFermetureXaf: number }) => Promise<RapportZ & { offline?: boolean }>
  createTicketOffline:       (payload: Record<string, unknown>) => Promise<TicketVente & { offline?: boolean }>
  getHistoriqueOffline:      (opts?: { caissierId?: string }) => Promise<HistoriqueResponse>
}

function ipcCaisse(): ForgeCaisseBridge {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).forge.caisse as ForgeCaisseBridge
}

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
  offline?:            boolean
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
  offline?:        boolean
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
  offline?:                boolean
}

// ── Session ─────────────────────────────────────────────────────────────────

// Un fetch() qui ne peut pas joindre le serveur lève un TypeError natif
// (ex: "Failed to fetch") — toute AUTRE erreur d'apiClient (401/403/409/500…)
// est une VRAIE réponse serveur qu'il ne faut jamais masquer en tombant sur le
// cache local (ça créerait un doublon silencieux, ou cacherait une 409
// SESSION_ALREADY_OPEN légitime — "un caissier ne peut avoir qu'une session
// ouverte à la fois", justement pour éviter deux postes sur la même caisse).
function isBrowserNetworkError(err: unknown): boolean {
  return err instanceof TypeError
}

/** Session ouverte de l'utilisateur courant, ou null. Source de vérité au chargement. */
export function useSessionCourante() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['caisse', 'session-courante'],
    queryFn:  async () => {
      // Toujours interroger le serveur en premier, MÊME en Electron : c'est le
      // seul moyen de voir qu'une session est déjà ouverte sur UN AUTRE poste
      // avec le même compte — le cache SQLite local n'est mis à jour que par le
      // cycle de pull (jusqu'à 5 minutes de retard), ce qui donnait l'impression
      // à tort qu'aucune session n'était ouverte ailleurs.
      try {
        return await apiClient.get<CaisseSession | null>('/api/caisse/sessions/courante')
      } catch (err) {
        if (isElectron && user?.id && isBrowserNetworkError(err)) {
          return ipcCaisse().getSessionCouranteOffline(user.id)
        }
        throw err
      }
    },
    // En Electron, il faut connaître l'utilisateur avant le fallback SQLite ; en
    // navigateur, l'API infère l'utilisateur depuis le JWT, pas de blocage.
    enabled:   isElectron ? Boolean(user?.id) : true,
    staleTime: 10_000,
  })
}

export function useOuvrirSession() {
  const qc = useQueryClient()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async (fond_ouverture_xaf: number) => {
      try {
        return await apiClient.post<CaisseSession>('/api/caisse/sessions', { fond_ouverture_xaf })
      } catch (err) {
        if (isElectron && user?.id && isBrowserNetworkError(err)) {
          return ipcCaisse().openSessionOffline({ caissierId: user.id, fondOuvertureXaf: fond_ouverture_xaf })
        }
        throw err   // ex: 409 SESSION_ALREADY_OPEN — ne jamais créer de doublon local
      }
    },
    onSuccess: (session) => {
      void qc.invalidateQueries({ queryKey: ['caisse', 'session-courante'] })
      toast.success(session.offline ? 'Session de caisse ouverte (hors-ligne)' : 'Session de caisse ouverte')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useFermerSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sessionId, fond_fermeture_xaf }: { sessionId: string; fond_fermeture_xaf: number }) =>
      isElectron
        ? ipcCaisse().closeSessionOffline({ sessionId, fondFermetureXaf: fond_fermeture_xaf })
        : apiClient.patch<RapportZ>(`/api/caisse/sessions/${sessionId}/close`, { fond_fermeture_xaf }),
    onSuccess: (rapport) => {
      void qc.invalidateQueries({ queryKey: ['caisse', 'session-courante'] })
      toast.success(rapport.offline ? 'Session fermée (hors-ligne — synchro à la reconnexion)' : 'Session fermée')
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
  const { user } = useAuth()
  return useMutation({
    mutationFn: (payload: CreerTicketPayload) => {
      if (isElectron && user?.id) {
        // Écriture locale (ticket + lignes + paiements + décrément stock +
        // mouvement_stock) + sync_queue — jamais bloqué par le réseau.
        return ipcCaisse().createTicketOffline({
          opId:        payload.op_id,
          numeroLocal: payload.numero_local,
          sessionId:   payload.session_id,
          caissierId:  user.id,
          clientId:    payload.client_id,
          clientNom:   payload.client_nom,
          remiseXaf:   payload.remise_xaf,
          lignes: payload.lignes.map((l) => ({
            produitId:       l.produit_id,
            designation:     l.designation,
            unite:           l.unite,
            quantite:        l.quantite,
            prixUnitaireXaf: l.prix_unitaire_xaf,
          })),
          paiements: payload.paiements.map((p) => ({
            mode:            p.mode,
            montantXaf:      p.montant_xaf,
            montantRecuXaf:  p.montant_recu_xaf,
            reference:       p.reference,
          })),
        })
      }
      // Timeout élargi (défaut 15s) : création de ticket = plusieurs écritures
      // DB (ticket + lignes + paiements + décrément stock par ligne) — plus
      // lourd qu'un GET classique, surtout sur connexion Supabase à froid.
      return apiClient.post<TicketVente>('/api/caisse/tickets', payload, 30_000)
    },
    onSuccess: (ticket) => {
      void qc.invalidateQueries({ queryKey: ['caisse', 'session-courante'] })
      void qc.invalidateQueries({ queryKey: ['caisse', 'historique'] })
      void qc.invalidateQueries({ queryKey: ['stocks'] })
      if (ticket.offline) {
        toast.success(`Ticket ${ticket.numero_local ?? ''} enregistré hors-ligne — synchro à la reconnexion`)
      } else if (ticket.oversell) {
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
      // Lecture locale en Electron — pas de filtre date/statut/pagination
      // côté SQLite (200 derniers tickets seulement) : suffisant pour
      // consulter les ventes du jour hors-ligne, pas un remplacement complet
      // de l'historique serveur filtré (utilisé dès que le réseau revient).
      if (isElectron) return ipcCaisse().getHistoriqueOffline({ caissierId: params?.caissier_id })

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
