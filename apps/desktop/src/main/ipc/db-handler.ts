import { ipcMain, app } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
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

    // ── 006: module crédit — plafonds, plans de paiement, échéances ──────────
    // Offline-first : les paiements enregistrés hors-ligne sont mis en
    // sync_queue et synchronisés à la reconnexion.
    // Conflit : statuts serveur prioritaires, nouveaux paiements locaux gardés.
    '006_credit_module': (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS customer_credit_limits (
          id                       TEXT PRIMARY KEY,
          customer_id              TEXT NOT NULL,
          max_credit_amount        INTEGER NOT NULL DEFAULT 0,
          is_active                INTEGER NOT NULL DEFAULT 1,
          eligibility_type         TEXT NOT NULL DEFAULT 'INDIVIDUAL',
          min_order_history_months INTEGER NOT NULL DEFAULT 3,
          min_past_orders_count    INTEGER NOT NULL DEFAULT 5,
          created_by               TEXT,
          created_at               TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
          sync_status              TEXT NOT NULL DEFAULT 'pending'
        );

        CREATE TABLE IF NOT EXISTS payment_plans (
          id                  TEXT PRIMARY KEY,
          order_id            TEXT NOT NULL,
          customer_id         TEXT NOT NULL,
          total_amount        INTEGER NOT NULL,
          outstanding_balance INTEGER NOT NULL,
          status              TEXT NOT NULL DEFAULT 'ACTIVE',
          created_by          TEXT,
          created_at          TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
          sync_status         TEXT NOT NULL DEFAULT 'pending'
        );

        CREATE TABLE IF NOT EXISTS payment_installments (
          id                  TEXT PRIMARY KEY,
          payment_plan_id     TEXT NOT NULL,
          installment_number  INTEGER NOT NULL,
          due_date            TEXT NOT NULL,
          amount_due          INTEGER NOT NULL,
          amount_paid         INTEGER NOT NULL DEFAULT 0,
          paid_at             TEXT,
          payment_method      TEXT,
          status              TEXT NOT NULL DEFAULT 'PENDING',
          notes               TEXT,
          created_at          TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
          sync_status         TEXT NOT NULL DEFAULT 'pending'
        );

        CREATE INDEX IF NOT EXISTS idx_credit_limits_customer
          ON customer_credit_limits(customer_id);
        CREATE INDEX IF NOT EXISTS idx_payment_plans_customer
          ON payment_plans(customer_id);
        CREATE INDEX IF NOT EXISTS idx_payment_plans_status
          ON payment_plans(status);
        CREATE INDEX IF NOT EXISTS idx_installments_plan
          ON payment_installments(payment_plan_id);
        CREATE INDEX IF NOT EXISTS idx_installments_due_date
          ON payment_installments(due_date);
        CREATE INDEX IF NOT EXISTS idx_installments_status
          ON payment_installments(status);
      `)
      log.info('[db] migration 006 : credit_module (payment_plans, installments, limits)')
    },

    // ── 007: module Caisse — vente au comptoir ────────────────────────────────
    // Offline-first : op_id est la clé d'idempotence générée côté client pour
    // qu'un ticket créé hors-ligne ne soit jamais dupliqué à la synchro.
    // Tous les montants XAF en INTEGER (pas de float).
    '007_pos_module': (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS caisse_sessions (
          id                  TEXT PRIMARY KEY,
          caissier_id         TEXT NOT NULL,
          date_ouverture      TEXT,
          date_fermeture      TEXT,
          fond_ouverture_xaf  INTEGER NOT NULL,
          total_especes_xaf   INTEGER DEFAULT 0,
          total_om_xaf        INTEGER DEFAULT 0,
          total_momo_xaf      INTEGER DEFAULT 0,
          total_credit_xaf    INTEGER DEFAULT 0,
          fond_fermeture_xaf  INTEGER,
          ecart_xaf           INTEGER,
          statut              TEXT DEFAULT 'ouverte',
          notes               TEXT,
          updated_at          TEXT,
          sync_status         TEXT DEFAULT 'pending'
        );

        CREATE TABLE IF NOT EXISTS tickets_vente (
          id              TEXT PRIMARY KEY,
          op_id           TEXT NOT NULL UNIQUE,
          numero_local    TEXT,
          numero_facture  TEXT,
          session_id      TEXT NOT NULL,
          caissier_id     TEXT NOT NULL,
          client_id       TEXT,
          client_nom      TEXT,
          total_ht_xaf    INTEGER NOT NULL,
          tva_xaf         INTEGER NOT NULL,
          total_ttc_xaf   INTEGER NOT NULL,
          remise_xaf      INTEGER DEFAULT 0,
          statut          TEXT DEFAULT 'paye',
          oversell        INTEGER DEFAULT 0,
          notes           TEXT,
          created_at      TEXT,
          updated_at      TEXT,
          sync_status     TEXT DEFAULT 'pending'
        );

        CREATE TABLE IF NOT EXISTS lignes_ticket (
          id                 TEXT PRIMARY KEY,
          ticket_id          TEXT NOT NULL,
          produit_id         TEXT,
          designation        TEXT NOT NULL,
          unite              TEXT DEFAULT 'unité',
          quantite           REAL NOT NULL,
          prix_unitaire_xaf  INTEGER NOT NULL,
          total_ligne_xaf    INTEGER NOT NULL,
          ordre              INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS paiements_ticket (
          id                TEXT PRIMARY KEY,
          ticket_id         TEXT NOT NULL,
          mode              TEXT NOT NULL,
          montant_xaf       INTEGER NOT NULL,
          montant_recu_xaf  INTEGER,
          rendu_xaf         INTEGER,
          reference         TEXT,
          date_echeance         TEXT,
          statut_remboursement  TEXT,
          date_remboursement    TEXT,
          created_at        TEXT,
          sync_status       TEXT DEFAULT 'pending'
        );

        CREATE INDEX IF NOT EXISTS idx_caisse_sessions_caissier ON caisse_sessions(caissier_id);
        CREATE INDEX IF NOT EXISTS idx_tickets_vente_session    ON tickets_vente(session_id);
        CREATE INDEX IF NOT EXISTS idx_lignes_ticket_ticket     ON lignes_ticket(ticket_id);
        CREATE INDEX IF NOT EXISTS idx_paiements_ticket_ticket  ON paiements_ticket(ticket_id);
      `)
      log.info('[db] migration 007 : pos_module (caisse_sessions, tickets_vente, lignes_ticket, paiements_ticket)')
    },

    // ── 008: score de fiabilité crédit caisse (clients) ───────────────────────
    '008_caisse_credit_score': (db) => {
      safeAddColumn(db, 'clients', 'score_fiabilite_caisse',       'INTEGER DEFAULT 10')
      safeAddColumn(db, 'clients', 'credit_caisse_bloque_jusqu_au', 'TEXT')
      log.info('[db] migration 008 : score_fiabilite_caisse + credit_caisse_bloque_jusqu_au sur clients')
    },

    // ── 009: colonne sync_status manquante sur lignes_ticket ──────────────────
    // Absente depuis la migration 007 (oubliée, contrairement à caisse_sessions/
    // tickets_vente/paiements_ticket) — le pull SyncManager.pullFromSupabase
    // référence sync_status pour TOUTE table synchronisée (ON CONFLICT ... SET
    // sync_status='synced'), donc le pull de lignes_ticket échouait à chaque
    // cycle avec "no such column: sync_status", empêchant les lignes d'autres
    // postes/caissiers de jamais apparaître dans l'historique local.
    '009_lignes_ticket_sync_status': (db) => {
      safeAddColumn(db, 'lignes_ticket', 'sync_status', "TEXT DEFAULT 'synced'")
      log.info('[db] migration 009 : sync_status sur lignes_ticket')
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

  // ── IPC Crédit offline ────────────────────────────────────────────────────

  // Enregistrer un paiement hors-ligne (mis en sync_queue)
  ipcMain.handle('credit:recordPaymentOffline', (_e, payload: {
    installmentId: string
    amount:        number
    method:        string
    notes?:        string
    planId:        string
  }) => {
    try {
      const now = new Date().toISOString()

      // Lire l'échéance courante
      const inst = database
        .prepare('SELECT * FROM payment_installments WHERE id = ?')
        .get(payload.installmentId) as Record<string, unknown> | undefined

      if (!inst) throw new Error('Échéance introuvable en local')
      if (inst.status === 'PAID') throw new Error('Déjà payée')

      const amountPaid = (inst.amount_paid as number) + payload.amount
      const newStatus  = amountPaid >= (inst.amount_due as number) ? 'PAID' : 'PARTIAL'

      // Mise à jour locale
      database.prepare(`
        UPDATE payment_installments
        SET amount_paid = ?, status = ?, payment_method = ?, paid_at = ?,
            notes = ?, updated_at = ?, sync_status = 'pending'
        WHERE id = ?
      `).run(amountPaid, newStatus, payload.method, newStatus === 'PAID' ? now : null,
             payload.notes ?? null, now, payload.installmentId)

      // Recalculer outstanding_balance du plan
      const insts = database
        .prepare('SELECT amount_due, amount_paid FROM payment_installments WHERE payment_plan_id = ?')
        .all(payload.planId) as Array<{ amount_due: number; amount_paid: number }>

      const outstanding = insts.reduce((s, i) => s + Math.max(0, i.amount_due - i.amount_paid), 0)

      database.prepare(`
        UPDATE payment_plans
        SET outstanding_balance = ?, updated_at = ?, sync_status = 'pending'
        WHERE id = ?
      `).run(outstanding, now, payload.planId)

      // Ajouter à la sync_queue
      database.prepare(`
        INSERT INTO sync_queue (table_name, operation, record_id, payload)
        VALUES ('payment_installments', 'UPDATE', ?, ?)
      `).run(payload.installmentId, JSON.stringify({ ...inst, amount_paid: amountPaid, status: newStatus, payment_method: payload.method, paid_at: now }))

      log.info('[credit:offline] paiement enregistré localement', payload.installmentId)
      return { ok: true, newStatus, outstanding }
    } catch (err) {
      log.error('[credit:offline] erreur paiement', err)
      throw err
    }
  })

  // Lire les plans et échéances d'un client (offline)
  ipcMain.handle('credit:getPlansOffline', (_e, customerId: string) => {
    const plans = database
      .prepare('SELECT * FROM payment_plans WHERE customer_id = ? ORDER BY created_at DESC')
      .all(customerId)
    return plans
  })

  ipcMain.handle('credit:getInstallmentsOffline', (_e, planId: string) => {
    const insts = database
      .prepare('SELECT * FROM payment_installments WHERE payment_plan_id = ? ORDER BY installment_number ASC')
      .all(planId)
    return insts
  })

  // ── IPC Caisse offline (PROMPT 5) ─────────────────────────────────────────
  // Calqués EXACTEMENT sur credit:recordPaymentOffline : écriture locale
  // synchrone (better-sqlite3), puis une entrée sync_queue par opération.
  // Pour tickets_vente spécifiquement, le payload de sync_queue est imbriqué
  // (ticket + lignes[] + paiements[]) — c'est sync-handler.ts::pushPending()
  // qui route ce table_name particulier vers POST /api/caisse/tickets (pas un
  // upsert Supabase brut), pour que le décrément de stock serveur (RPC
  // fn_mouvement_stock_vente) et la compta s'exécutent aussi à la synchro.

  // Ouvrir une session de caisse hors-ligne
  ipcMain.handle('caisse:openSessionOffline', (_e, payload: {
    caissierId:       string
    fondOuvertureXaf: number
  }) => {
    try {
      const now = new Date().toISOString()
      const id  = randomUUID()

      database.prepare(`
        INSERT INTO caisse_sessions (
          id, caissier_id, date_ouverture, fond_ouverture_xaf,
          total_especes_xaf, total_om_xaf, total_momo_xaf, total_credit_xaf,
          statut, updated_at, sync_status
        ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 'ouverte', ?, 'pending')
      `).run(id, payload.caissierId, now, payload.fondOuvertureXaf, now)

      const session = database.prepare('SELECT * FROM caisse_sessions WHERE id = ?').get(id)

      database.prepare(`
        INSERT INTO sync_queue (table_name, operation, record_id, payload)
        VALUES ('caisse_sessions', 'INSERT', ?, ?)
      `).run(id, JSON.stringify(session))

      log.info('[caisse:offline] session ouverte localement', id)
      return { ...(session as object), offline: true }
    } catch (err) {
      log.error('[caisse:offline] erreur ouverture session', err)
      throw err
    }
  })

  // Session ouverte du caissier courant (offline) — équivalent local de
  // GET /api/caisse/sessions/courante, pour que l'écran sache s'il doit
  // afficher l'ouverture de session ou l'écran de vente quand hors-ligne.
  ipcMain.handle('caisse:getSessionCouranteOffline', (_e, caissierId: string) => {
    const session = database
      .prepare(`SELECT * FROM caisse_sessions WHERE caissier_id = ? AND statut = 'ouverte' ORDER BY date_ouverture DESC LIMIT 1`)
      .get(caissierId)
    return session ?? null
  })

  // Fermer une session hors-ligne — recalcule les totaux depuis les tickets
  // et paiements déjà en local (même logique que buildRapportZ côté API).
  ipcMain.handle('caisse:closeSessionOffline', (_e, payload: {
    sessionId:        string
    fondFermetureXaf: number
  }) => {
    try {
      const now = new Date().toISOString()

      const session = database.prepare('SELECT * FROM caisse_sessions WHERE id = ?').get(payload.sessionId) as
        Record<string, unknown> | undefined
      if (!session) throw new Error('Session introuvable en local')
      if (session.statut === 'fermee') throw new Error('Session déjà fermée')

      const tickets = database
        .prepare(`SELECT id, total_ttc_xaf, statut, oversell FROM tickets_vente WHERE session_id = ?`)
        .all(payload.sessionId) as Array<{ id: string; total_ttc_xaf: number; statut: string; oversell: number }>

      const ticketsValides = tickets.filter((t) => t.statut !== 'annule')
      const ticketIds = ticketsValides.map((t) => t.id)

      const parMode: Record<string, number> = { espece: 0, orange_money: 0, mtn_momo: 0, credit: 0, carte: 0 }
      if (ticketIds.length > 0) {
        const placeholders = ticketIds.map(() => '?').join(',')
        const paiements = database
          .prepare(`SELECT mode, montant_xaf FROM paiements_ticket WHERE ticket_id IN (${placeholders})`)
          .all(...ticketIds) as Array<{ mode: string; montant_xaf: number }>
        for (const p of paiements) parMode[p.mode] = (parMode[p.mode] ?? 0) + p.montant_xaf
      }

      const totalEspeces     = parMode.espece ?? 0
      const montantTheorique = (session.fond_ouverture_xaf as number) + totalEspeces
      const ecart             = payload.fondFermetureXaf - montantTheorique

      database.prepare(`
        UPDATE caisse_sessions
        SET statut = 'fermee', date_fermeture = ?, fond_fermeture_xaf = ?,
            total_especes_xaf = ?, total_om_xaf = ?, total_momo_xaf = ?, total_credit_xaf = ?,
            ecart_xaf = ?, updated_at = ?, sync_status = 'pending'
        WHERE id = ?
      `).run(now, payload.fondFermetureXaf, totalEspeces, parMode.orange_money ?? 0,
             parMode.mtn_momo ?? 0, parMode.credit ?? 0, ecart, now, payload.sessionId)

      const updated = database.prepare('SELECT * FROM caisse_sessions WHERE id = ?').get(payload.sessionId)

      database.prepare(`
        INSERT INTO sync_queue (table_name, operation, record_id, payload)
        VALUES ('caisse_sessions', 'UPDATE', ?, ?)
      `).run(payload.sessionId, JSON.stringify(updated))

      log.info('[caisse:offline] session fermée localement', payload.sessionId)
      return {
        session:                updated,
        tickets_count:          ticketsValides.length,
        total_ttc_xaf:          ticketsValides.reduce((s, t) => s + t.total_ttc_xaf, 0),
        par_mode:               parMode,
        ventes_oversell:        ticketsValides.filter((t) => t.oversell).length,
        ecart_xaf:              ecart,
        montant_theorique_xaf:  montantTheorique,
        offline:                true,
      }
    } catch (err) {
      log.error('[caisse:offline] erreur fermeture session', err)
      throw err
    }
  })

  // Historique offline — lecture simple pour l'onglet Historique hors-ligne.
  ipcMain.handle('caisse:getHistoriqueOffline', (_e, opts: { caissierId?: string } = {}) => {
    const rows = opts.caissierId
      ? database.prepare('SELECT * FROM tickets_vente WHERE caissier_id = ? ORDER BY created_at DESC LIMIT 200').all(opts.caissierId)
      : database.prepare('SELECT * FROM tickets_vente ORDER BY created_at DESC LIMIT 200').all()
    return { data: rows, total: (rows as unknown[]).length, page: 1, per_page: 200, total_pages: 1, offline: true }
  })

  // Créer un ticket de vente hors-ligne — transaction locale complète :
  // ticket + lignes + paiements + décrément stock local + mouvement_stock,
  // puis UNE entrée sync_queue portant le payload imbriqué complet (record_id
  // = op_id, pour que l'idempotence serveur s'applique aussi après la synchro).
  ipcMain.handle('caisse:createTicketOffline', (_e, payload: {
    opId:         string
    numeroLocal?: string
    sessionId:    string
    caissierId:   string
    clientId?:    string
    clientNom?:   string
    remiseXaf?:   number
    lignes: Array<{ produitId?: string; designation: string; unite: string; quantite: number; prixUnitaireXaf: number }>
    paiements: Array<{ mode: string; montantXaf: number; montantRecuXaf?: number; reference?: string }>
  }) => {
    try {
      // Idempotence locale : si ce op_id existe déjà (retry après crash UI),
      // renvoyer le ticket existant sans rejouer le décrément de stock.
      const existing = database.prepare('SELECT * FROM tickets_vente WHERE op_id = ?').get(payload.opId) as
        Record<string, unknown> | undefined
      if (existing) {
        const lignes    = database.prepare('SELECT * FROM lignes_ticket WHERE ticket_id = ? ORDER BY ordre').all(existing.id as string)
        const paiements = database.prepare('SELECT * FROM paiements_ticket WHERE ticket_id = ?').all(existing.id as string)
        return { ...existing, lignes, paiements, idempotent: true, offline: true }
      }

      const now         = new Date().toISOString()
      const ticketId     = randomUUID()
      const numeroLocal  = payload.numeroLocal ?? `OFF-${Date.now()}`

      const brutHt   = payload.lignes.reduce((s, l) => s + l.quantite * l.prixUnitaireXaf, 0)
      const totalHt  = Math.max(0, Math.round(brutHt) - (payload.remiseXaf ?? 0))
      // TVA désactivée pour le moment — aligné sur apps/api/src/routes/caisse.ts (TVA_RATE = 0)
      const tva      = 0
      const totalTtc = totalHt + tva

      const lignesRows = payload.lignes.map((l) => ({
        id:                randomUUID(),
        produit_id:        l.produitId ?? null,
        designation:       l.designation,
        unite:             l.unite,
        quantite:          l.quantite,
        prix_unitaire_xaf: l.prixUnitaireXaf,
        total_ligne_xaf:   Math.round(l.quantite * l.prixUnitaireXaf),
      }))

      const paiementsRows = payload.paiements.map((p) => ({
        id:                randomUUID(),
        mode:              p.mode,
        montant_xaf:       p.montantXaf,
        montant_recu_xaf:  p.montantRecuXaf ?? null,
        rendu_xaf:         p.mode === 'espece' && p.montantRecuXaf != null
          ? Math.max(0, p.montantRecuXaf - p.montantXaf)
          : null,
        reference:         p.reference ?? null,
      }))

      // Payload imbriqué envoyé tel quel à POST /api/caisse/tickets à la
      // synchro — mêmes clés que createTicketSchema (apps/api/src/routes/caisse.ts).
      const syncPayload = {
        op_id:         payload.opId,
        numero_local:  numeroLocal,
        session_id:    payload.sessionId,
        client_id:     payload.clientId,
        client_nom:    payload.clientNom,
        remise_xaf:    payload.remiseXaf ?? 0,
        lignes: payload.lignes.map((l) => ({
          produit_id:         l.produitId,
          designation:        l.designation,
          unite:              l.unite,
          quantite:           l.quantite,
          prix_unitaire_xaf:  l.prixUnitaireXaf,
        })),
        paiements: payload.paiements.map((p) => ({
          mode:              p.mode,
          montant_xaf:       p.montantXaf,
          montant_recu_xaf:  p.montantRecuXaf,
          reference:         p.reference,
        })),
      }

      const tx = database.transaction(() => {
        database.prepare(`
          INSERT INTO tickets_vente (
            id, op_id, numero_local, numero_facture, session_id, caissier_id,
            client_id, client_nom, total_ht_xaf, tva_xaf, total_ttc_xaf, remise_xaf,
            statut, oversell, created_at, updated_at, sync_status
          ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'paye', 0, ?, ?, 'pending')
        `).run(
          ticketId, payload.opId, numeroLocal, payload.sessionId, payload.caissierId,
          payload.clientId ?? null, payload.clientNom ?? null,
          totalHt, tva, totalTtc, payload.remiseXaf ?? 0, now, now,
        )

        const insertLigne = database.prepare(`
          INSERT INTO lignes_ticket (id, ticket_id, produit_id, designation, unite, quantite, prix_unitaire_xaf, total_ligne_xaf, ordre)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        lignesRows.forEach((l, i) => {
          insertLigne.run(l.id, ticketId, l.produit_id, l.designation, l.unite, l.quantite, l.prix_unitaire_xaf, l.total_ligne_xaf, i)
        })

        const insertPaiement = database.prepare(`
          INSERT INTO paiements_ticket (
            id, ticket_id, mode, montant_xaf, montant_recu_xaf, rendu_xaf, reference,
            date_echeance, statut_remboursement, date_remboursement, created_at, sync_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, 'pending')
        `)
        for (const p of paiementsRows) {
          insertPaiement.run(p.id, ticketId, p.mode, p.montant_xaf, p.montant_recu_xaf, p.rendu_xaf, p.reference, now)
        }

        // Décrément stock local — provisoire : la valeur qui fera foi est
        // celle recalculée côté serveur par fn_mouvement_stock_vente à la
        // synchro (écrasée au prochain pull). Sert seulement à ce que l'écran
        // hors-ligne affiche un stock plausible entre-temps.
        const insertMouvement = database.prepare(`
          INSERT INTO mouvements_stock (id, produit_id, type, quantite, reference, notes, created_by, created_at, sync_status)
          VALUES (?, ?, 'sortie_vente', ?, ?, ?, ?, ?, 'pending')
        `)
        const updateStock = database.prepare(`UPDATE produits SET stock_actuel = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`)

        for (const l of payload.lignes) {
          if (!l.produitId) continue
          const produit = database.prepare('SELECT stock_actuel FROM produits WHERE id = ?').get(l.produitId) as
            { stock_actuel: number } | undefined
          const nouvelleQte = (produit?.stock_actuel ?? 0) - l.quantite
          insertMouvement.run(
            randomUUID(), l.produitId, l.quantite, numeroLocal,
            `Vente comptoir hors-ligne — ticket ${numeroLocal}`, payload.caissierId, now,
          )
          updateStock.run(nouvelleQte, now, l.produitId)
        }

        database.prepare(`
          INSERT INTO sync_queue (table_name, operation, record_id, payload)
          VALUES ('tickets_vente', 'INSERT', ?, ?)
        `).run(payload.opId, JSON.stringify(syncPayload))
      })

      tx()

      const ticket = database.prepare('SELECT * FROM tickets_vente WHERE id = ?').get(ticketId)
      log.info('[caisse:offline] ticket créé localement', ticketId, 'op_id:', payload.opId)
      return { ...(ticket as object), lignes: lignesRows, paiements: paiementsRows, offline: true }
    } catch (err) {
      log.error('[caisse:offline] erreur création ticket', err)
      throw err
    }
  })

  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:isDev',   () => !app.isPackaged)

  log.info('[db] IPC handlers registered')
}

export function getDb() { return db }
