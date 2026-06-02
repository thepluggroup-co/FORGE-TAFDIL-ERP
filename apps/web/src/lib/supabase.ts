import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL     as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// Ne pas throw au niveau module — un throw ici plante l'app entière avant le
// premier render React, produisant un écran blanc sans message d'erreur.
// À la place, on crée un client factice si les vars sont absentes : l'app
// affichera la page de login et les appels Supabase retourneront des erreurs
// lisibles plutôt qu'un crash silencieux.
if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '[FORGE] VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY manquant.\n' +
    'Lancez setup-env.bat puis redémarrez le serveur de développement.',
  )
}

export const supabase = createClient(
  supabaseUrl     ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder-anon-key',
  {
    auth: {
      persistSession:  true,
      autoRefreshToken: true,
    },
  },
)
