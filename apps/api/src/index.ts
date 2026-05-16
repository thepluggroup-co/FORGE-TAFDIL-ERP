import { serve } from '@hono/node-server'
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

// ── Application typée ──────────────────────────────────────────────────────────

const app = new Hono<{ Variables: HonoVariables }>()

// ── Origines autorisées ────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  'http://localhost:5173',   // Vite dev
  'http://localhost:4173',   // Vite preview
  'http://localhost:3000',   // Next/autre client local
  process.env.FRONTEND_URL,  // Production
  process.env.TAURI_URL,     // Desktop Tauri
].filter(Boolean) as string[]

// ── Middlewares globaux ────────────────────────────────────────────────────────

app.use('*', logger())

app.use('*', cors({
  origin: (origin) => {
    if (!origin) return origin              // curl / server-to-server sans Origin
    if (ALLOWED_ORIGINS.includes(origin)) return origin
    return null                            // refusé
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'],
  credentials: true,
  maxAge: 86400,
}))

app.use('*', rateLimitMiddleware)

// ── Routes publiques (avant authMiddleware) ────────────────────────────────────

app.route('/', publicCommandesRouter)

// ── Route santé (publique) ─────────────────────────────────────────────────────

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    version: '1.0.0',
    app: 'FORGE ERP API',
    company: 'TAFDIL',
    timestamp: new Date().toISOString(),
  }),
)

// ── Routes protégées (/api/*) ──────────────────────────────────────────────────

const api = new Hono<{ Variables: HonoVariables }>()

api.use('*', authMiddleware)
api.use('*', auditMiddleware)

// ── Modules core ──────────────────────────────────────────────────────────────
api.route('/stocks', stocksRouter)
api.route('/bons',   bonsRouter)
api.route('/',       commerceRouter)   // /clients, /devis, /commandes
api.route('/',       financeRouter)    // /factures, /credits, /ecritures, /rapports
api.route('/',       rhRouter)         // /rh/employes, /rh/presences, /rh/apprenants, /rh/paie
api.route('/',       aiRouter)         // /ai/chat, /ai/recommandations/stock, /ai/alertes

app.route('/api', api)

// ── Gestionnaire d'erreurs global ─────────────────────────────────────────────

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

// ── Démarrage ──────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT ?? 3001)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`FORGE API  →  http://localhost:${info.port}`)
  console.log(`Origines autorisées : ${ALLOWED_ORIGINS.join(', ')}`)
})

export default app
