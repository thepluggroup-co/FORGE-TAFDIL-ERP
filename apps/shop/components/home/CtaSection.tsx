import Link from 'next/link'
import { MessageCircle, ArrowRight } from 'lucide-react'

export function CtaSection() {
  const whatsapp = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? ''
  const waUrl = `https://wa.me/${whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent('Bonjour TAFDIL, je souhaite un devis pour mon projet.')}`

  return (
    <section
      className="relative overflow-hidden px-4 py-20 text-center sm:py-28"
      style={{ backgroundColor: '#C62828' }}
    >
      {/* Pattern de fond */}
      <div
        className="pointer-events-none absolute inset-0 opacity-10"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.3) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      <div className="relative mx-auto max-w-2xl">
        <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-white/70">
          Passez à l'action
        </p>
        <h2 className="mb-4 text-3xl font-black text-white sm:text-5xl">
          Prêt à lancer votre projet ?
        </h2>
        <p className="mb-10 text-lg text-white/80">
          Devis gratuit sous 24h. Réponse garantie.
        </p>

        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2.5 rounded-xl bg-white px-8 py-4 text-sm font-bold text-forge-red shadow-xl shadow-black/20 transition-all hover:-translate-y-0.5 hover:shadow-2xl"
          >
            <MessageCircle size={18} />
            WhatsApp — Réponse rapide
          </a>
          <Link
            href="/devis"
            className="inline-flex items-center gap-2 rounded-xl border-2 border-white/30 bg-transparent px-8 py-4 text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:border-white hover:bg-white/10"
          >
            Formulaire de contact <ArrowRight size={16} />
          </Link>
        </div>

        <p className="mt-8 text-xs text-white/50">
          Lun–Sam · 7h30–18h00 · Bonamoussadi, Douala
        </p>
      </div>
    </section>
  )
}
