import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'

/**
 * Ressources de production : équipements = référentiel UNIQUE des machines (décision D5,
 * Catalogue Hybride Phase 5) et techniciens = employés RH.
 * Utilisé par la Production (affectation d'un ordre de fabrication) et la gamme opératoire.
 */
export interface EquipementResume {
  id: string
  code: string
  designation: string
  categorie: string
  statut: string
  cout_horaire_xaf: number | null
}

/** Statuts qui interdisent d'affecter l'équipement à un travail. */
export const STATUTS_EQUIPEMENT_INDISPONIBLE = new Set(['en_panne', 'maintenance', 'hors_service', 'cede'])

export function useEquipements() {
  return useQuery({
    queryKey: ['equipements', 'liste'],
    queryFn:  () => apiClient.get<{ data: EquipementResume[] }>('/api/equipements?per_page=100').then((r) => r.data),
    staleTime: 60_000,
  })
}

/** Technicien affectable à un OF : employé RH actif (ou en période d'essai). Aucune donnée RH sensible. */
export interface Technicien {
  id: string
  nom: string
  poste: string | null
  departement: string | null
  statut: 'actif' | 'essai'
}

export function useTechniciens() {
  return useQuery({
    queryKey: ['production', 'techniciens'],
    queryFn:  () => apiClient.get<{ data: Technicien[] }>('/api/production/techniciens').then((r) => r.data),
    staleTime: 60_000,
  })
}
