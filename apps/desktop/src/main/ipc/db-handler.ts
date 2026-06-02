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

// ── Helpers de migration sécurisés ───────────────────────────────────────────

type ColumnInfo = { name: string }

function hasColumn(database: InstanceType<typeof Database>, table: string, column: string): boolean {
  const info = database.pragma(`table_info(${table})`) as ColumnInfo[]
  return info.some((c) => c.name === column)
}

/** Ajoute une colonne seulement si elle n'existe pas encore. */
function safeAddColumn(
  database: InstanceType<typeof Database>,
  table: string,
  column: string,
  definition: string,
): void {
  if (!hasColumn(database, table, column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    log.info(`[db] added column ${table}.${column}`)
  }
}

/**
 * Renomme une colonne si l'ancien nom existe et le nouveau n'existe pas encore.
 * Requiert SQLite ≥ 3.26 (better-sqlite3 bundle ≥ 3.40 — OK).
 */
function safeRenameColumn(
  database: InstanceType<typeof Database>,
  table: string,
  from: string,
  to: string,
): void {
  if (hasColumn(database, table, from) && !hasColumn(database, table, to)) {
    database.exec(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`)
    log.info(`[db] renamed column ${table}.${from} → ${to}`)
  }
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

  // Migration functions map — chaque migration est idempotente
  const migrations: Record<string, (db: InstanceType<typeof Database>) => void> = {

    // ── 001: tables initiales ──────────────────────────────────────────────
    '001_initial': (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS produits (
          id               TEXT PRIMARY KEY,
          reference        TEXT NOT NULL,
          nom              TEXT NOT NULL,
          categorie        TEXT,
          unite            TEXT DEFAULT 'pcs',
          stock_actuel     REAL DEFAULT 0,
          stock_min        REAL DEFAULT 0,
          prix_vente_ht_xaf REAL DEFAULT 0,
          statut           TEXT DEFAULT 'actif',
          sync_status      TEXT DEFAULT 'pending',
          updated_at       TEXT
        );

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

        CREATE TABLE IF NOT EXISTS commandes (
          id            TEXT PRIMARY KEY,
          reference     TEXT NOT NULL,
          client_id     TEXT,
          client_nom    TEXT NOT NULL,
          statut        TEXT DEFAULT 'confirmed',
          total_ttc_xaf REAL DEFAULT 0,
          date_livraison TEXT,
          sync_status   TEXT DEFAULT 'pending',
          updated_at    TEXT
        );

        CREATE TABLE IF NOT EXISTS sync_queue (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          table_name TEXT NOT NULL,
          operation  TEXT NOT NULL CHECK(operation IN ('INSERT','UPDATE','DELETE')),
          record_id  TEXT NOT NULL,
          payload    TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          attempts   INTEGER DEFAULT 0
        );
      `)
    },

    // ── 002: alignement schéma Supabase — SAFE (aucun DROP TABLE) ─────────
    //
    // Stratégie :
    //   - Renommer les colonnes renommées (SQLite ≥ 3.26)
    //   - Ajouter les colonnes manquantes (ALTER TABLE ADD COLUMN)
    //   - Créer les nouvelles tables si absentes (CREATE TABLE IF NOT EXISTS)
    //   → Aucune perte de données.
    //
    // NOTE : Les DBs qui avaient l'ancienne migration 002 (DROP TABLE) reçoivent
    // la migration 003_fix_missing_columns ci-dessous pour réparer les colonnes
    // et tables manquantes laissées par l'ancien code destructif.
    '002_align_schema': (db) => {
      // ── produits ──────────────────────────────────────────────────────
      // reference → ref, nom → designation, prix_vente_ht_xaf → prix_unitaire_xaf
      safeRenameColumn(db, 'produits', 'reference',        'ref')
      safeRenameColumn(db, 'produits', 'nom',              'designation')
      safeRenameColumn(db, 'produits', 'prix_vente_ht_xaf','prix_unitaire_xaf')
      safeAddColumn(db, 'produits', 'ref',              'TEXT NOT NULL DEFAULT ""')
      safeAddColumn(db, 'produits', 'designation',      'TEXT NOT NULL DEFAULT ""')
      safeAddColumn(db, 'produits', 'description',      'TEXT')
      safeAddColumn(db, 'produits', 'prix_unitaire_xaf','REAL DEFAULT 0')
      safeAddColumn(db, 'produits', 'stock_critique',   'REAL DEFAULT 2')
      safeAddColumn(db, 'produits', 'emplacement',      'TEXT')
      safeAddColumn(db, 'produits', 'fournisseur',      'TEXT')
      safeAddColumn(db, 'produits', 'created_at',       'TEXT')
      // Normalise le statut : 'actif' → 'normal' si besoin
      db.exec(`UPDATE produits SET statut='normal' WHERE statut NOT IN ('normal','alerte','critique','rupture')`)

      // ── clients ───────────────────────────────────────────────────────
      safeAddColumn(db, 'clients', 'ville',              'TEXT')
      safeAddColumn(db, 'clients', 'pays',               'TEXT DEFAULT "Cameroun"')
      safeAddColumn(db, 'clients', 'statut',             'TEXT DEFAULT "actif"')
      safeAddColumn(db, 'clients', 'commandes_count',    'INTEGER DEFAULT 0')
      safeAddColumn(db, 'clients', 'total_ca_xaf',       'REAL DEFAULT 0')
      safeAddColumn(db, 'clients', 'encours_credit_xaf', 'REAL DEFAULT 0')
      safeAddColumn(db, 'clients', 'notes',              'TEXT')
      safeAddColumn(db, 'clients', 'created_at',         'TEXT')

      // ── commandes ─────────────────────────────────────────────────────
      // reference → numero
      safeRenameColumn(db, 'commandes', 'reference',       'numero')
      safeRenameColumn(db, 'commandes', 'date_livraison',  'date_livraison_prevue')
      safeAddColumn(db, 'commandes', 'numero',               'TEXT NOT NULL DEFAULT ""')
      safeAddColumn(db, 'commandes', 'devis_id',             'TEXT')
      safeAddColumn(db, 'commandes', 'date_commande',        'TEXT')
      safeAddColumn(db, 'commandes', 'total_ht_xaf',         'REAL DEFAULT 0')
      safeAddColumn(db, 'commandes', 'tva_xaf',              'REAL DEFAULT 0')
      safeAddColumn(db, 'commandes', 'acompte_recu_xaf',     'REAL DEFAULT 0')
      safeAddColumn(db, 'commandes', 'date_livraison_prevue','TEXT')
      safeAddColumn(db, 'commandes', 'notes',                'TEXT')
      safeAddColumn(db, 'commandes', 'created_at',           'TEXT')

      // ── nouvelles tables pour sync étendue ────────────────────────────
      db.exec(`
        CREATE TABLE IF NOT EXISTS devis (
          id           TEXT PRIMARY KEY,
          numero       TEXT NOT NULL,
          client_id    TEXT,
          client_nom   TEXT NOT NULL,
          statut       TEXT DEFAULT 'brouillon',
          date_emission TEXT,
          date_validite TEXT,
          total_ttc_xaf REAL DEFAULT 0,
          sync_status  TEXT DEFAULT 'pending',
          updated_at   TEXT
        );

        CREATE TABLE IF NOT EXISTS factures (
          id               TEXT PRIMARY KEY,
          numero           TEXT NOT NULL,
          client_id        TEXT,
          client_nom       TEXT NOT NULL,
          commande_id      TEXT,
          statut           TEXT DEFAULT 'brouillon',
          date_emission    TEXT,
          date_echeance    TEXT,
          total_ttc_xaf    REAL DEFAULT 0,
          montant_paye_xaf REAL DEFAULT 0,
          sync_status      TEXT DEFAULT 'pending',
          updated_at       TEXT
        );

        CREATE TABLE IF NOT EXISTS employes (
          id               TEXT PRIMARY KEY,
          nom              TEXT NOT NULL,
          poste            TEXT,
          departement      TEXT,
          type_contrat     TEXT,
          date_entree      TEXT,
          salaire_base_xaf REAL DEFAULT 0,
          statut           TEXT DEFAULT 'actif',
          telephone        TEXT,
          email            TEXT,
          cnps             TEXT,
          sync_status      TEXT DEFAULT 'pending',
          updated_at       TEXT
        );

        CREATE TABLE IF NOT EXISTS apprenants (
          id          TEXT PRIMARY KEY,
          nom         TEXT NOT NULL,
          specialite  TEXT,
          niveau      INTEGER DEFAULT 1,
          duree_mois  INTEGER DEFAULT 0,
          statut      TEXT DEFAULT 'actif',
          notes       TEXT,
          sync_status TEXT DEFAULT 'pending',
          updated_at  TEXT
        );

        CREATE TABLE IF NOT EXISTS jobs_production (
          id                  TEXT PRIMARY KEY,
          numero              TEXT NOT NULL,
          commande_id         TEXT,
          produit_designation TEXT,
          machine_nom         TEXT,
          technicien_nom      TEXT,
          avancement_pct      INTEGER DEFAULT 0,
          statut              TEXT DEFAULT 'confirmed',
          date_debut          TEXT,
          date_fin_prevue     TEXT,
          sync_status         TEXT DEFAULT 'pending',
          updated_at          TEXT
        );

        CREATE TABLE IF NOT EXISTS projets (
          id              TEXT PRIMARY KEY,
          nom             TEXT NOT NULL,
          client_nom      TEXT,
          chef_projet_nom TEXT,
          budget_xaf      REAL DEFAULT 0,
          depense_xaf     REAL DEFAULT 0,
          avancement_pct  INTEGER DEFAULT 0,
          statut          TEXT DEFAULT 'planifie',
          date_debut      TEXT,
          deadline        TEXT,
          sync_status     TEXT DEFAULT 'pending',
          updated_at      TEXT
        );

        CREATE TABLE IF NOT EXISTS livraisons (
          id                    TEXT PRIMARY KEY,
          numero                TEXT NOT NULL,
          client_id             TEXT,
          client_nom            TEXT,
          destination           TEXT,
          transporteur          TEXT,
          statut                TEXT DEFAULT 'confirmed',
          date_depart           TEXT,
          date_livraison_prevue TEXT,
          sync_status           TEXT DEFAULT 'pending',
          updated_at            TEXT
        );

        CREATE TABLE IF NOT EXISTS campagnes_marketing (
          id               TEXT PRIMARY KEY,
          nom              TEXT NOT NULL,
          canal            TEXT,
          budget_xaf       REAL DEFAULT 0,
          reach            INTEGER DEFAULT 0,
          leads_count      INTEGER DEFAULT 0,
          conversions_count INTEGER DEFAULT 0,
          statut           TEXT DEFAULT 'planifie',
          date_debut       TEXT,
          date_fin         TEXT,
          sync_status      TEXT DEFAULT 'pending',
          updated_at       TEXT
        );
      `)
    },

    // ── 003: réparation des colonnes/tables manquantes post-002 destructive ──
    //
    // La migration 002 originale utilisait DROP TABLE + CREATE TABLE, ce qui
    // supprimait des colonnes et des tables attendues par le sync manager.
    // Cette migration 003 est idempotente et complète le schéma sans perte.
    '003_fix_missing_columns': (db) => {
      // ── clients : colonne statut manquante après l'ancien 002 ──────────────
      safeAddColumn(db, 'clients', 'statut',             'TEXT DEFAULT "actif"')
      safeAddColumn(db, 'clients', 'ville',              'TEXT')
      safeAddColumn(db, 'clients', 'pays',               'TEXT DEFAULT "Cameroun"')
      safeAddColumn(db, 'clients', 'commandes_count',    'INTEGER DEFAULT 0')
      safeAddColumn(db, 'clients', 'total_ca_xaf',       'REAL DEFAULT 0')
      safeAddColumn(db, 'clients', 'encours_credit_xaf', 'REAL DEFAULT 0')
      safeAddColumn(db, 'clients', 'notes',              'TEXT')
      safeAddColumn(db, 'clients', 'created_at',         'TEXT')

      // ── produits : colonnes manquantes ────────────────────────────────────
      safeAddColumn(db, 'produits', 'description',      'TEXT')
      safeAddColumn(db, 'produits', 'stock_critique',   'REAL DEFAULT 2')
      safeAddColumn(db, 'produits', 'emplacement',      'TEXT')
      safeAddColumn(db, 'produits', 'fournisseur',      'TEXT')
      safeAddColumn(db, 'produits', 'created_at',       'TEXT')
      safeRenameColumn(db, 'produits', 'reference',         'ref')
      safeRenameColumn(db, 'produits', 'nom',               'designation')
      safeRenameColumn(db, 'produits', 'prix_vente_ht_xaf', 'prix_unitaire_xaf')
      safeAddColumn(db, 'produits', 'ref',              'TEXT NOT NULL DEFAULT ""')
      safeAddColumn(db, 'produits', 'designation',      'TEXT NOT NULL DEFAULT ""')
      safeAddColumn(db, 'produits', 'prix_unitaire_xaf','REAL DEFAULT 0')

      // ── commandes : colonnes manquantes ───────────────────────────────────
      safeRenameColumn(db, 'commandes', 'reference',      'numero')
      safeRenameColumn(db, 'commandes', 'date_livraison', 'date_livraison_prevue')
      safeAddColumn(db, 'commandes', 'numero',               'TEXT NOT NULL DEFAULT ""')
      safeAddColumn(db, 'commandes', 'devis_id',             'TEXT')
      safeAddColumn(db, 'commandes', 'date_commande',        'TEXT')
      safeAddColumn(db, 'commandes', 'date_livraison_prevue','TEXT')
      safeAddColumn(db, 'commandes', 'total_ht_xaf',         'REAL DEFAULT 0')
      safeAddColumn(db, 'commandes', 'tva_xaf',              'REAL DEFAULT 0')
      safeAddColumn(db, 'commandes', 'acompte_recu_xaf',     'REAL DEFAULT 0')
      safeAddColumn(db, 'commandes', 'notes',                'TEXT')
      safeAddColumn(db, 'commandes', 'created_at',           'TEXT')

      // ── nouvelles tables — recréer si absentes ────────────────────────────
      db.exec(`
        CREATE TABLE IF NOT EXISTS devis (
          id TEXT PRIMARY KEY, numero TEXT NOT NULL, client_id TEXT,
          client_nom TEXT NOT NULL, statut TEXT DEFAULT 'brouillon',
          date_emission TEXT, date_validite TEXT,
          total_ttc_xaf REAL DEFAULT 0,
          sync_status TEXT DEFAULT 'pending', updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS factures (
          id TEXT PRIMARY KEY, numero TEXT NOT NULL, client_id TEXT,
          client_nom TEXT NOT NULL, commande_id TEXT,
          statut TEXT DEFAULT 'brouillon', date_emission TEXT, date_echeance TEXT,
          total_ttc_xaf REAL DEFAULT 0, montant_paye_xaf REAL DEFAULT 0,
          sync_status TEXT DEFAULT 'pending', updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS employes (
          id TEXT PRIMARY KEY, nom TEXT NOT NULL, poste TEXT, departement TEXT,
          type_contrat TEXT, date_entree TEXT, salaire_base_xaf REAL DEFAULT 0,
          statut TEXT DEFAULT 'actif', telephone TEXT, email TEXT, cnps TEXT,
          sync_status TEXT DEFAULT 'pending', updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS apprenants (
          id TEXT PRIMARY KEY, nom TEXT NOT NULL, specialite TEXT,
          niveau INTEGER DEFAULT 1, duree_mois INTEGER DEFAULT 0,
          statut TEXT DEFAULT 'actif', notes TEXT,
          sync_status TEXT DEFAULT 'pending', updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS jobs_production (
          id TEXT PRIMARY KEY, numero TEXT NOT NULL, commande_id TEXT,
          produit_designation TEXT, machine_nom TEXT, technicien_nom TEXT,
          avancement_pct INTEGER DEFAULT 0, statut TEXT DEFAULT 'confirmed',
          date_debut TEXT, date_fin_prevue TEXT,
          sync_status TEXT DEFAULT 'pending', updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS projets (
          id TEXT PRIMARY KEY, nom TEXT NOT NULL, client_nom TEXT,
          chef_projet_nom TEXT, budget_xaf REAL DEFAULT 0,
          depense_xaf REAL DEFAULT 0, avancement_pct INTEGER DEFAULT 0,
          statut TEXT DEFAULT 'planifie', date_debut TEXT, deadline TEXT,
          sync_status TEXT DEFAULT 'pending', updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS livraisons (
          id TEXT PRIMARY KEY, numero TEXT NOT NULL, client_id TEXT,
          client_nom TEXT, destination TEXT, transporteur TEXT,
          statut TEXT DEFAULT 'confirmed', date_depart TEXT,
          date_livraison_prevue TEXT,
          sync_status TEXT DEFAULT 'pending', updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS campagnes_marketing (
          id TEXT PRIMARY KEY, nom TEXT NOT NULL, canal TEXT,
          budget_xaf REAL DEFAULT 0, reach INTEGER DEFAULT 0,
          leads_count INTEGER DEFAULT 0, conversions_count INTEGER DEFAULT 0,
          statut TEXT DEFAULT 'planifie', date_debut TEXT, date_fin TEXT,
          sync_status TEXT DEFAULT 'pending', updated_at TEXT
        );
      `)

      // ── livraisons : colonne client_id manquante (nouvelle colonne) ────────
      safeAddColumn(db, 'livraisons', 'client_id', 'TEXT')
      safeAddColumn(db, 'livraisons', 'created_at', 'TEXT')

      // ── jobs_production : colonne commande_id (sync-handler la référence) ──
      safeAddColumn(db, 'jobs_production', 'commande_id', 'TEXT')

      log.info('[db] migration 003 : schéma réparé avec succès')
    },

    // ── 004: tables credits, remboursements et mouvements_stock (MOD-04 CDC) ──
    '004_add_credits': (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS mouvements_stock (
          id          TEXT PRIMARY KEY,
          produit_id  TEXT NOT NULL,
          type        TEXT NOT NULL,
          quantite    REAL NOT NULL,
          reference   TEXT,
          notes       TEXT,
          created_by  TEXT,
          created_at  TEXT,
          sync_status TEXT DEFAULT 'pending'
        );

        CREATE TABLE IF NOT EXISTS bons_sortie_lignes (
          id                TEXT PRIMARY KEY,
          bon_id            TEXT NOT NULL,
          produit_id        TEXT,
          designation       TEXT NOT NULL,
          unite             TEXT DEFAULT 'unité',
          quantite_demandee REAL DEFAULT 0,
          quantite_servie   REAL DEFAULT 0,
          created_at        TEXT
        );

        CREATE TABLE IF NOT EXISTS factures_lignes (
          id                   TEXT PRIMARY KEY,
          facture_id           TEXT NOT NULL,
          designation          TEXT NOT NULL,
          unite                TEXT DEFAULT 'unité',
          quantite             REAL DEFAULT 0,
          prix_unitaire_ht_xaf REAL DEFAULT 0,
          total_ht_xaf         REAL DEFAULT 0,
          ordre                INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS credits (
          id                TEXT PRIMARY KEY,
          numero            TEXT NOT NULL,
          client_id         TEXT,
          client_nom        TEXT NOT NULL,
          commande_id       TEXT,
          montant_xaf       REAL DEFAULT 0,
          solde_restant_xaf REAL DEFAULT 0,
          date_debut        TEXT,
          echeance          TEXT,
          statut            TEXT DEFAULT 'en_cours',
          notes             TEXT,
          sync_status       TEXT DEFAULT 'pending',
          updated_at        TEXT
        );

        CREATE TABLE IF NOT EXISTS remboursements_credit (
          id             TEXT PRIMARY KEY,
          credit_id      TEXT NOT NULL,
          montant_xaf    REAL DEFAULT 0,
          date_paiement  TEXT,
          type           TEXT DEFAULT 'partiel',
          notes          TEXT,
          sync_status    TEXT DEFAULT 'pending',
          created_at     TEXT
        );

        CREATE TABLE IF NOT EXISTS credit_documents (
          id          TEXT PRIMARY KEY,
          credit_id   TEXT NOT NULL,
          nom_fichier TEXT NOT NULL,
          storage_path TEXT NOT NULL,
          taille_bytes INTEGER DEFAULT 0,
          created_at  TEXT
        );
      `)
      log.info('[db] migration 004 : tables credits ajoutées')
    },

    // ── 005: bons_sortie + colonnes manquantes dans sync ─────────────────────
    '005_bons_sortie_and_sync_columns': (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS bons_sortie (
          id          TEXT PRIMARY KEY,
          numero      TEXT NOT NULL DEFAULT '',
          statut      TEXT DEFAULT 'brouillon',
          demandeur   TEXT,
          motif       TEXT,
          notes       TEXT,
          created_at  TEXT,
          updated_at  TEXT,
          sync_status TEXT DEFAULT 'pending'
        );
      `)
      safeAddColumn(db, 'jobs_production', 'commande_id', 'TEXT')
      safeAddColumn(db, 'livraisons',      'client_id',   'TEXT')
      log.info('[db] migration 005 : bons_sortie + colonnes jobs/livraisons')
    },
  }

  const alreadyRan = new Set(
    database.prepare('SELECT name FROM _migrations').all().map((r: unknown) => (r as { name: string }).name)
  )

  for (const [name, fn] of Object.entries(migrations)) {
    if (alreadyRan.has(name)) continue
    try {
      fn(database)
      database.prepare('INSERT INTO _migrations (name) VALUES (?)').run(name)
      log.info('[db] migration applied:', name)
    } catch (err) {
      log.error('[db] migration FAILED:', name, err)
      throw err
    }
  }
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

export async function registerDbHandlers() {
  const database = await initSQLite()

  // SELECT (résultat unique) — db:query retourne TOUTES les lignes.
  // Utiliser db:get pour une seule ligne.
  ipcMain.handle('db:query', (_e, sql: string, params: unknown[] = []) => {
    try {
      return database.prepare(sql).all(...params)
    } catch (err) {
      log.error('[db:query]', err, { sql })
      throw err
    }
  })

  // SELECT multi-lignes → tableau (alias explicite)
  ipcMain.handle('db:all', (_e, sql: string, params: unknown[] = []) => {
    try {
      return database.prepare(sql).all(...params)
    } catch (err) {
      log.error('[db:all]', err, { sql })
      throw err
    }
  })

  // SELECT ligne unique → objet | null
  ipcMain.handle('db:get', (_e, sql: string, params: unknown[] = []) => {
    try {
      return database.prepare(sql).get(...params) ?? null
    } catch (err) {
      log.error('[db:get]', err, { sql })
      throw err
    }
  })

  // INSERT / UPDATE / DELETE → { changes, lastInsertRowid }
  ipcMain.handle('db:execute', (_e, sql: string, params: unknown[] = []) => {
    try {
      const info = database.prepare(sql).run(...params)
      return { changes: info.changes, lastInsertRowid: info.lastInsertRowid }
    } catch (err) {
      log.error('[db:execute]', err, { sql })
      throw err
    }
  })

  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:isDev',   () => !app.isPackaged)

  log.info('[db] IPC handlers registered')
}

export function getDb() { return db }
