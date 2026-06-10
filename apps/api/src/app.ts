import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { supabaseAdmin } from '@forge/db'
import type { HonoVariables } from './types'
import { authMiddleware } from './middleware/auth'
import { auditMiddleware } from './middleware/audit'
import { rateLimitMiddleware } from './middleware/rateLimit'
import { stocksRouter } from './routes/stocks'
import { bonsRouter } from './routes/bons'
import { commerceRouter, publicCommandesRouter, publicDevisRouter } from './routes/commerce'
import { financeRouter } from './routes/finance'
import { rhRouter } from './routes/rh'
import { aiRouter } from './routes/ai'
import { rapportsRouter } from './routes/rapports'
import { shopRouter, shopErpRouter } from './routes/shop'
import { paiementsRouter } from './routes/paiements'
import { operationsRouter } from './routes/operations'
import { adminRouter } from './routes/admin'
import { equipementsRouter } from './routes/equipements'
import { creditRouter } from './routes/credit'
import { profileRouter } from './routes/profile'
import { fournisseursRouter } from './routes/fournisseurs'
import { demarrerCronRelances } from './services/relances-cron.service'
import { checkOverdueInstallments } from './services/creditService'
import { sendUpcomingReminders } from './services/notificationService'
import { HTTPException } from 'hono/http-exception'

const app = new Hono<{ Variables: HonoVariables }>()

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
  'http://localhost:3002',
  ...(process.env.FRONTEND_URL?.split(',').map((u) => u.trim()) ?? []),
  process.env.TAURI_URL,
].filter(Boolean) as string[]

app.use('*', logger())

//Log de debug — AVANT le CORS
app.use('*', async (c, next) => {
  console.log('Origin reçue:', c.req.header('origin'))
  console.log('ALLOWED_ORIGINS:', ALLOWED_ORIGINS)
  await next()
})

app.use('*', cors({
  origin: (origin) => {
    if (!origin) return origin
    if (ALLOWED_ORIGINS.includes(origin)) return origin
    // Dev: allow any localhost port (Vite may shift to 5174, 5175, etc.)
    if (process.env.NODE_ENV !== 'production' && /^https?:\/\/localhost(:\d+)?$/.test(origin)) return origin
    return null
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'],
  credentials: true,
  maxAge: 86400,
}))

app.use('*', rateLimitMiddleware)

app.route('/', publicCommandesRouter)
app.route('/', publicDevisRouter)
app.route('/api/shop',      shopRouter)
app.route('/api/paiements', paiementsRouter)

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    version: '1.0.0',
    app: 'FORGE ERP API',
    company: 'TAFDIL',
    timestamp: new Date().toISOString(),
  }),
)

// Diagnostic endpoint — tests DB connection without requiring a session
app.get('/health/db', async (c) => {
  if (!supabaseAdmin) {
    return c.json({ ok: false, error: 'supabaseAdmin is null — SERVICE_ROLE_KEY missing' }, 503)
  }
  try {
    const { data, error } = await supabaseAdmin.from('produits' as never).select('id').limit(1)
    if (error) return c.json({ ok: false, error: error.message, code: error.code }, 500)
    return c.json({ ok: true, db: 'connected', rows_sampled: (data as unknown[]).length })
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500)
  }
})

// Diagnostic endpoint — shows which env vars are loaded
app.get('/health/env', (c) =>
  c.json({
    supabase_url:       process.env.SUPABASE_URL ?? '(not set)',
    service_key_set:    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    jwt_secret_set:     Boolean(process.env.SUPABASE_JWT_SECRET),
    node_env:           process.env.NODE_ENV ?? '(not set)',
    supabaseAdmin_null: supabaseAdmin === null,
  }),
)

const api = new Hono<{ Variables: HonoVariables }>()

api.use('*', authMiddleware)
api.use('*', auditMiddleware)

api.route('/stocks',   stocksRouter)
api.route('/bons',     bonsRouter)
api.route('/',         commerceRouter)
api.route('/',         financeRouter)
api.route('/',         rhRouter)
api.route('/',         aiRouter)
api.route('/rapports', rapportsRouter)
api.route('/shop-erp', shopErpRouter)
api.route('/',         operationsRouter)
api.route('/',         equipementsRouter)
api.route('/admin',    adminRouter)
api.route('/credit',       creditRouter)
api.route('/profile',      profileRouter)
api.route('/fournisseurs', fournisseursRouter)

app.route('/api', api)

app.onError((err, c) => {
  // HTTPException : erreurs métier intentionnelles (422, 404, etc.)
  if (err instanceof HTTPException) {
    return err.getResponse()
  }

  // Erreurs avec code métier attaché (throw Object.assign(new Error(...), { code, httpStatus }))
  const e = err as Error & { code?: string; httpStatus?: number }
  if (e.httpStatus && e.httpStatus >= 400 && e.httpStatus < 500) {
    return c.json({ error: e.message, code: e.code ?? 'CLIENT_ERROR' }, e.httpStatus as 400)
  }

  console.error(`[error] ${c.req.method} ${c.req.url}`, err)
  return c.json(
    {
      error: 'Erreur serveur interne',
      code: 'INTERNAL_ERROR',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined,
    },
    500,
  )
})

app.notFound((c) =>
  c.json({ error: `Route ${c.req.method} ${c.req.path} introuvable`, code: 'NOT_FOUND' }, 404),
)

// ── Cron relances automatiques WhatsApp (MOD-04 CDC) ──────────────────────────
demarrerCronRelances()

// ── Cron Crédit : mark-overdue quotidien 06:00, rappels J-3 08:00 ─────────────
;(function startCreditCrons() {
  const MS_HOUR = 3_600_000
  const MS_DAY  = 86_400_000

  function scheduleAt(hour: number, fn: () => void) {
    const now    = new Date()
    const target = new Date(now)
    target.setHours(hour, 0, 0, 0)
    if (target <= now) target.setDate(target.getDate() + 1)
    const delay  = target.getTime() - now.getTime()
    setTimeout(() => { fn(); setInterval(fn, MS_DAY) }, delay)
  }

  scheduleAt(6, () => {
    checkOverdueInstallments()
      .then(r => console.info('[cron:credit:overdue]', r))
      .catch(e => console.error('[cron:credit:overdue] erreur', e))
  })

  scheduleAt(8, () => {
    sendUpcomingReminders()
      .then(r => console.info('[cron:credit:reminders]', r))
      .catch(e => console.error('[cron:credit:reminders] erreur', e))
  })
})()

export default app
