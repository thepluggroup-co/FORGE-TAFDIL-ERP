import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { HonoVariables } from './types'
import { authMiddleware } from './middleware/auth'
import { auditMiddleware } from './middleware/audit'
import { rateLimitMiddleware } from './middleware/rateLimit'
import { stocksRouter } from './routes/stocks'
import { bonsRouter } from './routes/bons'
import { commerceRouter, publicCommandesRouter } from './routes/commerce'
import { financeRouter } from './routes/finance'
import { rhRouter } from './routes/rh'
import { aiRouter } from './routes/ai'
import { rapportsRouter } from './routes/rapports'
import { shopRouter, shopErpRouter } from './routes/shop'
import { paiementsRouter } from './routes/paiements'

const app = new Hono<{ Variables: HonoVariables }>()

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
  'http://localhost:3002',
  process.env.FRONTEND_URL,
  process.env.TAURI_URL,
].filter(Boolean) as string[]

app.use('*', logger())

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

app.route('/api', api)

app.onError((err, c) => {
  console.error(`[error] ${c.req.method} ${c.req.url}`, err)
  if (err.message.includes('not found') || err.message.includes('404')) {
    return c.json({ error: 'Ressource introuvable', code: 'NOT_FOUND' }, 404)
  }
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

export default app
