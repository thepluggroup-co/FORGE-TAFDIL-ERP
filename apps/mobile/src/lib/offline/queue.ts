import { dbDelete, dbGetAll, dbPut, STORE_QUEUE } from './db'
import { isOnline, onNetworkChange } from './network'

export interface QueuedMutation<P = unknown> {
  id?: number
  kind: string
  payload: P
  label: string // texte lisible pour l'UI, ex. "Sortie — Antirouille 1KG Gris"
  createdAt: number
  status: 'pending' | 'syncing' | 'failed'
  error?: string
  attempts: number
}

type Processor = (payload: unknown) => Promise<void>

const processors = new Map<string, Processor>()
const subscribers = new Set<(items: QueuedMutation[]) => void>()
let processing = false

/** Chaque type de mutation enregistre son propre handler de synchronisation. */
export function registerProcessor(kind: string, fn: Processor): void {
  processors.set(kind, fn)
}

async function notifySubscribers() {
  const items = await dbGetAll<QueuedMutation>(STORE_QUEUE)
  subscribers.forEach(fn => fn(items))
}

export function subscribeQueue(fn: (items: QueuedMutation[]) => void): () => void {
  subscribers.add(fn)
  dbGetAll<QueuedMutation>(STORE_QUEUE).then(fn).catch(() => {})
  return () => subscribers.delete(fn)
}

export async function enqueueMutation<P>(kind: string, payload: P, label: string): Promise<void> {
  const item: QueuedMutation<P> = { kind, payload, label, createdAt: Date.now(), status: 'pending', attempts: 0 }
  await dbPut(STORE_QUEUE, item)
  await notifySubscribers()
  if (isOnline()) void processQueue()
}

/**
 * Rejoue les mutations en attente dans l'ordre de création. Un échec
 * n'interrompt pas les suivantes (ex. un seul item avec des données
 * désormais invalides ne doit pas bloquer indéfiniment tout le reste de la
 * file) ; l'item en échec reste en file, marqué "failed", pour être revu par
 * l'utilisateur plutôt que silencieusement perdu.
 */
export async function processQueue(): Promise<void> {
  if (processing || !isOnline()) return
  processing = true
  try {
    const items = (await dbGetAll<QueuedMutation>(STORE_QUEUE))
      .filter(i => i.status !== 'syncing')
      .sort((a, b) => a.createdAt - b.createdAt)

    for (const item of items) {
      const processor = processors.get(item.kind)
      if (!processor) continue

      item.status = 'syncing'
      await dbPut(STORE_QUEUE, item)
      await notifySubscribers()

      try {
        await processor(item.payload)
        if (item.id !== undefined) await dbDelete(STORE_QUEUE, item.id)
      } catch (err) {
        item.status = 'failed'
        item.attempts += 1
        item.error = err instanceof Error ? err.message : 'Échec de synchronisation'
        await dbPut(STORE_QUEUE, item)
      }
      await notifySubscribers()
    }
  } finally {
    processing = false
  }
}

onNetworkChange((online) => { if (online) void processQueue() })
