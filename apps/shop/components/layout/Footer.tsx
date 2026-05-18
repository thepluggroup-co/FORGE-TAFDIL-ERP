import Link from 'next/link'
import { MapPin, Phone, Mail } from 'lucide-react'
import { MetalForgeLogo } from '@/components/ui/BrandLogo'

export function Footer() {
  return (
    <footer className="border-t border-forge-steel-light bg-forge-dark text-white">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 md:grid-cols-3">
          {/* Brand */}
          <div>
            <MetalForgeLogo size={28} variant="white" />
            <p className="mt-2 text-sm text-gray-400">
              Fournitures industrielles de qualité — Tuyaux, raccords et équipements pour professionnels.
            </p>
          </div>

          {/* Navigation */}
          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-300">Navigation</p>
            <ul className="space-y-2 text-sm text-gray-400">
              {[
                { href: '/catalogue', label: 'Catalogue' },
                { href: '/categories', label: 'Catégories' },
                { href: '/promotions', label: 'Promotions' },
                { href: '/contact', label: 'Contact' },
              ].map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="transition-colors hover:text-white">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-300">Contact</p>
            <ul className="space-y-2 text-sm text-gray-400">
              <li className="flex items-start gap-2">
                <MapPin size={14} className="mt-0.5 shrink-0 text-forge-red" />
                <span>Douala, Cameroun</span>
              </li>
              <li className="flex items-center gap-2">
                <Phone size={14} className="shrink-0 text-forge-red" />
                <a
                  href={`https://wa.me/${process.env.NEXT_PUBLIC_WHATSAPP_NUMBER}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white"
                >
                  WhatsApp
                </a>
              </li>
              <li className="flex items-center gap-2">
                <Mail size={14} className="shrink-0 text-forge-red" />
                <span>contact@tafdil.cm</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-white/10 pt-6 text-center text-xs text-gray-500">
          © {new Date().getFullYear()} TAFDIL — FORGE ERP. Tous droits réservés.
        </div>
      </div>
    </footer>
  )
}
