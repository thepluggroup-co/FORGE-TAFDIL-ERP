import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { registerPushToken, unregisterPushToken } from './api'

let currentToken: string | null = null
let listenersReady = false
let initStarted = false

function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

function setupListenersOnce() {
  if (listenersReady) return
  listenersReady = true

  PushNotifications.addListener('registration', (token) => {
    currentToken = token.value
    registerPushToken(token.value, Capacitor.getPlatform() === 'ios' ? 'ios' : 'android')
      .catch(e => console.error('[push] enregistrement token:', e))
  })

  PushNotifications.addListener('registrationError', (err) => {
    console.error('[push] erreur enregistrement:', err)
  })

  // L'app est au premier plan : pas de bannière système, on laisse l'UI
  // de la page (toasts, badges déjà pollés) gérer l'affichage.
  PushNotifications.addListener('pushNotificationReceived', (notif) => {
    console.info('[push] reçue au premier plan:', notif.title)
  })

  // Tap sur la notification système (app en arrière-plan/fermée) — navigation
  // gérée par chaque page via l'URL transmise dans `data.url`, pas ici pour
  // rester indépendant du router.
  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const url = action.notification.data?.url as string | undefined
    if (url) window.location.hash = `#${url}`
  })
}

/**
 * Appelé une fois l'utilisateur authentifié (voir AuthContext). No-op hors app
 * native. Idempotent — AuthContext le ré-appelle à chaque événement Supabase
 * (y compris un simple refresh de token), mais la demande de permission et
 * l'enregistrement ne doivent se faire qu'une fois par session app.
 */
export async function initPushNotifications(): Promise<void> {
  if (!isNative() || initStarted) return
  initStarted = true

  setupListenersOnce()

  const perm = await PushNotifications.checkPermissions()
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
    const req = await PushNotifications.requestPermissions()
    if (req.receive !== 'granted') return
  } else if (perm.receive !== 'granted') {
    return
  }

  await PushNotifications.register()
}

/** Appelé à la déconnexion — désenregistre le token côté serveur pour cet utilisateur. */
export async function teardownPushNotifications(): Promise<void> {
  if (!isNative() || !currentToken) return
  try {
    await unregisterPushToken(currentToken)
  } catch (e) {
    console.error('[push] désenregistrement token:', e)
  } finally {
    currentToken = null
    initStarted = false
  }
}
