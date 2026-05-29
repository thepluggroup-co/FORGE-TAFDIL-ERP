import type { QueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

export function setupRealtime(queryClient: QueryClient): () => void {
  const inv = (...keys: string[][]) => {
    for (const key of keys) void queryClient.invalidateQueries({ queryKey: key })
  }

  const produits = supabase
    .channel('forge-produits')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'produits' }, () => {
      inv(['stocks'], ['dashboard', 'kpis'])
    })
    .subscribe()

  const bons = supabase
    .channel('forge-bons')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bons_sortie' }, () => {
      inv(['bons'], ['dashboard', 'kpis'])
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bons_sortie_lignes' }, () => {
      inv(['bons'])
    })
    .on('broadcast', { event: 'bon-created' }, () => { inv(['bons']) })
    .on('broadcast', { event: 'bon-validated' }, () => { inv(['bons']) })
    .subscribe()

  const commandes = supabase
    .channel('forge-commandes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'commandes' }, () => {
      inv(['commandes'], ['dashboard', 'kpis'])
    })
    .subscribe()

  const commandesShop = supabase
    .channel('forge-commandes-shop')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'commandes_shop' }, () => {
      inv(['commandes-shop'])
    })
    .subscribe()

  const clients = supabase
    .channel('forge-clients')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => {
      inv(['clients'])
    })
    .subscribe()

  const devis = supabase
    .channel('forge-devis')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'devis' }, () => {
      inv(['devis'])
    })
    .subscribe()

  const finance = supabase
    .channel('forge-finance')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'factures' }, () => {
      inv(['factures'])
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'credits' }, () => {
      inv(['credits'], ['dashboard', 'kpis'])
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ecritures_comptables' }, () => {
      inv(['ecritures'])
    })
    .subscribe()

  const rh = supabase
    .channel('forge-rh')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'employes' }, () => {
      inv(['employes'])
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'presences' }, () => {
      inv(['presences'])
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bulletins_paie' }, () => {
      inv(['bulletins'])
    })
    .subscribe()

  const formation = supabase
    .channel('forge-formation')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'apprenants' }, () => {
      inv(['apprenants'], ['dashboard', 'kpis'])
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'validations_niveau' }, () => {
      inv(['apprenants'], ['apprenant-historique'])
    })
    .subscribe()

  const operations = supabase
    .channel('forge-operations')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs_production' }, () => {
      inv(['jobs'])
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'projets' }, () => {
      inv(['projets'])
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'livraisons' }, () => {
      inv(['livraisons'])
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'campagnes_marketing' }, () => {
      inv(['campagnes'])
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents_securite' }, () => {
      inv(['incidents'])
    })
    .subscribe()

  return () => {
    void supabase.removeChannel(produits)
    void supabase.removeChannel(bons)
    void supabase.removeChannel(commandes)
    void supabase.removeChannel(commandesShop)
    void supabase.removeChannel(clients)
    void supabase.removeChannel(devis)
    void supabase.removeChannel(finance)
    void supabase.removeChannel(rh)
    void supabase.removeChannel(formation)
    void supabase.removeChannel(operations)
  }
}
