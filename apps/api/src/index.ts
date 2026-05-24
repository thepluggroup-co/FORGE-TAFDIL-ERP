import { serve } from '@hono/node-server'
import { supabaseAdmin } from '@forge/db'
import app from './app'

const port = Number(process.env.PORT ?? 3001)

// Startup diagnostics — remove after confirming setup works
console.log('[boot] SUPABASE_URL        :', process.env.SUPABASE_URL ? 'SET' : 'MISSING')
console.log('[boot] SUPABASE_ANON_KEY   :', process.env.SUPABASE_ANON_KEY ? 'SET' : 'MISSING')
console.log('[boot] SERVICE_ROLE_KEY    :', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'MISSING')
console.log('[boot] supabaseAdmin       :', supabaseAdmin ? 'INITIALIZED' : 'NULL — routes will all 500')

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`FORGE API  →  http://localhost:${info.port}`)
})

export default app
