/**
 * Clients Supabase pour FORGE ERP.
 *
 * supabase      — client public (anon key) : utilisé côté frontend et API publique.
 * supabaseAdmin — client service role      : réservé au backend / workers.
 *                 NE JAMAIS exposer dans le frontend.
 */
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

// ── Variables d'environnement ─────────────────────────────────────────────────

const SUPABASE_URL      = process.env.VITE_SUPABASE_URL      ?? process.env.SUPABASE_URL      ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? ''
const realtimeTransport = WebSocket as never

if (!SUPABASE_URL) {
  console.warn('[FORGE/db] SUPABASE_URL manquant — client Supabase non initialisé.')
}

// ── fetch avec délai plafonné ──────────────────────────────────────────────────
// Sans ceci, une résolution DNS qui traîne (réseau instable — vécu en pratique :
// des appels Supabase individuels qui prennent 30 à 90+ secondes avant même
// d'échouer) bloque la requête entière bien au-delà du timeout CÔTÉ CLIENT,
// qui voit alors un "Délai dépassé" sans queue ni pied — alors que le serveur
// tourne, juste coincé sur cet appel sortant. Fail-fast à 10s : nettement plus
// long qu'un aller-retour Supabase normal (dizaines à centaines de ms), mais
// borné plutôt qu'illimité.
const SUPABASE_FETCH_TIMEOUT_MS = 10_000

const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SUPABASE_FETCH_TIMEOUT_MS)
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

// ── Client public (anon) ──────────────────────────────────────────────────────

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken:  true,
    persistSession:    true,
    detectSessionInUrl: false,
  },
  realtime: {
    transport: realtimeTransport,
  },
  global: {
    headers: { 'x-app-name': 'FORGE-ERP' },
    fetch:   fetchWithTimeout,
  },
})

// ── Client admin (service role) ───────────────────────────────────────────────

export const supabaseAdmin = SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession:   false,
      },
      realtime: {
        transport: realtimeTransport,
      },
      global: {
        fetch: fetchWithTimeout,
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
  | 'charges'
  | 'sorties_tresorerie'
  | 'charges_justificatifs'
  | 'employes'
  | 'presences'
  | 'bulletins_paie'
  | 'avances_salaire'
  | 'retenues_salaire'
  | 'cotisations_sociales'
  | 'paie_periodes'
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
