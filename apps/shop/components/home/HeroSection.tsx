'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowRight, ChevronDown, Wrench, Building2, Layers } from 'lucide-react'

const ICONS = [
  { icon: Wrench,    label: 'Menuiserie' },
  { icon: Building2, label: 'Construction' },
  { icon: Layers,   label: 'Ferronnerie' },
]

export function HeroSection() {
  return (
    <section
      className="relative flex min-h-[80vh] flex-col items-center justify-center overflow-hidden px-4 text-center lg:min-h-screen"
      style={{ background: 'linear-gradient(160deg, #212121 0%, #1A1A1A 60%, #111111 100%)' }}
    >
      {/* Grille de fond subtile */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.3) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Accent rouge */}
      <div className="pointer-events-none absolute -top-32 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-forge-red opacity-[0.06] blur-3xl" />

      {/* Contenu */}
      <div className="relative z-10 flex flex-col items-center gap-6 max-w-3xl">

        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium tracking-widest text-white/60 uppercase"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-forge-red" />
          TAFDIL · Douala, Cameroun
        </motion.div>

        {/* Titre */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="text-4xl font-black leading-tight text-white sm:text-5xl lg:text-6xl"
        >
          Votre partenaire{' '}
          <span className="text-forge-red">métallurgie</span>
          <br />à Douala
        </motion.h1>

        {/* Sous-titre */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="max-w-xl text-base text-white/60 sm:text-lg"
        >
          Menuiserie aluminium, ferronnerie, construction sur mesure.
          <br />
          Commandez en ligne, livraison sur chantier.
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="flex flex-col items-center gap-3 sm:flex-row"
        >
          <Link
            href="/catalogue"
            className="inline-flex items-center gap-2 rounded-xl bg-forge-red px-7 py-3.5 text-sm font-bold text-white shadow-lg shadow-forge-red/20 transition-all hover:bg-forge-red-dark hover:shadow-forge-red/30 hover:-translate-y-0.5"
          >
            Voir le Catalogue <ArrowRight size={16} />
          </Link>
          <Link
            href="/devis"
            className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-7 py-3.5 text-sm font-bold text-white backdrop-blur-sm transition-all hover:bg-white/10 hover:-translate-y-0.5"
          >
            Demander un Devis
          </Link>
        </motion.div>

        {/* Icones industrielles animées */}
        <div className="mt-4 flex items-center gap-8">
          {ICONS.map(({ icon: Icon, label }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.4 + i * 0.12 }}
              className="flex flex-col items-center gap-1.5"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 border border-white/10">
                <Icon size={22} className="text-forge-red" />
              </div>
              <span className="text-xs text-white/40 font-medium">{label}</span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
      >
        <span className="text-xs text-white/30 tracking-widest uppercase">Découvrir</span>
        <motion.div
          animate={{ y: [0, 6, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        >
          <ChevronDown size={18} className="text-white/30" />
        </motion.div>
      </motion.div>
    </section>
  )
}
