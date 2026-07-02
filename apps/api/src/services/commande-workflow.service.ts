import { supabaseAdmin } from '@forge/db'
import {
  ensureFactureForCommande,
  getFactureActiveByCommande,
  syncCreditForCommande,
} from './finance-core.service'
import { notifyWorkflow } from './workflow-notifications.service'

const db = supabaseAdmin!

type ShopLigne = {
  product_id?: string | null
  designation?: string | null
  quantite?: number | null
  prix_unitaire?: number | null
  total_ht?: number | null
  unite?: string | null
}

type CommandeContextInput = {
  commande_id?: string | null
  erp_commande_id?: string | null
  ref?: string | null
  numero?: string | null
  demandeur?: string | null
  bon_id?: string | null
  commande_shop_id?: string | null
  userId?: string | null
}

type BonResolutionRow = {
  id: string
  commande_id?: string | null
  demandeur?: string | null
  numero?: string | null
}

type CommandeRow = {
  id: string
  numero: string
  statut?: string | null
  client_id?: string | null
  client_nom?: string | null
  total_ttc_xaf?: number | null
  montant_paye_xaf?: number | null
}

type ShopCommandeRow = {
  id: string
  ref: string
  client_nom: string
  client_telephone?: string | null
  client_email?: string | null
  client_adresse?: string | null
  client_ville?: string | null
  lignes?: ShopLigne[] | null
  montant_ht?: number | null
  tva?: number | null
  montant_ttc?: number | null
  frais_livraison?: number | null
  mode_paiement?: string | null
  statut_commande?: string | null
  statut_paiement?: string | null
  erp_commande_id?: string | null
}

export type CommandeWorkflowContext = {
  commandeId: string
  commande: CommandeRow
  shopCommande: ShopCommandeRow | null
  ref: string | null
}

function firstRef(input: CommandeContextInput, bon?: { demandeur?: string | null; numero?: string | null }) {
  return [input.ref, input.numero, input.demandeur, bon?.demandeur, bon?.numero]
    .map((v) => String(v ?? '').trim())
    .find(Boolean) ?? null
}

async function loadCommande(id: string): Promise<CommandeRow | null> {
  const { data } = await db
    .from('commandes')
    .select('id, numero, statut, client_id, client_nom, total_ttc_xaf, montant_paye_xaf')
    .eq('id', id)
    .maybeSingle()
  return (data as CommandeRow | null) ?? null
}

async function loadShopByRef(ref: string): Promise<ShopCommandeRow | null> {
  const { data } = await db
    .from('commandes_shop')
    .select('*')
    .eq('ref', ref)
    .maybeSingle()
  return (data as ShopCommandeRow | null) ?? null
}

async function loadShopByErpCommandeId(commandeId: string): Promise<ShopCommandeRow | null> {
  const { data } = await db
    .from('commandes_shop')
    .select('*')
    .eq('erp_commande_id', commandeId)
    .maybeSingle()
  return (data as ShopCommandeRow | null) ?? null
}

async function loadShopById(id: string): Promise<ShopCommandeRow | null> {
  const { data } = await db
    .from('commandes_shop')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  return (data as ShopCommandeRow | null) ?? null
}

async function findClientId(shop: ShopCommandeRow): Promise<string | null> {
  const telephone = String(shop.client_telephone ?? '').trim()
  if (telephone) {
    const { data } = await db.from('clients').select('id').eq('telephone', telephone).limit(1).maybeSingle()
    if ((data as { id?: string } | null)?.id) return (data as { id: string }).id
  }

  const email = String(shop.client_email ?? '').trim().toLowerCase()
  if (email) {
    const { data } = await db.from('clients').select('id').eq('email', email).limit(1).maybeSingle()
    if ((data as { id?: string } | null)?.id) return (data as { id: string }).id
  }

  const nom = String(shop.client_nom ?? '').trim()
  if (nom) {
    const { data } = await db.from('clients').select('id').eq('nom', nom).limit(1).maybeSingle()
    if ((data as { id?: string } | null)?.id) return (data as { id: string }).id
  }

  return null
}

async function defaultConditionPaiementId() {
  const { data } = await db
    .from('conditions_paiement')
    .select('id')
    .eq('code', 'P100')
    .maybeSingle()
  return (data as { id?: string } | null)?.id ?? null
}

async function createCommandeErpFromShop(shop: ShopCommandeRow, userId?: string | null): Promise<CommandeRow | null> {
  const existingByNumero = await db
    .from('commandes')
    .select('id, numero, statut, client_id, client_nom, total_ttc_xaf, montant_paye_xaf')
    .eq('numero', shop.ref)
    .maybeSingle()

  if (existingByNumero.data) {
    const commande = existingByNumero.data as CommandeRow
    await db.from('commandes_shop')
      .update({ erp_commande_id: commande.id, updated_at: new Date().toISOString() })
      .eq('id', shop.id)
    return commande
  }

  const lignes = Array.isArray(shop.lignes) ? shop.lignes : []
  const montantHt = Math.round(Number(shop.montant_ht ?? lignes.reduce((sum, l) => {
    const total = l.total_ht ?? (Number(l.quantite ?? 0) * Number(l.prix_unitaire ?? 0))
    return sum + Number(total ?? 0)
  }, 0)))
  const tva = Math.round(Number(shop.tva ?? 0))
  const fraisLivraison = Math.round(Number(shop.frais_livraison ?? 0))
  const totalTtc = Math.round(Number(shop.montant_ttc ?? montantHt + tva + fraisLivraison))
  const clientId = await findClientId(shop)
  const conditionPaiementId = await defaultConditionPaiementId()
  const today = new Date().toISOString().slice(0, 10)

  const { data: commande, error } = await db
    .from('commandes')
    .insert({
      numero:                shop.ref,
      client_id:             clientId,
      client_nom:            shop.client_nom,
      statut:                'confirmed',
      date_commande:         today,
      total_ht_xaf:          montantHt,
      tva_xaf:               tva,
      frais_livraison_xaf:   fraisLivraison,
      total_ttc_xaf:         totalTtc,
      condition_paiement_id: conditionPaiementId,
      montant_paye_xaf:      shop.statut_paiement === 'paye' ? totalTtc : 0,
      notes:                 `[SOURCE WEB - RECONSTRUIT] ${shop.ref}`,
      created_by:            userId ?? null,
      sync_status:           'synced',
    })
    .select('id, numero, statut, client_id, client_nom, total_ttc_xaf, montant_paye_xaf')
    .single()

  if (error || !commande) {
    console.error('[workflow] reconstruction commande ERP:', error?.message)
    return null
  }

  const cmd = commande as CommandeRow
  await db.from('commandes_shop')
    .update({ erp_commande_id: cmd.id, updated_at: new Date().toISOString() })
    .eq('id', shop.id)

  const lignesErp = lignes
    .filter((l) => l.designation)
    .map((l, index) => ({
      commande_id:          cmd.id,
      produit_id:           l.product_id ?? null,
      designation:          l.designation ?? 'Article',
      unite:                l.unite ?? 'unite',
      quantite:             Number(l.quantite ?? 1),
      prix_unitaire_ht_xaf: Number(l.prix_unitaire ?? 0),
      total_ht_xaf:         Math.round(Number(l.total_ht ?? (Number(l.quantite ?? 1) * Number(l.prix_unitaire ?? 0)))),
      ordre:                index,
    }))

  if (lignesErp.length > 0) {
    const { error: lignesError } = await db.from('commandes_lignes').insert(lignesErp)
    if (lignesError) console.error('[workflow] reconstruction lignes ERP:', lignesError.message)
  }

  await ensureFactureForCommande({
    commandeId: cmd.id,
    statut:    'brouillon',
    userId:    userId ?? undefined,
    notes:     `Facture brouillon generee automatiquement a la reconstruction ERP de ${shop.ref}.`,
  }).catch(e => console.error('[workflow] facture brouillon ERP reconstruite:', e))

  return cmd
}

export async function resolveCommandeContext(input: CommandeContextInput): Promise<CommandeWorkflowContext | null> {
  let bon: BonResolutionRow | null = null
  if (input.bon_id) {
    const { data } = await db
      .from('bons_sortie')
      .select('id, commande_id, demandeur, numero')
      .eq('id', input.bon_id)
      .maybeSingle()
    bon = (data as BonResolutionRow | null) ?? null
  }

  let shopCommande: ShopCommandeRow | null = null
  let commande: CommandeRow | null = null
  const directCommandeId = input.commande_id ?? input.erp_commande_id ?? bon?.commande_id ?? null

  if (directCommandeId) {
    commande = await loadCommande(directCommandeId)
    if (commande) shopCommande = await loadShopByErpCommandeId(commande.id)
  }

  const ref = firstRef(input, bon ?? undefined)
  if (!commande && ref) {
    const { data } = await db
      .from('commandes')
      .select('id, numero, statut, client_id, client_nom, total_ttc_xaf, montant_paye_xaf')
      .eq('numero', ref)
      .maybeSingle()
    commande = (data as CommandeRow | null) ?? null
    if (commande) shopCommande = await loadShopByErpCommandeId(commande.id)
  }

  if (!shopCommande && input.commande_shop_id) {
    shopCommande = await loadShopById(input.commande_shop_id)
  }
  if (!shopCommande && ref) {
    shopCommande = await loadShopByRef(ref)
  }

  if (!commande && shopCommande?.erp_commande_id) {
    commande = await loadCommande(shopCommande.erp_commande_id)
  }

  if (!commande && shopCommande) {
    commande = await createCommandeErpFromShop(shopCommande, input.userId)
  }

  if (!commande) return null

  const bonId = input.bon_id ?? bon?.id ?? null
  if (bonId) {
    await db.from('bons_sortie')
      .update({ commande_id: commande.id, updated_at: new Date().toISOString() })
      .eq('id', bonId)
  }

  if (shopCommande && shopCommande.erp_commande_id !== commande.id) {
    await db.from('commandes_shop')
      .update({ erp_commande_id: commande.id, updated_at: new Date().toISOString() })
      .eq('id', shopCommande.id)
    shopCommande = { ...shopCommande, erp_commande_id: commande.id }
  }

  return {
    commandeId: commande.id,
    commande,
    shopCommande,
    ref: shopCommande?.ref ?? ref,
  }
}

export async function ensureLivraisonEnPreparationForCommande(
  commandeId: string,
  userId?: string | null,
): Promise<{ created: boolean; livraison: unknown | null }> {
  const { data: existing } = await db
    .from('livraisons')
    .select('*')
    .eq('commande_id', commandeId)
    .not('statut', 'in', '("annulee","livree","echec_livraison")')
    .limit(1)
    .maybeSingle()
  if (existing) return { created: false, livraison: existing }

  const { data: cmd } = await db
    .from('commandes')
    .select('numero, client_id, client_nom')
    .eq('id', commandeId)
    .single()
  if (!cmd) return { created: false, livraison: null }

  const c2 = cmd as { numero: string; client_id: string | null; client_nom: string }
  const year = new Date().getFullYear()
  const { count } = await db.from('livraisons').select('*', { count: 'exact', head: true })
  const numero = `LIV-${year}-${String((count ?? 0) + 1).padStart(3, '0')}`

  const { data: livraison, error } = await db
    .from('livraisons')
    .insert({
      numero,
      commande_id:  commandeId,
      client_id:    c2.client_id,
      client_nom:   c2.client_nom,
      destination:  'A definir',
      statut:       'en_preparation',
      created_by:   userId ?? null,
      sync_status:  'synced',
    })
    .select('*')
    .single()

  if (error || !livraison) {
    console.error('[workflow] livraison auto:', error?.message)
    return { created: false, livraison: null }
  }

  await db.from('livraisons_historique').insert({
    livraison_id:   (livraison as { id: string }).id,
    ancien_statut:  null,
    nouveau_statut: 'en_preparation',
    commentaire:    `Livraison creee automatiquement apres execution du bon de sortie de la commande ${c2.numero}.`,
    changed_by:     userId ?? null,
  })

  await notifyWorkflow({
    event:    'logistique.livraison_en_preparation',
    module:   'logistique',
    severite: 'info',
    titre:    'Livraison en preparation',
    message:  `Commande ${c2.numero} : bon execute, livraison ${numero} creee pour planification.`,
    ref:      numero,
    url:      '/logistique',
    data:     { livraison_id: (livraison as { id: string }).id, commande_id: commandeId },
  })

  return { created: true, livraison }
}

export async function ensureWorkflowApresExecutionBon(
  input: CommandeContextInput,
): Promise<{
  commandeId: string | null
  facture: unknown | null
  livraison: unknown | null
  livraisonCreated: boolean
}> {
  const context = await resolveCommandeContext(input)
  if (!context) {
    return { commandeId: null, facture: null, livraison: null, livraisonCreated: false }
  }

  const shopPaid = context.shopCommande?.statut_paiement === 'paye'
  const montantPaye = shopPaid
    ? Math.round(Number(context.shopCommande?.montant_ttc ?? context.commande.total_ttc_xaf ?? 0))
    : undefined

  let ensured = await ensureFactureForCommande({
    commandeId:     context.commandeId,
    statut:         shopPaid ? 'paye' : 'valide',
    montantPayeXaf: montantPaye,
    userId:         input.userId ?? undefined,
    notes:          'Facture verifiee automatiquement apres execution du bon de sortie.',
  })

  if (shopPaid) {
    const factureId = (ensured.facture as { id?: string } | null)?.id ?? null
    if (factureId) {
      const { data: updatedFacture } = await db
        .from('factures')
        .update({
          statut:            'paye',
          montant_paye_xaf:  montantPaye ?? 0,
          updated_at:        new Date().toISOString(),
        })
        .eq('id', factureId)
        .select('*, factures_lignes(*)')
        .single()
      if (updatedFacture) ensured = { ...ensured, facture: updatedFacture }
    }
    await db.from('commandes')
      .update({ montant_paye_xaf: montantPaye ?? 0, updated_at: new Date().toISOString() })
      .eq('id', context.commandeId)
  }

  await syncCreditForCommande(context.commandeId, input.userId ?? null)

  if (context.commande.statut !== 'pret' && context.commande.statut !== 'delivered') {
    await db.from('commandes')
      .update({ statut: 'pret', updated_at: new Date().toISOString() })
      .eq('id', context.commandeId)
    await db.from('historique_commandes').insert({
      commande_id:    context.commandeId,
      ancien_statut:  context.commande.statut ?? null,
      nouveau_statut: 'pret',
      commentaire:    'Commande marquee prete automatiquement apres execution du bon de sortie.',
      changed_by:     input.userId ?? null,
    })
  }

  const livraisonResult = await ensureLivraisonEnPreparationForCommande(context.commandeId, input.userId)
  const facture = await getFactureActiveByCommande(context.commandeId)

  return {
    commandeId:        context.commandeId,
    facture:           facture ?? ensured.facture,
    livraison:         livraisonResult.livraison,
    livraisonCreated:  livraisonResult.created,
  }
}

export async function ensureWorkflowApresPreparationBon(
  input: CommandeContextInput,
): Promise<{
  commandeId: string | null
  facture: unknown | null
  livraison: unknown | null
  livraisonCreated: boolean
}> {
  const context = await resolveCommandeContext(input)
  if (!context) {
    return { commandeId: null, facture: null, livraison: null, livraisonCreated: false }
  }

  const shopPaid = context.shopCommande?.statut_paiement === 'paye'
  const montantPaye = shopPaid
    ? Math.round(Number(context.shopCommande?.montant_ttc ?? context.commande.total_ttc_xaf ?? 0))
    : undefined

  let ensured = await ensureFactureForCommande({
    commandeId:     context.commandeId,
    statut:         shopPaid ? 'paye' : 'valide',
    montantPayeXaf: montantPaye,
    userId:         input.userId ?? undefined,
    notes:          'Facture validee automatiquement apres preparation du bon de sortie.',
  })

  if (shopPaid) {
    const factureId = (ensured.facture as { id?: string } | null)?.id ?? null
    if (factureId) {
      const { data: updatedFacture } = await db
        .from('factures')
        .update({
          statut:           'paye',
          montant_paye_xaf: montantPaye ?? 0,
          updated_at:       new Date().toISOString(),
        })
        .eq('id', factureId)
        .select('*, factures_lignes(*)')
        .single()
      if (updatedFacture) ensured = { ...ensured, facture: updatedFacture }
    }
    await db.from('commandes')
      .update({ montant_paye_xaf: montantPaye ?? 0, updated_at: new Date().toISOString() })
      .eq('id', context.commandeId)
  }

  if (context.commande.statut !== 'pret' && context.commande.statut !== 'delivered') {
    await db.from('commandes')
      .update({ statut: 'pret', updated_at: new Date().toISOString() })
      .eq('id', context.commandeId)
    await db.from('historique_commandes').insert({
      commande_id:    context.commandeId,
      ancien_statut:  context.commande.statut ?? null,
      nouveau_statut: 'pret',
      commentaire:    'Commande marquee prete automatiquement apres preparation du bon de sortie.',
      changed_by:     input.userId ?? null,
    })
  }

  await syncCreditForCommande(context.commandeId, input.userId ?? null)
  const livraisonResult = await ensureLivraisonEnPreparationForCommande(context.commandeId, input.userId)
  const facture = await getFactureActiveByCommande(context.commandeId)

  return {
    commandeId:       context.commandeId,
    facture:          facture ?? ensured.facture,
    livraison:        livraisonResult.livraison,
    livraisonCreated: livraisonResult.created,
  }
}

export type SynchronisationWorkflowCible = 'factures' | 'livraisons' | 'tout'

export type SynchronisationWorkflowResult = {
  cible: SynchronisationWorkflowCible
  total_bons_execute: number
  commandes_resolues: number
  factures_creees: number
  factures_existantes: number
  livraisons_creees: number
  livraisons_existantes: number
  erreurs: Array<{ bon_id: string; numero?: string | null; message: string }>
}

async function ensureFacturePourContext(
  context: CommandeWorkflowContext,
  userId?: string | null,
) {
  const shopPaid = context.shopCommande?.statut_paiement === 'paye'
  const montantPaye = shopPaid
    ? Math.round(Number(context.shopCommande?.montant_ttc ?? context.commande.total_ttc_xaf ?? 0))
    : undefined

  let ensured = await ensureFactureForCommande({
    commandeId:     context.commandeId,
    statut:         shopPaid ? 'paye' : 'valide',
    montantPayeXaf: montantPaye,
    userId:         userId ?? undefined,
    notes:          'Facture synchronisee automatiquement par le workflow commande.',
  })

  if (shopPaid) {
    const factureId = (ensured.facture as { id?: string } | null)?.id ?? null
    if (factureId) {
      const { data: updatedFacture } = await db
        .from('factures')
        .update({
          statut:           'paye',
          montant_paye_xaf: montantPaye ?? 0,
          updated_at:       new Date().toISOString(),
        })
        .eq('id', factureId)
        .select('*, factures_lignes(*)')
        .single()
      if (updatedFacture) ensured = { ...ensured, facture: updatedFacture }
    }
    await db.from('commandes')
      .update({ montant_paye_xaf: montantPaye ?? 0, updated_at: new Date().toISOString() })
      .eq('id', context.commandeId)
  }

  await syncCreditForCommande(context.commandeId, userId ?? null)
  return ensured
}

export async function synchroniserBonsExecutesWorkflow(options: {
  cible: SynchronisationWorkflowCible
  userId?: string | null
}): Promise<SynchronisationWorkflowResult> {
  const cible = options.cible
  const result: SynchronisationWorkflowResult = {
    cible,
    total_bons_execute: 0,
    commandes_resolues: 0,
    factures_creees: 0,
    factures_existantes: 0,
    livraisons_creees: 0,
    livraisons_existantes: 0,
    erreurs: [],
  }

  const { data: bons, error } = await db
    .from('bons_sortie')
    .select('id, numero, commande_id, demandeur')
    .eq('statut', 'execute')
    .order('updated_at', { ascending: false })

  if (error) throw new Error(error.message)
  result.total_bons_execute = (bons ?? []).length

  const commandesTraitees = new Set<string>()

  for (const bon of (bons ?? []) as Array<{ id: string; numero?: string | null; commande_id?: string | null; demandeur?: string | null }>) {
    try {
      const context = await resolveCommandeContext({
        bon_id:      bon.id,
        commande_id: bon.commande_id ?? null,
        demandeur:   bon.demandeur ?? null,
        userId:      options.userId ?? null,
      })

      if (!context) {
        result.erreurs.push({
          bon_id: bon.id,
          numero: bon.numero ?? null,
          message: 'Commande introuvable ou impossible a reconstruire.',
        })
        continue
      }

      if (commandesTraitees.has(context.commandeId)) continue
      commandesTraitees.add(context.commandeId)
      result.commandes_resolues += 1

      if (cible === 'factures' || cible === 'tout') {
        const existing = await getFactureActiveByCommande(context.commandeId)
        const ensured = await ensureFacturePourContext(context, options.userId)
        if (existing || !ensured.created) result.factures_existantes += 1
        else result.factures_creees += 1
      }

      if (cible === 'livraisons' || cible === 'tout') {
        const livraison = await ensureLivraisonEnPreparationForCommande(context.commandeId, options.userId)
        if (livraison.created) result.livraisons_creees += 1
        else if (livraison.livraison) result.livraisons_existantes += 1
      }
    } catch (e) {
      result.erreurs.push({
        bon_id: bon.id,
        numero: bon.numero ?? null,
        message: (e as Error).message,
      })
    }
  }

  return result
}
