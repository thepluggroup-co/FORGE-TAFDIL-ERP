import { supabaseAdmin } from '@forge/db'
import { genererEcritureEncaissement, genererEcritureVente } from './comptabilite.service'

const db = supabaseAdmin!

type FactureStatut = 'brouillon' | 'valide' | 'envoye' | 'paye' | 'annule'
type PaiementMethode = 'mobile_money' | 'virement' | 'especes' | 'cheque' | 'notchpay'

interface FactureCreditRow {
  id?: string | null
  numero?: string | null
  client_id?: string | null
  client_nom?: string | null
  commande_id?: string | null
  statut?: string | null
  date_emission?: string | null
  date_echeance?: string | null
  total_ttc_xaf?: number | null
  montant_paye_xaf?: number | null
  created_by?: string | null
}

interface CommandeCreditRow {
  id: string
  numero?: string | null
  client_id?: string | null
  client_nom?: string | null
  condition_paiement_id?: string | null
  acompte_recu_xaf?: number | null
  montant_paye_xaf?: number | null
  total_ttc_xaf?: number | null
  date_commande?: string | null
  date_livraison_prevue?: string | null
  date_echeance_solde?: string | null
  statut?: string | null
  created_by?: string | null
}

interface CommandeRow {
  id: string
  numero: string
  client_id: string | null
  client_nom: string
  condition_paiement_id?: string | null
  acompte_recu_xaf?: number | null
  date_echeance_solde?: string | null
  total_ht_xaf: number
  tva_xaf: number
  frais_livraison_xaf?: number | null
  total_ttc_xaf: number
  montant_paye_xaf?: number | null
  remise_globale_xaf?: number | null
  remise_globale_motif?: string | null
  net_a_payer_xaf?: number | null
  commandes_lignes?: Array<{
    designation: string
    unite: string
    quantite: number
    prix_unitaire_ht_xaf: number
    total_ht_xaf: number
    remise_type?: string | null
    remise_valeur?: number | null
    remise_xaf?: number | null
    remise_motif?: string | null
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

function totalFactureCommande(cmd: Pick<CommandeRow, 'total_ht_xaf' | 'tva_xaf'>) {
  return Math.round(Number(cmd.total_ht_xaf ?? 0) + Number(cmd.tva_xaf ?? 0))
}

export function statutCreditDepuisSoldeEtEcheance(solde: number, echeance?: string | null) {
  if (solde <= 0) return 'rembourse'
  const today = new Date().toISOString().slice(0, 10)
  return String(echeance ?? today) < today ? 'echu' : 'en_cours'
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

function factureEngageante(statut?: string | null) {
  return ['valide', 'envoye', 'paye'].includes(String(statut ?? ''))
}

function statutRank(statut?: string | null) {
  const ranks: Record<string, number> = {
    brouillon: 0,
    valide:    1,
    envoye:    2,
    paye:      3,
    annule:    4,
  }
  return ranks[String(statut ?? 'brouillon')] ?? 0
}

async function engagerFactureSiNecessaire(
  facture: FactureCreditRow & {
    remise_globale_xaf?: number | null
    total_ht_xaf?: number | null
    tva_xaf?: number | null
    frais_livraison_xaf?: number | null
  },
  userId?: string | null,
) {
  if (!factureEngageante(facture.statut)) return null

  genererEcritureVente({
    id:                  facture.id!,
    numero:              facture.numero ?? facture.id!,
    date_emission:       facture.date_emission ?? new Date().toISOString().slice(0, 10),
    client_nom:          facture.client_nom ?? 'Client',
    total_ht_xaf:        Number(facture.total_ht_xaf ?? 0),
    tva_xaf:             Number(facture.tva_xaf ?? 0),
    frais_livraison_xaf: Number(facture.frais_livraison_xaf ?? 0),
    total_ttc_xaf:       Number(facture.total_ttc_xaf ?? 0),
    created_by:          userId ?? facture.created_by ?? undefined,
  }).catch(e => console.error('[compta] vente auto:', e))

  return syncCreditForFacture(facture, userId)
}

function creditStatutDepuisEcheance(echeance: string) {
  return statutCreditDepuisSoldeEtEcheance(1, echeance)
}

async function syncEncoursCreditClient(clientId?: string | null) {
  if (!clientId) return

  const { data, error } = await db
    .from('credits')
    .select('solde_restant_xaf')
    .eq('client_id', clientId)
    .in('statut', ['en_cours', 'echu'])

  if (error) throw new Error(error.message)

  const encours = ((data ?? []) as { solde_restant_xaf?: number | null }[])
    .reduce((sum, credit) => sum + Number(credit.solde_restant_xaf ?? 0), 0)

  const { error: updateError } = await db
    .from('clients')
    .update({ encours_credit_xaf: Math.round(encours), updated_at: new Date().toISOString() })
    .eq('id', clientId)

  if (updateError) throw new Error(updateError.message)
}

async function getCreditByFactureOrCommande(factureId?: string | null, commandeId?: string | null) {
  if (factureId) {
    const { data, error } = await db
      .from('credits')
      .select('*')
      .eq('facture_id', factureId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (data) return data
  }

  if (commandeId) {
    const { data, error } = await db
      .from('credits')
      .select('*')
      .eq('commande_id', commandeId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw new Error(error.message)
    return data ?? null
  }

  return null
}

export async function syncCreditForFacture(facture: FactureCreditRow | null, userId?: string | null) {
  if (!facture?.id && !facture?.commande_id) return null

  const total = Number(facture.total_ttc_xaf ?? 0)
  const montantPaye = Number(facture.montant_paye_xaf ?? 0)
  const solde = facture.statut === 'annule' ? 0 : Math.max(0, Math.round(total - montantPaye))
  const now = new Date().toISOString()

  const existing = await getCreditByFactureOrCommande(facture.id, facture.commande_id)
  const credit = existing as { id: string; montant_xaf?: number | null; client_id?: string | null } | null

  if (facture.statut === 'brouillon') {
    if (!credit) return null
    const { data, error } = await db
      .from('credits')
      .update({
        facture_id:         facture.id ?? null,
        commande_id:        facture.commande_id ?? null,
        solde_restant_xaf: 0,
        statut:            'rembourse',
        notes:             `Creance neutralisee : facture ${facture.numero ?? facture.id ?? ''} encore en brouillon.`.trim(),
        updated_at:        now,
        sync_status:       'synced',
      })
      .eq('id', credit.id)
      .select()
      .single()

    if (error) throw new Error(error.message)
    await syncEncoursCreditClient(credit.client_id ?? facture.client_id)
    return data
  }

  if (solde <= 0) {
    if (!credit) return null

    const { data, error } = await db
      .from('credits')
      .update({
        facture_id:          facture.id ?? null,
        commande_id:         facture.commande_id ?? null,
        solde_restant_xaf: 0,
        statut:           'rembourse',
        updated_at:       now,
        sync_status:      'synced',
      })
      .eq('id', credit.id)
      .select()
      .single()

    if (error) throw new Error(error.message)
    await syncEncoursCreditClient(credit.client_id ?? facture.client_id)
    return data
  }

  if (!facture.client_id) return null

  const dateDebut = facture.date_emission ?? new Date().toISOString().slice(0, 10)
  const echeance = facture.date_echeance ?? dateDebut
  const statut = creditStatutDepuisEcheance(echeance)

  if (credit) {
    const { data, error } = await db
      .from('credits')
      .update({
        client_id:           facture.client_id,
        client_nom:          facture.client_nom ?? 'Client',
        facture_id:          facture.id ?? null,
        commande_id:         facture.commande_id ?? null,
        montant_xaf:         Math.max(Number(credit.montant_xaf ?? 0), solde),
        solde_restant_xaf:   solde,
        echeance,
        statut,
        notes:               `Creance synchronisee automatiquement depuis la facture ${facture.numero ?? facture.id ?? ''}`.trim(),
        updated_at:          now,
        sync_status:         'synced',
      })
      .eq('id', credit.id)
      .select()
      .single()

    if (error) throw new Error(error.message)
    await syncEncoursCreditClient(facture.client_id)
    return data
  }

  const numero = await genererNumero('credits', 'CRD')
  const { data, error } = await db
    .from('credits')
    .insert({
      numero,
      client_id:           facture.client_id,
      client_nom:          facture.client_nom ?? 'Client',
      facture_id:          facture.id ?? null,
      commande_id:         facture.commande_id,
      montant_xaf:         solde,
      solde_restant_xaf:   solde,
      date_debut:          dateDebut,
      echeance,
      statut,
      notes:               `Creance generee automatiquement depuis la facture ${facture.numero ?? facture.id ?? ''}`.trim(),
      created_by:          userId ?? facture.created_by ?? null,
      sync_status:         'synced',
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  await syncEncoursCreditClient(facture.client_id)
  return data
}

export async function syncCreditForCommande(commandeId: string, userId?: string | null) {
  const facture = await getFactureActiveByCommande(commandeId)
  if (facture) return syncCreditForFacture(facture, userId)

  const { data, error } = await db
    .from('commandes')
    .select('id, numero, client_id, client_nom, condition_paiement_id, acompte_recu_xaf, montant_paye_xaf, total_ttc_xaf, date_commande, date_livraison_prevue, date_echeance_solde, statut, created_by')
    .eq('id', commandeId)
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Commande introuvable')

  const commande = data as CommandeCreditRow
  let acomptePct: number | null = null
  if (commande.condition_paiement_id) {
    const { data: condition, error: conditionError } = await db
      .from('conditions_paiement')
      .select('acompte_pct')
      .eq('id', commande.condition_paiement_id)
      .maybeSingle()

    if (conditionError) throw new Error(conditionError.message)
    acomptePct = Number((condition as { acompte_pct?: number | null } | null)?.acompte_pct ?? 100)
  }

  const total = Number(commande.total_ttc_xaf ?? 0)
  const montantPaye = Math.max(Number(commande.montant_paye_xaf ?? 0), Number(commande.acompte_recu_xaf ?? 0))
  const solde = commande.statut === 'cancelled' ? 0 : Math.max(0, Math.round(total - montantPaye))
  const existing = await getCreditByFactureOrCommande(null, commande.id)
  const credit = existing as { id: string; montant_xaf?: number | null; client_id?: string | null } | null

  if (solde <= 0 || !commande.condition_paiement_id || (acomptePct ?? 100) >= 100) {
    if (!credit) return null
    const { data: updated, error: updateError } = await db
      .from('credits')
      .update({
        solde_restant_xaf: 0,
        statut:           'rembourse',
        updated_at:       new Date().toISOString(),
        sync_status:      'synced',
      })
      .eq('id', credit.id)
      .select()
      .single()

    if (updateError) throw new Error(updateError.message)
    await syncEncoursCreditClient(credit.client_id ?? commande.client_id)
    return updated
  }

  if (!commande.client_id) return null

  const dateDebut = commande.date_commande ?? new Date().toISOString().slice(0, 10)
  const echeance = commande.date_echeance_solde ?? commande.date_livraison_prevue ?? dateDebut
  const statut = creditStatutDepuisEcheance(echeance)
  const now = new Date().toISOString()

  if (credit) {
    const { data: updated, error: updateError } = await db
      .from('credits')
      .update({
        client_id:           commande.client_id,
        client_nom:          commande.client_nom ?? 'Client',
        commande_id:         commande.id,
        montant_xaf:         Math.max(Number(credit.montant_xaf ?? 0), solde),
        solde_restant_xaf:   solde,
        echeance,
        statut,
        notes:               `Creance synchronisee automatiquement depuis la commande ${commande.numero ?? commande.id}`.trim(),
        updated_at:          now,
        sync_status:         'synced',
      })
      .eq('id', credit.id)
      .select()
      .single()

    if (updateError) throw new Error(updateError.message)
    await syncEncoursCreditClient(commande.client_id)
    return updated
  }

  const numero = await genererNumero('credits', 'CRD')
  const { data: created, error: createError } = await db
    .from('credits')
    .insert({
      numero,
      client_id:           commande.client_id,
      client_nom:          commande.client_nom ?? 'Client',
      commande_id:         commande.id,
      montant_xaf:         solde,
      solde_restant_xaf:   solde,
      date_debut:          dateDebut,
      echeance,
      statut,
      notes:               `Creance generee automatiquement depuis la commande ${commande.numero ?? commande.id}`.trim(),
      created_by:          userId ?? commande.created_by ?? null,
      sync_status:         'synced',
    })
    .select()
    .single()

  if (createError) throw new Error(createError.message)
  await syncEncoursCreditClient(commande.client_id)
  return created
}

export async function solderCreditsForCommande(commandeId: string, userId?: string | null) {
  const facture = await getFactureActiveByCommande(commandeId).catch(() => null)
  if (facture) await syncCreditForFacture({ ...(facture as FactureCreditRow), statut: 'annule', montant_paye_xaf: facture.total_ttc_xaf }, userId)

  const { data: credits, error } = await db
    .from('credits')
    .select('id, client_id')
    .eq('commande_id', commandeId)
    .neq('statut', 'rembourse')

  if (error) throw new Error(error.message)

  const rows = (credits ?? []) as Array<{ id: string; client_id?: string | null }>
  if (rows.length === 0) return { count: 0 }

  const { error: updateError } = await db
    .from('credits')
    .update({
      solde_restant_xaf: 0,
      statut:           'rembourse',
      updated_at:       new Date().toISOString(),
      sync_status:      'synced',
      notes:            'Creance soldee automatiquement apres annulation de la commande.',
    })
    .in('id', rows.map(row => row.id))

  if (updateError) throw new Error(updateError.message)
  await Promise.all([...new Set(rows.map(row => row.client_id).filter(Boolean) as string[])].map(syncEncoursCreditClient))
  return { count: rows.length }
}

export async function backfillCreditsClients(userId?: string | null) {
  const { data: factures, error: facturesError } = await db
    .from('factures')
    .select('id, numero, client_id, client_nom, commande_id, statut, date_emission, date_echeance, total_ttc_xaf, montant_paye_xaf, created_by')
    .neq('statut', 'annule')

  if (facturesError) throw new Error(facturesError.message)

  let facturesSynced = 0
  for (const facture of (factures ?? []) as FactureCreditRow[]) {
    const credit = await syncCreditForFacture(facture, userId)
    if (credit) facturesSynced += 1
  }

  const { data: commandes, error: commandesError } = await db
    .from('commandes')
    .select('id')
    .neq('statut', 'cancelled')

  if (commandesError) throw new Error(commandesError.message)

  let commandesSynced = 0
  for (const commande of (commandes ?? []) as Array<{ id: string }>) {
    const credit = await syncCreditForCommande(commande.id, userId)
    if (credit) commandesSynced += 1
  }

  return { factures_synced: facturesSynced, commandes_synced: commandesSynced }
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
  if (existing) {
    const current = existing as FactureCreditRow
    const total = Number(current.total_ttc_xaf ?? 0)
    const montantPaye = Math.min(Number(options.montantPayeXaf ?? current.montant_paye_xaf ?? 0), total)
    const requestedStatut = options.statut
      ? factureStatutDepuisPaiement(total, montantPaye, options.statut)
      : current.statut as FactureStatut | undefined
    const updates: Record<string, unknown> = {}

    if (requestedStatut && statutRank(requestedStatut) > statutRank(current.statut)) {
      updates.statut = requestedStatut
    }
    if (montantPaye > Number(current.montant_paye_xaf ?? 0)) {
      updates.montant_paye_xaf = montantPaye
    }

    let facture = existing
    if (Object.keys(updates).length > 0) {
      const { data: updated, error: updateError } = await db
        .from('factures')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', current.id)
        .select('*, factures_lignes(*)')
        .single()
      if (updateError) throw new Error(updateError.message)
      facture = updated
    }

    const credit = await engagerFactureSiNecessaire(facture as FactureCreditRow, options.userId)
      ?? await syncCreditForFacture(facture as FactureCreditRow, options.userId)
    return { facture: enrichirFactureSolde({ ...facture, credit_auto: credit }), created: false }
  }

  const { data: commande, error } = await db
    .from('commandes')
    .select('id, numero, client_id, client_nom, condition_paiement_id, acompte_recu_xaf, date_echeance_solde, total_ht_xaf, tva_xaf, frais_livraison_xaf, total_ttc_xaf, montant_paye_xaf, remise_globale_xaf, remise_globale_motif, net_a_payer_xaf, commandes_lignes(*)')
    .eq('id', options.commandeId)
    .single()

  if (error || !commande) throw new Error(error?.message ?? 'Commande introuvable')
  const cmd = commande as CommandeRow

  const numero = await genererNumero('factures', 'FAC')
  const dateEmission = new Date().toISOString().slice(0, 10)
  const dateEcheance = cmd.date_echeance_solde
    ?? new Date(Date.now() + (options.dateEcheanceJours ?? 7) * 86400_000).toISOString().slice(0, 10)
  const totalFactureXaf = totalFactureCommande(cmd)
  const montantPaye = Math.min(Number(options.montantPayeXaf ?? cmd.montant_paye_xaf ?? 0), totalFactureXaf)
  const statut = factureStatutDepuisPaiement(totalFactureXaf, montantPaye, options.statut ?? 'brouillon')

  const { data: facture, error: factureError } = await db
    .from('factures')
    .insert({
      numero,
      commande_id:           cmd.id,
      client_id:             cmd.client_id,
      client_nom:            cmd.client_nom,
      condition_paiement_id: cmd.condition_paiement_id ?? null,
      acompte_recu_xaf:      Number(cmd.acompte_recu_xaf ?? 0),
      statut,
      date_emission:         dateEmission,
      date_echeance:         dateEcheance,
      remise_globale_xaf:    Number(cmd.remise_globale_xaf ?? 0),
      remise_globale_motif:  cmd.remise_globale_motif ?? null,
      total_ht_xaf:          cmd.total_ht_xaf,
      tva_xaf:               cmd.tva_xaf,
      frais_livraison_xaf:   0,
      total_ttc_xaf:         totalFactureXaf,
      net_a_payer_xaf:       totalFactureXaf,
      montant_paye_xaf:      montantPaye,
      notes:                 options.notes ?? null,
      created_by:            options.userId ?? null,
      sync_status:           'synced',
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
    remise_type:           ligne.remise_type ?? null,
    remise_valeur:         ligne.remise_valeur ?? null,
    remise_xaf:            ligne.remise_xaf ?? 0,
    remise_motif:          ligne.remise_motif ?? null,
    ordre:                 ligne.ordre ?? index + 1,
  }))

  if (lignes.length > 0) {
    const { error: lignesError } = await db.from('factures_lignes').insert(lignes)
    if (lignesError) {
      await db.from('factures').delete().eq('id', facId)
      throw new Error(lignesError.message)
    }
  }

  const remiseLignesXaf = Math.round((cmd.commandes_lignes ?? []).reduce((s, l) => s + Number(l.remise_xaf ?? 0), 0))
  const remiseTotaleHtXaf = remiseLignesXaf + Math.round(Number(cmd.remise_globale_xaf ?? 0))
  const brutHtXaf = cmd.total_ht_xaf + remiseTotaleHtXaf

  let credit = null
  if (factureEngageante(statut)) {
    genererEcritureVente({
      id:                    facId,
      numero,
      date_emission:         dateEmission,
      client_nom:            cmd.client_nom,
      total_ht_xaf:          cmd.total_ht_xaf,
      tva_xaf:               cmd.tva_xaf,
      frais_livraison_xaf:   0,
      total_ttc_xaf:         totalFactureXaf,
      brut_ht_xaf:           remiseTotaleHtXaf > 0 ? brutHtXaf : undefined,
      remise_totale_ht_xaf:  remiseTotaleHtXaf > 0 ? remiseTotaleHtXaf : undefined,
      created_by:            options.userId,
    }).catch(e => console.error('[compta] vente auto:', e))

    credit = await syncCreditForFacture(facture as FactureCreditRow, options.userId)
  }
  return { facture: enrichirFactureSolde({ ...facture, factures_lignes: lignes, credit_auto: credit }), created: true }
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
  const { facture } = options.ensureFacture === false
    ? { facture: await getFactureActiveByCommande(options.commandeId) }
    : await ensureFactureForCommande({
        commandeId: options.commandeId,
        statut:     options.factureStatutSiCreation ?? 'envoye',
        userId:     options.userId,
      })

  const factureCourante = facture as {
    id?: string | null
    numero?: string | null
    total_ttc_xaf?: number | null
    montant_paye_xaf?: number | null
  } | null
  const factureId = factureCourante?.id ?? null
  const totalReference = Number(factureCourante?.total_ttc_xaf ?? cmd.total_ttc_xaf ?? 0)
  const dejaPaye = Number(factureCourante?.montant_paye_xaf ?? cmd.montant_paye_xaf ?? 0)
  const solde = Math.max(0, totalReference - dejaPaye)
  if (options.montantXaf > solde + 1) {
    throw Object.assign(new Error(`Montant depasse le solde restant (${Math.round(solde).toLocaleString('fr-CM')} XAF)`), {
      code: 'AMOUNT_EXCEEDED',
      httpStatus: 422,
    })
  }

  const nouveauPaye = Math.min(totalReference, Math.round(dejaPaye + options.montantXaf))

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
    const nouveauStatut = nouveauPaye >= totalReference ? 'paye' : 'envoye'
    const { data: updatedFacture, error: factureError } = await db
      .from('factures')
      .update({ montant_paye_xaf: nouveauPaye, statut: nouveauStatut, updated_at: new Date().toISOString() })
      .eq('id', factureId)
      .select('*, factures_lignes(*)')
      .single()
    if (factureError) throw new Error(factureError.message)
    factureUpdate = updatedFacture
    await syncCreditForFacture(updatedFacture as FactureCreditRow, options.userId)

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

  const soldeApres = Math.max(0, totalReference - nouveauPaye)
  return {
    paiement,
    facture: factureUpdate ? enrichirFactureSolde(factureUpdate as { total_ttc_xaf?: number; montant_paye_xaf?: number }) : null,
    montant_paye_xaf: nouveauPaye,
    solde_restant_xaf: Math.round(soldeApres),
  }
}
