'use client'

import { useState, useRef, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  Send, CheckCircle, Paperclip, X, FileText, HardHat,
  Clock, Phone, Mail, MapPin,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'

// ── Types de projet ────────────────────────────────────────────────────────────

const TYPES_PROJET = [
  'Menuiserie aluminium (fenêtres, portes)',
  'Ferronnerie (grilles, portails)',
  'Charpente / Construction métallique',
  'Façade vitrée / Véranda',
  'Formation professionnelle',
  'Devis produit catalogue',
  'Autre',
]

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

// ── Formulaire principal ───────────────────────────────────────────────────────

interface FormData {
  nom: string
  telephone: string
  email: string
  type_projet: string
  description: string
}

function DevisForm() {
  const searchParams = useSearchParams()
  const produitRef  = searchParams.get('ref') ?? ''
  const produitNom  = searchParams.get('nom') ?? ''

  const [form, setForm] = useState<FormData>({
    nom:          '',
    telephone:    '',
    email:        '',
    type_projet:  produitNom ? 'Devis produit catalogue' : '',
    description:  produitNom
      ? `Je souhaite un devis pour le produit : ${produitNom}${produitRef ? ` (Réf. ${produitRef})` : ''}.\n\n`
      : '',
  })
  const [fichiers, setFichiers]         = useState<File[]>([])
  const [loading, setLoading]           = useState(false)
  const [success, setSuccess]           = useState(false)
  const [showConfetti, setShowConfetti] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const set = (field: keyof FormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }))

  const addFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    setFichiers((prev) => [...prev, ...files].slice(0, 5))
  }

  const removeFile = (i: number) =>
    setFichiers((prev) => prev.filter((_, idx) => idx !== i))

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
      description: form.description,
      type_projet: form.type_projet || undefined,
      produit_ref: produitRef || undefined,
    })
    setLoading(false)

    if (error) {
      toast.error("Erreur lors de l'envoi. Réessayez ou contactez-nous par WhatsApp.")
      return
    }

    setSuccess(true)
    setShowConfetti(true)
    setTimeout(() => setShowConfetti(false), 2500)
  }

  const inputCls =
    'w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition-all focus:border-forge-red focus:ring-2 focus:ring-forge-red/10 placeholder:text-gray-400'

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
          Notre équipe vous rappelle sous <strong>24h</strong> avec un devis détaillé.
        </p>
        <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row">
          <button
            onClick={() => { setSuccess(false); setForm({ nom: '', telephone: '', email: '', type_projet: '', description: '' }); setFichiers([]) }}
            className="text-sm text-forge-steel underline hover:text-forge-red"
          >
            Envoyer une autre demande
          </button>
          <Link
            href="/catalogue"
            className="rounded-xl bg-forge-red px-5 py-2.5 text-sm font-bold text-white hover:bg-forge-red-dark"
          >
            Voir le catalogue
          </Link>
        </div>
      </motion.div>
    )
  }

  return (
    <>
      {showConfetti && <Confetti />}

      {/* Produit pré-sélectionné */}
      {produitNom && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-forge-red/20 bg-forge-red/5 p-3">
          <FileText size={16} className="shrink-0 text-forge-red" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-forge-red">Produit sélectionné</p>
            <p className="truncate text-sm font-medium text-forge-dark">{produitNom}</p>
            {produitRef && <p className="text-xs text-forge-steel">Réf. {produitRef}</p>}
          </div>
          <Link
            href={`/catalogue`}
            className="ml-auto shrink-0 text-xs text-forge-steel underline hover:text-forge-red"
          >
            Changer
          </Link>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-forge-steel">Nom complet *</label>
            <input
              className={inputCls}
              placeholder="Jean-Baptiste Nkomo"
              value={form.nom}
              onChange={set('nom')}
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-forge-steel">Téléphone *</label>
            <input
              className={inputCls}
              placeholder="+237 6XX XXX XXX"
              value={form.telephone}
              onChange={set('telephone')}
              required
            />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-forge-steel">Email (optionnel)</label>
          <input
            className={inputCls}
            type="email"
            placeholder="vous@exemple.cm"
            value={form.email}
            onChange={set('email')}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-forge-steel">Type de projet</label>
          <select className={inputCls} value={form.type_projet} onChange={set('type_projet')}>
            <option value="">Sélectionnez un type de projet…</option>
            {TYPES_PROJET.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-forge-steel">Description du projet *</label>
          <textarea
            className={`${inputCls} min-h-[140px] resize-y`}
            placeholder="Décrivez votre projet : dimensions, matériaux souhaités, délais, lieu de livraison, quantités…"
            value={form.description}
            onChange={set('description')}
            required
          />
        </div>

        {/* Upload fichiers */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-forge-steel">
            Fichiers joints — plans, photos, croquis (max 5)
          </label>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-2.5 text-sm text-forge-steel transition-colors hover:border-forge-red hover:text-forge-red"
          >
            <Paperclip size={14} /> Joindre des fichiers
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,.pdf,.dwg,.dxf"
            onChange={addFiles}
            className="hidden"
          />
          {fichiers.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {fichiers.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-forge-steel"
                >
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
          {loading ? 'Envoi en cours…' : 'Envoyer ma demande de devis'}
        </button>
      </form>
    </>
  )
}

// ── Layout principal ──────────────────────────────────────────────────────────

export function DevisClient() {
  return (
    <section className="bg-forge-steel-light px-4 py-12 sm:py-16">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 lg:grid-cols-5">

          {/* Formulaire — 3/5 */}
          <div className="lg:col-span-3">
            <div className="rounded-2xl bg-white p-6 shadow-sm sm:p-8">
              <h2 className="mb-6 text-lg font-black text-forge-dark">Votre demande</h2>
              <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-gray-100" />}>
                <DevisForm />
              </Suspense>
            </div>
          </div>

          {/* Infos pratiques — 2/5 */}
          <div className="flex flex-col gap-6 lg:col-span-2">

            {/* Étapes */}
            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-sm font-bold text-forge-dark">Comment ça marche ?</h3>
              <ol className="space-y-4">
                {[
                  { icon: FileText, titre: '1. Soumettez votre demande', detail: 'Remplissez le formulaire avec les détails de votre projet.' },
                  { icon: Clock,    titre: '2. Nous vous rappelons', detail: 'Notre équipe analyse votre demande et vous contacte sous 24h.' },
                  { icon: HardHat,  titre: '3. Devis & production', detail: 'Après validation du devis, nous lançons la fabrication.' },
                ].map(({ icon: Icon, titre, detail }) => (
                  <li key={titre} className="flex items-start gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-forge-red/10">
                      <Icon size={14} className="text-forge-red" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-forge-dark">{titre}</p>
                      <p className="text-xs text-forge-steel">{detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* Coordonnées */}
            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-sm font-bold text-forge-dark">Nous contacter directement</h3>
              <ul className="space-y-3">
                <li className="flex items-start gap-3">
                  <Phone size={15} className="mt-0.5 shrink-0 text-forge-red" />
                  <div>
                    <p className="text-xs font-medium text-forge-dark">WhatsApp</p>
                    <a
                      href={`https://wa.me/${(process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '').replace(/\D/g, '')}`}
                      className="text-sm text-forge-red hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '+237 6XX XXX XXX'}
                    </a>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <Mail size={15} className="mt-0.5 shrink-0 text-forge-red" />
                  <div>
                    <p className="text-xs font-medium text-forge-dark">Email</p>
                    <a href="mailto:contact@tafdil.cm" className="text-sm text-forge-red hover:underline">
                      contact@tafdil.cm
                    </a>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <MapPin size={15} className="mt-0.5 shrink-0 text-forge-red" />
                  <div>
                    <p className="text-xs font-medium text-forge-dark">Atelier</p>
                    <p className="text-sm text-forge-steel">Bonamoussadi, Douala, Cameroun</p>
                    <p className="text-xs text-gray-400">Lun–Sam · 7h30–18h00</p>
                  </div>
                </li>
              </ul>
            </div>

            {/* CTA catalogue */}
            <Link
              href="/catalogue"
              className="flex items-center justify-center gap-2 rounded-2xl border-2 border-forge-red/20 bg-white px-4 py-4 text-sm font-bold text-forge-red shadow-sm transition-colors hover:bg-forge-red/5"
            >
              Parcourir le catalogue
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
