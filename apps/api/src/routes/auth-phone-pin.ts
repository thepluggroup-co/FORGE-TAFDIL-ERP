/**
 * FORGE ERP — Connexion par téléphone + PIN.
 * Route PUBLIQUE (montée avant authMiddleware dans app.ts, comme
 * publicCommandesRouter/publicDevisRouter) — l'appelant n'est pas encore
 * authentifié, c'est justement le but de cet endpoint.
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { verifyPinAndIssueSession } from '../services/phone-pin.service'

export const authPhonePinRouter = new Hono()

const loginSchema = z.object({
  phone: z.string().min(6).max(30),
  pin:   z.string().length(4),
})

authPhonePinRouter.post(
  '/phone-pin/login',
  zValidator('json', loginSchema),
  async (c) => {
    const body = c.req.valid('json')
    const result = await verifyPinAndIssueSession(body.phone, body.pin)

    if (!result.ok) {
      const status = result.code === 'LOCKED' ? 429 : 401
      return c.json({ error: result.error ?? 'Connexion refusée', code: result.code }, status)
    }

    // hashed_token + email : le client les échange lui-même contre une
    // session via supabase.auth.verifyOtp({ token_hash, type: 'magiclink',
    // email }) — le serveur ne renvoie jamais de session Supabase toute
    // faite, juste de quoi en obtenir une en un aller-retour direct au
    // Auth de Supabase (pas à notre API).
    return c.json({
      email:         result.email,
      hashedToken:   result.hashedToken,
      mustChangePin: result.mustChangePin,
    })
  },
)
