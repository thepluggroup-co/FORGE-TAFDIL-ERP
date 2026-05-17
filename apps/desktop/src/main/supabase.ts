import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

// Desktop main process: Node.js 20 has no native WebSocket, provide ws package.
// Realtime subscriptions are unused here — the SyncManager polls via REST every 5 min.
export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
  {
    auth:   { autoRefreshToken: true, persistSession: false, detectSessionInUrl: false },
    global: { headers: { 'x-app-name': 'FORGE-ERP-DESKTOP' } },
    realtime: { transport: ws as unknown as typeof WebSocket },
  }
)
