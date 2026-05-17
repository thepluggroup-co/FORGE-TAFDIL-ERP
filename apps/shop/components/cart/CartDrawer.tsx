'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, ShoppingCart, Trash2, Plus, Minus,
  AlertTriangle, Package, Truck, MessageCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { useCartStore, computeTotal, isCartStale } from '@/lib/cart'
import type { CartItem } from '@/lib/cart'

// ── Tarifs livraison ───────────────────────────────────────────────────────────

const LIVRAISON_ZONES: Record<string, number | null> = {
  'Douala Centre (Akwa, Bonanjo)': 2000,
  'Douala Nord (Bonamoussadi, Makepe)': 2500,
  'Douala Est (Logpom, Bassa)': 3000,
  'Douala Bonaberi': 3500,
  'Yaoundé': 8000,
  'Autre ville': null,
}

function fmt(n: number) {
  return new Intl.NumberFormat('fr-CM', { style: 'currency', currency: 'XAF', maximumFractionDigits: 0 }).format(n)
}

// ── Item row ───────────────────────────────────────────────────────────────────

function DrawerItem({ item }: { item: CartItem }) {
  const { updateQuantity, removeItem } = useCartStore()
  const isUnavailable = item.stock_insuffisant || item.stock_actuel <= 0
  const isLow = !isUnavailable && item.stock_actuel > 0 && item.stock_actuel <= item.seuil_alerte

  return (
    <div
      className={`flex gap-3 rounded-xl border p-3 transition-colors ${
        isUnavailable ? 'border-red-100 bg-red-50' : 'border-gray-100 bg-white'
      }`}
    >
      {/* Image miniature */}
      <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-gray-50">
        {item.image ? (
          <Image src={item.image} alt={item.nom} fill sizes="64px" className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Package size={20} className="text-gray-200" />
          </div>
        )}
      </div>

      {/* Infos */}
      <div className="flex flex-1 flex-col gap-1 min-w-0">
        <div className="flex items-start justify-between gap-1">
          <p className="line-clamp-2 text-xs font-bold leading-tight text-forge-dark">{item.nom}</p>
          <button
            onClick={() => removeItem(item.id)}
            className="ml-1 flex-shrink-0 text-gray-300 transition hover:text-red-400"
            aria-label="Supprimer"
          >
            <Trash2 size={13} />
          </button>
        </div>

        {item.prix ? (
          <p className="text-[10px] text-forge-steel">{fmt(item.prix)} / unité</p>
        ) : (
          <p className="text-[10px] italic text-forge-steel">Prix sur devis</p>
        )}

        <div className="mt-0.5 flex items-center justify-between gap-2">
          {/* Stepper +/- */}
          <div className="flex items-center overflow-hidden rounded-lg border border-gray-200">
            <button
              onClick={() => updateQuantity(item.id, item.quantite - 1)}
              className="flex h-6 w-6 items-center justify-center text-forge-steel transition hover:bg-gray-50"
            >
              <Minus size={10} />
            </button>
            <span className="w-7 text-center text-[11px] font-bold text-forge-dark">{item.quantite}</span>
            <button
              onClick={() => updateQuantity(item.id, item.quantite + 1)}
              disabled={item.quantite >= item.stock_actuel}
              className="flex h-6 w-6 items-center justify-center text-forge-steel transition hover:bg-gray-50 disabled:opacity-30"
            >
              <Plus size={10} />
            </button>
          </div>

          {/* Badge état */}
          {isUnavailable && (
            <span className="text-[9px] font-bold uppercase tracking-wide text-red-500">Indisponible</span>
          )}
          {isLow && !isUnavailable && (
            <span className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-500">
              <AlertTriangle size={9} /> Stock faible
            </span>
          )}

          {/* Sous-total ligne */}
          {item.prix && (
            <span className="ml-auto text-xs font-black text-forge-red">{fmt(item.prix * item.quantite)}</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── CartDrawer ─────────────────────────────────────────────────────────────────

export function CartDrawer() {
  const { items, isOpen, closeDrawer, clearCart, refreshStockStatus, lastUpdated } = useCartStore()
  const [zone, setZone] = useState<string>(Object.keys(LIVRAISON_ZONES)[0])
  const [showStaleWarning, setShowStaleWarning] = useState(false)

  const totals = computeTotal(items)
  const shipping = LIVRAISON_ZONES[zone]
  const grandTotal = shipping ? totals.ttc + shipping : totals.ttc
  const hasUnavailable = items.some(i => i.stock_insuffisant || i.stock_actuel <= 0)

  // Vérification stock + détection panier périmé
  useEffect(() => {
    if (!isOpen || items.length === 0) return
    refreshStockStatus()
    if (isCartStale(lastUpdated)) setShowStaleWarning(true)
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fermeture Echap
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDrawer() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [closeDrawer])

  const whatsappItems = items.map(i => `• ${i.nom} (${i.ref}) × ${i.quantite}`).join('\n')
  const whatsappUrl = `https://wa.me/${(process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '').replace(/\D/g, '')}?text=${encodeURIComponent(
    `Bonjour TAFDIL, je souhaite commander :\n${whatsappItems}\n\nTotal estimé : ${fmt(grandTotal)} TTC`
  )}`

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.45 }}
            exit={{ opacity: 0 }}
            onClick={closeDrawer}
            className="fixed inset-0 z-40 bg-black"
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl"
          >
            {/* En-tête */}
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div className="flex items-center gap-2">
                <ShoppingCart size={18} className="text-forge-red" />
                <h2 className="text-sm font-black text-forge-dark">Mon panier</h2>
                {totals.lignes_count > 0 && (
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-forge-red px-1.5 text-[10px] font-bold text-white">
                    {totals.lignes_count}
                  </span>
                )}
              </div>
              <button
                onClick={closeDrawer}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-forge-dark"
              >
                <X size={16} />
              </button>
            </div>

            {/* Bandeau panier périmé */}
            <AnimatePresence>
              {showStaleWarning && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden border-b border-amber-100 bg-amber-50"
                >
                  <div className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <p className="text-[11px] leading-tight text-amber-700">
                      Ce panier date de plus de 24h. Les stocks ont peut-être changé.
                    </p>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => { clearCart(); setShowStaleWarning(false); toast.success('Panier vidé') }}
                        className="text-[11px] font-bold text-amber-700 underline"
                      >
                        Vider
                      </button>
                      <button onClick={() => setShowStaleWarning(false)} className="text-amber-400">
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Corps */}
            {items.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gray-50">
                  <ShoppingCart size={36} className="text-gray-200" />
                </div>
                <div>
                  <p className="font-bold text-forge-dark">Votre panier est vide</p>
                  <p className="mt-1 text-xs text-forge-steel">
                    Parcourez notre catalogue pour trouver vos produits.
                  </p>
                </div>
                <Link
                  href="/catalogue"
                  onClick={closeDrawer}
                  className="rounded-xl bg-forge-red px-6 py-2.5 text-sm font-bold text-white transition hover:bg-forge-red-dark"
                >
                  Voir le catalogue
                </Link>
              </div>
            ) : (
              <>
                {/* Liste articles */}
                <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
                  <AnimatePresence mode="popLayout">
                    {items.map((item) => (
                      <motion.div
                        key={item.id}
                        layout
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20, height: 0, marginBottom: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <DrawerItem item={item} />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>

                {/* Pied de drawer */}
                <div className="border-t border-gray-100 bg-white px-4 py-4 space-y-3">

                  {/* Sélecteur livraison */}
                  <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                    <Truck size={13} className="flex-shrink-0 text-forge-steel" />
                    <select
                      value={zone}
                      onChange={(e) => setZone(e.target.value)}
                      className="flex-1 bg-transparent text-xs text-forge-dark outline-none"
                    >
                      {Object.keys(LIVRAISON_ZONES).map((z) => (
                        <option key={z} value={z}>{z}</option>
                      ))}
                    </select>
                    <span className="flex-shrink-0 text-xs font-bold text-forge-steel">
                      {shipping != null ? fmt(shipping) : 'Sur devis'}
                    </span>
                  </div>

                  {/* Récapitulatif chiffré */}
                  <div className="rounded-xl bg-gray-50 p-3 space-y-1.5 text-xs">
                    <div className="flex justify-between text-forge-steel">
                      <span>Sous-total HT</span>
                      <span className="font-semibold">{fmt(totals.ht)}</span>
                    </div>
                    <div className="flex justify-between text-forge-steel">
                      <span>TVA (19,25%)</span>
                      <span className="font-semibold">{fmt(totals.tva)}</span>
                    </div>
                    {shipping != null && (
                      <div className="flex justify-between text-forge-steel">
                        <span>Livraison</span>
                        <span className="font-semibold">{fmt(shipping)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-gray-200 pt-1.5">
                      <span className="font-black text-forge-dark">Total TTC</span>
                      <span className="text-base font-black text-forge-red">{fmt(grandTotal)}</span>
                    </div>
                  </div>

                  {/* Alerte articles indisponibles */}
                  {hasUnavailable && (
                    <p className="text-center text-[10px] text-red-500">
                      ⚠ Certains articles ne sont plus disponibles en quantité demandée
                    </p>
                  )}

                  {/* Boutons d'action */}
                  <Link
                    href="/panier"
                    onClick={closeDrawer}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-forge-red py-3 text-sm font-bold text-white shadow-sm transition hover:bg-forge-red-dark active:scale-[0.98]"
                  >
                    Passer la commande
                  </Link>

                  <div className="flex gap-2">
                    <button
                      onClick={closeDrawer}
                      className="flex-1 rounded-xl border border-gray-200 py-2.5 text-xs font-semibold text-forge-steel transition hover:border-forge-red hover:text-forge-red"
                    >
                      Continuer mes achats
                    </button>
                    <a
                      href={whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={closeDrawer}
                      className="flex items-center gap-1.5 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs font-bold text-green-700 transition hover:bg-green-100"
                    >
                      <MessageCircle size={13} /> WhatsApp
                    </a>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
