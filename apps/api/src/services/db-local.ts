/**
 * Accès SQLite local pour l'API embarquée Electron.
 *
 * Lecture  : fallback quand Supabase est injoignable.
 * Écriture : stocke les mutations offline dans les tables locales
 *            ET dans sync_queue (push automatique par SyncManager dès la reconnexion).
 *
 * Le chemin de la base est transmis par le main Electron via SQLITE_PATH.
 * SQLite est ouvert en WAL (par le main process) → lectures/écritures
 * concurrentes entre le main et ce processus enfant sont safe.
 */

import { randomUUID } from 'node:crypto'

// ── Singleton ──────────────────────────────────────────────────────────────────

let db: import('better-sqlite3').Database | null = null

function getDb(): import('better-sqlite3').Database | null {
  if (db) return db
  const sqlitePath = process.env.SQLITE_PATH
  if (!sqlitePath) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterSQLite = require('better-sqlite3')
    const instance: import('better-sqlite3').Database = new BetterSQLite(sqlitePath)
    db = instance
    instance.pragma('journal_mode = WAL')
    instance.pragma('foreign_keys = ON')
    console.info('[db-local] SQLite ouvert (rw):', sqlitePath)
    return db
  } catch (e) {
    console.warn('[db-local] Impossible d\'ouvrir SQLite:', e)
    return null
  }
}

export function isAvailable(): boolean {
  return getDb() !== null
}

// ── Lecture ────────────────────────────────────────────────────────────────────

export function localQuery<T = Record<string, unknown>>(
  sql: string, params: unknown[] = [],
): T[] {
  try { return (getDb()?.prepare(sql).all(...params) ?? []) as T[] }
  catch (e) { console.warn('[db-local] query:', e); return [] }
}

export function localGet<T = Record<string, unknown>>(
  sql: string, params: unknown[] = [],
): T | null {
  try { return (getDb()?.prepare(sql).get(...params) as T) ?? null }
  catch (e) { console.warn('[db-local] get:', e); return null }
}

// ── Écriture ───────────────────────────────────────────────────────────────────

/**
 * Insère un enregistrement dans une table SQLite locale.
 * Génère un id UUID si absent. Retourne l'enregistrement complet.
 */
export function localInsert<T extends Record<string, unknown>>(
  table: string,
  record: T,
): T & { id: string } {
  const d = getDb()
  if (!d) throw new Error('SQLite non disponible')

  const row = { id: randomUUID(), ...record } as T & { id: string }
  const cols = Object.keys(row)
  const placeholders = cols.map(() => '?').join(', ')
  d.prepare(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`
  ).run(...cols.map(c => row[c] ?? null))

  return row
}

/**
 * Met à jour un enregistrement dans SQLite.
 */
export function localUpdate(
  table: string,
  id: string,
  updates: Record<string, unknown>,
): void {
  const d = getDb()
  if (!d) throw new Error('SQLite non disponible')

  const cols = Object.keys(updates)
  if (cols.length === 0) return
  const setClause = cols.map(c => `${c} = ?`).join(', ')
  d.prepare(
    `UPDATE ${table} SET ${setClause} WHERE id = ?`
  ).run(...cols.map(c => updates[c] ?? null), id)
}

/**
 * Enfile une opération dans sync_queue pour que SyncManager
 * la pousse vers Supabase dès que la connexion revient.
 */
export function enqueueSync(
  table: string,
  operation: 'INSERT' | 'UPDATE' | 'DELETE',
  recordId: string,
  payload: Record<string, unknown>,
): void {
  const d = getDb()
  if (!d) return
  try {
    d.prepare(
      `INSERT INTO sync_queue (table_name, operation, record_id, payload, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    ).run(table, operation, recordId, JSON.stringify(payload))
  } catch (e) {
    console.warn('[db-local] enqueueSync error:', e)
  }
}

/**
 * Génère un numéro séquentiel offline par préfixe.
 * Utilise une table _offline_counters dans SQLite.
 * Exemple : offlineNumero('FAC') → "FAC-OFF-2026-0001"
 */
export function offlineNumero(prefix: string): string {
  const d = getDb()
  if (!d) return `${prefix}-OFF-${Date.now()}`

  // Créer la table compteur si absente
  d.exec(`
    CREATE TABLE IF NOT EXISTS _offline_counters (
      prefix TEXT PRIMARY KEY,
      seq    INTEGER NOT NULL DEFAULT 0
    )
  `)
  d.prepare(
    `INSERT INTO _offline_counters (prefix, seq) VALUES (?, 0)
     ON CONFLICT(prefix) DO NOTHING`
  ).run(prefix)
  const row = d.prepare(
    `UPDATE _offline_counters SET seq = seq + 1 WHERE prefix = ? RETURNING seq`
  ).get(prefix) as { seq: number } | undefined

  const seq  = row?.seq ?? Date.now()
  const year = new Date().getFullYear()
  return `${prefix}-OFF-${year}-${String(seq).padStart(4, '0')}`
}

// ── Méthodes métier — Lecture ──────────────────────────────────────────────────

export function getProduitsLocal(opts: { search?: string; statut?: string } = {}) {
  let sql = `SELECT * FROM produits WHERE 1=1`
  const p: unknown[] = []
  if (opts.statut) { sql += ` AND statut = ?`; p.push(opts.statut) }
  if (opts.search) { sql += ` AND (designation LIKE ? OR ref LIKE ?)`; p.push(`%${opts.search}%`, `%${opts.search}%`) }
  sql += ` ORDER BY designation LIMIT 500`
  const rows = localQuery(sql, p)
  return { data: rows, total: rows.length, offline: true }
}

export function getClientsLocal(opts: { search?: string } = {}) {
  let sql = `SELECT * FROM clients WHERE 1=1`
  const p: unknown[] = []
  if (opts.search) { sql += ` AND nom LIKE ?`; p.push(`%${opts.search}%`) }
  sql += ` ORDER BY nom LIMIT 500`
  const rows = localQuery(sql, p)
  return { data: rows, total: rows.length, offline: true }
}

export function getCommandesLocal(opts: { statut?: string } = {}) {
  let sql = `SELECT * FROM commandes WHERE 1=1`
  const p: unknown[] = []
  if (opts.statut) { sql += ` AND statut = ?`; p.push(opts.statut) }
  sql += ` ORDER BY updated_at DESC LIMIT 200`
  const rows = localQuery(sql, p)
  return { data: rows, total: rows.length, offline: true }
}

export function getFacturesLocal(opts: { statut?: string } = {}) {
  let sql = `SELECT * FROM factures WHERE 1=1`
  const p: unknown[] = []
  if (opts.statut) { sql += ` AND statut = ?`; p.push(opts.statut) }
  sql += ` ORDER BY updated_at DESC LIMIT 200`
  const rows = localQuery(sql, p)
  return { data: rows, total: rows.length, offline: true }
}

export function getCreditsLocal(opts: { statut?: string } = {}) {
  let sql = `SELECT * FROM credits WHERE 1=1`
  const p: unknown[] = []
  if (opts.statut) { sql += ` AND statut = ?`; p.push(opts.statut) }
  sql += ` ORDER BY echeance ASC LIMIT 200`
  const rows = localQuery(sql, p)
  return { data: rows, total: rows.length, offline: true }
}

export function getBonsSortieLocal(opts: { statut?: string } = {}) {
  let sql = `SELECT * FROM bons_sortie WHERE 1=1`
  const p: unknown[] = []
  if (opts.statut) { sql += ` AND statut = ?`; p.push(opts.statut) }
  sql += ` ORDER BY updated_at DESC LIMIT 200`
  const rows = localQuery(sql, p)
  return { data: rows, total: rows.length, offline: true }
}

// ── Méthodes métier — Écriture offline ────────────────────────────────────────

const NOW = () => new Date().toISOString()

/** Enregistre un mouvement de stock offline et met à jour le stock SQLite. */
export function localMouvement(opts: {
  produit_id: string
  type:       'entree' | 'sortie' | 'ajustement'
  quantite:   number
  reference?: string
  notes?:     string
  user_id?:   string
}): Record<string, unknown> {
  const d = getDb()
  if (!d) throw new Error('SQLite non disponible')

  // Lire le stock actuel depuis SQLite
  const produit = localGet<{ stock_actuel: number; stock_min: number; stock_critique: number }>(
    'SELECT stock_actuel, stock_min, stock_critique FROM produits WHERE id = ?',
    [opts.produit_id],
  )

  let nouvelle_qte: number
  if (!produit) {
    nouvelle_qte = opts.type === 'entree' ? opts.quantite : 0
  } else if (opts.type === 'ajustement') {
    nouvelle_qte = opts.quantite
  } else if (opts.type === 'entree') {
    nouvelle_qte = (produit.stock_actuel ?? 0) + opts.quantite
  } else {
    nouvelle_qte = Math.max(0, (produit.stock_actuel ?? 0) - opts.quantite)
  }

  const now = NOW()

  // Insérer mouvement
  const mvtId = randomUUID()
  const mvt = {
    id:         mvtId,
    produit_id: opts.produit_id,
    type:       opts.type,
    quantite:   opts.quantite,
    reference:  opts.reference ?? null,
    notes:      opts.notes ?? null,
    created_by: opts.user_id ?? null,
    created_at: now,
    sync_status:'pending',
  }
  localInsert('mouvements_stock', mvt)
  enqueueSync('mouvements_stock', 'INSERT', mvtId, mvt)

  // Mettre à jour le stock du produit
  localUpdate('produits', opts.produit_id, {
    stock_actuel: nouvelle_qte,
    updated_at:   now,
    sync_status:  'pending',
  })
  enqueueSync('produits', 'UPDATE', opts.produit_id, {
    id:           opts.produit_id,
    stock_actuel: nouvelle_qte,
    updated_at:   now,
  })

  return { ...mvt, produit: { id: opts.produit_id, stock_actuel: nouvelle_qte } }
}

/** Crée un bon de sortie offline avec ses lignes. */
export function localCreateBon(opts: {
  demandeur: string
  motif:     string
  notes?:    string
  lignes:    Array<{ produit_id?: string; designation: string; unite: string; quantite_demandee: number }>
  user_id?:  string
}): Record<string, unknown> {
  const now    = NOW()
  const bonId  = randomUUID()
  const numero = offlineNumero('TAF')

  const bon = {
    id:          bonId,
    numero,
    statut:      'soumis',
    demandeur:   opts.demandeur,
    motif:       opts.motif,
    notes:       opts.notes ?? null,
    created_by:  opts.user_id ?? null,
    created_at:  now,
    updated_at:  now,
    sync_status: 'pending',
  }
  localInsert('bons_sortie', bon)
  enqueueSync('bons_sortie', 'INSERT', bonId, bon)

  const lignes = opts.lignes.map((l) => {
    const ligneId = randomUUID()
    const ligne = {
      id:                ligneId,
      bon_id:            bonId,
      produit_id:        l.produit_id ?? null,
      designation:       l.designation,
      unite:             l.unite,
      quantite_demandee: l.quantite_demandee,
      quantite_servie:   0,
      created_at:        now,
    }
    enqueueSync('bons_sortie_lignes', 'INSERT', ligneId, ligne)
    return ligne
  })

  return { ...bon, lignes, offline: true }
}

/** Valide ou refuse un bon offline. */
export function localValiderBon(opts: {
  bon_id:      string
  decision:    'valide' | 'refuse'
  commentaire?: string
  user_id?:    string
}): void {
  const now = NOW()
  const updates = {
    id:            opts.bon_id,
    statut:        opts.decision,
    updated_at:    now,
    sync_status:   'pending',
  }
  localUpdate('bons_sortie', opts.bon_id, updates)
  enqueueSync('bons_sortie', 'UPDATE', opts.bon_id, updates)
}

/** Crée une facture offline. */
export function localCreateFacture(opts: {
  client_nom:    string
  client_id?:    string
  commande_id?:  string
  date_emission: string
  date_echeance: string
  lignes: Array<{ designation: string; unite?: string; quantite: number; prix_unitaire_ht_xaf: number }>
  user_id?:      string
}): Record<string, unknown> {
  const TVA = 0.1925
  const ht  = Math.round(opts.lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_ht_xaf, 0))
  const tva = Math.round(ht * TVA)
  const ttc = ht + tva
  const now    = NOW()
  const id     = randomUUID()
  const numero = offlineNumero('FAC')

  const facture = {
    id,
    numero,
    client_id:        opts.client_id ?? null,
    client_nom:       opts.client_nom,
    commande_id:      opts.commande_id ?? null,
    statut:           'brouillon',
    date_emission:    opts.date_emission,
    date_echeance:    opts.date_echeance,
    total_ht_xaf:     ht,
    tva_xaf:          tva,
    total_ttc_xaf:    ttc,
    montant_paye_xaf: 0,
    created_by:       opts.user_id ?? null,
    created_at:       now,
    updated_at:       now,
    sync_status:      'pending',
  }

  localInsert('factures', facture)
  enqueueSync('factures', 'INSERT', id, facture)

  const lignes = opts.lignes.map((l, i) => {
    const lid = randomUUID()
    const ligne = {
      id:                   lid,
      facture_id:           id,
      designation:          l.designation,
      unite:                l.unite ?? 'unité',
      quantite:             l.quantite,
      prix_unitaire_ht_xaf: l.prix_unitaire_ht_xaf,
      total_ht_xaf:         Math.round(l.quantite * l.prix_unitaire_ht_xaf),
      ordre:                i,
    }
    enqueueSync('factures_lignes', 'INSERT', lid, ligne)
    return ligne
  })

  return {
    ...facture,
    solde_restant_xaf: ttc,
    lignes,
    offline: true,
  }
}

/** Crée un crédit client offline. */
export function localCreateCredit(opts: {
  client_nom:  string
  client_id?:  string
  commande_id?: string
  montant_xaf: number
  date_debut:  string
  echeance:    string
  notes?:      string
  user_id?:    string
}): Record<string, unknown> {
  const now    = NOW()
  const id     = randomUUID()
  const numero = offlineNumero('CRD')

  const credit = {
    id,
    numero,
    client_id:         opts.client_id ?? null,
    client_nom:        opts.client_nom,
    commande_id:       opts.commande_id ?? null,
    montant_xaf:       opts.montant_xaf,
    solde_restant_xaf: opts.montant_xaf,
    date_debut:        opts.date_debut,
    echeance:          opts.echeance,
    statut:            'en_cours',
    notes:             opts.notes ?? null,
    created_by:        opts.user_id ?? null,
    created_at:        now,
    updated_at:        now,
    sync_status:       'pending',
  }

  localInsert('credits', credit)
  enqueueSync('credits', 'INSERT', id, credit)

  return { ...credit, offline: true }
}

/** Enregistre un remboursement offline. */
export function localRembourser(opts: {
  credit_id:     string
  montant_xaf:   number
  date_paiement: string
  type:          'total' | 'partiel'
  notes?:        string
  user_id?:      string
}): Record<string, unknown> {
  const now  = NOW()
  const id   = randomUUID()

  // Lire le crédit depuis SQLite
  const credit = localGet<{ solde_restant_xaf: number; statut: string }>(
    'SELECT solde_restant_xaf, statut FROM credits WHERE id = ?',
    [opts.credit_id],
  )

  const solde_actuel   = credit?.solde_restant_xaf ?? opts.montant_xaf
  const nouveau_solde  = Math.max(0, solde_actuel - opts.montant_xaf)
  const nouveau_statut = nouveau_solde <= 0 ? 'rembourse' : 'en_cours'

  const remb = {
    id,
    credit_id:     opts.credit_id,
    montant_xaf:   opts.montant_xaf,
    date_paiement: opts.date_paiement,
    type:          opts.type,
    notes:         opts.notes ?? null,
    created_by:    opts.user_id ?? null,
    created_at:    now,
    sync_status:   'pending',
  }
  localInsert('remboursements_credit', remb)
  enqueueSync('remboursements_credit', 'INSERT', id, remb)

  // Mise à jour du crédit
  const creditUpdates = {
    id:                opts.credit_id,
    solde_restant_xaf: nouveau_solde,
    statut:            nouveau_statut,
    updated_at:        now,
    sync_status:       'pending',
  }
  localUpdate('credits', opts.credit_id, creditUpdates)
  enqueueSync('credits', 'UPDATE', opts.credit_id, creditUpdates)

  return {
    remboursement:     remb,
    nouveau_solde_xaf: nouveau_solde,
    statut:            nouveau_statut,
    offline:           true,
  }
}

/** Crée un devis offline. */
export function localCreateDevis(opts: {
  client_nom:          string
  client_id?:          string
  date_emission:       string
  date_validite:       string
  validite_jours?:     number
  acompte_pct?:        number
  conditions_paiement?: string
  notes?:              string
  lignes: Array<{ produit_id?: string; designation: string; description?: string; categorie?: string; unite?: string; quantite: number; prix_unitaire_ht_xaf: number }>
  user_id?: string
}): Record<string, unknown> {
  const TVA = 0.1925
  const ht  = Math.round(opts.lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_ht_xaf, 0))
  const tva = Math.round(ht * TVA)
  const ttc = ht + tva
  const now    = NOW()
  const id     = randomUUID()
  const numero = offlineNumero('DEV')

  const devis = {
    id, numero,
    client_id:           opts.client_id ?? null,
    client_nom:          opts.client_nom,
    statut:              'brouillon',
    date_emission:       opts.date_emission,
    date_validite:       opts.date_validite,
    validite_jours:      opts.validite_jours ?? 30,
    acompte_pct:         opts.acompte_pct ?? 0,
    conditions_paiement: opts.conditions_paiement ?? 'Virement bancaire',
    notes:               opts.notes ?? null,
    total_ht_xaf:        ht,
    tva_xaf:             tva,
    total_ttc_xaf:       ttc,
    created_by:          opts.user_id ?? null,
    created_at:          now,
    updated_at:          now,
    sync_status:         'pending',
  }
  localInsert('devis', devis)
  enqueueSync('devis', 'INSERT', id, devis)

  const lignes = opts.lignes.map((l, i) => {
    const lid = randomUUID()
    const ligne = {
      id: lid, devis_id: id,
      produit_id:           l.produit_id ?? null,
      designation:          l.designation,
      description:          l.description ?? null,
      categorie:            l.categorie ?? 'materiaux',
      unite:                l.unite ?? 'unité',
      quantite:             l.quantite,
      prix_unitaire_ht_xaf: l.prix_unitaire_ht_xaf,
      total_ht_xaf:         Math.round(l.quantite * l.prix_unitaire_ht_xaf),
      ordre:                i,
    }
    enqueueSync('devis_lignes', 'INSERT', lid, ligne)
    return ligne
  })

  return { ...devis, lignes, offline: true }
}

/** Crée une commande offline. */
export function localCreateCommande(opts: {
  client_nom:             string
  client_id?:             string
  devis_id?:              string
  date_commande:          string
  date_livraison_prevue?: string
  acompte_recu_xaf?:      number
  notes?:                 string
  lignes: Array<{ produit_id?: string; designation: string; unite?: string; quantite: number; prix_unitaire_ht_xaf: number }>
  user_id?: string
}): Record<string, unknown> {
  const TVA = 0.1925
  const ht  = Math.round(opts.lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire_ht_xaf, 0))
  const tva = Math.round(ht * TVA)
  const ttc = ht + tva
  const now    = NOW()
  const id     = randomUUID()
  const numero = offlineNumero('CMD')

  const commande = {
    id, numero,
    client_id:             opts.client_id ?? null,
    client_nom:            opts.client_nom,
    devis_id:              opts.devis_id ?? null,
    statut:                'confirmed',
    date_commande:         opts.date_commande,
    date_livraison_prevue: opts.date_livraison_prevue ?? null,
    acompte_recu_xaf:      opts.acompte_recu_xaf ?? 0,
    notes:                 opts.notes ?? null,
    total_ht_xaf:          ht,
    tva_xaf:               tva,
    total_ttc_xaf:         ttc,
    created_by:            opts.user_id ?? null,
    created_at:            now,
    updated_at:            now,
    sync_status:           'pending',
  }
  localInsert('commandes', commande)
  enqueueSync('commandes', 'INSERT', id, commande)

  const lignes = opts.lignes.map((l, i) => {
    const lid = randomUUID()
    const ligne = {
      id: lid, commande_id: id,
      produit_id:           l.produit_id ?? null,
      designation:          l.designation,
      unite:                l.unite ?? 'unité',
      quantite:             l.quantite,
      prix_unitaire_ht_xaf: l.prix_unitaire_ht_xaf,
      total_ht_xaf:         Math.round(l.quantite * l.prix_unitaire_ht_xaf),
      ordre:                i,
    }
    enqueueSync('commandes_lignes', 'INSERT', lid, ligne)
    return ligne
  })

  return {
    ...commande,
    reference: numero,
    client: { id: opts.client_id ?? '', nom: opts.client_nom, telephone: '' },
    lignes,
    offline: true,
  }
}
