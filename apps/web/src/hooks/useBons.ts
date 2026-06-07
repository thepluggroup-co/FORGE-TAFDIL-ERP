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
  id: string; numero: string
  statut: 'en_attente' | 'soumis' | 'valide' | 'execute' | 'refuse'
  type?: 'commande' | 'devis' | 'manuel'
  commande_id?: string | null
  montant_total_xaf?: number | null
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

/** Retourne le nombre de bons en statut 'en_attente' — utilisé pour le badge magasinier */
export function useBonsEnAttente() {
  return useQuery({
    queryKey:   ['bons', 'en_attente', 'count'],
    queryFn:    async () => {
      const { data, error } = await supabase
        .from('bons_sortie')
        .select('id', { count: 'exact', head: false })
        .eq('statut', 'en_attente')
      if (error) throw new Error(error.message)
      return (data ?? []).length
    },
    staleTime:  10_000,
    refetchInterval: 30_000,
  })
}

/** Crée les bons de sortie manquants pour les commandes web existantes — via Supabase direct */
export function useBackfillBons() {
  const qc   = useQueryClient()
  const auth = useAuth()
  return useMutation({
    mutationFn: async () => {
      let created = 0
      const errors: string[] = []

      // Toutes les commandes shop en_preparation
      const { data: shopCommandes, error: shopErr } = await supabase
        .from('commandes_shop')
        .select('ref, client_nom, client_telephone, lignes, montant_ttc, erp_commande_id')
        .eq('statut_commande', 'en_preparation')

      if (shopErr) throw new Error(shopErr.message)

      for (const cmd of (shopCommandes ?? []) as Array<{
        ref: string; client_nom: string; client_telephone: string
        lignes: Array<{ designation: string; quantite: number }> | null
        montant_ttc: number | null; erp_commande_id: string | null
      }>) {
        // Vérifier si un bon existe déjà
        const { data: existing } = await supabase
          .from('bons_sortie')
          .select('id')
          .eq('demandeur', cmd.ref)
          .maybeSingle()
        if (existing) continue

        const lignes = cmd.lignes ?? []
        if (lignes.length === 0) { errors.push(`${cmd.ref}: lignes vides`); continue }

        // Numéro de bon
        const today    = new Date()
        const yyyymmdd = today.toISOString().slice(0, 10).replace(/-/g, '')
        const { count } = await supabase
          .from('bons_sortie')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', `${today.toISOString().slice(0, 10)}T00:00:00.000Z`)
        const numero = `TAF-${yyyymmdd}-${String((count ?? 0) + 1 + created).padStart(4, '0')}`

        // Créer le bon
        const { data: bon, error: bonErr } = await supabase.from('bons_sortie').insert({
          numero,
          statut:            'en_attente',
          type:              'commande',
          demandeur:         cmd.ref,
          motif:             `Préparation commande ${cmd.ref}`,
          montant_total_xaf: cmd.montant_ttc ?? null,
          notes:             `Client : ${cmd.client_nom} — ${cmd.client_telephone}`,
          created_by:        auth.user?.id,
          sync_status:       'synced',
          ...(cmd.erp_commande_id ? { commande_id: cmd.erp_commande_id } : {}),
        }).select('id').single()

        if (bonErr || !bon) { errors.push(`${cmd.ref}: ${bonErr?.message ?? 'insert échoué'}`); continue }

        // Créer les lignes
        const bonId   = (bon as { id: string }).id
        const bonLignes = lignes.map((l) => ({
          bon_id:            bonId,
          produit_id:        null,
          designation:       l.designation,
          unite:             'unité',
          quantite_demandee: l.quantite,
          quantite_servie:   0,
        }))
        const { error: ligErr } = await supabase.from('bons_sortie_lignes').insert(bonLignes)
        if (ligErr) {
          await supabase.from('bons_sortie').delete().eq('id', bonId)
          errors.push(`${cmd.ref}: lignes - ${ligErr.message}`)
          continue
        }

        created++
      }

      return { created, errors }
    },
    onSuccess: (res) => {
      void qc.refetchQueries({ queryKey: ['bons'] })
      if (res.errors.length) res.errors.forEach((e) => console.error('[backfill]', e))
      toast.success(res.created > 0 ? `${res.created} bon(s) créé(s)` : 'Tous les bons sont déjà à jour')
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useCreateBon() {
  const qc   = useQueryClient()
  const auth = useAuth()
  return useMutation({
    mutationFn: async (payload: {
      technicien_nom?: string; demandeur?: string; motif?: string; notes?: string
      type?: 'manuel' | 'commande' | 'devis'
      commande_id?: string | null; devis_id?: string | null
      lignes: Array<{ produit_id?: string; designation?: string; unite?: string; quantite?: number; quantite_demandee?: number }>
    }) => {
      const numero = await genererNumero('bons_sortie', 'TAF')
      const { data: bon, error: bonErr } = await supabase.from('bons_sortie').insert({
        numero,
        demandeur:  payload.demandeur ?? payload.technicien_nom ?? 'Technicien',
        motif:      payload.motif ?? 'Sortie de stock',
        notes:      payload.notes ?? null,
        statut:     'soumis',
        type:       payload.type ?? 'manuel',
        ...(payload.commande_id ? { commande_id: payload.commande_id } : {}),
        ...(payload.devis_id ? { devis_id: payload.devis_id } : {}),
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
      const { data: ex } = await supabase.from('bons_sortie').select('statut, commande_id').eq('id', id).single()
      if (!ex) throw new Error('Bon introuvable')
      const exBon = ex as { statut: string; commande_id: string | null }
      if (!['en_attente', 'soumis'].includes(exBon.statut)) throw new Error('Bon déjà traité')
      const { data, error } = await supabase.from('bons_sortie')
        .update({ statut: decision, valide_par_id: auth.user?.id, updated_at: new Date().toISOString() })
        .eq('id', id).select().single()
      if (error) throw new Error(error.message)

      // Auto-créer une facture brouillon si le bon est lié à une commande
      if (decision === 'valide' && exBon.commande_id) {
        try {
          const { data: existingFact } = await supabase
            .from('factures').select('id').eq('commande_id', exBon.commande_id).maybeSingle()
          if (!existingFact) {
            const { data: cmd } = await supabase
              .from('commandes')
              .select('id, numero, client_id, client_nom, total_ht_xaf, tva_xaf')
              .eq('id', exBon.commande_id)
              .single()
            if (cmd) {
              const c = cmd as { id: string; numero: string; client_id: string | null; client_nom: string; total_ht_xaf: number; tva_xaf: number }
              const { data: cmdLignes } = await supabase
                .from('commandes_lignes')
                .select('designation, unite, quantite, prix_unitaire_ht_xaf, total_ht_xaf, ordre')
                .eq('commande_id', c.id).order('ordre')
              const numero   = await genererNumero('factures', 'FAC')
              const today    = new Date().toISOString().slice(0, 10)
              const echeance = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
              const { data: facture } = await supabase.from('factures').insert({
                numero,
                statut:           'brouillon',
                commande_id:      c.id,
                client_id:        c.client_id,
                client_nom:       c.client_nom,
                date_emission:    today,
                date_echeance:    echeance,
                total_ht_xaf:     c.total_ht_xaf,
                tva_xaf:          c.tva_xaf,
                total_ttc_xaf:    c.total_ht_xaf + c.tva_xaf,
                montant_paye_xaf: 0,
                created_by:       auth.user?.id,
                sync_status:      'synced',
              }).select('id').single()
              if (facture) {
                const factId = (facture as { id: string }).id
                type CmdLigne = { designation: string; unite: string; quantite: number; prix_unitaire_ht_xaf: number; total_ht_xaf: number; ordre: number }
                const lignesArr = Array.isArray(cmdLignes) && cmdLignes.length > 0
                  ? (cmdLignes as CmdLigne[]).map((l, i) => ({
                      facture_id: factId, designation: l.designation, unite: l.unite,
                      quantite: l.quantite, prix_unitaire_ht_xaf: l.prix_unitaire_ht_xaf,
                      total_ht_xaf: l.total_ht_xaf, ordre: l.ordre ?? i,
                    }))
                  : [{ facture_id: factId, designation: `Commande ${c.numero}`, unite: 'forfait',
                       quantite: 1, prix_unitaire_ht_xaf: c.total_ht_xaf, total_ht_xaf: c.total_ht_xaf, ordre: 0 }]
                await supabase.from('factures_lignes').insert(lignesArr)
                void qc.invalidateQueries({ queryKey: ['factures'] })
                toast(`Facture ${numero} créée — en attente de validation Finance`)
              }
            }
          }
        } catch (e) {
          console.error('[auto-facture]', e)
        }
      }

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
