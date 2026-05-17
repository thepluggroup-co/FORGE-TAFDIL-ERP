import type { MiddlewareHandler } from 'hono'
import { supabaseAdmin } from '@forge/db/supabase'
import type { HonoVariables } from '../types'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Extrait le nom de table depuis l'URL : /api/clients/123 → 'clients' */
function extractTableName(pathname: string): string {
  const segments = pathname.replace(/^\/api\//, '').split('/')
  return segments[0] ?? 'unknown'
}

/** Extrait l'ID de ressource depuis l'URL : /api/clients/123 → '123' */
function extractRecordId(pathname: string): string | null {
  const segments = pathname.replace(/^\/api\//, '').split('/')
  return segments[1] ?? null
}

export const auditMiddleware: MiddlewareHandler<{ Variables: HonoVariables }> = async (c, next) => {
  const method = c.req.method

  if (!MUTATING_METHODS.has(method)) {
    return next()
  }

  const user = c.get('user')
  const pathname = new URL(c.req.url).pathname
  const tableName = extractTableName(pathname)
  const recordId = extractRecordId(pathname)
  const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown'
  const userAgent = c.req.header('user-agent') ?? 'unknown'

  // Capturer le body pour old/new data (best-effort)
  let requestBody: unknown = null
  try {
    const cloned = c.req.raw.clone()
    const text = await cloned.text()
    requestBody = text ? JSON.parse(text) : null
  } catch {
    // Body non-JSON ou déjà consommé — on continue quand même
  }

  const action = method === 'POST' ? 'create'
    : method === 'PUT' || method === 'PATCH' ? 'update'
    : 'delete'

  await next()

  // Logger après la réponse pour capturer le statut
  const status = c.res.status

  // Ne logguer que les succès (2xx) — les erreurs sont déjà tracées via error handler
  if (status >= 200 && status < 300 && supabaseAdmin) {
    supabaseAdmin
      .from('audit_log' as never)
      .insert({
        user_id: user?.id ?? null,
        action,
        table_name: tableName,
        record_id: recordId,
        new_data: action !== 'delete' ? requestBody : null,
        ip_address: ip,
        user_agent: userAgent,
        created_at: new Date().toISOString(),
      })
      .then(({ error }) => {
        if (error) console.error('[audit] Erreur log:', error.message)
      })
  }
}
