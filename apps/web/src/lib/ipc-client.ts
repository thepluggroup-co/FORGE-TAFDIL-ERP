/**
 * FORGE ERP — Couche de données IPC (Electron Desktop)
 *
 * Quand l'app tourne dans Electron, window.forge.db.* est disponible via le
 * preload et donne accès direct à SQLite (peuplé par le sync Supabase).
 *
 * Ce module remplace apiClient pour tous les hooks de lecture/écriture :
 * les SELECT vont vers SQLite, les mutations écrivent dans SQLite ET dans
 * sync_queue pour que le SyncManager les pousse ensuite vers Supabase.
 *
 * Aucune dépendance HTTP, aucun serveur à démarrer.
 */

// ── Détection contexte Electron ───────────────────────────────────────────────

export const isElectron: boolean =
  typeof window !== 'undefined' && 'forge' in window

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ipc = () => (window as any).forge as {
  db: {
    all:     (sql: string, params?: unknown[]) => Promise<unknown[]>
    get:     (sql: string, params?: unknown[]) => Promise<unknown | null>
    execute: (sql: string, params?: unknown[]) => Promise<{ changes: number; lastInsertRowid: number }>
  }
}

// ── Helpers SQL ────────────────────────────────────────────────────────────────

async function all<T>(sql: string, params?: unknown[]): Promise<T[]> {
  return ipc().db.all(sql, params) as Promise<T[]>
}

async function get<T>(sql: string, params?: unknown[]): Promise<T | null> {
  return ipc().db.get(sql, params) as Promise<T | null>
}

async function exec(sql: string, params?: unknown[]) {
  return ipc().db.execute(sql, params)
}

/** Labels acceptés par la contrainte chk_clients_score_fiabilite côté Supabase. */
const SCORE_FIABILITE_LABELS = ['nouveau', 'bon', 'tres_bon', 'vip', 'bloque'] as const
type ScoreFiabilite = typeof SCORE_FIABILITE_LABELS[number]

/** Convertit un score (label ou entier 0-100) en label valide pour la sync Supabase. */
function normalizeScoreFiabilite(value: unknown): ScoreFiabilite {
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

function now() { return new Date().toISOString() }
function uid() { return crypto.randomUUID() }

/** Enqueue une opération pour sync vers Supabase */
async function enqueueSync(
  table: string,
  operation: 'INSERT' | 'UPDATE' | 'DELETE',
  recordId: string,
  payload: Record<string, unknown>,
) {
  await exec(
    `INSERT INTO sync_queue (table_name, operation, record_id, payload)
     VALUES (?, ?, ?, ?)`,
    [table, operation, recordId, JSON.stringify(payload)],
  )
}

// Filtre LIKE SQLite
function like(val: string | undefined, col: string, params: unknown[]): string {
  if (!val) return ''
  params.push(`%${val}%`)
  return ` AND ${col} LIKE ?`
}

// ══════════════════════════════════════════════════════════════════════════════
// PRODUITS / STOCKS
// ══════════════════════════════════════════════════════════════════════════════

export interface IpcProduit {
  id: string
  ref: string
  designation: string
  categorie: string
  unite: string
  stock_actuel: number
  stock_min: number
  stock_critique: number
  prix_unitaire_xaf: number
  statut: 'normal' | 'alerte' | 'critique' | 'rupture'
  updated_at: string | null
}

export async function ipcGetProduits(params?: {
  search?: string; categorie?: string; statut?: string
}): Promise<{ data: IpcProduit[]; total: number }> {
  const p: unknown[] = []
  let where = 'WHERE 1=1'
  if (params?.categorie) { where += ' AND categorie = ?'; p.push(params.categorie) }
  if (params?.statut)    { where += ' AND statut = ?'; p.push(params.statut) }
  if (params?.search)    { where += like(params.search, 'designation', p); where += like(params.search, 'ref', p) }

  const data = await all<IpcProduit>(
    `SELECT id, ref, designation, categorie, unite,
            stock_actuel, COALESCE(stock_min,5) as stock_min,
            COALESCE(stock_critique,2) as stock_critique,
            COALESCE(prix_unitaire_xaf, 0) as prix_unitaire_xaf,
            statut, updated_at
     FROM produits ${where}
     ORDER BY designation`, p,
  )
  return { data, total: data.length }
}

export async function ipcGetAlertesProduits(): Promise<{ data: IpcProduit[]; total: number }> {
  const data = await all<IpcProduit>(
    `SELECT * FROM produits WHERE statut IN ('alerte','critique','rupture') ORDER BY stock_actuel ASC`,
  )
  return { data, total: data.length }
}

export async function ipcCreateProduit(payload: Omit<IpcProduit, 'id' | 'statut' | 'updated_at'>) {
  const id = uid()
  const statut = payload.stock_actuel === 0 ? 'rupture'
    : payload.stock_actuel <= payload.stock_critique ? 'critique'
    : payload.stock_actuel <= payload.stock_min ? 'alerte'
    : 'normal'
  const ts = now()
  await exec(
    `INSERT INTO produits (id, ref, designation, categorie, unite, stock_actuel, stock_min, stock_critique, prix_unitaire_xaf, statut, sync_status, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?)`,
    [id, payload.ref, payload.designation, payload.categorie, payload.unite,
     payload.stock_actuel, payload.stock_min, payload.stock_critique,
     payload.prix_unitaire_xaf, statut, ts],
  )
  await enqueueSync('produits', 'INSERT', id, { id, ...payload, statut, sync_status: 'pending', updated_at: ts })
  return { id, ...payload, statut, updated_at: ts }
}

export async function ipcMouvementStock(
  produitId: string,
  type: 'entree' | 'sortie' | 'ajustement',
  quantite: number,
  notes?: string,
) {
  const produit = await get<IpcProduit>('SELECT * FROM produits WHERE id = ?', [produitId])
  if (!produit) throw new Error('Produit introuvable')

  let nouvelleQte: number
  if (type === 'ajustement') nouvelleQte = quantite
  else if (type === 'entree') nouvelleQte = produit.stock_actuel + quantite
  else {
    if (produit.stock_actuel < quantite) throw new Error(`Stock insuffisant : ${produit.stock_actuel} disponible`)
    nouvelleQte = produit.stock_actuel - quantite
  }

  const statut = nouvelleQte === 0 ? 'rupture'
    : nouvelleQte <= produit.stock_critique ? 'critique'
    : nouvelleQte <= produit.stock_min ? 'alerte' : 'normal'

  await exec('UPDATE produits SET stock_actuel=?, statut=?, updated_at=?, sync_status=? WHERE id=?',
    [nouvelleQte, statut, now(), 'pending', produitId])
  await enqueueSync('produits', 'UPDATE', produitId,
    { id: produitId, stock_actuel: nouvelleQte, statut, updated_at: now() })
  return { stock_actuel: nouvelleQte, statut }
}

// ══════════════════════════════════════════════════════════════════════════════
// CLIENTS
// ══════════════════════════════════════════════════════════════════════════════

export interface IpcClient {
  id: string
  nom: string
  type: string
  telephone: string | null
  email: string | null
  adresse: string | null
  ville: string | null
  pays: string | null
  statut: string
  score_fiabilite: number
  commandes_count: number
  total_ca_xaf: number
  encours_credit_xaf: number
  notes: string | null
}

export async function ipcGetClients(params?: {
  search?: string; statut?: string; type?: string
}): Promise<{ data: IpcClient[]; total: number }> {
  const p: unknown[] = []
  let where = 'WHERE 1=1'
  if (params?.statut) { where += ' AND statut = ?'; p.push(params.statut) }
  if (params?.type)   { where += ' AND type = ?'; p.push(params.type) }
  if (params?.search) {
    const s = `%${params.search}%`; p.push(s, s, s)
    where += ' AND (nom LIKE ? OR telephone LIKE ? OR email LIKE ?)'
  }
  const data = await all<IpcClient>(
    `SELECT id, nom, type, telephone, email, adresse, ville, pays,
            COALESCE(statut,'actif') as statut,
            COALESCE(score_fiabilite,50) as score_fiabilite,
            COALESCE(commandes_count,0) as commandes_count,
            COALESCE(total_ca_xaf,0) as total_ca_xaf,
            COALESCE(encours_credit_xaf,0) as encours_credit_xaf, notes
     FROM clients ${where} ORDER BY nom`, p,
  )
  return { data, total: data.length }
}

export async function ipcCreateClient(payload: Omit<IpcClient, 'id' | 'commandes_count' | 'total_ca_xaf' | 'encours_credit_xaf'>) {
  const id = uid(); const ts = now()
  const scoreLabel = normalizeScoreFiabilite(payload.score_fiabilite)
  await exec(
    `INSERT INTO clients (id, nom, type, telephone, email, adresse, ville, pays, statut, score_fiabilite, notes, sync_status, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?)`,
    [id, payload.nom, payload.type, payload.telephone ?? null, payload.email ?? null,
     payload.adresse ?? null, payload.ville ?? null, payload.pays ?? 'Cameroun',
     payload.statut ?? 'actif', payload.score_fiabilite ?? 50, payload.notes ?? null, ts],
  )
  // Le payload poussé vers Supabase doit respecter la contrainte CHECK
  // chk_clients_score_fiabilite (5 labels TEXT), d'où la conversion.
  await enqueueSync('clients', 'INSERT', id, {
    id, ...payload,
    score_fiabilite: scoreLabel,
    sync_status: 'pending',
    updated_at: ts,
  })
  return { id, ...payload, score_fiabilite: scoreLabel, commandes_count: 0, total_ca_xaf: 0, encours_credit_xaf: 0, updated_at: ts }
}

// ══════════════════════════════════════════════════════════════════════════════
// COMMANDES
// ══════════════════════════════════════════════════════════════════════════════

export interface IpcCommande {
  id: string
  reference: string   // = numero
  statut: string
  date_commande: string | null
  date_livraison_prevue: string | null
  montant_ttc_xaf: number
  acompte_recu_xaf: number
  solde_restant_xaf: number
  notes: string | null
  client: { id: string; nom: string; telephone: string }
  lignes: Array<{ designation: string; quantite: number; prix_unitaire_ht_xaf: number; unite: string }>
  historique: Array<{ statut: string; created_at: string; commentaire: string | null }>
}

export async function ipcGetCommandes(params?: {
  statut?: string; search?: string
}): Promise<{ data: IpcCommande[]; total: number }> {
  const p: unknown[] = []
  let where = 'WHERE 1=1'
  if (params?.statut) { where += ' AND c.statut = ?'; p.push(params.statut) }
  if (params?.search) {
    const s = `%${params.search}%`; p.push(s, s)
    where += ' AND (c.numero LIKE ? OR c.client_nom LIKE ?)'
  }

  const rows = await all<Record<string, unknown>>(
    `SELECT c.id, c.numero, c.client_id, c.client_nom, c.statut,
            COALESCE(c.total_ttc_xaf,0) as total_ttc_xaf,
            COALESCE(c.acompte_recu_xaf,0) as acompte_recu_xaf,
            c.date_commande, c.date_livraison_prevue, c.notes
     FROM commandes c ${where}
     ORDER BY c.created_at DESC`, p,
  )

  const data: IpcCommande[] = await Promise.all(rows.map(async (r) => {
    const lignes = await all<Record<string, unknown>>(
      `SELECT designation, quantite, prix_unitaire_ht_xaf, COALESCE(unite,'unité') as unite
       FROM commandes_lignes WHERE commande_id = ?`, [r.id],
    )
    const ttc = Number(r.total_ttc_xaf ?? 0)
    const acompte = Number(r.acompte_recu_xaf ?? 0)
    return {
      id:                    r.id as string,
      reference:             r.numero as string,
      statut:                r.statut as string,
      date_commande:         r.date_commande as string | null,
      date_livraison_prevue: r.date_livraison_prevue as string | null,
      montant_ttc_xaf:       ttc,
      acompte_recu_xaf:      acompte,
      solde_restant_xaf:     Math.max(0, ttc - acompte),
      notes:                 r.notes as string | null,
      client:                { id: r.client_id as string ?? '', nom: r.client_nom as string ?? '', telephone: '' },
      lignes:                lignes as IpcCommande['lignes'],
      historique:            [],
    }
  }))

  return { data, total: data.length }
}

// ══════════════════════════════════════════════════════════════════════════════
// DEVIS
// ══════════════════════════════════════════════════════════════════════════════

export interface IpcDevis {
  id: string
  reference: string   // = numero
  statut: string
  date_creation: string | null
  date_validite: string | null
  validite_jours: number
  acompte_pct: number
  conditions_paiement: string
  montant_ttc_xaf: number
  pdf_url: string | null
  expire: boolean
  client: { id: string; nom: string; telephone: string | null; email: string | null }
  lignes: Array<{ id: string; designation: string; categorie: string; quantite: number; prix_unitaire_ht_xaf: number }>
}

export async function ipcGetDevis(params?: {
  statut?: string; search?: string
}): Promise<{ data: IpcDevis[]; total: number }> {
  const p: unknown[] = []
  let where = 'WHERE 1=1'
  if (params?.statut) { where += ' AND statut = ?'; p.push(params.statut) }
  if (params?.search) {
    const s = `%${params.search}%`; p.push(s, s)
    where += ' AND (numero LIKE ? OR client_nom LIKE ?)'
  }

  const rows = await all<Record<string, unknown>>(
    `SELECT id, numero, client_id, client_nom, statut, date_emission, date_validite,
            COALESCE(validite_jours,30) as validite_jours,
            COALESCE(acompte_pct,0) as acompte_pct,
            COALESCE(conditions_paiement,'Virement bancaire') as conditions_paiement,
            COALESCE(total_ttc_xaf,0) as total_ttc_xaf
     FROM devis ${where} ORDER BY created_at DESC`, p,
  )

  const today = new Date().toISOString().slice(0, 10)
  const data: IpcDevis[] = await Promise.all(rows.map(async (r) => {
    const lignes = await all<Record<string, unknown>>(
      `SELECT id, designation, COALESCE(categorie,'materiaux') as categorie,
              quantite, prix_unitaire_ht_xaf
       FROM devis_lignes WHERE devis_id = ?`, [r.id],
    )
    const dateV = r.date_validite as string | null
    return {
      id:                  r.id as string,
      reference:           r.numero as string,
      statut:              r.statut as string,
      date_creation:       r.date_emission as string | null,
      date_validite:       dateV,
      validite_jours:      Number(r.validite_jours),
      acompte_pct:         Number(r.acompte_pct),
      conditions_paiement: r.conditions_paiement as string,
      montant_ttc_xaf:     Number(r.total_ttc_xaf ?? 0),
      pdf_url:             null,
      expire:              !!dateV && dateV < today,
      client:              { id: r.client_id as string ?? '', nom: r.client_nom as string ?? '', telephone: null, email: null },
      lignes:              lignes as IpcDevis['lignes'],
    }
  }))

  return { data, total: data.length }
}

// ══════════════════════════════════════════════════════════════════════════════
// FACTURES
// ══════════════════════════════════════════════════════════════════════════════

export interface IpcFacture {
  id: string
  numero: string
  statut: string
  date_emission: string | null
  date_echeance: string | null
  montant_ht_xaf: number
  montant_tva_xaf: number
  montant_ttc_xaf: number
  montant_paye_xaf: number
  solde_restant_xaf: number
  client: { id: string; nom: string }
  lignes: Array<{ designation: string; quantite: number; prix_unitaire_ht_xaf: number }>
}

export async function ipcGetFactures(params?: { statut?: string }): Promise<{ data: IpcFacture[]; total: number }> {
  const p: unknown[] = []
  let where = 'WHERE 1=1'
  if (params?.statut) { where += ' AND statut = ?'; p.push(params.statut) }

  const rows = await all<Record<string, unknown>>(
    `SELECT id, numero, client_id, client_nom, statut, date_emission, date_echeance,
            COALESCE(total_ht_xaf,0) as total_ht_xaf,
            COALESCE(tva_xaf,0) as tva_xaf,
            COALESCE(total_ttc_xaf,0) as total_ttc_xaf,
            COALESCE(montant_paye_xaf,0) as montant_paye_xaf
     FROM factures ${where} ORDER BY created_at DESC`, p,
  )

  const data: IpcFacture[] = rows.map((r) => {
    const ttc  = Number(r.total_ttc_xaf ?? 0)
    const paye = Number(r.montant_paye_xaf ?? 0)
    return {
      id:                r.id as string,
      numero:            r.numero as string,
      statut:            r.statut as string,
      date_emission:     r.date_emission as string | null,
      date_echeance:     r.date_echeance as string | null,
      montant_ht_xaf:    Number(r.total_ht_xaf ?? 0),
      montant_tva_xaf:   Number(r.tva_xaf ?? 0),
      montant_ttc_xaf:   ttc,
      montant_paye_xaf:  paye,
      solde_restant_xaf: Math.max(0, ttc - paye),
      client:            { id: r.client_id as string ?? '', nom: r.client_nom as string ?? '' },
      lignes:            [],
    }
  })

  return { data, total: data.length }
}

// ══════════════════════════════════════════════════════════════════════════════
// EMPLOYÉS
// ══════════════════════════════════════════════════════════════════════════════

export async function ipcGetEmployes(params?: { search?: string; statut?: string }) {
  const p: unknown[] = []
  let where = 'WHERE 1=1'
  if (params?.statut) { where += ' AND statut = ?'; p.push(params.statut) }
  if (params?.search) { where += like(params.search, 'nom', p) }

  const data = await all<Record<string, unknown>>(
    `SELECT id, nom, poste, departement, type_contrat, date_entree,
            COALESCE(salaire_base_xaf,0) as salaire_base_xaf,
            COALESCE(statut,'actif') as statut,
            telephone, email, cin, cnps
     FROM employes ${where} ORDER BY nom`, p,
  )
  return { data, total: data.length }
}

export async function ipcCreateEmploye(payload: Record<string, unknown>) {
  const id = uid(); const ts = now()
  await exec(
    `INSERT INTO employes (id, nom, poste, departement, type_contrat, date_entree, salaire_base_xaf, statut, telephone, email, cin, cnps, sync_status, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pending',?)`,
    [id, payload.nom, payload.poste, payload.departement, payload.type_contrat,
     payload.date_entree, payload.salaire_base_xaf ?? 0,
     payload.statut ?? 'actif', payload.telephone ?? null, payload.email ?? null,
     payload.cin ?? null, payload.cnps ?? null, ts],
  )
  await enqueueSync('employes', 'INSERT', id, { id, ...payload, sync_status: 'pending', updated_at: ts })
  return { id, ...payload, updated_at: ts }
}

// ══════════════════════════════════════════════════════════════════════════════
// APPRENANTS
// ══════════════════════════════════════════════════════════════════════════════

export async function ipcGetApprenants(params?: { statut?: string }) {
  const p: unknown[] = []
  let where = 'WHERE 1=1'
  if (params?.statut) { where += ' AND statut = ?'; p.push(params.statut) }
  const data = await all<Record<string, unknown>>(
    `SELECT id, nom, specialite, COALESCE(niveau,1) as niveau,
            COALESCE(duree_mois,0) as duree_mois,
            COALESCE(statut,'actif') as statut, notes
     FROM apprenants ${where} ORDER BY nom`, p,
  )
  return { data, total: data.length }
}

export async function ipcCreateApprenant(payload: Record<string, unknown>) {
  const id = uid(); const ts = now()
  await exec(
    `INSERT INTO apprenants (id, nom, specialite, niveau, duree_mois, statut, notes, sync_status, updated_at)
     VALUES (?,?,?,?,?,?,?,'pending',?)`,
    [id, payload.nom, payload.specialite, payload.niveau ?? 1,
     payload.duree_mois ?? 0, payload.statut ?? 'actif', payload.notes ?? null, ts],
  )
  await enqueueSync('apprenants', 'INSERT', id, { id, ...payload, sync_status: 'pending', updated_at: ts })
  return { id, ...payload, updated_at: ts }
}

// ══════════════════════════════════════════════════════════════════════════════
// JOBS PRODUCTION
// ══════════════════════════════════════════════════════════════════════════════

export async function ipcGetJobs(params?: { statut?: string; search?: string }) {
  const p: unknown[] = []
  let where = 'WHERE 1=1'
  if (params?.statut) { where += ' AND statut = ?'; p.push(params.statut) }
  if (params?.search) { where += like(params.search, 'produit_designation', p) }
  const today = new Date().toISOString().slice(0, 10)
  const data = await all<Record<string, unknown>>(
    `SELECT id, numero, commande_id, produit_designation, machine_nom, technicien_nom,
            COALESCE(avancement_pct,0) as avancement_pct, statut,
            date_debut, date_fin_prevue, date_fin_reelle, notes, created_at
     FROM jobs_production ${where} ORDER BY created_at DESC`, p,
  )
  return {
    data: data.map(j => ({
      ...j,
      en_retard: j.date_fin_prevue && (j.date_fin_prevue as string) < today
        && !['delivered','cancelled'].includes(j.statut as string),
    })),
    total: data.length,
  }
}

export async function ipcUpdateJobAvancement(id: string, avancement_pct: number) {
  const ts = now()
  const newStatut = avancement_pct === 100 ? 'pret' : undefined
  const updates = newStatut
    ? 'avancement_pct=?, statut=?, date_fin_reelle=?, updated_at=?, sync_status=?'
    : 'avancement_pct=?, updated_at=?, sync_status=?'
  const params = newStatut
    ? [avancement_pct, newStatut, ts.slice(0,10), ts, 'pending', id]
    : [avancement_pct, ts, 'pending', id]
  await exec(`UPDATE jobs_production SET ${updates} WHERE id=?`, params)
  await enqueueSync('jobs_production', 'UPDATE', id, { id, avancement_pct, statut: newStatut, updated_at: ts })
  return { id, avancement_pct, statut: newStatut }
}

// ══════════════════════════════════════════════════════════════════════════════
// PROJETS
// ══════════════════════════════════════════════════════════════════════════════

export async function ipcGetProjets(params?: { statut?: string; search?: string }) {
  const p: unknown[] = []
  let where = 'WHERE 1=1'
  if (params?.statut) { where += ' AND statut = ?'; p.push(params.statut) }
  if (params?.search) { where += like(params.search, 'nom', p) }
  const data = await all<Record<string, unknown>>(
    `SELECT id, nom, description, client_nom, chef_projet_nom,
            COALESCE(budget_xaf,0) as budget_xaf,
            COALESCE(depense_xaf,0) as depense_xaf,
            COALESCE(avancement_pct,0) as avancement_pct,
            COALESCE(statut,'planifie') as statut, date_debut, deadline, created_at
     FROM projets ${where} ORDER BY created_at DESC`, p,
  )
  return {
    data: data.map(p => ({
      ...p,
      alerte_budget: Number(p.depense_xaf) > Number(p.budget_xaf) && Number(p.budget_xaf) > 0,
    })),
    total: data.length,
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// LIVRAISONS
// ══════════════════════════════════════════════════════════════════════════════

export async function ipcGetLivraisons(params?: { statut?: string; search?: string }) {
  const p: unknown[] = []
  let where = 'WHERE 1=1'
  if (params?.statut) { where += ' AND statut = ?'; p.push(params.statut) }
  if (params?.search) { where += like(params.search, 'client_nom', p) }
  const data = await all<Record<string, unknown>>(
    `SELECT id, numero, client_id, client_nom, destination, transporteur,
            COALESCE(statut,'confirmed') as statut,
            date_depart, date_livraison_prevue, created_at
     FROM livraisons ${where} ORDER BY created_at DESC`, p,
  )
  return { data, total: data.length }
}

// ══════════════════════════════════════════════════════════════════════════════
// BONS DE SORTIE
// ══════════════════════════════════════════════════════════════════════════════

export async function ipcGetBons(params?: { statut?: string }) {
  const p: unknown[] = []
  let where = 'WHERE 1=1'
  if (params?.statut) { where += ' AND statut = ?'; p.push(params.statut) }
  const rows = await all<Record<string, unknown>>(
    `SELECT id, numero, statut, demandeur, motif, notes, created_at
     FROM bons_sortie ${where} ORDER BY created_at DESC`, p,
  )
  const data = await Promise.all(rows.map(async (b) => {
    const lignes = await all(
      `SELECT produit_id, designation, COALESCE(unite,'unité') as unite,
              quantite_demandee as quantite, quantite_servie
       FROM bons_sortie_lignes WHERE bon_id = ?`, [b.id],
    )
    return { ...b, lignes }
  }))
  return { data, total: data.length }
}

// ══════════════════════════════════════════════════════════════════════════════
// CAMPAGNES MARKETING
// ══════════════════════════════════════════════════════════════════════════════

export async function ipcGetCampagnes(params?: { statut?: string; search?: string }) {
  const p: unknown[] = []
  let where = 'WHERE 1=1'
  if (params?.statut) { where += ' AND statut = ?'; p.push(params.statut) }
  if (params?.search) { where += like(params.search, 'nom', p) }
  const data = await all<Record<string, unknown>>(
    `SELECT id, nom, description, canal,
            COALESCE(budget_xaf,0) as budget_xaf,
            COALESCE(reach,0) as reach,
            COALESCE(leads_count,0) as leads_count,
            COALESCE(conversions_count,0) as conversions_count,
            COALESCE(statut,'planifie') as statut, date_debut, date_fin, created_at
     FROM campagnes_marketing ${where} ORDER BY created_at DESC`, p,
  )
  return { data, total: data.length }
}

// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD KPIS (calculés depuis SQLite)
// ══════════════════════════════════════════════════════════════════════════════

export async function ipcGetDashboardKpis() {
  const [
    commandesActif,
    alertesStock,
    apprenantsActifs,
    bonsEnAttente,
    creditsEchus,
    recentCommandes,
    caParMois,
  ] = await Promise.all([
    get<{ n: number }>(`SELECT COUNT(*) as n FROM commandes WHERE statut IN ('confirmed','in_production','pret')`),
    get<{ n: number }>(`SELECT COUNT(*) as n FROM produits WHERE statut IN ('alerte','critique','rupture')`),
    get<{ n: number }>(`SELECT COUNT(*) as n FROM apprenants WHERE statut = 'actif'`),
    get<{ n: number }>(`SELECT COUNT(*) as n FROM bons_sortie WHERE statut = 'soumis'`),
    get<{ n: number }>(`SELECT COUNT(*) as n FROM credits WHERE statut = 'echu'`).catch(() => ({ n: 0 })),
    all<Record<string, unknown>>(
      `SELECT id, numero, client_nom, COALESCE(total_ttc_xaf,0) as total_ttc_xaf, statut, date_commande
       FROM commandes ORDER BY created_at DESC LIMIT 5`,
    ),
    all<{ mois: string; ca: number }>(
      `SELECT strftime('%Y-%m', date_commande) as mois, SUM(COALESCE(total_ttc_xaf,0)) as ca
       FROM commandes
       WHERE statut != 'cancelled'
         AND date_commande >= date('now', '-6 months')
       GROUP BY mois ORDER BY mois ASC`,
    ),
  ])

  const MOIS_FR: Record<string, string> = {
    '01':'Jan','02':'Fév','03':'Mar','04':'Avr','05':'Mai','06':'Jui',
    '07':'Juil','08':'Aoû','09':'Sep','10':'Oct','11':'Nov','12':'Déc',
  }

  const ca_mensuel = caParMois.map(r => ({
    mois: MOIS_FR[r.mois?.slice(5, 7) ?? ''] ?? r.mois,
    ca:   Math.round(Number(r.ca ?? 0)),
  }))

  return {
    ca_mensuel,
    kpis: {
      commandes_actives: commandesActif?.n ?? 0,
      stocks_en_alerte:  alertesStock?.n ?? 0,
      apprenants_actifs: apprenantsActifs?.n ?? 0,
      bons_en_attente:   bonsEnAttente?.n ?? 0,
      credits_echus:     (creditsEchus as { n: number } | null)?.n ?? 0,
    },
    recent_commandes:  recentCommandes,
    recent_mouvements: [],
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// UTILITAIRES MUTATION COMMUNES
// ══════════════════════════════════════════════════════════════════════════════

/** Met à jour le statut d'un enregistrement dans une table SQLite + sync_queue */
export async function ipcUpdateStatut(
  table: string,
  id: string,
  statut: string,
  extra?: Record<string, unknown>,
) {
  const ts = now()
  const extraFields = extra
    ? Object.keys(extra).map(k => `${k}=?`).join(', ') + ', '
    : ''
  const extraValues = extra ? Object.values(extra) : []
  await exec(
    `UPDATE ${table} SET ${extraFields}statut=?, updated_at=?, sync_status='pending' WHERE id=?`,
    [...extraValues, statut, ts, id],
  )
  await enqueueSync(table, 'UPDATE', id, { id, statut, ...extra, updated_at: ts })
  return { id, statut, updated_at: ts }
}
