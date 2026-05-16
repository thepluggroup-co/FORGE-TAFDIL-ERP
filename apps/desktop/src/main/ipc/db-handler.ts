import { ipcMain, app } from 'electron'
import { join } from 'path'
import log from 'electron-log'
import type Database from 'better-sqlite3'

// ── Chargement conditionnel de better-sqlite3 (addon natif) ───────────────────
let db: InstanceType<typeof Database> | null = null

async function initSQLite(): Promise<InstanceType<typeof Database>> {
  if (db) return db

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BetterSQLite = require('better-sqlite3') as typeof Database
  const dbPath = join(app.getPath('userData'), 'forge.db')

  log.info('[db] SQLite path:', dbPath)
  db = new BetterSQLite(dbPath, { verbose: (msg) => log.debug('[sqlite]', msg) })
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runMigrations(db)
  return db
}

// ── Migrations ────────────────────────────────────────────────────────────────

function runMigrations(database: InstanceType<typeof Database>) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      ran_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  const migrations: Record<string, string> = {
    '001_initial': `
      -- Produits / stocks
      CREATE TABLE IF NOT EXISTS produits (
        id          TEXT PRIMARY KEY,
        reference   TEXT NOT NULL,
        nom         TEXT NOT NULL,
        categorie   TEXT,
        unite       TEXT DEFAULT 'pcs',
        stock_actuel REAL DEFAULT 0,
        stock_min   REAL DEFAULT 0,
        prix_vente_ht_xaf REAL DEFAULT 0,
        statut      TEXT DEFAULT 'actif',
        sync_status TEXT DEFAULT 'pending',
        updated_at  TEXT
      );

      -- Clients
      CREATE TABLE IF NOT EXISTS clients (
        id               TEXT PRIMARY KEY,
        nom              TEXT NOT NULL,
        type             TEXT DEFAULT 'particulier',
        telephone        TEXT,
        email            TEXT,
        adresse          TEXT,
        statut           TEXT DEFAULT 'actif',
        score_fiabilite  INTEGER DEFAULT 50,
        sync_status      TEXT DEFAULT 'pending',
        updated_at       TEXT
      );

      -- Commandes
      CREATE TABLE IF NOT EXISTS commandes (
        id           TEXT PRIMARY KEY,
        reference    TEXT NOT NULL,
        client_id    TEXT,
        client_nom   TEXT NOT NULL,
        statut       TEXT DEFAULT 'confirmed',
        total_ttc_xaf REAL DEFAULT 0,
        date_livraison TEXT,
        sync_status  TEXT DEFAULT 'pending',
        updated_at   TEXT
      );

      -- File d'attente de synchronisation (opérations offline)
      CREATE TABLE IF NOT EXISTS sync_queue (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL,
        operation  TEXT NOT NULL CHECK(operation IN ('INSERT','UPDATE','DELETE')),
        record_id  TEXT NOT NULL,
        payload    TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        attempts   INTEGER DEFAULT 0
      );
    `,
  }

  const alreadyRan = new Set(
    database.prepare('SELECT name FROM _migrations').all().map((r: unknown) => (r as { name: string }).name)
  )

  for (const [name, sql] of Object.entries(migrations)) {
    if (alreadyRan.has(name)) continue
    database.exec(sql)
    database.prepare('INSERT INTO _migrations (name) VALUES (?)').run(name)
    log.info('[db] migration applied:', name)
  }
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

export async function registerDbHandlers() {
  const database = await initSQLite()

  // Requête SELECT → retourne les lignes
  ipcMain.handle('db:query', (_e, sql: string, params: unknown[] = []) => {
    try {
      return database.prepare(sql).get(...params) ?? null
    } catch (err) {
      log.error('[db:query]', err, { sql })
      throw err
    }
  })

  // Requête SELECT multiple → retourne un tableau
  ipcMain.handle('db:all', (_e, sql: string, params: unknown[] = []) => {
    try {
      return database.prepare(sql).all(...params)
    } catch (err) {
      log.error('[db:all]', err, { sql })
      throw err
    }
  })

  // INSERT / UPDATE / DELETE → retourne { changes, lastInsertRowid }
  ipcMain.handle('db:execute', (_e, sql: string, params: unknown[] = []) => {
    try {
      const info = database.prepare(sql).run(...params)
      return { changes: info.changes, lastInsertRowid: info.lastInsertRowid }
    } catch (err) {
      log.error('[db:execute]', err, { sql })
      throw err
    }
  })

  // Version DB de dev
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:isDev',   () => !app.isPackaged)

  log.info('[db] IPC handlers registered')
}

export function getDb() { return db }
