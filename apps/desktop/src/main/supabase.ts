import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

// Electron main process runs Node.js 20 which has no native WebSocket.
// Pass the 'ws' package via the realtime.transport option — the correct API.
export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
  {
    auth:   { autoRefreshToken: true, persistSession: false, detectSessionInUrl: false },
    global: { headers: { 'x-app-name': 'FORGE-ERP-DESKTOP' } },
    realtime: { transport: ws as unknown as typeof WebSocket },
  }
)
