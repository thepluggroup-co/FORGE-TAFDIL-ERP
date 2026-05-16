/**
 * Clients Supabase pour FORGE ERP.
 *
 * supabase      — client public (anon key) : utilisé côté frontend et API publique.
 * supabaseAdmin — client service role      : réservé au backend / workers.
 *                 NE JAMAIS exposer dans le frontend.
 */
import { createClient } from '@supabase/supabase-js'

// ── Variables d'environnement ─────────────────────────────────────────────────

const SUPABASE_URL      = process.env.VITE_SUPABASE_URL      ?? process.env.SUPABASE_URL      ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!SUPABASE_URL) {
  console.warn('[FORGE/db] SUPABASE_URL manquant — client Supabase non initialisé.')
}

// ── Client public (anon) ──────────────────────────────────────────────────────

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken:  true,
    persistSession:    true,
    detectSessionInUrl: false,
  },
  global: {
    headers: { 'x-app-name': 'FORGE-ERP' },
  },
})

// ── Client admin (service role) ───────────────────────────────────────────────

export const supabaseAdmin = SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession:   false,
      },
    })
  : null

// ── Types d'aide ──────────────────────────────────────────────────────────────

export type SupabaseClient = typeof supabase

/**
 * Tables Supabase référencées dans les appels .from().
 * Ajouter ici les nouveaux noms de table au fur et à mesure.
 */
export type ForgeTable =
  | 'profiles'
  | 'clients'
  | 'produits'
  | 'mouvements_stock'
  | 'bons_sortie'
  | 'bons_sortie_lignes'
  | 'devis'
  | 'devis_lignes'
  | 'commandes'
  | 'commandes_lignes'
  | 'historique_commandes'
  | 'factures'
  | 'factures_lignes'
  | 'credits'
  | 'remboursements_credit'
  | 'ecritures_comptables'
  | 'declarations_fiscales'
  | 'employes'
  | 'presences'
  | 'bulletins_paie'
  | 'apprenants'
  | 'validations_niveau'
  | 'machines'
  | 'jobs_production'
  | 'projets'
  | 'taches_projet'
  | 'livraisons'
  | 'campagnes_marketing'
  | 'incidents_securite'
  | 'epi_items'
  | 'capteurs_iot'
  | 'mesures_iot'
