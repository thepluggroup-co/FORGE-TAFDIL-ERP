import { ipcMain, net } from 'electron'
import log from 'electron-log'
import type { BrowserWindow } from 'electron'
import { supabase } from '../supabase'
import { getDb } from './db-handler'

// ── Constantes ────────────────────────────────────────────────────────────────

const SYNC_INTERVAL_MS = 5 * 60 * 1000  // 5 minutes
const BATCH_SIZE       = 500

// Tables à synchroniser depuis Supabase (pull)
const SYNC_TABLES: Array<{
  table:    string
  columns:  string
  orderBy:  string
}> = [
  { table: 'produits',  columns: 'id,ref,designation,categorie,unite,stock_actuel,stock_min,prix_unitaire_xaf,statut,updated_at', orderBy: 'updated_at' },
  { table: 'clients',   columns: 'id,nom,type,telephone,email,adresse,score_fiabilite,updated_at',                                orderBy: 'updated_at' },
  { table: 'commandes', columns: 'id,numero,client_id,client_nom,statut,total_ttc_xaf,date_livraison_prevue,updated_at',          orderBy: 'updated_at' },
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
        const rows = data as Record<string, unknown>[]
        const cols  = Object.keys(rows[0])
        const placeholders = cols.map(() => '?').join(', ')
        const updates = cols.filter(c => c !== 'id').map(c => `${c}=excluded.${c}`).join(', ')

        const upsert = db.prepare(
          `INSERT INTO ${table} (${cols.join(', ')})
           VALUES (${placeholders})
           ON CONFLICT(id) DO UPDATE SET ${updates}, sync_status='synced'`
        )

        const upsertMany = db.transaction((items: Record<string, unknown>[]) => {
          for (const item of items) upsert.run(...cols.map(c => item[c] ?? null))
        })

        upsertMany(rows)
        log.debug(`[sync] pulled ${rows.length} rows from ${table}`)
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

        if (op.operation === 'INSERT' || op.operation === 'UPDATE') {
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
}
