import { OFFLINE_ACTION_MAX_AGE_MS } from '@forge/shared'
import { dbDelete, dbGetAll, dbPut, STORE_QUEUE } from './db'
import { isOnline, onNetworkChange } from './network'

export interface QueuedMutation<P = unknown> {
  id?: number
  kind: string
  payload: P
  label: string // texte lisible pour l'UI, ex. "Sortie — Antirouille 1KG Gris"
  createdAt: number
  // pending : sera envoyée automatiquement · syncing : envoi en cours ·
  // failed : refusée par le serveur ou trop ancienne — attend une décision
  // de l'utilisateur (Réessayer / Abandonner), jamais renvoyée toute seule.
  status: 'pending' | 'syncing' | 'failed'
  error?: string
  attempts: number
}

type Processor = (payload: unknown) => Promise<void>

/**
 * À lever par un processor quand l'échec est passager (réseau, session,
 * serveur momentanément indisponible) : l'action reste « pending » et la
 * synchronisation s'arrête là, pour reprendre plus tard dans le même ordre.
 * Toute autre erreur est un refus du serveur, montré à l'utilisateur.
 */
export class RetryLaterError extends Error {}

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
 * Rejoue les mutations en attente dans l'ordre de création.
 *  - échec passager (réseau, TypeError de fetch, RetryLaterError) : on s'arrête,
 *    tout reste en attente ;
 *  - refus du serveur : l'item passe « failed » et n'est plus renvoyé tout
 *    seul — sans bloquer les suivants ;
 *  - en attente depuis plus de 7 jours : « failed », à confirmer.
 */
export async function processQueue(): Promise<void> {
  if (processing || !isOnline()) return
  processing = true
  try {
    const items = (await dbGetAll<QueuedMutation>(STORE_QUEUE))
      // « syncing » ici = app fermée en plein envoi (le verrou `processing`
      // exclut un envoi concurrent) : à reprendre, sinon l'action reste
      // bloquée pour toujours. La clé d'idempotence évite le doublon.
      .filter(i => i.status !== 'failed')
      .sort((a, b) => a.createdAt - b.createdAt)

    for (const item of items) {
      const processor = processors.get(item.kind)
      if (!processor) continue

      if (Date.now() - item.createdAt > OFFLINE_ACTION_MAX_AGE_MS) {
        item.status = 'failed'
        item.error = 'En attente depuis plus de 7 jours — confirmez l\'envoi ou abandonnez'
        await dbPut(STORE_QUEUE, item)
        await notifySubscribers()
        continue
      }

      item.status = 'syncing'
      await dbPut(STORE_QUEUE, item)
      await notifySubscribers()

      try {
        await processor(item.payload)
        if (item.id !== undefined) await dbDelete(STORE_QUEUE, item.id)
      } catch (err) {
        if (err instanceof TypeError || err instanceof RetryLaterError) {
          item.status = 'pending'
          await dbPut(STORE_QUEUE, item)
          await notifySubscribers()
          break
        }
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

/** « Réessayer » : l'utilisateur reconfirme l'envoi des actions refusées ou trop anciennes. */
export async function retryFailed(): Promise<void> {
  const items = await dbGetAll<QueuedMutation>(STORE_QUEUE)
  for (const item of items.filter(i => i.status === 'failed')) {
    await dbPut(STORE_QUEUE, { ...item, status: 'pending', error: undefined, createdAt: Date.now() })
  }
  await notifySubscribers()
  await processQueue()
}

/** « Abandonner » : ces actions ne seront jamais envoyées au serveur. */
export async function discardFailed(): Promise<void> {
  const items = await dbGetAll<QueuedMutation>(STORE_QUEUE)
  for (const item of items) {
    if (item.status === 'failed' && item.id !== undefined) await dbDelete(STORE_QUEUE, item.id)
  }
  await notifySubscribers()
}

onNetworkChange((online) => { if (online) void processQueue() })
