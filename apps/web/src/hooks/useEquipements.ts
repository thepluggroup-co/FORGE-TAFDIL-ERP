import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'

/**
 * Équipements = référentiel UNIQUE des machines (décision D5, Catalogue Hybride Phase 5).
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
