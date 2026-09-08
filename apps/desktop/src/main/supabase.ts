import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

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
export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
  {
    auth:   { autoRefreshToken: true, persistSession: false, detectSessionInUrl: false },
    global: { headers: { 'x-app-name': 'FORGE-ERP-DESKTOP' }, fetch: fetchWithTimeout },
    realtime: { transport: ws as unknown as typeof WebSocket },
  }
)
