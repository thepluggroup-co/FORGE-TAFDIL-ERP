'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { toast } from 'sonner'

// ── Constants ──────────────────────────────────────────────────────────────────

const TVA_RATE = 0.1925
const SESSION_STALE_MS = 24 * 60 * 60 * 1000

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CartItem {
  id: string
  ref: string
  nom: string
  prix: number | null
  quantite: number
  stock_actuel: number
  seuil_alerte: number
  image: string | null
  stock_insuffisant?: boolean
}

export interface CartTotals {
  ht: number
  tva: number
  ttc: number
  lignes_count: number
}

interface AddPayload {
  id: string
  ref: string
  nom: string
  prix: number | null
  image: string | null
}

interface CartStore {
  items: CartItem[]
  lastUpdated: number | null
  sessionId: string
  isOpen: boolean

  openDrawer: () => void
  closeDrawer: () => void
  addItem: (payload: AddPayload, quantite?: number) => Promise<void>
  removeItem: (id: string) => void
  updateQuantity: (id: string, quantite: number) => void
  clearCart: () => void
  refreshStockStatus: () => Promise<void>
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export function computeTotal(items: CartItem[]): CartTotals {
  const ht = items.reduce((s, i) => s + (i.prix ?? 0) * i.quantite, 0)
  const tva = ht * TVA_RATE
  return {
    ht,
    tva,
    ttc: ht + tva,
    lignes_count: items.reduce((s, i) => s + i.quantite, 0),
  }
}

export function isCartStale(lastUpdated: number | null): boolean {
  if (!lastUpdated) return false
  return Date.now() - lastUpdated > SESSION_STALE_MS
}

// ── Store ──────────────────────────────────────────────────────────────────────

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      lastUpdated: null,
      sessionId: generateSessionId(),
      isOpen: false,

      openDrawer: () => set({ isOpen: true }),
      closeDrawer: () => set({ isOpen: false }),

      addItem: async (payload, quantite = 1) => {
        const apiUrl = ''
        let stockActuel = 9999
        let seuilAlerte = 0

        try {
          const res = await fetch(`${apiUrl}/api/shop/catalogue/${payload.id}`)
          if (res.ok) {
            const json = await res.json()
            const p = json.data
            if (p) {
              stockActuel = p.stock_actuel ?? 9999
              seuilAlerte = p.seuil_alerte ?? 0

              if (stockActuel <= 0) {
                toast.error(`${payload.nom} est indisponible`)
                return
              }

              const alreadyInCart = get().items.find(i => i.id === payload.id)?.quantite ?? 0
              const totalDemande = alreadyInCart + quantite

              if (totalDemande > stockActuel) {
                const adjusted = stockActuel - alreadyInCart
                if (adjusted <= 0) {
                  toast.warning(`Vous avez déjà le stock max pour ${payload.nom}`)
                  return
                }
                quantite = adjusted
                toast.warning(
                  `Stock disponible : ${stockActuel} unité${stockActuel > 1 ? 's' : ''}. Quantité ajustée.`
                )
              }
            }
          }
        } catch {
          // API injoignable — on ajoute quand même
        }

        set((state) => {
          const idx = state.items.findIndex(i => i.id === payload.id)
          let next: CartItem[]
          if (idx >= 0) {
            next = state.items.map((item, j) =>
              j === idx
                ? { ...item, quantite: item.quantite + quantite, stock_actuel: stockActuel, seuil_alerte: seuilAlerte }
                : item
            )
          } else {
            next = [
              ...state.items,
              { ...payload, quantite, stock_actuel: stockActuel, seuil_alerte: seuilAlerte, stock_insuffisant: false },
            ]
          }
          return { items: next, lastUpdated: Date.now() }
        })

        set({ isOpen: true })
      },

      removeItem: (id) => {
        set((state) => ({
          items: state.items.filter(i => i.id !== id),
          lastUpdated: Date.now(),
        }))
      },

      updateQuantity: (id, quantite) => {
        if (quantite <= 0) { get().removeItem(id); return }
        set((state) => ({
          items: state.items.map(i => i.id === id ? { ...i, quantite } : i),
          lastUpdated: Date.now(),
        }))
      },

      clearCart: () => set({ items: [], lastUpdated: Date.now() }),

      refreshStockStatus: async () => {
        const { items } = get()
        if (items.length === 0) return
        const apiUrl = ''

        const updated = await Promise.all(
          items.map(async (item) => {
            try {
              const res = await fetch(`${apiUrl}/api/shop/catalogue/${item.id}`)
              if (!res.ok) return item
              const json = await res.json()
              const p = json.data
              if (!p) return item
              return {
                ...item,
                stock_actuel: p.stock_actuel ?? 0,
                seuil_alerte: p.seuil_alerte ?? item.seuil_alerte,
                stock_insuffisant: (p.stock_actuel ?? 0) < item.quantite,
              }
            } catch {
              return item
            }
          })
        )
        set({ items: updated })
      },
    }),
    {
      name: 'forge-shop-cart',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        items: state.items,
        lastUpdated: state.lastUpdated,
        sessionId: state.sessionId,
      }),
    }
  )
)

// ── Convenience hook ───────────────────────────────────────────────────────────

export function useCart() {
  const store = useCartStore()
  const totals = computeTotal(store.items)
  return {
    ...store,
    totals,
    count: totals.lignes_count,
    total: totals.ht,
    // alias pour compatibilité
    updateQuantite: store.updateQuantity,
  }
}
