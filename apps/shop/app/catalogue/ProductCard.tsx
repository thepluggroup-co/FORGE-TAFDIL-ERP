'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ShoppingCart, MessageCircle, Eye, Clock } from 'lucide-react'
import { useCart } from '@/lib/cart'
import type { Produit, Disponibilite } from '@/lib/types'

// ── Badge disponibilité ────────────────────────────────────────────────────────

const DISPO_CONFIG: Record<Disponibilite, { label: string; bg: string; text: string }> = {
  disponible:   { label: 'Disponible',   bg: '#dcfce7', text: '#15803d' },
  stock_faible: { label: 'Stock faible', bg: '#fef3c7', text: '#d97706' },
  indisponible: { label: 'Sur commande', bg: '#f3f4f6', text: '#6b7280' },
}

export function BadgeDisponibilite({ dispo }: { dispo: Disponibilite }) {
  const cfg = DISPO_CONFIG[dispo]
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{ backgroundColor: cfg.bg, color: cfg.text }}
    >
      {cfg.label}
    </span>
  )
}

// ── ProductCard ────────────────────────────────────────────────────────────────

interface Props {
  produit: Produit
  onDisponibiliteChange?: (id: string, dispo: Disponibilite) => void
}

export function ProductCard({ produit }: Props) {
  const { addItem } = useCart()
  const indisponible = produit.disponibilite === 'indisponible'

  const whatsappUrl = `https://wa.me/237695884528?text=${encodeURIComponent(
    `Bonjour TAFDIL, je souhaite un devis pour : ${produit.nom} (Réf. ${produit.ref})`
  )}`

  const handleAddToCart = () => {
    void addItem(
      { id: produit.id, ref: produit.ref, nom: produit.nom, prix: produit.prix_public, image: produit.images[0] ?? null },
      1
    )
  }

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-forge-red/20 hover:shadow-xl">

      {/* Image */}
      <Link href={`/catalogue/${produit.id}`} className="relative block h-52 overflow-hidden bg-gray-50">
        {produit.images[0] ? (
          <Image
            src={produit.images[0]}
            alt={produit.nom}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="text-4xl font-black text-gray-200">{produit.ref}</span>
          </div>
        )}

        {/* Badges superposés */}
        <div className="absolute left-3 top-3">
          <span className="rounded-full border border-white/40 bg-white/90 px-2.5 py-1 text-xs font-semibold text-forge-steel backdrop-blur-sm">
            {produit.categorie}
          </span>
        </div>
        <div className="absolute right-3 top-3">
          <BadgeDisponibilite dispo={produit.disponibilite} />
        </div>
      </Link>

      {/* Corps */}
      <div className="flex flex-1 flex-col p-4">
        {/* Ref */}
        <span className="mb-1 font-mono text-[10px] text-gray-400">{produit.ref}</span>

        {/* Nom */}
        <Link href={`/catalogue/${produit.id}`}>
          <h3 className="mb-1.5 line-clamp-2 text-sm font-bold leading-snug text-forge-dark transition-colors hover:text-forge-red">
            {produit.nom}
          </h3>
        </Link>

        {/* Description */}
        {produit.description_longue && (
          <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-forge-steel">
            {produit.description_longue}
          </p>
        )}

        {/* Tags */}
        {produit.tags.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {produit.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded-full bg-forge-steel-light px-2 py-0.5 text-[10px] font-medium text-forge-steel">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Prix */}
        <div className="mt-auto">
          {produit.prix_public ? (
            <p className="text-xl font-black text-forge-red">
              {new Intl.NumberFormat('fr-CM', { style: 'currency', currency: 'XAF', maximumFractionDigits: 0 }).format(produit.prix_public)}
              <span className="ml-1 text-xs font-normal text-forge-steel">/ {produit.unite}</span>
            </p>
          ) : (
            <p className="text-sm font-semibold italic text-forge-steel">Prix sur devis</p>
          )}

          {/* Délai */}
          <div className="mt-1 flex items-center gap-1 text-xs text-gray-400">
            <Clock size={11} />
            <span>Livraison sous {produit.delai_fabrication_jours} j.</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 border-t border-gray-50 p-3">
        <Link
          href={`/catalogue/${produit.id}`}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 py-2 text-xs font-semibold text-forge-steel transition-colors hover:border-forge-red hover:text-forge-red"
        >
          <Eye size={13} /> Détail
        </Link>

        <button
          onClick={handleAddToCart}
          disabled={indisponible}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-forge-red py-2 text-xs font-semibold text-white transition-all hover:bg-forge-red-dark disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ShoppingCart size={13} />
          {indisponible ? 'Indisponible' : 'Panier'}
        </button>

        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center rounded-xl border border-green-200 bg-green-50 px-3 py-2 transition-colors hover:bg-green-100"
          title="Demander un devis WhatsApp"
        >
          <MessageCircle size={14} className="text-green-700" />
        </a>
      </div>
    </article>
  )
}
