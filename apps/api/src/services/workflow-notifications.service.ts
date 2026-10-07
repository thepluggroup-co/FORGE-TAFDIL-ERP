import { supabaseAdmin } from '@forge/db'
import { sendPushToRole } from './push.service'

const db = supabaseAdmin!

export type WorkflowNotificationPayload = {
  event: string
  titre: string
  message: string
  module: 'boutique' | 'commandes' | 'stock' | 'finance' | 'logistique' | 'production'
  severite?: 'info' | 'success' | 'warning' | 'error'
  ref?: string | null
  url?: string | null
  data?: Record<string, unknown>
}

// Rôles RBAC concernés par module — mobile push en plus du broadcast temps
// réel (web). SUPER_ADMIN reçoit toujours tout.
const ROLES_PAR_MODULE: Record<WorkflowNotificationPayload['module'], string[]> = {
  stock:      ['MAGASINIER', 'SUPER_ADMIN'],
  commandes:  ['COMMERCIAL', 'SUPER_ADMIN'],
  boutique:   ['COMMERCIAL', 'SUPER_ADMIN'],
  finance:    ['SUPER_ADMIN', 'MANAGER'],
  logistique: ['LIVREUR', 'MANAGER', 'SUPER_ADMIN'],
  production: ['MANAGER', 'SUPER_ADMIN'],
}

export async function notifyWorkflow(payload: WorkflowNotificationPayload): Promise<void> {
  try {
    const channel = db.channel('forge-workflow')
    await channel.send({
      type:  'broadcast',
      event: 'workflow_notification',
      payload: {
        ...payload,
        id: `${payload.event}-${payload.ref ?? Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: new Date().toISOString(),
      },
    })
    db.removeChannel(channel)
  } catch (e) {
    console.error('[workflow-notification]', e)
  }

  const roles = ROLES_PAR_MODULE[payload.module] ?? []
  await Promise.all(
    roles.map(role =>
      sendPushToRole(role, { title: payload.titre, body: payload.message, data: { url: payload.url ?? '' } })
        .catch(e => console.error('[push:workflow]', role, e)),
    ),
  )
}
