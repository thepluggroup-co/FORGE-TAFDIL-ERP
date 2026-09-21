'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence, useInView } from 'framer-motion'
import { Quote, Star } from 'lucide-react'

const TEMOIGNAGES = [
  {
    id: 1,
    nom: 'Jean-Baptiste Nkomo',
    poste: 'Promoteur immobilier',
    entreprise: 'JBN Construction, Douala',
    texte:
      "TAFDIL a réalisé la totalité des menuiseries aluminium de notre résidence de 24 appartements. Délais respectés, finitions impeccables. Je recommande sans hésitation.",
    note: 5,
    initiale: 'J',
    couleur: '#1d4ed8',
  },
  {
    id: 2,
    nom: 'Marie-Claire Essomba',
    poste: 'Directrice',
    entreprise: 'Groupe Essomba & Fils, Yaoundé',
    texte:
      "La charpente métallique de notre entrepôt a été livrée et montée en 3 semaines. Équipe professionnelle, prix compétitifs. TAFDIL est notre partenaire de confiance depuis 5 ans.",
    note: 5,
    initiale: 'M',
    couleur: '#15803d',
  },
  {
    id: 3,
    nom: 'Patrick Abanda',
    poste: 'Architecte DOAC',
    entreprise: 'Cabinet PA Architectes, Douala',
    texte:
      "J'intègre systématiquement TAFDIL dans mes projets résidentiels haut de gamme. La qualité des profils aluminium et la précision de fabrication sont au rendez-vous.",
    note: 5,
    initiale: 'P',
    couleur: '#7c3aed',
  },
]

export function TemoignagesSection() {
  const [current, setCurrent] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrent((c) => (c + 1) % TEMOIGNAGES.length)
    }, 5000)
    return () => clearInterval(timer)
  }, [])

  const t = TEMOIGNAGES[current]

  return (
    <section className="bg-forge-dark px-4 py-20 sm:py-28" ref={ref}>
      <div className="mx-auto max-w-3xl">
        {/* En-tête */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mb-10 text-center"
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-forge-red">Ils nous font confiance</p>
          <h2 className="text-3xl font-black text-white sm:text-4xl">Témoignages</h2>
        </motion.div>

        {/* Carousel */}
        <div className="relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={current}
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.4 }}
              className="rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur-sm sm:p-10"
            >
              {/* Icone guillemet */}
              <Quote size={36} className="mb-5 text-forge-red/60" />

              {/* Étoiles */}
              <div className="mb-4 flex gap-1">
                {Array.from({ length: t.note }).map((_, i) => (
                  <Star key={i} size={15} fill="#C62828" stroke="none" />
                ))}
              </div>

              {/* Texte */}
              <p className="mb-8 text-lg leading-relaxed text-white/80 italic">"{t.texte}"</p>

              {/* Auteur */}
              <div className="flex items-center gap-4">
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white text-lg font-bold"
                  style={{ backgroundColor: t.couleur }}
                >
                  {t.initiale}
                </div>
                <div>
                  <p className="font-semibold text-white">{t.nom}</p>
                  <p className="text-sm text-white/50">{t.poste} · {t.entreprise}</p>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Dots */}
          <div className="mt-6 flex items-center justify-center gap-2">
            {TEMOIGNAGES.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                className="h-2 rounded-full transition-all duration-300"
                style={{
                  width: i === current ? 24 : 8,
                  backgroundColor: i === current ? '#C62828' : 'rgba(255,255,255,0.2)',
                }}
                aria-label={`Témoignage ${i + 1}`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
