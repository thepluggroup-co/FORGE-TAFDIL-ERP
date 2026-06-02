'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { ShoppingCart, FileText, ChevronLeft, ChevronRight, Minus, Plus, Clock, Package, Tag, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { useCart } from '@/lib/cart'
import { BadgeDisponibilite } from '../ProductCard'
import type { Produit } from '@/lib/types'

interface Props {
  produit: Produit
}

export function ProductDetailClient({ produit }: Props) {
  const { addItem } = useCart()
  const [activeImg, setActiveImg] = useState(0)
  const [qty, setQty] = useState(produit.min_commande || 1)
  const [direction, setDirection] = useState(0)

  const images = produit.images.length > 0 ? produit.images : []
  const indisponible = produit.disponibilite === 'indisponible'

  const changeImg = (next: number) => {
    if (images.length < 2) return
    setDirection(next > activeImg ? 1 : -1)
    setActiveImg(next)
  }

  const prevImg = () => changeImg((activeImg - 1 + images.length) % images.length)
  const nextImg = () => changeImg((activeImg + 1) % images.length)

  const changeQty = (delta: number) => {
    setQty((v) => Math.max(produit.min_commande || 1, v + delta))
  }

  const handleAddToCart = () => {
    void addItem(
      { id: produit.id, ref: produit.ref, nom: produit.nom, prix: produit.prix_public, image: produit.images[0] ?? null },
      qty
    )
  }

  const devisUrl = `/devis?ref=${encodeURIComponent(produit.ref)}&nom=${encodeURIComponent(produit.nom)}`

  const stockIcon = {
    disponible:   <CheckCircle2 size={14} className="text-green-600" />,
    stock_faible: <AlertTriangle size={14} className="text-amber-500" />,
    indisponible: <XCircle size={14} className="text-gray-400" />,
  }[produit.disponibilite]

  const stockLabel = {
    disponible:   `En stock (${produit.stock_actuel} ${produit.unite})`,
    stock_faible: `Stock faible (${produit.stock_actuel} restant${produit.stock_actuel > 1 ? 's' : ''})`,
    indisponible: 'Sur commande',
  }[produit.disponibilite]

  const slideVariants = {
    enter: (d: number) => ({ x: d > 0 ? 40 : -40, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit:  (d: number) => ({ x: d > 0 ? -40 : 40, opacity: 0 }),
  }

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      {/* ── Galerie ────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        {/* Image principale */}
        <div className="relative aspect-square overflow-hidden rounded-2xl bg-gray-50">
          {images.length > 0 ? (
            <>
              <AnimatePresence custom={direction} mode="wait">
                <motion.div
                  key={activeImg}
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.25 }}
                  className="absolute inset-0"
                >
                  <Image
                    src={images[activeImg]}
                    alt={`${produit.nom} — photo ${activeImg + 1}`}
                    fill
                    sizes="(max-width: 1024px) 100vw, 50vw"
                    className="object-cover"
                    priority
                  />
                </motion.div>
              </AnimatePresence>

              {images.length > 1 && (
                <>
                  <button
                    onClick={prevImg}
                    className="absolute left-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow backdrop-blur-sm transition hover:bg-white"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    onClick={nextImg}
                    className="absolute right-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow backdrop-blur-sm transition hover:bg-white"
                  >
                    <ChevronRight size={18} />
                  </button>
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                    {images.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => changeImg(i)}
                        className="h-1.5 rounded-full transition-all"
                        style={{ width: i === activeImg ? 20 : 6, backgroundColor: i === activeImg ? '#C62828' : '#fff' }}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="flex h-full items-center justify-center">
              <span className="text-6xl font-black text-gray-200">{produit.ref}</span>
            </div>
          )}

          {/* Badge dispo overlay */}
          <div className="absolute right-3 top-3">
            <BadgeDisponibilite dispo={produit.disponibilite} />
          </div>
        </div>

        {/* Thumbnails */}
        {images.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {images.map((src, i) => (
              <button
                key={i}
                onClick={() => changeImg(i)}
                className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl border-2 transition-all"
                style={{ borderColor: i === activeImg ? '#C62828' : 'transparent' }}
              >
                <Image src={src} alt={`thumb ${i + 1}`} fill sizes="64px" className="object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Informations produit ───────────────────────────────────────── */}
      <div className="flex flex-col gap-5">
        {/* Catégorie + Réf */}
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-forge-steel-light px-3 py-1 text-xs font-semibold text-forge-steel">
            {produit.categorie}
          </span>
          <span className="font-mono text-xs text-gray-400">{produit.ref}</span>
        </div>

        {/* Nom */}
        <h1 className="text-2xl font-black leading-tight text-forge-dark sm:text-3xl">{produit.nom}</h1>

        {/* Description */}
        {produit.description_longue && (
          <p className="text-sm leading-relaxed text-forge-steel">{produit.description_longue}</p>
        )}

        {/* Tags */}
        {produit.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {produit.tags.map((tag) => (
              <span key={tag} className="flex items-center gap-1 rounded-full bg-forge-steel-light px-2.5 py-0.5 text-[11px] font-medium text-forge-steel">
                <Tag size={9} /> {tag}
              </span>
            ))}
          </div>
        )}

        {/* Prix */}
        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
          {produit.prix_public ? (
            <div>
              <p className="text-3xl font-black text-forge-red">
                {new Intl.NumberFormat('fr-CM', { style: 'currency', currency: 'XAF', maximumFractionDigits: 0 }).format(produit.prix_public)}
                <span className="ml-1.5 text-sm font-normal text-forge-steel">/ {produit.unite}</span>
              </p>
              {qty > 1 && (
                <p className="mt-1 text-xs text-forge-steel">
                  Total :{' '}
                  <span className="font-bold text-forge-dark">
                    {new Intl.NumberFormat('fr-CM', { style: 'currency', currency: 'XAF', maximumFractionDigits: 0 }).format(produit.prix_public * qty)}
                  </span>
                </p>
              )}
            </div>
          ) : (
            <p className="text-lg font-semibold italic text-forge-steel">Prix sur devis</p>
          )}
        </div>

        {/* Infos stock + délai */}
        <div className="flex flex-wrap gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            {stockIcon}
            <span className="text-forge-steel">{stockLabel}</span>
          </div>
          <div className="flex items-center gap-1.5 text-gray-400">
            <Clock size={13} />
            <span>Livraison sous {produit.delai_fabrication_jours} j.</span>
          </div>
          {produit.min_commande > 1 && (
            <div className="flex items-center gap-1.5 text-gray-400">
              <Package size={13} />
              <span>Min. {produit.min_commande} {produit.unite}</span>
            </div>
          )}
        </div>

        {/* Quantité */}
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold text-forge-dark">Quantité</span>
          <div className="flex items-center gap-0 overflow-hidden rounded-xl border border-gray-200">
            <button
              onClick={() => changeQty(-1)}
              disabled={qty <= (produit.min_commande || 1)}
              className="flex h-10 w-10 items-center justify-center text-forge-steel transition hover:bg-gray-50 disabled:opacity-30"
            >
              <Minus size={14} />
            </button>
            <span className="w-12 text-center text-sm font-bold text-forge-dark">{qty}</span>
            <button
              onClick={() => changeQty(1)}
              className="flex h-10 w-10 items-center justify-center text-forge-steel transition hover:bg-gray-50"
            >
              <Plus size={14} />
            </button>
          </div>
          <span className="text-xs text-gray-400">{produit.unite}</span>
        </div>

        {/* CTA */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            onClick={handleAddToCart}
            disabled={indisponible}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-forge-red py-3 text-sm font-bold text-white shadow-sm transition-all hover:bg-forge-red-dark active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ShoppingCart size={16} />
            {indisponible ? 'Indisponible' : 'Ajouter au panier'}
          </button>

          <Link
            href={devisUrl}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-forge-red/20 bg-forge-red/5 py-3 text-sm font-bold text-forge-red transition-colors hover:bg-forge-red/10"
          >
            <FileText size={16} />
            Demander un devis
          </Link>
        </div>
      </div>
    </div>
  )
}
