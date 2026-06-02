/**
 * Types partagés pour l'application Hono FORGE API.
 */

export interface ForgeUser {
  id: string
  email: string
  role: 'admin' | 'superviseur' | 'operateur' | 'apprenant'
}

/** Variables injectées dans le contexte Hono par les middlewares. */
export interface HonoVariables {
  user: ForgeUser
  requestId: string
}

/** Payload JWT Supabase */
export interface SupabaseJwtPayload {
  sub: string
  email: string
  user_metadata?: { role?: string; nom?: string }
  app_metadata?: { role?: string }
  aud: string
  exp: number
  iat: number
  role?: string
}

/** Format de réponse d'erreur standardisé */
export interface ApiError {
  error: string
  code?: string
  details?: unknown
}

/** Format de réponse de succès paginée */
export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  perPage: number
  totalPages: number
}
