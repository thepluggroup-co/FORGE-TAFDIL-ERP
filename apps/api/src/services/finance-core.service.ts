import { supabaseAdmin } from '@forge/db'
import { genererEcritureEncaissement, genererEcritureVente } from './comptabilite.service'

const db = supabaseAdmin!

type FactureStatut = 'brouillon' | 'valide' | 'envoye' | 'paye' | 'annule'
type PaiementMethode = 'mobile_money' | 'virement' | 'especes' | 'cheque' | 'notchpay'

interface CommandeRow {
  id: string
  numero: string
  client_id: string | null
  client_nom: string
  total_ht_xaf: number
  tva_xaf: number
  frais_livraison_xaf?: number | null
  total_ttc_xaf: number
  montant_paye_xaf?: number | null
  commandes_lignes?: Array<{
    designation: string
    unite: string
    quantite: number
    prix_unitaire_ht_xaf: number
    total_ht_xaf: number
    ordre: number
  }>
}

export interface EnsureFactureOptions {
  commandeId: string
  statut?: FactureStatut
  montantPayeXaf?: number
  dateEcheanceJours?: number
  notes?: string
  userId?: string
}

export interface EnregistrerPaiementCommandeOptions {
  commandeId: string
  montantXaf: number
  methode: PaiementMethode
  referenceExt?: string | null
  datePaiement: string
  notes?: string | null
  userId?: string
  ensureFacture?: boolean
  factureStatutSiCreation?: FactureStatut
}

export function enrichirFactureSolde<T extends { total_ttc_xaf?: number; montant_paye_xaf?: number }>(facture: T) {
  const solde = Math.max(0, Number(facture.total_ttc_xaf ?? 0) - Number(facture.montant_paye_xaf ?? 0))
  return { ...facture, solde_restant_xaf: Math.round(solde) }
}

async function genererNumero(table: string, prefix: string) {
  const year = new Date().getFullYear()
  const { count } = await db.from(table).select('*', { count: 'exact', head: true })
    .gte('created_at', `${year}-01-01T00:00:00.000Z`)
  return `${prefix}-${year}-${String((count ?? 0) + 1).padStart(4, '0')}`
}

function factureStatutDepuisPaiement(total: number, montantPaye: number, fallback: FactureStatut) {
  if (montantPaye >= total) return 'paye'
  if (montantPaye > 0 && ['brouillon', 'valide'].includes(fallback)) return 'envoye'
  return fallback
}

export async function getFactureActiveByCommande(commandeId: string) {
  const { data, error } = await db
    .from('factures')
    .select('*, factures_lignes(*)')
    .eq('commande_id', commandeId)
    .neq('statut', 'annule')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data ?? null
}

export async function ensureFactureForCommande(options: EnsureFactureOptions) {
  const existing = await getFactureActiveByCommande(options.commandeId)
  if (existing) return { facture: enrichirFactureSolde(existing), created: false }

  const { data: commande, error } = await db
    .from('commandes')
    .select('id, numero, client_id, client_nom, total_ht_xaf, tva_xaf, frais_livraison_xaf, total_ttc_xaf, montant_paye_xaf, commandes_lignes(*)')
    .eq('id', options.commandeId)
    .single()

  if (error || !commande) throw new Error(error?.message ?? 'Commande introuvable')
  const cmd = commande as CommandeRow

  const numero = await genererNumero('factures', 'FAC')
  const dateEmission = new Date().toISOString().slice(0, 10)
  const dateEcheance = new Date(Date.now() + (options.dateEcheanceJours ?? 7) * 86400_000).toISOString().slice(0, 10)
  const montantPaye = Math.min(Number(options.montantPayeXaf ?? cmd.montant_paye_xaf ?? 0), Number(cmd.total_ttc_xaf))
  const statut = factureStatutDepuisPaiement(Number(cmd.total_ttc_xaf), montantPaye, options.statut ?? 'brouillon')

  const { data: facture, error: factureError } = await db
    .from('factures')
    .insert({
      numero,
      commande_id:       cmd.id,
      client_id:         cmd.client_id,
      client_nom:        cmd.client_nom,
      statut,
      date_emission:     dateEmission,
      date_echeance:     dateEcheance,
      total_ht_xaf:      cmd.total_ht_xaf,
      tva_xaf:           cmd.tva_xaf,
      frais_livraison_xaf: Number(cmd.frais_livraison_xaf ?? 0),
      total_ttc_xaf:     cmd.total_ttc_xaf,
      montant_paye_xaf:  montantPaye,
      notes:             options.notes ?? null,
      created_by:        options.userId ?? null,
      sync_status:       'synced',
    })
    .select()
    .single()

  if (factureError || !facture) throw new Error(factureError?.message ?? 'Erreur creation facture')

  const facId = (facture as { id: string }).id
  const lignes = (cmd.commandes_lignes ?? []).map((ligne, index) => ({
    facture_id:            facId,
    designation:           ligne.designation,
    unite:                 ligne.unite,
    quantite:              ligne.quantite,
    prix_unitaire_ht_xaf:  ligne.prix_unitaire_ht_xaf,
    total_ht_xaf:          ligne.total_ht_xaf,
    ordre:                 ligne.ordre ?? index + 1,
  }))

  if (lignes.length > 0) {
    const { error: lignesError } = await db.from('factures_lignes').insert(lignes)
    if (lignesError) {
      await db.from('factures').delete().eq('id', facId)
      throw new Error(lignesError.message)
    }
  }

  genererEcritureVente({
    id:             facId,
    numero,
    date_emission:  dateEmission,
    client_nom:     cmd.client_nom,
    total_ht_xaf:   cmd.total_ht_xaf,
    tva_xaf:        cmd.tva_xaf,
    frais_livraison_xaf: Number(cmd.frais_livraison_xaf ?? 0),
    total_ttc_xaf:  cmd.total_ttc_xaf,
    created_by:     options.userId,
  }).catch(e => console.error('[compta] vente auto:', e))

  return { facture: enrichirFactureSolde({ ...facture, factures_lignes: lignes }), created: true }
}

export async function enregistrerPaiementCommande(options: EnregistrerPaiementCommandeOptions) {
  if (options.montantXaf <= 0) throw Object.assign(new Error('Montant paiement invalide'), { httpStatus: 422 })

  const { data: commande, error } = await db
    .from('commandes')
    .select('id, numero, client_id, client_nom, total_ttc_xaf, montant_paye_xaf')
    .eq('id', options.commandeId)
    .single()

  if (error || !commande) throw Object.assign(new Error('Commande introuvable'), { httpStatus: 404 })

  const cmd = commande as {
    id: string; numero: string; client_id: string | null; client_nom: string
    total_ttc_xaf: number; montant_paye_xaf: number | null
  }
  const dejaPaye = Number(cmd.montant_paye_xaf ?? 0)
  const solde = Math.max(0, Number(cmd.total_ttc_xaf) - dejaPaye)
  if (options.montantXaf > solde + 1) {
    throw Object.assign(new Error(`Montant depasse le solde restant (${Math.round(solde).toLocaleString('fr-CM')} XAF)`), {
      code: 'AMOUNT_EXCEEDED',
      httpStatus: 422,
    })
  }

  const nouveauPaye = Math.min(Number(cmd.total_ttc_xaf), Math.round(dejaPaye + options.montantXaf))
  const { facture } = options.ensureFacture === false
    ? { facture: await getFactureActiveByCommande(options.commandeId) }
    : await ensureFactureForCommande({
        commandeId:      options.commandeId,
        statut:          options.factureStatutSiCreation ?? 'envoye',
        montantPayeXaf:  nouveauPaye,
        userId:          options.userId,
      })

  const factureId = (facture as { id?: string } | null)?.id ?? null

  const { data: paiement, error: paiementError } = await db
    .from('paiements_commande')
    .insert({
      commande_id:    options.commandeId,
      client_id:      cmd.client_id,
      facture_id:     factureId,
      montant_xaf:    options.montantXaf,
      methode:        options.methode,
      reference_ext:  options.referenceExt ?? null,
      statut:         'confirme',
      date_paiement:  options.datePaiement,
      notes:          options.notes ?? null,
      enregistre_par: options.userId ?? null,
      sync_status:    'synced',
    })
    .select()
    .single()

  if (paiementError) throw new Error(paiementError.message)

  await db.from('commandes')
    .update({ montant_paye_xaf: nouveauPaye, updated_at: new Date().toISOString() })
    .eq('id', options.commandeId)

  let factureUpdate = facture
  if (factureId) {
    const nouveauStatut = nouveauPaye >= Number(cmd.total_ttc_xaf) ? 'paye' : 'envoye'
    const { data: updatedFacture, error: factureError } = await db
      .from('factures')
      .update({ montant_paye_xaf: nouveauPaye, statut: nouveauStatut, updated_at: new Date().toISOString() })
      .eq('id', factureId)
      .select('*, factures_lignes(*)')
      .single()
    if (factureError) throw new Error(factureError.message)
    factureUpdate = updatedFacture

    genererEcritureEncaissement({
      facture_id:  factureId,
      reference:   (factureUpdate as { numero?: string })?.numero ?? cmd.numero,
      date:        options.datePaiement,
      montant_xaf: options.montantXaf,
      client_nom:  cmd.client_nom,
      mode:        options.methode === 'especes' ? 'caisse' : 'banque',
      created_by:  options.userId,
    }).catch(e => console.error('[compta] encaissement commande:', e))
  }

  const soldeApres = Math.max(0, Number(cmd.total_ttc_xaf) - nouveauPaye)
  return {
    paiement,
    facture: factureUpdate ? enrichirFactureSolde(factureUpdate as { total_ttc_xaf?: number; montant_paye_xaf?: number }) : null,
    montant_paye_xaf: nouveauPaye,
    solde_restant_xaf: Math.round(soldeApres),
  }
}
