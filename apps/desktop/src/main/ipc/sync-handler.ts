import { ipcMain, net } from 'electron'
import log from 'electron-log'
import type { BrowserWindow } from 'electron'
import { supabase } from '../supabase'
import { getDb } from './db-handler'
import { getSession } from '../../auth/session'

// ── Constantes ────────────────────────────────────────────────────────────────

const SYNC_INTERVAL_MS = 5 * 60 * 1000  // 5 minutes
const BATCH_SIZE       = 500

// API Hono embarquée (forkée par main/index.ts) — même port que celui que le
// renderer web utilise pour tous ses appels /api/*.
const LOCAL_API_BASE = 'http://localhost:3001'

// Tables à synchroniser depuis Supabase (pull)
const SYNC_TABLES: Array<{
  table:    string
  columns:  string
  orderBy:  string
}> = [
  { table: 'produits',           columns: 'id,ref,designation,categorie,unite,stock_actuel,stock_min,prix_unitaire_xaf,statut,updated_at',                                            orderBy: 'updated_at' },
  { table: 'clients',            columns: 'id,nom,type,telephone,email,adresse,score_fiabilite,statut,updated_at',                                                                    orderBy: 'updated_at' },
  { table: 'commandes',          columns: 'id,numero,client_id,client_nom,statut,total_ttc_xaf,date_livraison_prevue,updated_at',                                                     orderBy: 'updated_at' },
  { table: 'devis',              columns: 'id,numero,client_id,client_nom,statut,total_ttc_xaf,date_emission,date_validite,updated_at',                                               orderBy: 'updated_at' },
  { table: 'factures',           columns: 'id,numero,client_id,client_nom,commande_id,statut,date_emission,date_echeance,total_ttc_xaf,updated_at',                                  orderBy: 'updated_at' },
  { table: 'bons_sortie',        columns: 'id,numero,statut,demandeur,motif,notes,created_at,updated_at',                                                                             orderBy: 'updated_at' },
  { table: 'employes',           columns: 'id,nom,poste,departement,type_contrat,date_entree,salaire_base_xaf,statut,telephone,email,updated_at',                                    orderBy: 'updated_at' },
  { table: 'apprenants',         columns: 'id,nom,specialite,niveau,duree_mois,statut,notes,updated_at',                                                                             orderBy: 'updated_at' },
  { table: 'jobs_production',    columns: 'id,numero,commande_id,produit_designation,machine_nom,technicien_nom,avancement_pct,statut,date_debut,date_fin_prevue,updated_at',        orderBy: 'updated_at' },
  { table: 'projets',            columns: 'id,nom,client_nom,chef_projet_nom,budget_xaf,depense_xaf,avancement_pct,statut,date_debut,deadline,updated_at',                          orderBy: 'updated_at' },
  { table: 'livraisons',         columns: 'id,numero,client_id,client_nom,destination,transporteur,statut,date_depart,date_livraison_prevue,updated_at',                             orderBy: 'updated_at' },
  { table: 'campagnes_marketing',columns: 'id,nom,canal,budget_xaf,reach,leads_count,conversions_count,statut,date_debut,date_fin,updated_at',                                      orderBy: 'updated_at' },
  { table: 'credits',            columns: 'id,numero,client_id,client_nom,commande_id,montant_xaf,solde_restant_xaf,date_debut,echeance,statut,notes,updated_at',                    orderBy: 'updated_at' },
  { table: 'remboursements_credit', columns: 'id,credit_id,montant_xaf,date_paiement,type,notes,created_at',                                                                        orderBy: 'created_at' },
  // ── Module Caisse (PROMPT 5) — pull pour que l'historique et les sessions
  // ouvertes par d'autres postes/caissiers restent visibles hors-ligne.
  // produits (déjà ci-dessus) porte déjà stock_actuel/prix_unitaire_xaf.
  { table: 'caisse_sessions',    columns: 'id,caissier_id,date_ouverture,date_fermeture,fond_ouverture_xaf,fond_fermeture_xaf,total_especes_xaf,total_om_xaf,total_momo_xaf,total_credit_xaf,ecart_xaf,statut,updated_at', orderBy: 'updated_at' },
  { table: 'tickets_vente',      columns: 'id,op_id,numero_local,numero_facture,session_id,caissier_id,client_id,client_nom,total_ht_xaf,tva_xaf,total_ttc_xaf,remise_xaf,statut,oversell,created_at,updated_at',        orderBy: 'updated_at' },
  { table: 'lignes_ticket',      columns: 'id,ticket_id,produit_id,designation,unite,quantite,prix_unitaire_xaf,total_ligne_xaf,ordre',                                                                                 orderBy: 'id' },
  { table: 'paiements_ticket',   columns: 'id,ticket_id,mode,montant_xaf,montant_recu_xaf,rendu_xaf,reference,date_echeance,statut_remboursement,date_remboursement,created_at',                                        orderBy: 'created_at' },
]

// ── Types ─────────────────────────────────────────────────────────────────────

type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error'

interface SyncState {
  status:      SyncStatus
  lastSync:    Date | null
  pending:     number
  errorCount:  number
}

// ── Gestionnaire de synchronisation ───────────────────────────────────────────

export class SyncManager {
  private timer:    NodeJS.Timeout | null = null
  private state:    SyncState = { status: 'idle', lastSync: null, pending: 0, errorCount: 0 }
  private getWin:   () => BrowserWindow | null

  constructor(getWin: () => BrowserWindow | null) {
    this.getWin = getWin
    this.registerIpc()
  }

  // ── IPC ───────────────────────────────────────────────────────────────────

  private registerIpc() {
    ipcMain.handle('sync:status',  () => this.getState())
    ipcMain.handle('sync:trigger', () => this.sync())
  }

  private getState() {
    return {
      ...this.state,
      lastSync: this.state.lastSync?.toISOString() ?? null,
    }
  }

  private emit(status: SyncStatus) {
    this.state.status = status
    const win = this.getWin()
    if (!win || win.isDestroyed()) return
    win.webContents.send('sync:update', status)

    // Mise à jour du titre de la fenêtre
    const base = 'FORGE by TAFDIL'
    win.setTitle(status === 'offline' ? `${base} [OFFLINE]` : base)
  }

  // ── Démarrage / arrêt ─────────────────────────────────────────────────────

  start() {
    this.sync()
    this.timer = setInterval(() => this.sync(), SYNC_INTERVAL_MS)
    log.info('[sync] manager started, interval:', SYNC_INTERVAL_MS / 1000, 's')
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    log.info('[sync] manager stopped')
  }

  // ── Vérification connexion ────────────────────────────────────────────────

  private isOnline(): boolean {
    return net.isOnline()
  }

  // ── Sync principale ───────────────────────────────────────────────────────

  async sync(): Promise<void> {
    if (this.state.status === 'syncing') return

    if (!this.isOnline()) {
      this.emit('offline')
      return
    }

    this.emit('syncing')
    log.info('[sync] starting sync cycle')

    try {
      await this.pullFromSupabase()
      await this.pushPending()

      this.state.lastSync   = new Date()
      this.state.errorCount = 0
      this.emit('idle')
      log.info('[sync] cycle complete at', this.state.lastSync.toISOString())
    } catch (err) {
      this.state.errorCount++
      log.error('[sync] cycle error:', err)
      this.emit(this.isOnline() ? 'error' : 'offline')
    }
  }

  // ── Pull depuis Supabase ──────────────────────────────────────────────────

  private async pullFromSupabase(): Promise<void> {
    const db = getDb()
    if (!db) return

    for (const { table, columns, orderBy } of SYNC_TABLES) {
      try {
        const { data, error } = await supabase
          .from(table)
          .select(columns)
          .order(orderBy, { ascending: false })
          .limit(BATCH_SIZE)

        if (error) {
          log.warn(`[sync] pull ${table} error:`, error.message)
          continue
        }

        if (!data || data.length === 0) continue

        // Upsert dans SQLite
        const rows = data as unknown as Record<string, unknown>[]
        const cols  = Object.keys(rows[0])
        const placeholders = cols.map(() => '?').join(', ')
        const updates = cols.filter(c => c !== 'id').map(c => `${c}=excluded.${c}`).join(', ')

        const upsert = db.prepare(
          `INSERT INTO ${table} (${cols.join(', ')})
           VALUES (${placeholders})
           ON CONFLICT(id) DO UPDATE SET ${updates}, sync_status='synced'`
        )

        // better-sqlite3 ne bind que number/string/bigint/buffer/null — un booléen
        // brut (ex: tickets_vente.oversell) fait planter .run() avec TypeError,
        // ce qui interrompait le pull de cette table à chaque cycle (silencieux :
        // rattrapé par le catch plus bas, mais la table restait figée localement).
        //
        // Échec PAR LIGNE capturé individuellement plutôt que de laisser
        // db.transaction() annuler tout le lot : un seul conflit isolé (ex: un
        // ticket créé hors-ligne puis synchronisé sous un autre id, qui percute
        // la contrainte UNIQUE(op_id) locale) ne doit pas empêcher les AUTRES
        // lignes valides du même lot d'être appliquées — sinon toute la table
        // reste figée localement à chaque cycle tant que la ligne fautive existe.
        let applied = 0
        const upsertMany = db.transaction((items: Record<string, unknown>[]) => {
          for (const item of items) {
            try {
              upsert.run(...cols.map(c => {
                const v = item[c]
                if (typeof v === 'boolean') return v ? 1 : 0
                return v ?? null
              }))
              applied++
            } catch (rowErr) {
              log.warn(`[sync] pull ${table} — ligne ${item.id as string} ignorée:`, rowErr)
            }
          }
        })

        upsertMany(rows)
        log.debug(`[sync] pulled ${applied}/${rows.length} rows from ${table}`)
      } catch (e) {
        log.error(`[sync] pull ${table} exception:`, e)
      }
    }
  }

  // ── Push des opérations locales non synchronisées ─────────────────────────

  private async pushPending(): Promise<void> {
    const db = getDb()
    if (!db) return

    type QueueRow = { id: number; table_name: string; operation: string; record_id: string; payload: string }
    const pending = db.prepare(
      `SELECT id, table_name, operation, record_id, payload
       FROM sync_queue WHERE attempts < 3
       ORDER BY created_at LIMIT 50`
    ).all() as QueueRow[]

    this.state.pending = pending.length

    for (const op of pending) {
      try {
        const payload = JSON.parse(op.payload)

        // ── tickets_vente : NE JAMAIS upsert brut. Le payload est imbriqué
        // (ticket + lignes[] + paiements[], cf. caisse:createTicketOffline
        // dans db-handler.ts) et doit passer par POST /api/caisse/tickets
        // pour que le décrément de stock serveur (RPC fn_mouvement_stock_vente,
        // verrouillé, idempotent sur op_id) et la compta s'exécutent aussi à
        // la synchro — un upsert direct laisserait le stock Supabase inchangé.
        if (op.table_name === 'tickets_vente') {
          await this.pushTicketViaApi(payload)
        } else if (op.operation === 'INSERT' || op.operation === 'UPDATE') {
          const { error } = await supabase.from(op.table_name).upsert(payload)
          if (error) throw error
        } else if (op.operation === 'DELETE') {
          const { error } = await supabase.from(op.table_name).delete().eq('id', op.record_id)
          if (error) throw error
        }

        db.prepare('DELETE FROM sync_queue WHERE id = ?').run(op.id)
        log.debug(`[sync] pushed ${op.operation} on ${op.table_name}/${op.record_id}`)
      } catch (e) {
        db.prepare('UPDATE sync_queue SET attempts = attempts + 1 WHERE id = ?').run(op.id)
        log.warn(`[sync] push failed for queue id ${op.id}:`, e)
      }
    }
  }

  // ── Push d'un ticket caisse via l'API locale (pas un upsert Supabase) ────
  // op_id garantit l'idempotence côté serveur : même rejoué (ex: coupure
  // réseau juste après une réponse 200/201 mais avant le DELETE du sync_queue
  // local), ce push ne double jamais le ticket ni le décrément de stock.
  private async pushTicketViaApi(payload: Record<string, unknown>): Promise<void> {
    const session = getSession()
    if (!session?.accessToken) {
      throw new Error('Aucune session utilisateur locale — reconnectez-vous pour synchroniser les ventes caisse')
    }

    const res = await fetch(`${LOCAL_API_BASE}/api/caisse/tickets`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string; code?: string }
      throw new Error(body.error ?? `POST /api/caisse/tickets a échoué (HTTP ${res.status})`)
    }

    const result = await res.json().catch(() => ({})) as { id?: string; numero_facture?: string; idempotent?: boolean }
    log.info(
      result.idempotent
        ? `[sync] ticket caisse déjà synchronisé (idempotent) — op_id ${payload.op_id}`
        : `[sync] ticket caisse synchronisé — ${result.numero_facture ?? payload.op_id}`,
    )

    // ── Réconciliation d'id : le ticket a été créé localement avec un id
    // random (caisse:createTicketOffline), mais Supabase génère le SIEN à
    // l'insert — les deux ne coïncident JAMAIS. Sans ce remplacement, l'id
    // local devient un doublon orphelin qui (a) fait échouer le prochain pull
    // de tickets_vente (UNIQUE(op_id)) et (b) casse silencieusement toute
    // action qui référence encore l'id local après la synchro — ex: le bouton
    // "envoyer le reçu" (POST /tickets/:id/envoyer), qui ne trouve plus rien
    // côté serveur sous cet id et échoue.
    if (result.id) {
      const db = getDb()
      const localId = db?.prepare('SELECT id FROM tickets_vente WHERE op_id = ?').get(payload.op_id as string) as
        { id: string } | undefined
      if (db && localId && localId.id !== result.id) {
        const reconcile = db.transaction(() => {
          db.prepare('UPDATE lignes_ticket    SET ticket_id = ? WHERE ticket_id = ?').run(result.id, localId.id)
          db.prepare('UPDATE paiements_ticket SET ticket_id = ? WHERE ticket_id = ?').run(result.id, localId.id)
          db.prepare('UPDATE tickets_vente    SET id = ?, sync_status = ? WHERE id = ?').run(result.id, 'synced', localId.id)
        })
        reconcile()
        log.info(`[sync] id local ${localId.id} remplacé par l'id serveur ${result.id} (op_id ${payload.op_id})`)
      }
    }
  }
}
