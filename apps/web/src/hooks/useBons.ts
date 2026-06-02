import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { dbGetBons, dbUpdateStatut, genererNumero } from '@/lib/db'
import { useAuth } from '@/context/AuthContext'

export interface BonLigne {
  produit_id?: string; designation: string; quantite: number
  quantite_demandee?: number; unite: string
}
export interface BonSortie {
  id: string; numero: string; statut: 'soumis' | 'valide' | 'execute' | 'refuse'
  demandeur: string; motif: string; notes?: string | null
  lignes: BonLigne[]; created_at: string; code_unique?: string
}
interface BonsResponse { data: BonSortie[]; total: number }

export function useBons(params?: { statut?: string }) {
  return useQuery({
    queryKey:  ['bons', params],
    queryFn:   () => dbGetBons(params) as Promise<BonsResponse>,
    staleTime: 15_000,
  })
}

export function useCreateBon() {
  const qc   = useQueryClient()
  const auth = useAuth()
  return useMutation({
    mutationFn: async (payload: {
      technicien_nom?: string; demandeur?: string; motif?: string; notes?: string
      lignes: Array<{ produit_id?: string; designation?: string; unite?: string; quantite?: number; quantite_demandee?: number }>
    }) => {
      const numero = await genererNumero('bons_sortie', 'TAF')
      const { data: bon, error: bonErr } = await supabase.from('bons_sortie').insert({
        numero,
        demandeur:  payload.demandeur ?? payload.technicien_nom ?? 'Technicien',
        motif:      payload.motif ?? 'Sortie de stock',
        notes:      payload.notes ?? null,
        statut:     'soumis',
        created_by: auth.user?.id,
        sync_status: 'synced',
      }).select().single()
      if (bonErr || !bon) throw new Error(bonErr?.message ?? 'Erreur création bon')
      const bonId = (bon as { id: string }).id
      const lignes = payload.lignes.map(l => ({
        bon_id:            bonId,
        produit_id:        l.produit_id ?? null,
        designation:       l.designation ?? 'Article',
        unite:             l.unite ?? 'unité',
        quantite_demandee: l.quantite_demandee ?? l.quantite ?? 1,
        quantite_servie:   0,
      }))
      const { error: ligErr } = await supabase.from('bons_sortie_lignes').insert(lignes)
      if (ligErr) { await supabase.from('bons_sortie').delete().eq('id', bonId); throw new Error(ligErr.message) }
      return { ...bon, lignes }
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bons'] }); toast.success('Bon de sortie créé') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useValidateBon() {
  const qc   = useQueryClient()
  const auth = useAuth()
  return useMutation({
    mutationFn: async (arg: string | { id: string; decision: 'valide' | 'refuse'; commentaire?: string }) => {
      const id       = typeof arg === 'string' ? arg : arg.id
      const decision = typeof arg === 'string' ? 'valide' : arg.decision
      const { data: ex } = await supabase.from('bons_sortie').select('statut').eq('id', id).single()
      if (!ex) throw new Error('Bon introuvable')
      if ((ex as { statut: string }).statut !== 'soumis') throw new Error('Bon déjà traité')
      const { data, error } = await supabase.from('bons_sortie')
        .update({ statut: decision, valide_par_id: auth.user?.id, updated_at: new Date().toISOString() })
        .eq('id', id).select().single()
      if (error) throw new Error(error.message)
      return data!
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['bons'] }); toast.success('Décision enregistrée') },
    onError:   (err: Error) => toast.error(err.message),
  })
}

export function useExecuteBon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, code_unique }: { id: string; code_unique: string }) => {
      const { data: bon } = await supabase.from('bons_sortie')
        .select('*, bons_sortie_lignes(*)').eq('id', id).single()
      if (!bon) throw new Error('Bon introuvable')
      const b = bon as { numero: string; statut: string; bons_sortie_lignes: Array<{ produit_id: string | null; quantite_demandee: number }> }
      if (b.numero !== code_unique) throw new Error('Code unique invalide')
      if (b.statut !== 'valide') throw new Error('Bon non validé')
      // Déduire le stock pour chaque ligne avec produit_id
      for (const ligne of b.bons_sortie_lignes) {
        if (!ligne.produit_id) continue
        const { data: p } = await supabase.from('produits').select('stock_actuel,stock_min,stock_critique').eq('id', ligne.produit_id).single()
        if (!p) continue
        const prod = p as { stock_actuel: number; stock_min: number; stock_critique: number }
        if (prod.stock_actuel < ligne.quantite_demandee) throw new Error(`Stock insuffisant pour un produit`)
        const nouvelleQte = prod.stock_actuel - ligne.quantite_demandee
        const statut = nouvelleQte === 0 ? 'rupture' : nouvelleQte <= prod.stock_critique ? 'critique' : nouvelleQte <= prod.stock_min ? 'alerte' : 'normal'
        await supabase.from('produits').update({ stock_actuel: nouvelleQte, statut, updated_at: new Date().toISOString() }).eq('id', ligne.produit_id)
        await supabase.from('bons_sortie_lignes').update({ quantite_servie: ligne.quantite_demandee }).eq('bon_id', id).eq('produit_id', ligne.produit_id)
      }
      const { data, error } = await supabase.from('bons_sortie')
        .update({ statut: 'execute', updated_at: new Date().toISOString() }).eq('id', id).select().single()
      if (error) throw new Error(error.message)
      return data!
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bons'] })
      void qc.invalidateQueries({ queryKey: ['stocks'] })
      toast.success('Bon exécuté — stocks mis à jour')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
