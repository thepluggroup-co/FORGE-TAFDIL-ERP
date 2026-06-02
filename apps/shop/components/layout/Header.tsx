'use client'

import Link from 'next/link'
import { ShoppingCart, Menu, X, Phone, UserCircle } from 'lucide-react'
import { useState } from 'react'
import { useCartStore, computeTotal } from '@/lib/cart'
import { MetalForgeHeaderLogo } from '@/components/ui/BrandLogo'

const NAV_LINKS = [
  { href: '/catalogue', label: 'Catalogue' },
  { href: '/devis',     label: 'Devis & Projets' },
  { href: '/contact',  label: 'Contact' },
]

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { items, openDrawer } = useCartStore()
  const count = computeTotal(items).lignes_count

  return (
    <header className="sticky top-0 z-30 border-b border-forge-steel-light bg-white shadow-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center">
            <MetalForgeHeaderLogo label="Shop" />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-8 md:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-forge-steel transition-colors hover:text-forge-red"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <a
              href={`https://wa.me/${(process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '').replace(/\D/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700 sm:flex"
            >
              <Phone size={14} />
              WhatsApp
            </a>

            {/* Bouton Mon compte → /compte/dashboard (middleware redirige vers login si non connecté) */}
            <Link
              href="/compte/dashboard"
              className="flex h-9 w-9 items-center justify-center rounded-md border border-forge-steel-light transition-colors hover:bg-forge-steel-light"
              aria-label="Mon compte"
              title="Mon compte / Déconnexion"
            >
              <UserCircle size={18} className="text-forge-steel" />
            </Link>

            {/* Bouton panier → ouvre le CartDrawer */}
            <button
              onClick={openDrawer}
              className="relative flex h-9 w-9 items-center justify-center rounded-md border border-forge-steel-light transition-colors hover:bg-forge-steel-light"
              aria-label="Panier"
            >
              <ShoppingCart size={18} className="text-forge-steel" />
              {count > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-forge-red text-[9px] font-bold text-white">
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </button>

            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-forge-steel-light md:hidden"
              aria-label="Menu"
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <nav className="border-t border-forge-steel-light bg-white px-4 py-4 md:hidden">
          <ul className="flex flex-col gap-3">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="block py-1 text-sm font-medium text-forge-steel hover:text-forge-red"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li className="border-t border-forge-steel-light pt-3">
              <Link
                href="/compte/dashboard"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2 py-1 text-sm font-medium text-forge-steel hover:text-forge-red"
              >
                <UserCircle size={15} />
                Mon compte / Déconnexion
              </Link>
            </li>
          </ul>
        </nav>
      )}
    </header>
  )
}
