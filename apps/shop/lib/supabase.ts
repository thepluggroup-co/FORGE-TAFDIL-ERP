import { createBrowserClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

const supabaseUrl      = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Client navigateur (composants client)
export function createClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey)
}

// Client public — lecture de données publiques, fonctionne partout (server components, API routes)
// Utilise la clé anon ; les RLS policies autorisent SELECT sur produits/produits_shop sans auth.
export function createPublicClient() {
  return createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Client service role — écriture uniquement (INSERT dans commandes, devis, etc.)
// Requiert SUPABASE_SERVICE_KEY dans les variables d'env du serveur (Vercel ou .env.local).
export function createServiceClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_KEY manquante — ajoutez-la dans les variables Vercel')
  return createSupabaseClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
