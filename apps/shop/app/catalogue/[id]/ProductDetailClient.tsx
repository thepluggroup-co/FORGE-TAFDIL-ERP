'use client'

import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileText,
  Heart,
  Headphones,
  Minus,
  PackageCheck,
  Plus,
  RotateCcw,
  ShieldCheck,
  ShoppingCart,
  Star,
  Truck,
  Wallet,
  ZoomIn,
} from 'lucide-react'
import { useCart } from '@/lib/cart'
import type { Disponibilite, Produit } from '@/lib/types'

interface Props {
  produit: Produit
  similaires: Produit[]
}

const FALLBACK_IMAGES = [
  'https://images.unsplash.com/photo-1564540583246-934409427776?auto=format&fit=crop&w=1200&q=85',
  'https://images.unsplash.com/photo-1518709268805-4e9042af2176?auto=format&fit=crop&w=1200&q=85',
  'https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=1200&q=85',
]

const tabItems = [
  { key: 'description', label: 'Description', icon: FileText },
  { key: 'caracteristiques', label: 'Caracteristiques', icon: CheckCircle2 },
  { key: 'fiche', label: 'Fiche technique', icon: Download },
  { key: 'avis', label: 'Avis clients (126)', icon: Star },
  { key: 'livraison', label: 'Livraison & Retours', icon: Truck },
] as const

function formatXAF(value: number | null | undefined) {
  if (!value) return 'Prix sur devis'
  return new Intl.NumberFormat('fr-CM', { maximumFractionDigits: 0 }).format(value) + ' FCFA'
}

function statusConfig(disponibilite: Disponibilite) {
  if (disponibilite === 'stock_faible') return { label: 'Stock faible', className: 'bg-amber-100 text-amber-700' }
  if (disponibilite === 'indisponible') return { label: 'Sur commande', className: 'bg-gray-100 text-gray-600' }
  return { label: 'En stock', className: 'bg-green-100 text-green-700' }
}

function productImage(produit: Produit, index = 0) {
  return produit.images?.[0] || FALLBACK_IMAGES[index % FALLBACK_IMAGES.length]
}

export function ProductDetailClient({ produit, similaires }: Props) {
  const { addItem } = useCart()
  const [activeImg, setActiveImg] = useState(0)
  const [qty, setQty] = useState(produit.min_commande || 1)
  const [tab, setTab] = useState<(typeof tabItems)[number]['key']>('description')

  const images = useMemo(() => {
    const source = produit.images.length > 0 ? produit.images : [FALLBACK_IMAGES[0]]
    return source.length >= 5 ? source.slice(0, 5) : [...source, ...FALLBACK_IMAGES].slice(0, 5)
  }, [produit.images])
  const indisponible = produit.disponibilite === 'indisponible'
  const status = statusConfig(produit.disponibilite)
  const oldPrice = produit.prix_public ? Math.round(produit.prix_public * 1.18) : null
  const discount = produit.prix_public ? Math.max(5, Math.round(((oldPrice! - produit.prix_public) / oldPrice!) * 100)) : null
  const devisUrl = `/devis?ref=${encodeURIComponent(produit.ref)}&nom=${encodeURIComponent(produit.nom)}`

  const features = [
    `${produit.categorie} de qualite professionnelle`,
    produit.disponibilite === 'disponible' ? 'Disponible en stock' : 'Disponible sur commande',
    'Finition soignee et durable',
    'Facile a installer',
  ]

  const handleAddToCart = () => {
    void addItem(
      { id: produit.id, ref: produit.ref, nom: produit.nom, prix: produit.prix_public, image: produit.images[0] ?? null },
      qty,
    )
  }

  return (
    <div>
      <section className="grid gap-8 lg:grid-cols-[1fr_1fr_280px]">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="space-y-4">
          <div className="relative aspect-square overflow-hidden rounded-lg bg-gray-50">
            {discount && (
              <span className="absolute left-4 top-4 z-10 rounded-md bg-forge-red px-3 py-2 text-sm font-black text-white">
                -{discount}%
              </span>
            )}
            <AnimatePresence mode="wait">
              <motion.div
                key={activeImg}
                initial={{ opacity: 0, scale: 1.02 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.22 }}
                className="absolute inset-0"
              >
                <Image src={images[activeImg]} alt={produit.nom} fill priority sizes="(max-width: 1024px) 100vw, 520px" className="object-cover" />
              </motion.div>
            </AnimatePresence>
            <button onClick={() => setActiveImg((activeImg - 1 + images.length) % images.length)} className="absolute left-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-forge-dark shadow hover:bg-white" aria-label="Image precedente">
              <ArrowLeft size={17} />
            </button>
            <button onClick={() => setActiveImg((activeImg + 1) % images.length)} className="absolute right-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-forge-dark shadow hover:bg-white" aria-label="Image suivante">
              <ArrowRight size={17} />
            </button>
            <button className="absolute bottom-4 right-4 flex items-center gap-2 rounded-md bg-white px-3 py-2 text-xs font-black text-forge-dark shadow hover:text-forge-red">
              <ZoomIn size={14} /> Zoom
            </button>
          </div>

          <div className="grid grid-cols-5 gap-3">
            {images.map((src, index) => (
              <button
                key={`${src}-${index}`}
                onClick={() => setActiveImg(index)}
                className={`relative aspect-square overflow-hidden rounded-md border-2 bg-gray-100 transition hover:-translate-y-0.5 ${activeImg === index ? 'border-forge-red' : 'border-transparent'}`}
              >
                <Image src={src} alt={`${produit.nom} ${index + 1}`} fill sizes="100px" className="object-cover" />
                {index === 4 && produit.images.length > 5 && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-sm font-black text-white">+{produit.images.length - 4}</span>
                )}
              </button>
            ))}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.08 }} className="py-1">
          <span className={`inline-flex rounded-full px-3 py-1 text-[10px] font-black uppercase ${status.className}`}>{status.label}</span>
          <p className="mt-4 font-mono text-sm text-gray-500">{produit.ref}</p>
          <h1 className="mt-2 text-3xl font-black leading-tight text-forge-dark sm:text-4xl">{produit.nom}</h1>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="flex text-amber-400">
              {Array.from({ length: 5 }).map((_, index) => <Star key={index} size={16} fill="currentColor" />)}
            </span>
            <span className="font-semibold text-gray-600">4.8 (126 avis)</span>
            <span className="h-4 w-px bg-gray-200" />
            <span className="font-semibold text-gray-600">235 ventes</span>
          </div>

          <p className="mt-5 max-w-xl text-sm leading-7 text-forge-steel">
            {produit.description_longue || `${produit.nom} est selectionne pour les besoins professionnels en ${produit.categorie.toLowerCase()}. Qualite fiable, usage durable et livraison partout au Cameroun.`}
          </p>

          <ul className="mt-5 space-y-3">
            {features.map((item) => (
              <li key={item} className="flex items-center gap-3 text-sm font-semibold text-forge-steel">
                <CheckCircle2 size={16} className="text-forge-red" />
                {item}
              </li>
            ))}
          </ul>

          <div className="mt-7">
            <p className="text-3xl font-black text-forge-red">
              {formatXAF(produit.prix_public)}
              {produit.prix_public ? <span className="ml-2 text-sm font-semibold text-gray-500">/ {produit.unite}</span> : null}
            </p>
            {oldPrice && (
              <div className="mt-2 flex items-center gap-3">
                <span className="text-sm font-bold text-gray-400 line-through">{formatXAF(oldPrice)}</span>
                <span className="rounded-md bg-forge-red px-2 py-1 text-xs font-black text-white">-{discount}%</span>
              </div>
            )}
          </div>

          <div className="mt-6">
            <p className="mb-2 text-sm font-black text-forge-dark">Quantite</p>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex h-11 overflow-hidden rounded-md border border-gray-200">
                <button onClick={() => setQty((value) => Math.max(produit.min_commande || 1, value - 1))} className="flex w-12 items-center justify-center hover:bg-gray-50" aria-label="Reduire la quantite">
                  <Minus size={15} />
                </button>
                <span className="flex w-14 items-center justify-center border-x border-gray-200 text-sm font-black">{qty}</span>
                <button onClick={() => setQty((value) => value + 1)} className="flex w-12 items-center justify-center hover:bg-gray-50" aria-label="Augmenter la quantite">
                  <Plus size={15} />
                </button>
              </div>
              <span className="text-sm font-semibold text-gray-500">{produit.stock_actuel} {produit.unite} disponibles</span>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_48px]">
            <button onClick={handleAddToCart} disabled={indisponible} className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-forge-red px-5 text-sm font-black text-white shadow-sm hover:bg-forge-red-dark disabled:cursor-not-allowed disabled:opacity-40">
              <ShoppingCart size={17} /> Ajouter au panier
            </button>
            <button className="flex h-12 items-center justify-center rounded-md border border-gray-200 text-forge-steel hover:border-forge-red hover:text-forge-red" aria-label="Ajouter aux favoris">
              <Heart size={18} />
            </button>
            <Link href={devisUrl} className="sm:col-span-2 inline-flex h-12 items-center justify-center gap-2 rounded-md border border-forge-red/30 bg-forge-red/5 px-5 text-sm font-black text-forge-red hover:bg-forge-red-light">
              <FileText size={17} /> Demander un devis
            </Link>
          </div>

          <div className="mt-6 grid gap-3 border-t border-gray-100 pt-5 sm:grid-cols-3">
            {[
              { icon: Truck, title: 'Livraison sous 24 - 48h', text: 'Partout au Cameroun' },
              { icon: ShieldCheck, title: 'Paiement securise', text: '100% securise' },
              { icon: RotateCcw, title: 'Satisfait ou rembourse', text: '14 jours pour retourner' },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="flex gap-2 text-xs">
                <Icon size={18} className="shrink-0 text-forge-steel" />
                <span>
                  <span className="block font-black text-forge-dark">{title}</span>
                  <span className="text-gray-500">{text}</span>
                </span>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.aside initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, delay: 0.12 }} className="space-y-5">
          <InfoCard title="Nos engagements">
            {[
              { icon: PackageCheck, title: 'Produits garantis', text: 'Certifies et testes' },
              { icon: Wallet, title: 'Prix competitifs', text: 'Le meilleur rapport qualite/prix' },
              { icon: Truck, title: 'Livraison rapide', text: 'Partout au Cameroun' },
              { icon: Headphones, title: 'Support dedie', text: 'Conseils et accompagnement' },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="flex gap-3 py-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-forge-red-light text-forge-red"><Icon size={16} /></span>
                <span>
                  <span className="block text-sm font-black text-forge-dark">{title}</span>
                  <span className="text-xs text-gray-500">{text}</span>
                </span>
              </div>
            ))}
          </InfoCard>

          <InfoCard title="Besoin d aide ?">
            <p className="text-sm leading-6 text-gray-600">Notre equipe est a votre ecoute pour vous conseiller sur ce produit.</p>
            <a href="https://wa.me/237695884528" target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-md border border-gray-200 px-4 py-2 text-sm font-black text-forge-dark hover:border-forge-red hover:text-forge-red">
              WhatsApp
            </a>
            <div className="mt-4 space-y-1 text-sm font-semibold text-gray-600">
              <p>+237 695884528</p>
              <p>Lun - Sam : 7h30 - 18h</p>
            </div>
          </InfoCard>
        </motion.aside>
      </section>

      <section className="mt-14">
        <div className="flex gap-6 overflow-x-auto border-b border-gray-200">
          {tabItems.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setTab(key)} className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-4 text-sm font-black transition ${tab === key ? 'border-forge-red text-forge-red' : 'border-transparent text-forge-steel hover:text-forge-red'}`}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_340px]">
          <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="rounded-lg border border-gray-200 bg-white p-6 sm:p-8">
            <h2 className="text-xl font-black text-forge-dark">{tab === 'description' ? 'Description du produit' : tabItems.find((item) => item.key === tab)?.label}</h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-gray-700">
              {produit.description_longue || `${produit.nom} est adapte aux projets de ${produit.categorie.toLowerCase()}. Il offre une bonne resistance, une finition propre et une utilisation fiable pour les chantiers professionnels.`}
            </p>
            <div className="mt-6 grid gap-6 md:grid-cols-[1fr_300px]">
              <ul className="space-y-3">
                {features.map((item) => (
                  <li key={item} className="flex gap-3 text-sm font-semibold text-gray-700">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-forge-red" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="relative hidden min-h-44 rounded-md bg-gray-50 md:block">
                <Image src={images[0]} alt={produit.nom} fill sizes="300px" className="object-cover opacity-80" />
              </div>
            </div>
          </motion.div>

          <aside className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="text-lg font-black text-forge-dark">Informations produit</h2>
            <dl className="mt-5 space-y-3 text-sm">
              {[
                ['Reference', produit.ref],
                ['Categorie', produit.categorie],
                ['Marque', 'MetalForge'],
                ['Materiau', produit.tags[0] || produit.categorie],
                ['Delai', `${produit.delai_fabrication_jours} jour(s)`],
                ['Stock', `${produit.stock_actuel} ${produit.unite}`],
                ['Min. commande', `${produit.min_commande} ${produit.unite}`],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className="font-black text-gray-500">{label}</dt>
                  <dd className="text-right font-semibold text-forge-steel">{value}</dd>
                </div>
              ))}
            </dl>
            <button className="mt-6 flex w-full items-center justify-center gap-2 rounded-md border border-gray-200 px-4 py-2.5 text-sm font-black text-forge-steel hover:border-forge-red hover:text-forge-red">
              <Download size={15} /> Telecharger la fiche technique
            </button>
          </aside>
        </div>
      </section>

      {similaires.length > 0 && (
        <section className="mt-12">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-xl font-black text-forge-dark">Produits similaires</h2>
            <div className="flex gap-2">
              <Link href="/catalogue" className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-forge-steel hover:border-forge-red hover:text-forge-red" aria-label="Catalogue">
                <ArrowLeft size={15} />
              </Link>
              <Link href="/catalogue" className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-forge-steel hover:border-forge-red hover:text-forge-red" aria-label="Catalogue">
                <ArrowRight size={15} />
              </Link>
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            {similaires.slice(0, 6).map((item, index) => (
              <SimilarProductCard key={item.id} produit={item} index={index} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-10 grid gap-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: Truck, title: 'Livraison rapide', text: 'Partout au Cameroun' },
          { icon: Wallet, title: 'Paiement securise', text: '100% securise' },
          { icon: ShieldCheck, title: 'Produits garantis', text: 'Certifies et testes' },
          { icon: Headphones, title: 'Support client', text: 'Lun - Sam : 7h30 - 18h' },
        ].map(({ icon: Icon, title, text }) => (
          <div key={title} className="flex items-center gap-3">
            <Icon size={25} className="text-forge-steel" />
            <span>
              <span className="block text-sm font-black text-forge-dark">{title}</span>
              <span className="text-xs text-gray-500">{text}</span>
            </span>
          </div>
        ))}
      </section>

      <section className="mt-5 rounded-lg bg-[#111820] p-6 text-white sm:p-8">
        <div className="grid gap-5 md:grid-cols-[1fr_1.2fr] md:items-center">
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-forge-red">
              <FileText size={26} />
            </span>
            <span>
              <span className="block text-xl font-black">Restez informe de nos nouveautes</span>
              <span className="text-sm text-gray-300">Inscrivez-vous a notre newsletter et recevez nos offres exclusives.</span>
            </span>
          </div>
          <form className="flex overflow-hidden rounded-lg bg-white/10">
            <input type="email" placeholder="Votre adresse email" className="min-w-0 flex-1 bg-transparent px-4 py-3 text-sm text-white outline-none placeholder:text-gray-500" />
            <button type="submit" className="bg-forge-red px-7 text-sm font-black text-white hover:bg-forge-red-dark">S inscrire</button>
          </form>
        </div>
      </section>
    </div>
  )
}

function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-lg font-black text-forge-dark">{title}</h2>
      {children}
    </div>
  )
}

function SimilarProductCard({ produit, index }: { produit: Produit; index: number }) {
  const { addItem } = useCart()
  const unavailable = produit.disponibilite === 'indisponible'

  return (
    <article className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
      <Link href={`/catalogue/${produit.id}`} className="relative block aspect-[1.15] bg-gray-50">
        <Image src={productImage(produit, index)} alt={produit.nom} fill sizes="180px" className="object-cover" />
      </Link>
      <div className="p-4">
        <p className="font-mono text-[10px] text-gray-400">{produit.ref}</p>
        <Link href={`/catalogue/${produit.id}`} className="mt-1 block min-h-10 text-sm font-black leading-tight text-forge-dark hover:text-forge-red">
          {produit.nom}
        </Link>
        <p className="mt-2 text-base font-black text-forge-red">
          {formatXAF(produit.prix_public)}
          {produit.prix_public ? <span className="text-xs font-semibold text-gray-500"> / {produit.unite}</span> : null}
        </p>
        <p className={`mt-1 text-xs font-semibold ${unavailable ? 'text-gray-500' : 'text-green-700'}`}>{unavailable ? 'Sur commande' : 'En stock'}</p>
      </div>
      <button
        onClick={() => void addItem({ id: produit.id, ref: produit.ref, nom: produit.nom, prix: produit.prix_public, image: produit.images[0] ?? null }, 1)}
        disabled={unavailable}
        className="mx-4 mb-4 flex h-9 w-[calc(100%-2rem)] items-center justify-center rounded-md border border-gray-200 text-forge-steel hover:border-forge-red hover:text-forge-red disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Ajouter au panier"
      >
        <ShoppingCart size={15} />
      </button>
    </article>
  )
}
