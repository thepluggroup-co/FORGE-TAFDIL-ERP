import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL     as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '[FORGE Mobile] VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY manquant.\n' +
    'Vérifiez votre fichier .env dans apps/mobile/.',
  )
}

// Sans délai plafonné, une résolution DNS/réseau instable (mobile — Wi-Fi
// capricieux, data 3G/4G) bloque l'écran bien plus longtemps qu'une vraie
// coupure ne le justifierait. Fail-fast à 10s plutôt qu'illimité.
const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
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
    global: {
      fetch: fetchWithTimeout,
    },
  },
)
