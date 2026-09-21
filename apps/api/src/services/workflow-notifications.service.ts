import { supabaseAdmin } from '@forge/db'

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
}
