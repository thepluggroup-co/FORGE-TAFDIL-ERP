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

  const stock = supabase
    .channel('forge-stock')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bons_approvisionnement' }, () => {
      inv(['bons-appro'])
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bons_approvisionnement_lignes' }, () => {
      inv(['bons-appro'])
    })
    .on('broadcast', { event: 'alerte_appro' }, (payload) => {
      inv(['bons-appro'])
      // Toast de notification — importé dynamiquement pour éviter le couplage
      import('sonner').then(({ toast }) => {
        const p = payload.payload as { numero?: string; nb_produits?: number } | undefined
        const nb = p?.nb_produits ?? 1
        toast.warning(
          `Alerte stock — ${nb} produit${nb > 1 ? 's' : ''} sous seuil`,
          {
            description: p?.numero
              ? `Bon d'approvisionnement ${p.numero} créé automatiquement`
              : 'Vérifier les bons d\'approvisionnement',
            action: { label: 'Voir', onClick: () => { window.location.href = '/stocks/approvisionnement' } },
            duration: 8_000,
          },
        )
      }).catch(() => undefined)
    })
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
    void supabase.removeChannel(stock)
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
