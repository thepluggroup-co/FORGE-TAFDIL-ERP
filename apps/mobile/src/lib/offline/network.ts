import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Network } from '@capacitor/network'

type Listener = (online: boolean) => void
const listeners = new Set<Listener>()
let currentOnline = true
let started = false

function notify(online: boolean) {
  if (online === currentOnline) return
  currentOnline = online
  listeners.forEach(l => l(online))
}

function startWatching() {
  if (started) return
  started = true

  if (Capacitor.isNativePlatform()) {
    Network.getStatus().then(s => { currentOnline = s.connected }).catch(() => {})
    Network.addListener('networkStatusChange', (status) => notify(status.connected))
  } else {
    currentOnline = typeof navigator === 'undefined' ? true : navigator.onLine
    window.addEventListener('online', () => notify(true))
    window.addEventListener('offline', () => notify(false))
  }
}

export function isOnline(): boolean {
  startWatching()
  return currentOnline
}

export function onNetworkChange(fn: Listener): () => void {
  startWatching()
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(isOnline())
  useEffect(() => onNetworkChange(setOnline), [])
  return online
}
