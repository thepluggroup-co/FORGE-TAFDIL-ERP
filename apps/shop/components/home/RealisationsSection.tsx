'use client'

import { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { motion, AnimatePresence, useInView } from 'framer-motion'
import { X, ChevronLeft, ChevronRight, ArrowRight, Image as ImageIcon } from 'lucide-react'
import { api } from '@/lib/api'

interface Realisation {
  id: string
  url: string
  alt: string
  categorie?: string
}

// ── Lightbox ───────────────────────────────────────────────────────────────────

function Lightbox({
  images,
  index,
  onClose,
}: {
  images: Realisation[]
  index: number
  onClose: () => void
}) {
  const [current, setCurrent] = useState(index)

  const prev = () => setCurrent((c) => (c - 1 + images.length) % images.length)
  const next = () => setCurrent((c) => (c + 1) % images.length)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <X size={18} />
      </button>

      <button
        onClick={(e) => { e.stopPropagation(); prev() }}
        className="absolute left-4 top-1/2 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <ChevronLeft size={22} />
      </button>

      <motion.div
        key={current}
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.25 }}
        className="relative max-h-[85vh] max-w-4xl overflow-hidden rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Image
          src={images[current].url}
          alt={images[current].alt}
          width={900}
          height={600}
          className="h-auto max-h-[85vh] w-auto object-contain"
        />
        {images[current].categorie && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-5 py-4">
            <span className="text-sm font-medium text-white">{images[current].categorie}</span>
          </div>
        )}
      </motion.div>

      <button
        onClick={(e) => { e.stopPropagation(); next() }}
        className="absolute right-4 top-1/2 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <ChevronRight size={22} />
      </button>

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/50">
        {current + 1} / {images.length}
      </div>
    </motion.div>
  )
}

// ── Skeleton masonry ───────────────────────────────────────────────────────────

const HEIGHTS = [180, 240, 200, 260, 180, 220, 200, 180, 240]

function MasonrySkeleton() {
  return (
    <div className="columns-1 gap-4 sm:columns-2 lg:columns-3">
      {HEIGHTS.map((h, i) => (
        <div
          key={i}
          className="mb-4 break-inside-avoid rounded-xl bg-gray-100 animate-pulse"
          style={{ height: h }}
        />
      ))}
    </div>
  )
}

// ── Réalisations section ───────────────────────────────────────────────────────

const FALLBACK_IMAGES: Realisation[] = [
  { id: '1', url: 'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?w=600&q=80', alt: 'Menuiserie aluminium', categorie: 'Menuiserie Aluminium' },
  { id: '2', url: 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=600&q=80', alt: 'Ferronnerie', categorie: 'Ferronnerie' },
  { id: '3', url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=600&q=80', alt: 'Construction métallique', categorie: 'Construction Métallique' },
  { id: '4', url: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=600&q=80', alt: 'Portail', categorie: 'Ferronnerie' },
  { id: '5', url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=600&q=80', alt: 'Façade', categorie: 'Menuiserie Aluminium' },
  { id: '6', url: 'https://images.unsplash.com/photo-1541888946425-d81bb19240f5?w=600&q=80', alt: 'Charpente', categorie: 'Construction Métallique' },
]

export function RealisationsSection() {
  const [images, setImages] = useState<Realisation[]>([])
  const [loading, setLoading] = useState(true)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })

  useEffect(() => {
    api
      .get<{ data: Realisation[] }>('/api/shop/realisations?limit=9')
      .then((res) => {
        setImages(res.data?.data?.length ? res.data.data : FALLBACK_IMAGES)
      })
      .catch(() => setImages(FALLBACK_IMAGES))
      .finally(() => setLoading(false))
  }, [])

  return (
    <>
      <section className="bg-white px-4 py-16 sm:py-24" ref={ref}>
        <div className="mx-auto max-w-6xl">
          {/* En-tête */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5 }}
            className="mb-10 flex flex-col items-center text-center sm:flex-row sm:items-end sm:justify-between sm:text-left"
          >
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-forge-red">Portfolio</p>
              <h2 className="text-3xl font-black text-forge-dark sm:text-4xl">Nos Réalisations</h2>
            </div>
            <Link
              href="/realisations"
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-forge-steel-light px-5 py-2.5 text-sm font-semibold text-forge-steel transition-colors hover:border-forge-red hover:text-forge-red sm:mt-0"
            >
              Voir tout <ArrowRight size={15} />
            </Link>
          </motion.div>

          {/* Masonry grid */}
          {loading ? (
            <MasonrySkeleton />
          ) : (
            <div className="columns-1 gap-4 sm:columns-2 lg:columns-3">
              {images.map((img, i) => (
                <motion.button
                  key={img.id}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={inView ? { opacity: 1, scale: 1 } : {}}
                  transition={{ duration: 0.4, delay: Math.min(i * 0.07, 0.5) }}
                  onClick={() => setLightbox(i)}
                  className="group mb-4 block w-full break-inside-avoid overflow-hidden rounded-xl border border-gray-100 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
                >
                  <div className="relative overflow-hidden">
                    <Image
                      src={img.url}
                      alt={img.alt}
                      width={600}
                      height={400}
                      className="h-auto w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/50 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                      <div className="flex items-center gap-2 px-4 py-3">
                        <ImageIcon size={14} className="text-white" />
                        <span className="text-xs font-medium text-white">{img.alt}</span>
                      </div>
                    </div>
                  </div>
                  {img.categorie && (
                    <div className="bg-white px-3 py-2">
                      <span className="text-xs font-medium text-forge-steel">{img.categorie}</span>
                    </div>
                  )}
                </motion.button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Lightbox */}
      <AnimatePresence>
        {lightbox !== null && (
          <Lightbox images={images} index={lightbox} onClose={() => setLightbox(null)} />
        )}
      </AnimatePresence>
    </>
  )
}
