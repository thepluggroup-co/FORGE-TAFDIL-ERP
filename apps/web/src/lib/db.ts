/**
 * FORGE ERP — Couche de données Supabase directe.
 *
 * Remplace apiClient (HTTP → API server) par des appels Supabase directs.
 * Fonctionne identiquement dans le navigateur ET dans Electron desktop.
 * Aucun serveur HTTP à démarrer, aucun IPC SQLite nécessaire.
 *
 * La clé anon + session utilisateur suffit (RLS non bloquant sur ce projet).
 */
import { supabase } from './supabase'

// ── Constantes métier ─────────────────────────────────────────────────────────

export const TVA_RATE = 0.1925

// ── Utilitaires ────────────────────────────────────────────────────────────────

/** Lève une erreur lisible depuis une réponse Supabase */
function raise(error: { message: string } | null, ctx = ''): never {
  throw new Error(ctx ? `${ctx} : ${error?.message}` : (error?.message ?? 'Erreur inconnue'))
}

/** Calcule HT, TVA, TTC depuis un tableau de lignes */
export function calculerTotaux(
  lignes: Array<{ quantite: number; prix_unitaire_ht_xaf: number }>,
) {
  const ht  = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_ht_xaf, 0)
  const tva = Math.round(ht * TVA_RATE)
  return { total_ht_xaf: Math.round(ht), tva_xaf: tva, total_ttc_xaf: Math.round(ht + tva) }
}

/** Génère un numéro séquentiel jour : PREFIX-YYYYMMDD-XXXX */
export async function genererNumero(table: string, prefix: string): Promise<string> {
  const today    = new Date().toISOString().slice(0, 10)
  const yyyymmdd = today.replace(/-/g, '')
  const { count } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .gte('created_at', `${today}T00:00:00.000Z`)
  return `${prefix}-${yyyymmdd}-${String((count ?? 0) + 1).padStart(4, '0')}`
}

/** Statut stock d'après les seuils */
export function calcStatutStock(
  stock: number, min: number, critique: number,
): 'normal' | 'alerte' | 'critique' | 'rupture' {
  if (stock === 0)       return 'rupture'
  if (stock <= critique) return 'critique'
  if (stock <= min)      return 'alerte'
  return 'normal'
}

/** Labels autorisés par la contrainte chk_clients_score_fiabilite */
export const SCORE_FIABILITE_LABELS = ['nouveau', 'bon', 'tres_bon', 'vip', 'bloque'] as const
export type ScoreFiabilite = typeof SCORE_FIABILITE_LABELS[number]

/**
 * Normalise une valeur `score_fiabilite` (string label OU entier 0-100) vers
 * l'un des 5 labels acceptés par la base. Indispensable avant tout `.insert()`
 * ou `.update()` direct sur Supabase sinon la contrainte CHECK
 * `chk_clients_score_fiabilite` rejette la ligne.
 */
export function normalizeScoreFiabilite(value: unknown): ScoreFiabilite {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'tres-bon' || normalized === 'tres bon' ||
        normalized === 'très_bon' || normalized === 'très bon') return 'tres_bon'
    if ((SCORE_FIABILITE_LABELS as readonly string[]).includes(normalized)) {
      return normalized as ScoreFiabilite
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 80) return 'vip'
    if (value >= 60) return 'tres_bon'
    if (value >= 40) return 'bon'
    return 'nouveau'
  }
  return 'nouveau'
}

// ══════════════════════════════════════════════════════════════════════════════
// PRODUITS / STOCKS
// ══════════════════════════════════════════════════════════════════════════════

export async function dbGetProduits(params?: {
  search?: string; categorie?: string; statut?: string
}) {
  let q = supabase.from('produits').select('*', { count: 'exact' })
  if (params?.categorie) q = q.eq('categorie', params.categorie)
  if (params?.statut)    q = q.eq('statut', params.statut)
  if (params?.search)    q = q.or(`designation.ilike.%${params.search}%,ref.ilike.%${params.search}%`)
  const { data, count, error } = await q.order('designation')
  if (error) raise(error, 'produits')
  return { data: data ?? [], total: count ?? 0 }
}

export async function dbGetAlertesProduits() {
  const { data, error } = await supabase
    .from('produits')
    .select('*')
    .in('statut', ['alerte', 'critique', 'rupture'])
    .order('stock_actuel', { ascending: true })
  if (error) raise(error, 'alertes produits')
  return { data: data ?? [], total: data?.length ?? 0 }
}

export async function dbCreateProduit(payload: {
  ref: string; designation: string; description?: string; categorie: string
  unite: string; stock_actuel: number; stock_min: number; stock_critique: number
  prix_unitaire_xaf: number; emplacement?: string; fournisseur?: string
}) {
  const statut = calcStatutStock(payload.stock_actuel, payload.stock_min, payload.stock_critique)
  const { data, error } = await supabase
    .from('produits')
    .insert({ ...payload, statut, sync_status: 'synced' })
    .select().single()
  if (error) raise(error, 'créer produit')
  return data!
}

export async function dbMouvementStock(
  produitId: string,
  type: 'entree' | 'sortie' | 'ajustement',
  quantite: number,
  motif?: string,
) {
  const { data: p, error: pe } = await supabase
    .from('produits')
    .select('stock_actuel, stock_min, stock_critique')
    .eq('id', produitId).single()
  if (pe || !p) raise(pe, 'produit introuvable')

  let nouvelleQte: number
  if      (type === 'ajustement') nouvelleQte = quantite
  else if (type === 'entree')     nouvelleQte = p.stock_actuel + quantite
  else {
    if (p.stock_actuel < quantite)
      throw new Error(`Stock insuffisant : ${p.stock_actuel} disponible`)
    nouvelleQte = p.stock_actuel - quantite
  }

  const statut = calcStatutStock(nouvelleQte, p.stock_min, p.stock_critique)

  const [mvtRes, updRes] = await Promise.all([
    supabase.from('mouvements_stock').insert({
      produit_id: produitId, type, quantite,
      notes: motif ?? null,
    }).select().single(),
    supabase.from('produits').update({
      stock_actuel: nouvelleQte, statut,
      updated_at: new Date().toISOString(),
    }).eq('id', produitId).select().single(),
  ])
  if (mvtRes.error) raise(mvtRes.error, 'mouvement stock')
  return { mouvement: mvtRes.data, produit: updRes.data }
}

export async function dbGetMouvementsStock(params?: {
  produit_id?: string
  type?: 'entree' | 'sortie' | 'ajustement' | 'transfert'
  date_debut?: string
  date_fin?: string
  page?: number
  per_page?: number
}) {
  const page    = params?.page    ?? 1
  const perPage = params?.per_page ?? 20
  const from = (page - 1) * perPage
  const to   = from + perPage - 1

  let q = supabase
    .from('mouvements_stock')
    .select('*, produits(ref, designation, unite), profiles!created_by(full_name)', { count: 'exact' })

  if (params?.produit_id) q = q.eq('produit_id', params.produit_id)
  if (params?.type)       q = q.eq('type', params.type)
  if (params?.date_debut) q = q.gte('created_at', params.date_debut)
  if (params?.date_fin)   q = q.lte('created_at', `${params.date_fin}T23:59:59.999Z`)

  const { data, count, error } = await q
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) raise(error, 'mouvements_stock')
  return {
    data:        data ?? [],
    total:       count ?? 0,
    page,
    per_page:    perPage,
    total_pages: Math.ceil((count ?? 0) / perPage),
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CLIENTS
// ══════════════════════════════════════════════════════════════════════════════

export async function dbGetClients(params?: {
  search?: string; statut?: string; type?: string
}) {
  let q = supabase.from('clients').select('*', { count: 'exact' })
  if (params?.statut) q = q.eq('statut', params.statut)
  if (params?.type)   q = q.eq('type', params.type)
  if (params?.search) q = q.or(`nom.ilike.%${params.search}%,telephone.ilike.%${params.search}%,email.ilike.%${params.search}%`)
  const { data, count, error } = await q.order('nom')
  if (error) raise(error, 'clients')
  return { data: data ?? [], total: count ?? 0 }
}

export async function dbGetClient(id: string) {
  const { data, error } = await supabase
    .from('clients')
    .select('*, commandes(id,numero,statut,total_ttc_xaf,date_commande), credits(id,numero,montant_xaf,solde_restant_xaf,statut,echeance)')
    .eq('id', id).single()
  if (error) raise(error, 'client')
  return data!
}

export async function dbCreateClient(payload: Record<string, unknown>) {
  const { data, error } = await supabase
    .from('clients')
    .insert({
      ...payload,
      score_fiabilite: normalizeScoreFiabilite(payload.score_fiabilite),
      sync_status: 'synced',
    })
    .select().single()
  if (error) raise(error, 'créer client')
  return data!
}

export async function dbUpdateClient(id: string, payload: Record<string, unknown>) {
  const updates: Record<string, unknown> = {
    ...payload,
    updated_at: new Date().toISOString(),
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'score_fiabilite')) {
    updates.score_fiabilite = normalizeScoreFiabilite(payload.score_fiabilite)
  }
  const { data, error } = await supabase
    .from('clients')
    .update(updates)
    .eq('id', id).select().single()
  if (error) raise(error, 'modifier client')
  return data!
}

async function ensureClientLocal(payload: {
  client_id?: string
  client_nom: string
  client_telephone?: string
  client_email?: string
  client_adresse?: string
  client_ville?: string
  user_id?: string
}) {
  if (payload.client_id) return payload.client_id

  const nom = payload.client_nom.trim()
  if (!nom) return null

  const telephone = payload.client_telephone?.trim() || null
  const email = payload.client_email?.trim().toLowerCase() || null
  const telTail = telephone?.replace(/\D/g, '').slice(-8) || ''

  let existing: { id: string } | null = null
  if (telTail) {
    const { data } = await supabase.from('clients').select('id').ilike('telephone', `%${telTail}%`).limit(1).maybeSingle()
    existing = data as { id: string } | null
  }
  if (!existing && email) {
    const { data } = await supabase.from('clients').select('id').eq('email', email).maybeSingle()
    existing = data as { id: string } | null
  }
  if (!existing) {
    const { data } = await supabase.from('clients').select('id').ilike('nom', nom).limit(1).maybeSingle()
    existing = data as { id: string } | null
  }
  if (existing?.id) return existing.id

  const { data, error } = await supabase
    .from('clients')
    .insert({
      nom,
      type:        'particulier',
      telephone,
      email,
      adresse:     payload.client_adresse?.trim() || null,
      ville:       payload.client_ville?.trim() || null,
      pays:        'Cameroun',
      statut:      'actif',
      created_by:  payload.user_id ?? null,
      sync_status: 'synced',
    })
    .select('id')
    .single()

  if (error) raise(error, 'créer client automatiquement')
  return (data as { id: string }).id
}

// ══════════════════════════════════════════════════════════════════════════════
// COMMANDES
// ══════════════════════════════════════════════════════════════════════════════

export async function dbGetCommandes(params?: {
  statut?: string; search?: string; client_id?: string
}) {
  let q = supabase.from('commandes').select(
    '*, commandes_lignes(*), historique_commandes(nouveau_statut,commentaire,changed_at), clients(id,nom,telephone)',
    { count: 'exact' },
  )
  if (params?.statut)    q = q.eq('statut', params.statut)
  if (params?.client_id) q = q.eq('client_id', params.client_id)
  if (params?.search)    q = q.or(`numero.ilike.%${params.search}%,client_nom.ilike.%${params.search}%`)
  const { data, count, error } = await q.order('created_at', { ascending: false })
  if (error) raise(error, 'commandes')
  return {
    data: (data ?? []).map(mapCommande),
    total: count ?? 0,
  }
}

function mapCommande(row: Record<string, unknown>) {
  const cli = row.clients as { id?: string; nom?: string; telephone?: string } | null
  const ttc     = Number(row.total_ttc_xaf ?? 0)
  const acompte = Number(row.acompte_recu_xaf ?? 0)
  return {
    id:                    row.id as string,
    reference:             row.numero as string,
    statut:                row.statut as string,
    date_commande:         row.date_commande as string | null,
    date_livraison_prevue: row.date_livraison_prevue as string | null,
    montant_ttc_xaf:       ttc,
    acompte_recu_xaf:      acompte,
    solde_restant_xaf:     Math.max(0, ttc - acompte),
    notes:                 row.notes as string | null,
    client: {
      id:        row.client_id as string ?? cli?.id ?? '',
      nom:       cli?.nom ?? row.client_nom as string ?? '',
      telephone: cli?.telephone ?? '',
    },
    lignes: ((row.commandes_lignes as unknown[]) ?? []).map((l: unknown) => {
      const ll = l as Record<string, unknown>
      return {
        designation:          ll.designation as string,
        quantite:             Number(ll.quantite),
        prix_unitaire_ht_xaf: Number(ll.prix_unitaire_ht_xaf),
        unite:                ll.unite as string ?? 'unité',
      }
    }),
    historique: ((row.historique_commandes as unknown[]) ?? []).map((h: unknown) => {
      const hh = h as Record<string, unknown>
      return {
        statut:      hh.nouveau_statut as string,
        created_at:  hh.changed_at as string ?? '',
        commentaire: hh.commentaire as string | null,
      }
    }).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
  }
}

export async function dbCreateCommande(
  payload: {
    client_id?: string; client_nom: string; devis_id?: string
    client_telephone?: string; client_email?: string; client_adresse?: string; client_ville?: string
    date_commande: string; date_livraison_prevue?: string
    notes?: string; acompte_recu_xaf?: number
    condition_paiement_id?: string
    lignes: Array<{
      produit_id?: string; designation: string; unite?: string
      quantite: number; prix_unitaire_ht_xaf: number; ordre?: number
    }>
  },
  userId?: string,
) {
  // Vérifier blocage client
  const clientId = await ensureClientLocal({
    client_id:        payload.client_id,
    client_nom:       payload.client_nom,
    client_telephone: payload.client_telephone,
    client_email:     payload.client_email,
    client_adresse:   payload.client_adresse,
    client_ville:     payload.client_ville,
    user_id:          userId,
  })

  if (clientId) {
    const { count } = await supabase.from('credits')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', clientId).eq('statut', 'echu')
    if ((count ?? 0) > 0) {
      const { data: cli } = await supabase.from('clients').select('nom').eq('id', clientId).single()
      throw new Error(`Client "${(cli as { nom?: string } | null)?.nom}" a des crédits échus — commande bloquée`)
    }
  }

  const numero = await genererNumero('commandes', 'CMD')
  const totaux = calculerTotaux(payload.lignes)

  const { data: cmd, error: cmdErr } = await supabase
    .from('commandes')
    .insert({
      numero,
      client_id:             clientId ?? payload.client_id ?? null,
      client_nom:            payload.client_nom,
      devis_id:              payload.devis_id ?? null,
      statut:                'confirmed',
      date_commande:         payload.date_commande,
      date_livraison_prevue: payload.date_livraison_prevue ?? null,
      acompte_recu_xaf:      payload.acompte_recu_xaf ?? 0,
      condition_paiement_id: payload.condition_paiement_id ?? null,
      statut_paiement:       'non_paye',
      notes:                 payload.notes ?? null,
      created_by:            userId ?? null,
      sync_status:           'synced',
      ...totaux,
    })
    .select().single()
  if (cmdErr || !cmd) raise(cmdErr, 'créer commande')
  const cmdId = (cmd as { id: string }).id

  // Lignes
  const { error: ligErr } = await supabase.from('commandes_lignes').insert(
    payload.lignes.map((l, i) => ({
      commande_id:          cmdId,
      produit_id:           l.produit_id ?? null,
      designation:          l.designation,
      unite:                l.unite ?? 'unité',
      quantite:             l.quantite,
      prix_unitaire_ht_xaf: l.prix_unitaire_ht_xaf,
      total_ht_xaf:         Math.round(l.quantite * l.prix_unitaire_ht_xaf),
      ordre:                l.ordre ?? i,
    })),
  )
  if (ligErr) { await supabase.from('commandes').delete().eq('id', cmdId); raise(ligErr, 'lignes commande') }

  // Historique
  await supabase.from('historique_commandes').insert({
    commande_id: cmdId, ancien_statut: null,
    nouveau_statut: 'confirmed', commentaire: 'Commande créée', changed_by: userId ?? null,
  })

  // Retourner la commande complète
  const { data: full } = await supabase.from('commandes')
    .select('*, commandes_lignes(*), historique_commandes(nouveau_statut,commentaire,changed_at), clients(id,nom,telephone)')
    .eq('id', cmdId).single()
  return mapCommande(full as Record<string, unknown>)
}

export async function dbUpdateStatutCommande(
  id: string, statut: string, commentaire?: string, userId?: string,
) {
  const TRANSITIONS: Record<string, string[]> = {
    confirmed: ['in_production','cancelled'], in_production: ['pret','cancelled'],
    pret: ['cancelled'], delivered: [], cancelled: [],
  }
  if (statut === 'delivered') {
    throw new Error('La validation de livraison se fait uniquement depuis le module Logistique.')
  }
  const { data: ex } = await supabase.from('commandes').select('statut').eq('id', id).single()
  if (!ex) throw new Error('Commande introuvable')
  const allowed = TRANSITIONS[(ex as { statut: string }).statut] ?? []
  if (!allowed.includes(statut))
    throw new Error(`Transition "${(ex as { statut: string }).statut}" → "${statut}" non autorisée`)

  const { error } = await supabase.from('commandes')
    .update({ statut, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) raise(error, 'statut commande')

  await supabase.from('historique_commandes').insert({
    commande_id: id, ancien_statut: (ex as { statut: string }).statut,
    nouveau_statut: statut, commentaire: commentaire ?? null, changed_by: userId ?? null,
  })
  return { id, statut }
}

// ══════════════════════════════════════════════════════════════════════════════
// DEVIS
// ══════════════════════════════════════════════════════════════════════════════

export async function dbGetDevis(params?: { statut?: string; search?: string }) {
  let q = supabase.from('devis')
    .select('*, devis_lignes(*), clients(id,nom,telephone,email)', { count: 'exact' })
  if (params?.statut) q = q.eq('statut', params.statut)
  if (params?.search) q = q.or(`numero.ilike.%${params.search}%,client_nom.ilike.%${params.search}%`)
  const { data, count, error } = await q.order('created_at', { ascending: false })
  if (error) raise(error, 'devis')

  // Auto-expire
  const today = new Date().toISOString().slice(0, 10)
  const toExpire = (data ?? []).filter(
    (d: Record<string, unknown>) =>
      !['expire','refuse','transforme'].includes(d.statut as string) &&
      (d.date_validite as string) < today
  )
  if (toExpire.length > 0) {
    await supabase.from('devis')
      .update({ statut: 'expire', updated_at: new Date().toISOString() })
      .in('id', toExpire.map((d: Record<string, unknown>) => d.id))
    toExpire.forEach((d: Record<string, unknown>) => { d.statut = 'expire' })
  }

  return { data: (data ?? []).map(mapDevis), total: count ?? 0 }
}

function mapDevis(row: Record<string, unknown>) {
  const cli = row.clients as { id?: string; nom?: string; telephone?: string; email?: string } | null
  const today = new Date().toISOString().slice(0, 10)
  return {
    id:                  row.id as string,
    reference:           row.numero as string,
    statut:              row.statut as string,
    date_creation:       row.date_emission as string ?? row.created_at as string,
    date_validite:       row.date_validite as string,
    validite_jours:      Number(row.validite_jours ?? 30),
    acompte_pct:         Number(row.acompte_pct ?? 0),
    conditions_paiement: row.conditions_paiement as string ?? 'Virement bancaire',
    montant_ttc_xaf:     Number(row.total_ttc_xaf ?? 0),
    pdf_url:             (row.pdf_url as string | null) ?? null,
    expire:              (row.date_validite as string) < today,
    client: {
      id:        row.client_id as string ?? cli?.id ?? '',
      nom:       cli?.nom ?? row.client_nom as string ?? '',
      telephone: cli?.telephone ?? null,
      email:     cli?.email ?? null,
    },
    lignes: ((row.devis_lignes as unknown[]) ?? []).map((l: unknown) => {
      const ll = l as Record<string, unknown>
      return {
        id:                   ll.id as string,
        designation:          ll.designation as string,
        categorie:            (ll.categorie as string ?? 'materiaux').replace('_', '-'),
        quantite:             Number(ll.quantite),
        prix_unitaire_ht_xaf: Number(ll.prix_unitaire_ht_xaf),
      }
    }),
  }
}

export async function dbCreateDevis(
  payload: {
    client_id?: string; client_nom: string; date_emission: string; date_validite: string
    validite_jours: number; acompte_pct: number; conditions_paiement: string; notes?: string
    lignes: Array<{
      designation: string; categorie: string; unite: string
      quantite: number; prix_unitaire_ht_xaf: number; ordre: number; description?: string
    }>
  },
  userId?: string,
) {
  const numero = await genererNumero('devis', 'DEV')
  const totaux = calculerTotaux(payload.lignes)

  const { data: dv, error: dvErr } = await supabase.from('devis')
    .insert({
      numero, client_id: payload.client_id ?? null, client_nom: payload.client_nom,
      statut: 'brouillon', date_emission: payload.date_emission,
      date_validite: payload.date_validite, validite_jours: payload.validite_jours,
      acompte_pct: payload.acompte_pct, conditions_paiement: payload.conditions_paiement,
      notes: payload.notes ?? null, created_by: userId ?? null, sync_status: 'synced',
      ...totaux,
    })
    .select().single()
  if (dvErr || !dv) raise(dvErr, 'créer devis')
  const dvId = (dv as { id: string }).id

  const { data: lignesData, error: ligErr } = await supabase.from('devis_lignes')
    .insert(payload.lignes.map((l, i) => ({
      devis_id: dvId, designation: l.designation, description: l.description ?? null,
      categorie: l.categorie, unite: l.unite, quantite: l.quantite,
      prix_unitaire_ht_xaf: l.prix_unitaire_ht_xaf,
      total_ht_xaf: Math.round(l.quantite * l.prix_unitaire_ht_xaf),
      ordre: l.ordre !== 0 ? l.ordre : i,
    })))
    .select()
  if (ligErr) { await supabase.from('devis').delete().eq('id', dvId); raise(ligErr, 'lignes devis') }

  return { ...dv, lignes: lignesData, pdf_url: null }
}

export async function dbUpdateStatutDevis(id: string, statut: string) {
  const TRANSITIONS: Record<string, string[]> = {
    brouillon: ['envoye','refuse','expire'], envoye: ['accepte','refuse','expire'],
    accepte: ['transforme'], refuse: [], expire: [], transforme: [],
  }
  const { data: ex } = await supabase.from('devis').select('statut,date_validite').eq('id', id).single()
  if (!ex) throw new Error('Devis introuvable')
  const allowed = TRANSITIONS[(ex as { statut: string }).statut] ?? []
  if (!allowed.includes(statut))
    throw new Error(`Transition "${(ex as { statut: string }).statut}" → "${statut}" non autorisée`)

  const { data, error } = await supabase.from('devis')
    .update({ statut, updated_at: new Date().toISOString() })
    .eq('id', id).select('*, devis_lignes(*), clients(id,nom,telephone,email)').single()
  if (error) raise(error, 'statut devis')
  return mapDevis(data as Record<string, unknown>)
}

export async function dbTransformerDevis(id: string, userId?: string) {
  const { data: dv, error } = await supabase.from('devis')
    .select('*, devis_lignes(*)').eq('id', id).single()
  if (error || !dv) raise(error, 'devis introuvable')
  const d = dv as Record<string, unknown>

  const today = new Date().toISOString().slice(0, 10)
  if ((d.date_validite as string) < today && !['brouillon','envoye','accepte'].includes(d.statut as string))
    throw new Error(`Devis expiré ou refusé — transformation impossible`)
  if (!['brouillon','envoye','accepte'].includes(d.statut as string))
    throw new Error(`Statut "${d.statut}" — transformation impossible`)

  const lignes = (d.devis_lignes as Record<string, unknown>[]) ?? []
  const totaux = { total_ht_xaf: Number(d.total_ht_xaf), tva_xaf: Number(d.tva_xaf), total_ttc_xaf: Number(d.total_ttc_xaf) }
  const numero = await genererNumero('commandes', 'CMD')

  const { data: cmd, error: cmdErr } = await supabase.from('commandes')
    .insert({
      numero, client_id: d.client_id ?? null, client_nom: d.client_nom,
      devis_id: d.id, statut: 'confirmed',
      date_commande: today,
      acompte_recu_xaf: Math.round(Number(d.total_ttc_xaf) * (Number(d.acompte_pct) / 100)),
      notes: d.notes ?? null, created_by: userId ?? null, sync_status: 'synced',
      ...totaux,
    })
    .select().single()
  if (cmdErr || !cmd) raise(cmdErr, 'créer commande depuis devis')
  const cmdId = (cmd as { id: string }).id

  await supabase.from('commandes_lignes').insert(
    lignes.map(l => ({
      commande_id: cmdId, designation: l.designation, unite: l.unite,
      quantite: Number(l.quantite), prix_unitaire_ht_xaf: Number(l.prix_unitaire_ht_xaf),
      total_ht_xaf: Number(l.total_ht_xaf), ordre: Number(l.ordre ?? 0),
    })),
  )

  await supabase.from('devis').update({ statut: 'transforme', updated_at: new Date().toISOString() }).eq('id', id)
  await supabase.from('historique_commandes').insert({
    commande_id: cmdId, ancien_statut: null, nouveau_statut: 'confirmed',
    commentaire: `Créée depuis devis ${d.numero}`, changed_by: userId ?? null,
  })

  return { commande_id: cmdId, commande_numero: (cmd as { numero: string }).numero }
}

// ══════════════════════════════════════════════════════════════════════════════
// FACTURES
// ══════════════════════════════════════════════════════════════════════════════

export async function dbGetFactures(params?: { statut?: string; client_id?: string; search?: string }) {
  let q = supabase.from('factures').select('*, factures_lignes(*)', { count: 'exact' })
  if (params?.statut)    q = q.eq('statut', params.statut)
  if (params?.client_id) q = q.eq('client_id', params.client_id)
  if (params?.search)    q = q.or(`numero.ilike.%${params.search}%,client_nom.ilike.%${params.search}%`)
  const { data, count, error } = await q.order('created_at', { ascending: false })
  if (error) raise(error, 'factures')
  return {
    data: (data ?? []).map(enrichirFacture),
    total: count ?? 0,
  }
}

function enrichirFacture(f: Record<string, unknown>) {
  const ttc  = Number(f.total_ttc_xaf ?? 0)
  const paye = Number(f.montant_paye_xaf ?? 0)
  return {
    ...f,
    id:                f.id as string,
    numero:            f.numero as string,
    statut:            f.statut as string,
    date_emission:     f.date_emission as string,
    date_echeance:     f.date_echeance as string,
    montant_ht_xaf:    Number(f.total_ht_xaf ?? 0),
    montant_tva_xaf:   Number(f.tva_xaf ?? 0),
    montant_ttc_xaf:   ttc,
    montant_paye_xaf:  paye,
    solde_restant_xaf: Math.max(0, ttc - paye),
    client:            { id: f.client_id as string ?? '', nom: f.client_nom as string ?? '' },
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CRÉDITS
// ══════════════════════════════════════════════════════════════════════════════

export async function dbGetCredits(params?: { statut?: string; client_id?: string }) {
  // Auto-échoir les crédits en retard
  const today = new Date().toISOString().slice(0, 10)
  await supabase.from('credits')
    .update({ statut: 'echu', updated_at: new Date().toISOString() })
    .eq('statut', 'en_cours').lt('echeance', today)

  let q = supabase.from('credits').select('*', { count: 'exact' })
  if (params?.statut)    q = q.eq('statut', params.statut)
  if (params?.client_id) q = q.eq('client_id', params.client_id)
  const { data, count, error } = await q.order('echeance')
  if (error) raise(error, 'crédits')
  return { data: data ?? [], total: count ?? 0 }
}

// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD KPIS
// ══════════════════════════════════════════════════════════════════════════════

export async function dbGetDashboardKpis() {
  const now        = new Date()
  const debut6Mois = new Date(now)
  debut6Mois.setMonth(debut6Mois.getMonth() - 5)
  debut6Mois.setDate(1)
  const debut6MoisStr = debut6Mois.toISOString().slice(0, 10)

  // Single RPC call replaces 7 parallel round trips — much faster on cold connections.
  const { data: raw, error } = await supabase.rpc('fn_dashboard_kpis', { debut_6mois: debut6MoisStr })
  if (error) throw new Error(`[dbGetDashboardKpis] ${error.message}`)

  const d = raw as {
    commandes_actives: number
    stocks_en_alerte:  number
    apprenants_actifs: number
    bons_en_attente:   number
    credits_echus:     number
    caisse_ventes_jour_count: number
    caisse_ventes_jour_xaf:   number
    recent_commandes:  { id: string; numero: string; client_nom: string; total_ttc_xaf: number; statut: string; date_commande: string }[]
    ca_data:           { total_ttc_xaf: number; date_commande: string }[]
    recent_mouvements: { id: string; type: 'entree' | 'sortie'; quantite: number; created_at: string; produits: { designation: string; unite: string } | null }[]
  }

  const MOIS_FR = ['Jan','Fév','Mar','Avr','Mai','Jui','Juil','Aoû','Sep','Oct','Nov','Déc']
  const caParMois = new Map<string, { label: string; ca: number }>()
  for (let i = 5; i >= 0; i--) {
    const m = new Date(now); m.setMonth(m.getMonth() - i)
    const cle = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`
    caParMois.set(cle, { label: MOIS_FR[m.getMonth()], ca: 0 })
  }
  for (const cmd of (d.ca_data ?? [])) {
    const cle = cmd.date_commande.slice(0, 7)
    const ex  = caParMois.get(cle)
    if (ex) ex.ca += cmd.total_ttc_xaf
  }

  return {
    ca_mensuel: Array.from(caParMois.values()).map(({ label, ca }) => ({ mois: label, ca: Math.round(ca) })),
    kpis: {
      commandes_actives: d.commandes_actives ?? 0,
      stocks_en_alerte:  d.stocks_en_alerte  ?? 0,
      apprenants_actifs: d.apprenants_actifs ?? 0,
      bons_en_attente:   d.bons_en_attente   ?? 0,
      credits_echus:     d.credits_echus     ?? 0,
      caisse_ventes_jour_count: d.caisse_ventes_jour_count ?? 0,
      caisse_ventes_jour_xaf:   d.caisse_ventes_jour_xaf   ?? 0,
    },
    recent_commandes:  d.recent_commandes  ?? [],
    recent_mouvements: d.recent_mouvements ?? [],
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// EMPLOYÉS
// ══════════════════════════════════════════════════════════════════════════════

export async function dbGetEmployes(params?: { search?: string; statut?: string }) {
  let q = supabase.from('employes').select('*', { count: 'exact' })
  if (params?.statut) q = q.eq('statut', params.statut)
  if (params?.search) q = q.ilike('nom', `%${params.search}%`)
  const { data, count, error } = await q.order('nom')
  if (error) raise(error, 'employés')
  return { data: data ?? [], total: count ?? 0 }
}

export async function dbCreateEmploye(payload: Record<string, unknown>) {
  const { data, error } = await supabase
    .from('employes').insert({ ...payload, sync_status: 'synced' }).select().single()
  if (error) raise(error, 'créer employé')
  return data!
}

// ══════════════════════════════════════════════════════════════════════════════
// APPRENANTS
// ══════════════════════════════════════════════════════════════════════════════

export async function dbGetApprenants(params?: { statut?: string }) {
  let q = supabase.from('apprenants').select('*', { count: 'exact' })
  if (params?.statut) q = q.eq('statut', params.statut)
  const { data, count, error } = await q.order('nom')
  if (error) raise(error, 'apprenants')
  return { data: data ?? [], total: count ?? 0 }
}

export async function dbCreateApprenant(payload: Record<string, unknown>) {
  const { data, error } = await supabase
    .from('apprenants').insert({ ...payload, sync_status: 'synced' }).select().single()
  if (error) raise(error, 'créer apprenant')
  return data!
}

// ══════════════════════════════════════════════════════════════════════════════
// PRÉSENCES & PAIE
// ══════════════════════════════════════════════════════════════════════════════

export async function dbGetPresences(params?: { date?: string; employe_id?: string }) {
  let q = supabase.from('presences').select('*, employes(nom,poste)', { count: 'exact' })
  if (params?.date)       q = q.eq('date', params.date)
  if (params?.employe_id) q = q.eq('employe_id', params.employe_id)
  const { data, count, error } = await q.order('date', { ascending: false })
  if (error) raise(error, 'présences')
  return { data: data ?? [], total: count ?? 0 }
}

export async function dbGetBulletins(mois: string) {
  const { data, count, error } = await supabase
    .from('bulletins_paie')
    .select('*, employes(nom,poste,departement)', { count: 'exact' })
    .eq('mois', mois).order('employe_id')
  if (error) raise(error, 'bulletins paie')
  return { data: data ?? [], total: count ?? 0, mois, deja_genere: (count ?? 0) > 0 }
}

export async function dbGetFormationSessions(params?: { statut?: string; niveau?: number }) {
  let q = supabase.from('formation_sessions').select('*, formation_inscriptions(id)', { count: 'exact' })
  if (params?.statut) q = q.in('statut', params.statut.split(','))
  if (params?.niveau) q = q.eq('niveau', params.niveau)
  const { data, count, error } = await q.order('date_debut', { ascending: true, nullsFirst: false })
  if (error) raise(error, 'sessions formation')
  return {
    data: (data ?? []).map((s: Record<string, unknown>) => ({
      ...s,
      nb_inscrits: Array.isArray(s.formation_inscriptions) ? (s.formation_inscriptions as unknown[]).length : 0,
      formation_inscriptions: undefined,
    })),
    total: count ?? 0,
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// BONS DE SORTIE
// ══════════════════════════════════════════════════════════════════════════════

export async function dbGetBons(params?: { statut?: string }) {
  let q = supabase.from('bons_sortie').select('*, bons_sortie_lignes(*)', { count: 'exact' })
  if (params?.statut) q = q.eq('statut', params.statut)
  const { data, count, error } = await q.order('created_at', { ascending: false })
  if (error) raise(error, 'bons sortie')
  const rows = (data ?? []) as Record<string, unknown>[]
  const preparateurIds = [...new Set(
    rows.map((row) => row.preparateur_id).filter(Boolean) as string[],
  )]
  const preparateurs = new Map<string, Record<string, unknown>>()
  if (preparateurIds.length > 0) {
    const { data: employes, error: employesError } = await supabase
      .from('employes')
      .select('id, nom, poste, departement, telephone, statut')
      .in('id', preparateurIds)
    if (employesError) raise(employesError, 'preparateurs bons sortie')
    for (const employe of employes ?? []) preparateurs.set(employe.id as string, employe as Record<string, unknown>)
  }
  return {
    data: rows.map((row: Record<string, unknown>) => ({
      ...row,
      lignes: row.lignes ?? row.bons_sortie_lignes ?? [],
      preparateur: row.preparateur_id ? preparateurs.get(row.preparateur_id as string) ?? null : null,
    })),
    total: count ?? 0,
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PRODUCTION — JOBS
// ══════════════════════════════════════════════════════════════════════════════

export async function dbGetJobs(params?: { statut?: string; search?: string; commande_id?: string }) {
  let q = supabase.from('jobs_production').select('*', { count: 'exact' })
  if (params?.statut)      q = q.eq('statut', params.statut)
  if (params?.commande_id) q = q.eq('commande_id', params.commande_id)
  if (params?.search)      q = q.ilike('produit_designation', `%${params.search}%`)
  const { data, count, error } = await q.order('created_at', { ascending: false })
  if (error) raise(error, 'jobs production')
  const today = new Date().toISOString().slice(0, 10)
  return {
    data: (data ?? []).map(j => ({
      ...j,
      en_retard: j.date_fin_prevue && j.date_fin_prevue < today &&
                 !['delivered','cancelled'].includes(j.statut),
    })),
    total: count ?? 0,
  }
}

export async function dbUpdateJobAvancement(id: string, avancement_pct: number, userId?: string) {
  const newStatut = avancement_pct === 100 ? 'pret' : undefined
  const updates: Record<string, unknown> = { avancement_pct, updated_at: new Date().toISOString() }
  if (newStatut) { updates.statut = newStatut; updates.date_fin_reelle = new Date().toISOString().slice(0, 10) }

  const { data, error } = await supabase.from('jobs_production').update(updates).eq('id', id).select().single()
  if (error) raise(error, 'avancement job')

  // Auto-transition commande si job passe à 100%
  if (newStatut === 'pret') {
    const job = data as { commande_id?: string } | null
    if (job?.commande_id) {
      const { data: cmd } = await supabase.from('commandes').select('statut').eq('id', job.commande_id).single()
      if (cmd && (cmd as { statut: string }).statut === 'in_production') {
        await supabase.from('commandes')
          .update({ statut: 'pret', updated_at: new Date().toISOString() }).eq('id', job.commande_id)
        await supabase.from('historique_commandes').insert({
          commande_id: job.commande_id, ancien_statut: 'in_production', nouveau_statut: 'pret',
          commentaire: `[Auto] Job à 100%`, changed_by: userId ?? null,
        })
      }
    }
  }
  return data!
}

// ══════════════════════════════════════════════════════════════════════════════
// PROJETS
// ══════════════════════════════════════════════════════════════════════════════

export async function dbGetProjets(params?: { statut?: string; search?: string }) {
  let q = supabase.from('projets').select('*', { count: 'exact' })
  if (params?.statut) q = q.eq('statut', params.statut)
  if (params?.search) q = q.ilike('nom', `%${params.search}%`)
  const { data, count, error } = await q.order('created_at', { ascending: false })
  if (error) raise(error, 'projets')
  return {
    data: (data ?? []).map(p => ({
      ...p, alerte_budget: Number(p.depense_xaf) > Number(p.budget_xaf) && Number(p.budget_xaf) > 0,
    })),
    total: count ?? 0,
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// LIVRAISONS
// ══════════════════════════════════════════════════════════════════════════════

export async function dbGetLivraisons(params?: { statut?: string; search?: string }) {
  let q = supabase.from('livraisons').select('*', { count: 'exact' })
  if (params?.statut) q = q.eq('statut', params.statut)
  if (params?.search) q = q.or(`client_nom.ilike.%${params.search}%,numero.ilike.%${params.search}%`)
  const { data, count, error } = await q.order('created_at', { ascending: false })
  if (error) raise(error, 'livraisons')
  return { data: data ?? [], total: count ?? 0 }
}

// ══════════════════════════════════════════════════════════════════════════════
// CAMPAGNES MARKETING
// ══════════════════════════════════════════════════════════════════════════════

export async function dbGetCampagnes(params?: { statut?: string; search?: string }) {
  let q = supabase.from('campagnes_marketing').select('*', { count: 'exact' })
  if (params?.statut) q = q.eq('statut', params.statut)
  if (params?.search) q = q.ilike('nom', `%${params.search}%`)
  const { data, count, error } = await q.order('created_at', { ascending: false })
  if (error) raise(error, 'campagnes')
  return { data: data ?? [], total: count ?? 0 }
}

// ══════════════════════════════════════════════════════════════════════════════
// UPDATE STATUT GÉNÉRIQUE
// ══════════════════════════════════════════════════════════════════════════════

export async function dbUpdateStatut(
  table: string, id: string, statut: string, extra?: Record<string, unknown>,
) {
  const updates = { statut, updated_at: new Date().toISOString(), ...(extra ?? {}) }
  const { data, error } = await supabase.from(table).update(updates).eq('id', id).select().single()
  if (error) raise(error, `statut ${table}`)
  return data!
}
