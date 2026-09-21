'use client'

import Link from 'next/link'
import Image from 'next/image'
import { motion, AnimatePresence } from 'framer-motion'
import { ShoppingCart, Trash2, Plus, Minus, ArrowLeft, MessageCircle, Package } from 'lucide-react'
import { toast } from 'sonner'
import { useCartStore, computeTotal } from '@/lib/cart'
import type { CartItem } from '@/lib/cart'

function fmt(n: number) {
  return new Intl.NumberFormat('fr-CM', { style: 'currency', currency: 'XAF', maximumFractionDigits: 0 }).format(n)
}

function CartRow({
  item,
  onQty,
  onRemove,
}: {
  item: CartItem
  onQty: (id: string, q: number) => void
  onRemove: (id: string) => void
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"
    >
      {/* Image */}
      <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl bg-gray-50">
        {item.image ? (
          <Image src={item.image} alt={item.nom} fill sizes="80px" className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Package size={24} className="text-gray-200" />
          </div>
        )}
      </div>

      {/* Infos */}
      <div className="flex flex-1 flex-col gap-1 min-w-0">
        <span className="font-mono text-[10px] text-gray-400">{item.ref}</span>
        <p className="truncate text-sm font-bold text-forge-dark">{item.nom}</p>
        {item.prix ? (
          <p className="text-xs text-forge-steel">{fmt(item.prix)} / unité</p>
        ) : (
          <p className="text-xs italic text-forge-steel">Prix sur devis</p>
        )}
      </div>

      {/* Quantité + supprimer */}
      <div className="flex flex-col items-end gap-2">
        {item.prix && (
          <p className="text-sm font-black text-forge-red">{fmt(item.prix * item.quantite)}</p>
        )}
        <div className="flex items-center overflow-hidden rounded-lg border border-gray-200">
          <button
            onClick={() => onQty(item.id, item.quantite - 1)}
            className="flex h-7 w-7 items-center justify-center text-forge-steel transition hover:bg-gray-50"
          >
            <Minus size={12} />
          </button>
          <span className="w-8 text-center text-xs font-bold text-forge-dark">{item.quantite}</span>
          <button
            onClick={() => onQty(item.id, item.quantite + 1)}
            disabled={item.quantite >= item.stock_actuel}
            className="flex h-7 w-7 items-center justify-center text-forge-steel transition hover:bg-gray-50 disabled:opacity-30"
          >
            <Plus size={12} />
          </button>
        </div>
        <button
          onClick={() => onRemove(item.id)}
          className="text-gray-300 transition hover:text-red-400"
          aria-label="Supprimer"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </motion.div>
  )
}

export function PanierClient() {
  const { items, updateQuantity, removeItem, clearCart } = useCartStore()

  const totals = computeTotal(items)

  const whatsappItems = items.map((i) => `• ${i.nom} (${i.ref}) × ${i.quantite}`).join('\n')
  const whatsappUrl = `https://wa.me/237695884528?text=${encodeURIComponent(
    `Bonjour TAFDIL, je souhaite commander :\n${whatsappItems}\n\nTotal estimé : ${fmt(totals.ttc)} TTC`
  )}`

  if (items.length === 0) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 py-16 text-center">
        <ShoppingCart size={56} className="mb-4 text-gray-200" />
        <h1 className="text-xl font-black text-forge-dark">Votre panier est vide</h1>
        <p className="mt-2 text-sm text-forge-steel">Parcourez notre catalogue pour trouver vos produits.</p>
        <Link
          href="/catalogue"
          className="mt-6 rounded-xl bg-forge-red px-6 py-3 text-sm font-bold text-white transition hover:bg-forge-red-dark"
        >
          Voir le catalogue
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      {/* En-tête */}
      <div className="mb-6 flex items-center gap-3">
        <Link href="/catalogue" className="flex items-center gap-1 text-xs text-gray-400 hover:text-forge-red transition-colors">
          <ArrowLeft size={14} /> Continuer mes achats
        </Link>
        <span className="ml-auto text-sm font-semibold text-forge-steel">
          {totals.lignes_count} article{totals.lignes_count > 1 ? 's' : ''}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Liste articles */}
        <div className="lg:col-span-2">
          <h1 className="mb-4 text-2xl font-black text-forge-dark">Mon panier</h1>
          <div className="flex flex-col gap-3">
            <AnimatePresence mode="popLayout">
              {items.map((item) => (
                <CartRow
                  key={item.id}
                  item={item}
                  onQty={updateQuantity}
                  onRemove={removeItem}
                />
              ))}
            </AnimatePresence>
          </div>
          <button
            onClick={() => { clearCart(); toast.success('Panier vidé') }}
            className="mt-4 flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-400 transition-colors"
          >
            <Trash2 size={12} /> Vider le panier
          </button>
        </div>

        {/* Récapitulatif */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-black text-forge-dark">Récapitulatif</h2>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between text-forge-steel">
                <span>Sous-total HT</span>
                <span className="font-semibold">{fmt(totals.ht)}</span>
              </div>
              <div className="flex justify-between text-forge-steel">
                <span>TVA (19,25%)</span>
                <span className="font-semibold">{fmt(totals.tva)}</span>
              </div>
              <div className="mt-2 flex justify-between border-t border-gray-100 pt-2 text-forge-dark">
                <span className="font-black">Total TTC</span>
                <span className="text-lg font-black text-forge-red">{fmt(totals.ttc)}</span>
              </div>
            </div>

            <Link
              href="/commander"
              className="mt-4 flex w-full items-center justify-center rounded-xl bg-forge-red py-3 text-sm font-bold text-white transition hover:bg-forge-red-dark"
            >
              Passer la commande →
            </Link>

            <div className="mt-3 flex items-center gap-2">
              <div className="h-px flex-1 bg-gray-100" />
              <span className="text-[10px] text-gray-400">ou</span>
              <div className="h-px flex-1 bg-gray-100" />
            </div>

            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-green-200 bg-green-50 py-3 text-sm font-bold text-green-700 transition hover:bg-green-100"
            >
              <MessageCircle size={15} /> Commander via WhatsApp
            </a>

            <p className="mt-3 text-center text-[10px] text-gray-400">
              Livraison calculée à la commande • Paiement à la livraison possible
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
