import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL     as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '[FORGE Mobile] VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY manquant.\n' +
    'Vérifiez votre fichier .env dans apps/mobile/.',
  )
}

export const supabase = createClient(
  supabaseUrl     ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder-anon-key',
  {
    auth: {
      persistSession:   true,
      autoRefreshToken: true,
      // Capacitor utilise le localStorage du WebView — pas de session URL à détecter
      detectSessionInUrl: false,
    },
  },
)
