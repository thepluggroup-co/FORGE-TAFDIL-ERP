import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
import { getSession } from '../auth/session'

// Sans délai plafonné, une résolution DNS/réseau instable (vécu en pratique :
// un cycle de sync qui prend normalement 5-9s en a pris 4min32s, chaque appel
// individuel bloquant 30 à 90+ secondes avant d'échouer) fait traîner TOUT le
// cycle de synchro d'autant. Fail-fast à 10s par appel plutôt qu'illimité.
const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

// Electron main process runs Node.js 20 which has no native WebSocket.
// Pass the 'ws' package via the realtime.transport option — the correct API.
//
// accessToken : la synchro s'exécute au nom de l'utilisateur connecté (jeton
// transmis par le renderer, cf. auth/session.ts), pas avec la clé anonyme
// seule. La base n'accorde plus rien au rôle anonyme (migration
// 20261017_securite_rls_acces_anonyme.sql) ; sans session valide, la synchro
// ne reçoit simplement aucune ligne et les données locales restent en place.
export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
  {
    accessToken: async () => getSession()?.accessToken ?? null,
    global: { headers: { 'x-app-name': 'FORGE-ERP-DESKTOP' }, fetch: fetchWithTimeout },
    realtime: { transport: ws as unknown as typeof WebSocket },
  }
)
