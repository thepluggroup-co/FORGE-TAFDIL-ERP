import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { StatutDemande } from '@forge/shared'
import { apiClient } from '@/lib/api-client'

// ── Types ──────────────────────────────────────────────────────────────────────

/** Statuts du workflow (Phase 6) + valeurs historiques encore présentes en base. */
export type StatutDevisWeb = StatutDemande | 'vue' | 'en_cours' | 'traitee'

export interface DevisWeb {
  id:              string
  numero?:         string | null
  nom:             string
  telephone:       string
  email?:          string | null
  description:     string
  type_projet?:    string | null
  produit_ref?:    string | null
  source?:         string | null
  statut:          StatutDevisWeb
  erp_devis_id?:   string | null
  client_id?:      string | null
  famille_id?:     string | null
  modele_id?:      string | null
  quantite?:       number | null
  dimensions?:     string | null
  materiau?:       string | null
  localisation?:   string | null
  delai_souhaite?: string | null
  notes_internes?: string | null
  qualifie_le?:    string | null
  nb_documents?:   number
  created_at:      string
}

export interface DocumentDemande {
  id:            string
  nom_fichier:   string
  type_mime:     string
  taille_octets: number
  url:           string | null
  created_at:    string
}

export interface EvenementDemande {
  ancien_statut:  string | null
  nouveau_statut: string
  commentaire:    string | null
  par:            string | null
  created_at:     string
}

export interface DemandeDevisDetail extends DevisWeb {
  familles?:             { nom: string } | null
  modeles?:              { reference: string; designation: string } | null
  documents:             DocumentDemande[]
  historique:            EvenementDemande[]
  transitions_possibles: StatutDemande[]
}

// ── Hook : liste ───────────────────────────────────────────────────────────────

export function useDevisWeb(statut?: StatutDevisWeb) {
  return useQuery({
    queryKey: ['devis-web', statut],
    queryFn:  () => {
      const qs = statut ? `?statut=${statut}` : ''
      return apiClient.get<{ data: DevisWeb[]; total: number }>(`/api/shop-erp/devis-web${qs}`)
        .then((r) => r.data)
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

// ── Hook : détail (documents signés, historique) ───────────────────────────────

export function useDemandeDevisDetail(id: string | null) {
  return useQuery({
    queryKey: ['devis-web', 'detail', id],
    queryFn:  () => apiClient.get<{ data: DemandeDevisDetail }>(`/api/shop-erp/devis-web/${id}`).then((r) => r.data),
    enabled:  !!id,
    // Les liens de téléchargement sont signés pour 1 h.
    staleTime: 5 * 60_000,
  })
}

// ── Mutation : créer devis ERP depuis demande web ──────────────────────────────

export interface CreerDevisErpPayload {
  id:                       string
  montant_ht?:              number
  date_validite?:           string
  condition_paiement_code?: string
  notes_commerciales?:      string
}

export function useCreerDevisErp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...payload }: CreerDevisErpPayload) =>
      apiClient.post<{ data: { id: string; numero: string } }>(`/api/shop-erp/devis/${id}/creer-erp`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['devis-web'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Mutation : qualification ───────────────────────────────────────────────────

export interface QualificationPayload {
  famille_id?:     string | null
  modele_id?:      string | null
  quantite?:       number | null
  dimensions?:     string | null
  materiau?:       string | null
  localisation?:   string | null
  delai_souhaite?: string | null
  notes_internes?: string | null
}

export function useQualifierDemande() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...payload }: QualificationPayload & { id: string }) =>
      apiClient.patch<{ data: { id: string; statut: string } }>(`/api/shop-erp/devis-web/${id}/qualification`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['devis-web'] })
      toast.success('Qualification enregistrée')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

// ── Mutation : statut (contrôlé par le workflow côté serveur) ──────────────────

export function useChangerStatutDevisWeb() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, statut, commentaire }: { id: string; statut: StatutDemande; commentaire?: string }) =>
      apiClient.patch<{ data: { id: string; statut: string } }>(`/api/shop-erp/devis-web/${id}/statut`, { statut, commentaire }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['devis-web'] })
      toast.success('Demande de devis mise à jour')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
