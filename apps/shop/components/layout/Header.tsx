'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import { ChevronDown, Clock, Menu, Search, ShoppingCart, Truck, UserCircle, X } from 'lucide-react'
import { useCartStore, computeTotal } from '@/lib/cart'
import { MetalForgeLogo } from '@/components/ui/BrandLogo'

const NAV_LINKS = [
  { href: '/contact', label: 'A propos' },
  { href: '/blog/comment-bien-choisir-ses-profils-aluminium-pour-vos-menuiseries', label: 'Blog' },
  { href: '/contact', label: 'FAQ' },
  { href: '/contact', label: 'Contact' },
]

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [search, setSearch] = useState('')
  const { items, openDrawer } = useCartStore()
  const router = useRouter()
  const count = computeTotal(items).lignes_count
  const whatsapp = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '+237 658 84 52 8').replace(/\D/g, '')

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const q = search.trim()
    router.push(q ? `/catalogue?q=${encodeURIComponent(q)}` : '/catalogue')
  }

  return (
    <header className="sticky top-0 z-40 bg-white shadow-sm">
      <div className="bg-[#0f1418] text-white">
        <div className="mx-auto flex h-9 max-w-7xl items-center justify-between px-4 text-xs font-semibold sm:px-6 lg:px-8">
          <div className="flex items-center gap-6">
            <span className="hidden items-center gap-2 sm:flex"><Truck size={14} /> Livraison rapide partout au Cameroun</span>
            <span className="flex items-center gap-2"><Clock size={14} /> Devis gratuit sous 24h</span>
          </div>
          <nav className="hidden items-center gap-6 md:flex">
            {NAV_LINKS.map((link) => (
              <Link key={link.label} href={link.href} className="hover:text-forge-red">{link.label}</Link>
            ))}
          </nav>
        </div>
      </div>

      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="shrink-0">
            <MetalForgeLogo size={36} variant="color" />
          </Link>

          <form onSubmit={submitSearch} className="hidden min-w-0 flex-1 overflow-hidden rounded-lg border border-gray-200 bg-white lg:flex">
            <Link href="/catalogue" className="flex items-center gap-2 border-r border-gray-200 px-5 text-sm font-bold text-forge-dark hover:text-forge-red">
              Toutes categories <ChevronDown size={14} />
            </Link>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              type="search"
              placeholder="Rechercher un produit, une reference..."
              className="min-w-0 flex-1 px-5 text-sm outline-none"
            />
            <button type="submit" className="m-1 flex h-11 w-14 items-center justify-center rounded-md bg-forge-red text-white hover:bg-forge-red-dark" aria-label="Rechercher">
              <Search size={18} />
            </button>
          </form>

          <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer" className="hidden items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-gray-50 md:flex">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-green-200 bg-green-50 text-green-600">W</span>
            <span className="leading-tight">
              <span className="block font-black text-forge-dark">WhatsApp</span>
              <span className="text-xs text-gray-500">+237 658 84 52 8</span>
            </span>
          </a>

          <Link href="/compte/dashboard" className="hidden items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-gray-50 md:flex">
            <UserCircle size={25} className="text-forge-dark" />
            <span className="leading-tight">
              <span className="block font-black text-forge-dark">Mon compte</span>
              <span className="text-xs text-gray-500">Se connecter</span>
            </span>
          </Link>

          <button onClick={openDrawer} className="relative flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-gray-50" aria-label="Panier">
            <ShoppingCart size={27} className="text-forge-dark" />
            <span className="hidden leading-tight sm:block">
              <span className="block font-black text-forge-dark">Panier</span>
              <span className="text-xs text-gray-500">Articles</span>
            </span>
            <span className="absolute right-0 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-forge-dark px-1 text-[10px] font-black text-white">
              {count > 99 ? '99+' : count}
            </span>
          </button>

          <button onClick={() => setMobileOpen((value) => !value)} className="flex h-10 w-10 items-center justify-center rounded-md border border-gray-200 lg:hidden" aria-label="Menu">
            {mobileOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-b border-gray-200 bg-white px-4 py-4 lg:hidden">
          <form onSubmit={submitSearch} className="flex overflow-hidden rounded-lg border border-gray-200">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher..." className="min-w-0 flex-1 px-4 py-3 text-sm outline-none" />
            <button type="submit" className="bg-forge-red px-4 text-white" aria-label="Rechercher"><Search size={17} /></button>
          </form>
          <nav className="mt-4 grid gap-2">
            <Link href="/catalogue" onClick={() => setMobileOpen(false)} className="rounded-md px-3 py-2 text-sm font-bold text-forge-dark hover:bg-forge-red-light">Catalogue</Link>
            <Link href="/devis" onClick={() => setMobileOpen(false)} className="rounded-md px-3 py-2 text-sm font-bold text-forge-dark hover:bg-forge-red-light">Demander un devis</Link>
            {NAV_LINKS.map((link) => (
              <Link key={link.label} href={link.href} onClick={() => setMobileOpen(false)} className="rounded-md px-3 py-2 text-sm font-bold text-forge-dark hover:bg-forge-red-light">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  )
}
