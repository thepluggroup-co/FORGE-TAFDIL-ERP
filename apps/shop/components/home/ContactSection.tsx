'use client'

import { useState, useRef } from 'react'
import { motion, AnimatePresence, useInView } from 'framer-motion'
import { MapPin, Clock, Phone, Mail, Send, CheckCircle, Paperclip, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'

// ── Confetti léger ─────────────────────────────────────────────────────────────

function Confetti() {
  const pieces = Array.from({ length: 30 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    delay: Math.random() * 0.6,
    color: ['#C62828', '#FFD600', '#1d4ed8', '#15803d'][i % 4],
  }))

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {pieces.map((p) => (
        <motion.div
          key={p.id}
          initial={{ top: -10, left: `${p.x}%`, opacity: 1, rotate: 0 }}
          animate={{ top: '110%', opacity: 0, rotate: 360 * (Math.random() > 0.5 ? 1 : -1) }}
          transition={{ duration: 1.8 + Math.random(), delay: p.delay, ease: 'easeIn' }}
          className="absolute h-3 w-3 rounded-sm"
          style={{ backgroundColor: p.color }}
        />
      ))}
    </div>
  )
}

// ── Types de projet ────────────────────────────────────────────────────────────

const TYPES_PROJET = [
  'Menuiserie aluminium (fenêtres, portes)',
  'Ferronnerie (grilles, portails)',
  'Charpente / Construction métallique',
  'Façade vitrée / Véranda',
  'Formation professionnelle',
  'Autre',
]

// ── Formulaire ─────────────────────────────────────────────────────────────────

interface FormData {
  nom: string
  telephone: string
  email: string
  type_projet: string
  description: string
}

function ContactForm() {
  const [form, setForm] = useState<FormData>({
    nom: '', telephone: '', email: '', type_projet: '', description: '',
  })
  const [fichiers, setFichiers] = useState<File[]>([])
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [showConfetti, setShowConfetti] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const set = (field: keyof FormData) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const addFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    setFichiers((prev) => [...prev, ...files].slice(0, 5))
  }

  const removeFile = (i: number) => setFichiers((prev) => prev.filter((_, idx) => idx !== i))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.nom || !form.telephone || !form.description) {
      toast.error('Veuillez remplir les champs obligatoires.')
      return
    }

    setLoading(true)
    const { error } = await api.post('/api/shop/devis', {
      nom:         form.nom,
      telephone:   form.telephone,
      email:       form.email || undefined,
      description: `[${form.type_projet || 'Projet'}] ${form.description}`,
    })
    setLoading(false)

    if (error) {
      toast.error('Erreur lors de l\'envoi. Réessayez ou contactez-nous par WhatsApp.')
      return
    }

    setSuccess(true)
    setShowConfetti(true)
    setTimeout(() => setShowConfetti(false), 2500)
  }

  if (success) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center rounded-2xl border border-green-100 bg-green-50 px-8 py-14 text-center"
      >
        <CheckCircle size={48} className="mb-4 text-green-500" />
        <h3 className="mb-2 text-xl font-bold text-forge-dark">Demande envoyée !</h3>
        <p className="text-forge-steel">
          Nous avons bien reçu votre message. Notre équipe vous rappelle sous <strong>24h</strong>.
        </p>
        <button
          onClick={() => setSuccess(false)}
          className="mt-6 text-sm text-forge-steel underline hover:text-forge-red"
        >
          Envoyer une autre demande
        </button>
      </motion.div>
    )
  }

  const inputCls = 'w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition-all focus:border-forge-red focus:ring-2 focus:ring-forge-red/10 placeholder:text-gray-400'

  return (
    <>
      {showConfetti && <Confetti />}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-forge-steel">Nom complet *</label>
            <input className={inputCls} placeholder="Jean-Baptiste Nkomo" value={form.nom} onChange={set('nom')} required />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-forge-steel">Téléphone *</label>
            <input className={inputCls} placeholder="+237 6XX XXX XXX" value={form.telephone} onChange={set('telephone')} required />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-forge-steel">Email (optionnel)</label>
          <input className={inputCls} type="email" placeholder="vous@exemple.cm" value={form.email} onChange={set('email')} />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-forge-steel">Type de projet</label>
          <select className={inputCls} value={form.type_projet} onChange={set('type_projet')}>
            <option value="">Sélectionnez un type de projet…</option>
            {TYPES_PROJET.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-forge-steel">Description du projet *</label>
          <textarea
            className={`${inputCls} min-h-[120px] resize-y`}
            placeholder="Décrivez votre projet : dimensions, matériaux souhaités, délais, lieu de livraison…"
            value={form.description}
            onChange={set('description')}
            required
          />
        </div>

        {/* Upload fichiers */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-forge-steel">
            Fichiers joints (plans, photos — max 5)
          </label>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-2.5 text-sm text-forge-steel transition-colors hover:border-forge-red hover:text-forge-red"
          >
            <Paperclip size={14} /> Ajouter des fichiers
          </button>
          <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.dwg" onChange={addFiles} className="hidden" />
          {fichiers.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {fichiers.map((f, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-forge-steel">
                  {f.name}
                  <button type="button" onClick={() => removeFile(i)} className="text-gray-400 hover:text-red-500">
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-forge-red py-3.5 text-sm font-bold text-white transition-all hover:bg-forge-red-dark disabled:opacity-60"
        >
          {loading ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : (
            <Send size={15} />
          )}
          {loading ? 'Envoi en cours…' : 'Envoyer ma demande'}
        </button>
      </form>
    </>
  )
}

// ── Section Contact ────────────────────────────────────────────────────────────

export function ContactSection() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })

  return (
    <section id="contact" className="bg-forge-steel-light px-4 py-16 sm:py-24" ref={ref}>
      <div className="mx-auto max-w-6xl">
        {/* En-tête */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mb-12 text-center"
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-forge-red">Contactez-nous</p>
          <h2 className="text-3xl font-black text-forge-dark sm:text-4xl">Parlons de votre projet</h2>
          <p className="mx-auto mt-3 max-w-md text-forge-steel">
            Remplissez le formulaire ou contactez-nous directement. Réponse garantie sous 24h.
          </p>
        </motion.div>

        <div className="grid gap-10 lg:grid-cols-5">
          {/* Formulaire — 3/5 */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="lg:col-span-3"
          >
            <div className="rounded-2xl bg-white p-6 shadow-sm sm:p-8">
              <ContactForm />
            </div>
          </motion.div>

          {/* Infos + carte — 2/5 */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="flex flex-col gap-6 lg:col-span-2"
          >
            {/* Infos */}
            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-sm font-bold text-forge-dark">Informations</h3>
              <ul className="space-y-4">
                <li className="flex items-start gap-3">
                  <MapPin size={16} className="mt-0.5 shrink-0 text-forge-red" />
                  <div>
                    <p className="text-sm font-medium text-forge-dark">Adresse</p>
                    <p className="text-sm text-forge-steel">KOTTO, derriere l'ecole Mauryvanas, Douala</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <Clock size={16} className="mt-0.5 shrink-0 text-forge-red" />
                  <div>
                    <p className="text-sm font-medium text-forge-dark">Horaires</p>
                    <p className="text-sm text-forge-steel">Lun–Sam · 7h30–18h00</p>
                    <p className="text-xs text-gray-400">Fermé le dimanche</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <Phone size={16} className="mt-0.5 shrink-0 text-forge-red" />
                  <div>
                    <p className="text-sm font-medium text-forge-dark">Téléphone / WhatsApp</p>
                    <a
                      href="https://wa.me/237695884528"
                      className="text-sm text-forge-red hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      +237 695884528
                    </a>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <Mail size={16} className="mt-0.5 shrink-0 text-forge-red" />
                  <div>
                    <p className="text-sm font-medium text-forge-dark">Email</p>
                    <a href="mailto:contact@tafdil.cm" className="text-sm text-forge-red hover:underline">
                      contact@tafdil.cm
                    </a>
                  </div>
                </li>
              </ul>
            </div>

            {/* Google Maps embed */}
            <div className="overflow-hidden rounded-2xl shadow-sm">
              <iframe
                src="https://www.google.com/maps?q=KOTTO%2C%20derriere%20l%27ecole%20Mauryvanas%2C%20Douala%2C%20Cameroun&output=embed"
                width="100%"
                height="220"
                style={{ border: 0 }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title="Localisation TAFDIL Douala"
              />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
