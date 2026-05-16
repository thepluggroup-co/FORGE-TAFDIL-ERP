import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

const app = new Hono()

app.use('*', logger())
app.use('*', cors({
  origin: process.env.VITE_API_URL ?? 'http://localhost:5173',
  credentials: true,
}))

app.get('/health', (c) => c.json({ status: 'ok', app: 'FORGE API', company: 'TAFDIL' }))

// TODO: mount route modules (auth, products, orders, production, ai)

const port = Number(process.env.PORT ?? 3001)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`FORGE API running on http://localhost:${info.port}`)
})

export default app
