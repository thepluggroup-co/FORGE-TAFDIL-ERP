/**
 * Client SQLite local — LibSQL avec fichier local.
 * Compatible Electron (userData path) et tests (process.cwd()).
 *
 * En production Electron, passer le chemin via :
 *   process.env.FORGE_DB_PATH = app.getPath('userData') + '/forge.db'
 * avant d'importer ce module.
 */
import path from 'path'
import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import * as schema from './schema'

function resolveDbPath(): string {
  // Electron : l'app positionne FORGE_DB_PATH avant le démarrage du renderer
  if (process.env.FORGE_DB_PATH) {
    return `file:${process.env.FORGE_DB_PATH}`
  }

  // Turso / remote LibSQL (fourni via DATABASE_URL)
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('libsql://')) {
    return process.env.DATABASE_URL
  }

  // Fallback : fichier local dans le répertoire courant (dev / tests)
  const localPath = path.join(process.cwd(), 'forge-local.db')
  return `file:${localPath}`
}

const libsql = createClient({
  url:       resolveDbPath(),
  authToken: process.env.DATABASE_AUTH_TOKEN,
})

export const dbLocal = drizzle(libsql, { schema })
export type DbLocal = typeof dbLocal

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Vérifie que la connexion locale fonctionne.
 * Lève une erreur si la DB est inaccessible.
 */
export async function pingLocal(): Promise<boolean> {
  try {
    await libsql.execute('SELECT 1')
    return true
  } catch {
    return false
  }
}

/**
 * Retourne le chemin résolu de la base locale (pour affichage dans les logs).
 */
export function getLocalDbPath(): string {
  return resolveDbPath()
}
