import { supabaseAdmin } from '@forge/db'
import type { App } from 'firebase-admin/app'
import type { MulticastMessage } from 'firebase-admin/messaging'

const db = supabaseAdmin!

export interface PushNotification {
  title: string
  body: string
  data?: Record<string, string>
}

// Même convention que sms.service.ts : si les identifiants Firebase ne sont
// pas configurés, on ne lève pas d'erreur — l'envoi est journalisé et ignoré
// (dry-run), pour ne jamais faire échouer le flux métier qui déclenche la
// notification.
let appPromise: Promise<App | null> | null = null

async function getFirebaseApp(): Promise<App | null> {
  if (appPromise) return appPromise

  appPromise = (async () => {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    if (!raw) {
      console.info('[push] FIREBASE_SERVICE_ACCOUNT_JSON non configuré — notifications désactivées (dry-run)')
      return null
    }
    try {
      const { initializeApp, cert, getApps } = await import('firebase-admin/app')
      const existing = getApps()
      if (existing.length > 0) return existing[0]
      const serviceAccount = JSON.parse(raw)
      return initializeApp({ credential: cert(serviceAccount) })
    } catch (e) {
      console.error('[push] échec initialisation Firebase:', e)
      return null
    }
  })()

  return appPromise
}

async function sendToTokens(tokens: string[], notif: PushNotification): Promise<void> {
  if (tokens.length === 0) return

  const app = await getFirebaseApp()
  if (!app) {
    console.info('[push:dry-run]', { tokens: tokens.length, ...notif })
    return
  }

  try {
    const { getMessaging } = await import('firebase-admin/messaging')
    const messaging = getMessaging(app)

    const message: MulticastMessage = {
      tokens,
      notification: { title: notif.title, body: notif.body },
      data: notif.data,
    }

    const res = await messaging.sendEachForMulticast(message)

    // Purge les tokens que FCM signale invalides/désinstallés — évite de les
    // re-tenter indéfiniment et de garder la table push_tokens polluée.
    const staleTokens: string[] = []
    res.responses.forEach((r, i) => {
      if (!r.success && (
        r.error?.code === 'messaging/registration-token-not-registered' ||
        r.error?.code === 'messaging/invalid-registration-token'
      )) {
        staleTokens.push(tokens[i])
      }
    })
    if (staleTokens.length > 0) {
      await db.from('push_tokens').delete().in('token', staleTokens)
    }
  } catch (e) {
    console.error('[push] échec envoi FCM:', e)
  }
}

/** Envoie une notification à tous les appareils enregistrés d'un utilisateur. */
export async function sendPushToUser(profileId: string, notif: PushNotification): Promise<void> {
  // Sort avant toute requête .from() — appelé depuis des flux métier (ex.
  // notifyWorkflow) exercés par des tests qui ne mockent pas ce service et
  // dont les .from() positionnels (mockReturnValueOnce) sont réservés à leur
  // propre logique ; sans Firebase configuré (toujours le cas en test), il
  // n'y a de toute façon rien à envoyer.
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.info('[push:dry-run] sendPushToUser', profileId, notif.title)
    return
  }

  const { data, error } = await db.from('push_tokens').select('token').eq('profile_id', profileId)
  if (error) {
    console.error('[push] lecture push_tokens:', error.message)
    return
  }
  const tokens = (data ?? []).map((r: { token: string }) => r.token)
  await sendToTokens(tokens, notif)
}

/**
 * Envoie une notification à tous les utilisateurs actifs détenant un rôle RBAC
 * donné (ex. MAGASINIER pour une alerte stock). Utilisé pour le fan-out par
 * module dans workflow-notifications.service.ts.
 */
export async function sendPushToRole(roleName: string, notif: PushNotification): Promise<void> {
  // Même garde-fou que sendPushToUser — voir son commentaire.
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.info('[push:dry-run] sendPushToRole', roleName, notif.title)
    return
  }

  const { data: role } = await db.from('rbac_roles').select('id').eq('name', roleName).single()
  if (!role) return

  const { data: profiles, error } = await db
    .from('rbac_user_profiles')
    .select('profile_id')
    .eq('role_id', (role as { id: string }).id)
    .eq('is_active', true)

  if (error || !profiles?.length) return

  const profileIds = (profiles as Array<{ profile_id: string }>).map(p => p.profile_id)
  const { data: tokenRows, error: tokenErr } = await db
    .from('push_tokens')
    .select('token')
    .in('profile_id', profileIds)

  if (tokenErr) {
    console.error('[push] lecture push_tokens (par rôle):', tokenErr.message)
    return
  }

  const tokens = (tokenRows ?? []).map((r: { token: string }) => r.token)
  await sendToTokens(tokens, notif)
}

export async function registerPushToken(
  profileId: string,
  token: string,
  platform: 'android' | 'ios',
  appVersion?: string,
): Promise<void> {
  const { error } = await db
    .from('push_tokens')
    .upsert(
      { profile_id: profileId, token, platform, app_version: appVersion ?? null, updated_at: new Date().toISOString() },
      { onConflict: 'profile_id,token' },
    )
  if (error) throw new Error(error.message)
}

export async function unregisterPushToken(profileId: string, token: string): Promise<void> {
  await db.from('push_tokens').delete().eq('profile_id', profileId).eq('token', token)
}
