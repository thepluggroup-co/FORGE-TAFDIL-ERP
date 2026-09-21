'use client'

import Link from 'next/link'
import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import { ArrowRight, Frame, Layers, Building2, GraduationCap } from 'lucide-react'

const SERVICES = [
  {
    icon: Frame,
    title: 'Menuiserie Aluminium',
    description: 'Fenêtres, portes, façades vitrées et vérandas sur mesure. Profilés aluminium certifiés, pose et finitions incluses.',
    href: '/catalogue?categorie=menuiserie-aluminium',
    color: '#1d4ed8',
  },
  {
    icon: Layers,
    title: 'Ferronnerie',
    description: 'Grilles de sécurité, portails motorisables, escaliers en métal et structures décoratives. Soudure TIG & MIG.',
    href: '/catalogue?categorie=ferronnerie',
    color: '#C62828',
  },
  {
    icon: Building2,
    title: 'Construction Métallique',
    description: 'Charpentes métalliques, hangars industriels et mezzanines. Conception et montage clé en main.',
    href: '/catalogue?categorie=construction-metallique',
    color: '#d97706',
  },
  {
    icon: GraduationCap,
    title: 'Formation Professionnelle',
    description: 'Apprentissage en menuiserie aluminium, soudure et ferronnerie. Reconversion et certification professionnelle.',
    href: '/formation',
    color: '#15803d',
  },
]

export function ServicesSection() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })

  return (
    <section className="bg-forge-steel-light px-4 py-16 sm:py-24" ref={ref}>
      <div className="mx-auto max-w-6xl">
        {/* En-tête */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mb-12 text-center"
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-forge-red">Ce que nous faisons</p>
          <h2 className="text-3xl font-black text-forge-dark sm:text-4xl">Nos Expertises</h2>
        </motion.div>

        {/* Grille 2×2 */}
        <div className="grid gap-6 sm:grid-cols-2">
          {SERVICES.map((service, i) => {
            const Icon = service.icon
            return (
              <motion.div
                key={service.title}
                initial={{ opacity: 0, y: 28 }}
                animate={inView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="group relative rounded-2xl border border-white bg-white p-7 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-forge-red/10 hover:shadow-xl"
              >
                {/* Accent couleur */}
                <div
                  className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl transition-transform duration-300 group-hover:scale-110"
                  style={{ backgroundColor: `${service.color}15` }}
                >
                  <Icon size={26} style={{ color: service.color }} />
                </div>

                <h3 className="mb-2 text-lg font-bold text-forge-dark">{service.title}</h3>
                <p className="mb-5 text-sm leading-relaxed text-forge-steel">{service.description}</p>

                <Link
                  href={service.href}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold transition-colors"
                  style={{ color: service.color }}
                >
                  Découvrir <ArrowRight size={14} className="transition-transform duration-200 group-hover:translate-x-1" />
                </Link>

                {/* Bordure rouge au hover */}
                <div
                  className="pointer-events-none absolute inset-0 rounded-2xl border-2 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  style={{ borderColor: `${service.color}30` }}
                />
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
