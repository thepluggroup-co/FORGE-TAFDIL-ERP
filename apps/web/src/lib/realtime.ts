import type { QueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

export function setupRealtime(queryClient: QueryClient): () => void {
  const produits = supabase
    .channel('forge-produits')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'produits' }, () => {
      void queryClient.invalidateQueries({ queryKey: ['stocks'] })
    })
    .subscribe()

  const bons = supabase
    .channel('forge-bons')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bons_sortie' }, () => {
      void queryClient.invalidateQueries({ queryKey: ['bons'] })
    })
    .on('broadcast', { event: 'bon-created' }, () => {
      void queryClient.invalidateQueries({ queryKey: ['bons'] })
    })
    .on('broadcast', { event: 'bon-validated' }, () => {
      void queryClient.invalidateQueries({ queryKey: ['bons'] })
    })
    .subscribe()

  const commandes = supabase
    .channel('forge-commandes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'commandes' }, () => {
      void queryClient.invalidateQueries({ queryKey: ['commandes'] })
    })
    .subscribe()

  return () => {
    void supabase.removeChannel(produits)
    void supabase.removeChannel(bons)
    void supabase.removeChannel(commandes)
  }
}
