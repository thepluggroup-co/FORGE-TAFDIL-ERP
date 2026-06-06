'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Check, ChevronRight, ChevronLeft, AlertTriangle,
  Trash2, Package, MessageCircle, Loader2,
} from 'lucide-react'
import { z } from 'zod'
import { toast } from 'sonner'
import { useCartStore, computeTotal } from '@/lib/cart'
import type { CartItem, CartTotals } from '@/lib/cart'
import { FRAIS_LIVRAISON } from '@forge/shared'

// ── Constantes ─────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4
type Ville = 'Douala' | 'Yaounde' | 'Bafoussam' | 'Autres'
type ModePaiement = 'mtn' | 'orange' | 'livraison'

const STEPS: { id: Step; label: string }[] = [
  { id: 1, label: 'Panier' },
  { id: 2, label: 'Coordonnées' },
  { id: 3, label: 'Paiement' },
  { id: 4, label: 'Confirmation' },
]

const FRAIS: Record<Ville, number | null> = {
  Douala:    FRAIS_LIVRAISON.douala.tarif,
  Yaounde:   FRAIS_LIVRAISON.yaounde.tarif,
  Bafoussam: null, // tarif sur devis — contact commercial
  Autres:    null, // tarif sur devis — contact commercial
}

const MODE_LABEL: Record<ModePaiement, string> = {
  mtn: 'MTN Mobile Money',
  orange: 'Orange Money',
  livraison: 'Paiement à la livraison',
}

// ── Types formulaire ───────────────────────────────────────────────────────────

interface Coordonnees {
  nom: string
  telephone: string
  email: string
  adresse: string
  ville: Ville
  notes: string
  veutFacture: boolean
  niu: string
  rccm: string
}

const DEFAULT_COORDONNEES: Coordonnees = {
  nom: '', telephone: '', email: '', adresse: '',
  ville: 'Douala', notes: '', veutFacture: false, niu: '', rccm: '',
}

// ── Validation Zod ─────────────────────────────────────────────────────────────

const CoordSchema = z.object({
  nom:       z.string().min(3, 'Minimum 3 caractères'),
  telephone: z.string().regex(/^(\+?237\s?)?6\d{8}$/, 'Format invalide (ex : +237 677 123 456)'),
  email:     z.union([z.string().email('Email invalide'), z.literal('')]),
  adresse:   z.string().min(5, 'Adresse trop courte'),
  ville:     z.enum(['Douala', 'Yaounde', 'Bafoussam', 'Autres']),
})

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('fr-CM', {
    style: 'currency', currency: 'XAF', maximumFractionDigits: 0,
  }).format(n)
}

function grandTotal(totals: CartTotals, ville: Ville) {
  const frais = FRAIS[ville]
  return totals.ttc + (frais ?? 0)
}

// ── Stepper ────────────────────────────────────────────────────────────────────

function Stepper({ current }: { current: Step }) {
  return (
    <div className="flex items-center justify-center">
      {STEPS.map((s, i) => {
        const status = s.id < current ? 'done' : s.id === current ? 'active' : 'pending'
        return (
          <div key={s.id} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all duration-300 ${
                status === 'done'   ? 'bg-green-500 text-white' :
                status === 'active' ? 'bg-forge-red text-white ring-4 ring-forge-red/20' :
                                      'bg-gray-100 text-gray-400'
              }`}>
                {status === 'done' ? <Check size={14} /> : s.id}
              </div>
              <span className={`hidden text-[10px] font-semibold sm:block transition-colors ${
                status === 'active' ? 'text-forge-red' :
                status === 'done'   ? 'text-green-600' : 'text-gray-400'
              }`}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`mx-2 mb-4 h-0.5 w-8 transition-colors duration-300 sm:w-14 ${
                s.id < current ? 'bg-green-400' : 'bg-gray-200'
              }`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Composant Field réutilisable ───────────────────────────────────────────────

function Field({
  label, error, value, onChange, placeholder, type = 'text',
}: {
  label: string; error?: string; value: string
  onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-forge-dark">
        {label}
        {error && <span className="ml-2 font-normal text-red-500">{error}</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition-all focus:ring-2 ${
          error
            ? 'border-red-300 bg-red-50 focus:border-red-400 focus:ring-red-100'
            : 'border-gray-200 bg-white focus:border-forge-red focus:ring-forge-red/10'
        }`}
      />
    </div>
  )
}

// ── ÉTAPE 1 — Récapitulatif panier ─────────────────────────────────────────────

function StepPanier({ onNext }: { onNext: () => void }) {
  const { items, removeItem, refreshStockStatus } = useCartStore()
  const [checking, setChecking] = useState(true)
  const totals = computeTotal(items)
  const hasInvalidStock = items.some(i => i.stock_insuffisant || i.stock_actuel <= 0)

  useEffect(() => {
    refreshStockStatus().finally(() => setChecking(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <Package size={48} className="text-gray-200" />
        <p className="font-bold text-forge-dark">Votre panier est vide</p>
        <Link href="/catalogue" className="rounded-xl bg-forge-red px-6 py-3 text-sm font-bold text-white transition hover:bg-forge-red-dark">
          Voir le catalogue
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-forge-dark">Récapitulatif panier</h2>
          <p className="mt-0.5 text-xs text-forge-steel">
            {checking ? (
              <span className="flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Vérification des stocks…</span>
            ) : (
              hasInvalidStock ? '⚠ Certains articles ont un problème de stock' : `${totals.lignes_count} article${totals.lignes_count > 1 ? 's' : ''} vérifiés`
            )}
          </p>
        </div>
      </div>

      {/* Tableau articles */}
      <div className="overflow-hidden rounded-2xl border border-gray-100">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="py-3 pl-4 text-left text-xs font-semibold text-forge-steel">Désignation</th>
              <th className="py-3 px-3 text-center text-xs font-semibold text-forge-steel">Qté</th>
              <th className="py-3 px-3 text-right text-xs font-semibold text-forge-steel">Prix unit.</th>
              <th className="py-3 pr-4 text-right text-xs font-semibold text-forge-steel">Total HT</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: CartItem) => {
              const isProblematic = item.stock_insuffisant || item.stock_actuel <= 0
              return (
                <tr key={item.id} className={`border-t border-gray-100 ${isProblematic ? 'bg-red-50' : ''}`}>
                  <td className="py-3 pl-4">
                    <div className="flex items-center gap-3 min-w-0">
                      {item.image && (
                        <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg bg-gray-50">
                          <Image src={item.image} alt={item.nom} fill sizes="40px" className="object-cover" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className={`line-clamp-1 font-semibold ${isProblematic ? 'text-red-700' : 'text-forge-dark'}`}>
                          {item.nom}
                        </p>
                        <p className="font-mono text-[10px] text-gray-400">{item.ref}</p>
                      </div>
                      {isProblematic && (
                        <div className="flex flex-shrink-0 items-center gap-1.5 ml-1">
                          <span className="flex items-center gap-0.5 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-600">
                            <AlertTriangle size={8} /> Stock insuffisant
                          </span>
                          <button
                            onClick={() => removeItem(item.id)}
                            className="text-red-300 transition hover:text-red-500"
                            title="Supprimer"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-center text-forge-steel">{item.quantite}</td>
                  <td className="py-3 px-3 text-right text-forge-steel">
                    {item.prix ? fmt(item.prix) : '—'}
                  </td>
                  <td className="py-3 pr-4 text-right font-bold text-forge-dark">
                    {item.prix ? fmt(item.prix * item.quantite) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Totaux */}
      <div className="rounded-2xl bg-gray-50 p-4 space-y-2">
        <div className="flex justify-between text-sm text-forge-steel">
          <span>Sous-total HT</span>
          <span className="font-semibold">{fmt(totals.ht)}</span>
        </div>
        <div className="flex justify-between text-sm text-forge-steel">
          <span>TVA (19,25%)</span>
          <span className="font-semibold">{fmt(totals.tva)}</span>
        </div>
        <div className="flex justify-between border-t border-gray-200 pt-2">
          <span className="font-black text-forge-dark">Total TTC</span>
          <span className="text-xl font-black text-forge-red">{fmt(totals.ttc)}</span>
        </div>
      </div>

      {hasInvalidStock && (
        <p className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
          Supprimez les articles indisponibles (icône poubelle) pour continuer.
        </p>
      )}

      <button
        onClick={onNext}
        disabled={hasInvalidStock || checking}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-forge-red py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-forge-red-dark disabled:opacity-40"
      >
        Suivant — Coordonnées <ChevronRight size={16} />
      </button>
    </div>
  )
}

// ── ÉTAPE 2 — Coordonnées ──────────────────────────────────────────────────────

function StepCoordonnees({
  coordonnees, onChange, onNext, onBack, totals,
}: {
  coordonnees: Coordonnees
  onChange: (c: Coordonnees) => void
  onNext: () => void
  onBack: () => void
  totals: CartTotals
}) {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const frais = FRAIS[coordonnees.ville]
  const total = grandTotal(totals, coordonnees.ville)

  const set = (field: keyof Coordonnees) => (value: string | boolean) =>
    onChange({ ...coordonnees, [field]: value })

  const handleNext = () => {
    const result = CoordSchema.safeParse(coordonnees)
    if (!result.success) {
      const errs: Record<string, string> = {}
      result.error.issues.forEach(i => { errs[String(i.path[0])] = i.message })
      setErrors(errs)
      return
    }
    setErrors({})
    onNext()
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black text-forge-dark">Vos coordonnées</h2>
        <p className="mt-0.5 text-xs text-forge-steel">Les champs marqués * sont obligatoires.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field
            label="Nom complet *" error={errors.nom}
            value={coordonnees.nom} onChange={v => set('nom')(v)}
            placeholder="Ex : Jean-Paul Mbarga"
          />
        </div>
        <Field
          label="Téléphone *" error={errors.telephone}
          value={coordonnees.telephone} onChange={v => set('telephone')(v)}
          placeholder="+237 677 123 456" type="tel"
        />
        <Field
          label="Email (optionnel)" error={errors.email}
          value={coordonnees.email} onChange={v => set('email')(v)}
          placeholder="email@exemple.com" type="email"
        />
        <div className="sm:col-span-2">
          <Field
            label="Adresse de livraison *" error={errors.adresse}
            value={coordonnees.adresse} onChange={v => set('adresse')(v)}
            placeholder="Rue, Quartier — ex : Rue Castelnau, Bonamoussadi"
          />
        </div>

        {/* Ville + frais de livraison */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-forge-dark">
            Ville *{errors.ville && <span className="ml-2 font-normal text-red-500">{errors.ville}</span>}
          </label>
          <select
            value={coordonnees.ville}
            onChange={e => set('ville')(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-forge-dark outline-none focus:border-forge-red focus:ring-2 focus:ring-forge-red/10"
          >
            <option value="Douala">Douala</option>
            <option value="Yaounde">Yaoundé</option>
            <option value="Bafoussam">Bafoussam</option>
            <option value="Autres">Autre ville</option>
          </select>
          <p className="mt-1.5 text-xs text-forge-steel">
            Frais de livraison :{' '}
            {frais != null
              ? <span className="font-bold text-forge-dark">{fmt(frais)}</span>
              : <span className="italic">sur devis à la commande</span>
            }
          </p>
        </div>

        {/* Notes */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-forge-dark">
            Instructions livraison (optionnel)
          </label>
          <textarea
            value={coordonnees.notes}
            onChange={e => set('notes')(e.target.value)}
            placeholder="Sonnez deux fois, 2ème étage bâtiment B…"
            rows={3}
            className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-forge-dark outline-none focus:border-forge-red focus:ring-2 focus:ring-forge-red/10"
          />
        </div>
      </div>

      {/* Facture */}
      <div className="rounded-xl border border-gray-200 p-4">
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={coordonnees.veutFacture}
            onChange={e => set('veutFacture')(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 accent-forge-red"
          />
          <div>
            <span className="text-sm font-semibold text-forge-dark">Je souhaite une facture officielle</span>
            <p className="text-[11px] text-forge-steel">Obligatoire si vous utilisez la commande pour votre entreprise</p>
          </div>
        </label>

        <AnimatePresence>
          {coordonnees.veutFacture && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field
                  label="NIU (Numéro d'Identification Unique)"
                  value={coordonnees.niu} onChange={v => set('niu')(v)}
                  placeholder="Ex : M012345678901H"
                />
                <Field
                  label="RCCM (optionnel)"
                  value={coordonnees.rccm} onChange={v => set('rccm')(v)}
                  placeholder="Ex : RC/DLA/2020/B/1234"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Total avec livraison */}
      {frais != null && (
        <div className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
          <span className="text-sm text-blue-700">
            Total TTC avec livraison ({coordonnees.ville})
          </span>
          <span className="text-lg font-black text-blue-800">{fmt(total)}</span>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-5 py-3 text-sm font-semibold text-forge-steel transition hover:border-forge-red hover:text-forge-red"
        >
          <ChevronLeft size={15} /> Retour
        </button>
        <button
          onClick={handleNext}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-forge-red py-3 text-sm font-bold text-white transition hover:bg-forge-red-dark"
        >
          Suivant — Paiement <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}

// ── ÉTAPE 3 — Paiement ─────────────────────────────────────────────────────────

function PaymentCard({
  selected, onClick, emoji, label, description, disabled = false, children,
}: {
  selected: boolean; onClick: () => void; emoji: string
  label: string; description: string; disabled?: boolean
  children?: React.ReactNode
}) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={!disabled ? onClick : undefined}
      onKeyDown={e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick() } }}
      className={`rounded-2xl border-2 p-4 transition-all ${
        selected   ? 'border-forge-red bg-forge-red-light shadow-sm' :
        disabled   ? 'cursor-not-allowed border-gray-100 bg-gray-50 opacity-40' :
                     'cursor-pointer border-gray-200 bg-white hover:border-forge-red/40 hover:shadow-sm'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none">{emoji}</span>
        <div className="flex-1 min-w-0">
          <p className={`font-bold ${selected ? 'text-forge-red' : 'text-forge-dark'}`}>{label}</p>
          <p className="mt-0.5 text-xs text-forge-steel">{description}</p>
          {/* Input à l'intérieur - stopPropagation pour éviter re-sélection */}
          {children && (
            <div onClick={e => e.stopPropagation()}>{children}</div>
          )}
        </div>
        <div className={`mt-0.5 h-4 w-4 flex-shrink-0 rounded-full border-2 transition-all ${
          selected ? 'border-forge-red bg-forge-red' : 'border-gray-300'
        }`} />
      </div>
    </div>
  )
}

function StepPaiement({
  coordonnees, modePaiement, numeroPaiement, setModePaiement,
  setNumeroPaiement, onConfirm, onBack, totals, loading,
}: {
  coordonnees: Coordonnees
  modePaiement: ModePaiement | null
  numeroPaiement: string
  setModePaiement: (m: ModePaiement) => void
  setNumeroPaiement: (n: string) => void
  onConfirm: () => void
  onBack: () => void
  totals: CartTotals
  loading: boolean
}) {
  const frais = FRAIS[coordonnees.ville]
  const total = grandTotal(totals, coordonnees.ville)
  const isDouala = coordonnees.ville === 'Douala'

  const canPay =
    modePaiement !== null &&
    (modePaiement === 'livraison' || numeroPaiement.replace(/\D/g, '').length >= 9)

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black text-forge-dark">Mode de paiement</h2>
        <p className="mt-0.5 text-xs text-forge-steel">Choisissez comment vous souhaitez régler.</p>
      </div>

      <div className="space-y-3">
        {/* MTN Mobile Money */}
        <PaymentCard
          selected={modePaiement === 'mtn'}
          onClick={() => setModePaiement('mtn')}
          emoji="🟡"
          label="MTN Mobile Money"
          description="Vous recevrez un prompt de paiement sur votre téléphone"
        >
          {modePaiement === 'mtn' && (
            <input
              type="tel"
              value={numeroPaiement}
              onChange={e => setNumeroPaiement(e.target.value)}
              placeholder="677 123 456 (préfixes : 677/676/675/674/679)"
              autoFocus
              className="mt-3 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-forge-red focus:ring-2 focus:ring-forge-red/10"
            />
          )}
        </PaymentCard>

        {/* Orange Money */}
        <PaymentCard
          selected={modePaiement === 'orange'}
          onClick={() => setModePaiement('orange')}
          emoji="🟠"
          label="Orange Money"
          description="Vous recevrez un prompt de paiement sur votre téléphone"
        >
          {modePaiement === 'orange' && (
            <input
              type="tel"
              value={numeroPaiement}
              onChange={e => setNumeroPaiement(e.target.value)}
              placeholder="695 123 456 (préfixes : 695/694/693/692/699)"
              autoFocus
              className="mt-3 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-forge-red focus:ring-2 focus:ring-forge-red/10"
            />
          )}
        </PaymentCard>

        {/* Paiement à la livraison */}
        <PaymentCard
          selected={modePaiement === 'livraison'}
          onClick={() => setModePaiement('livraison')}
          emoji="💵"
          label="Paiement à la livraison"
          description={
            isDouala
              ? 'Payez en espèces lors de la réception de votre commande'
              : 'Disponible uniquement pour les livraisons à Douala'
          }
          disabled={!isDouala}
        />
      </div>

      {/* Récapitulatif final */}
      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 space-y-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-forge-steel">Récapitulatif</p>
        <div className="flex justify-between text-sm text-forge-steel">
          <span>Montant HT</span>
          <span>{fmt(totals.ht)}</span>
        </div>
        <div className="flex justify-between text-sm text-forge-steel">
          <span>TVA (19,25%)</span>
          <span>{fmt(totals.tva)}</span>
        </div>
        {frais != null && (
          <div className="flex justify-between text-sm text-forge-steel">
            <span>Livraison ({coordonnees.ville})</span>
            <span>{fmt(frais)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-gray-200 pt-2">
          <span className="font-black text-forge-dark">TOTAL TTC</span>
          <span className="text-xl font-black text-forge-red">{fmt(total)}</span>
        </div>
      </div>

      <div className="space-y-2.5">
        <button
          onClick={onConfirm}
          disabled={!canPay || loading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-forge-red py-4 text-sm font-bold text-white shadow-md transition hover:bg-forge-red-dark disabled:opacity-40 active:scale-[0.98]"
        >
          {loading
            ? <><Loader2 size={15} className="animate-spin" /> Traitement en cours…</>
            : `Confirmer et Payer ${fmt(total)}`
          }
        </button>

        <p className="text-center text-[10px] text-gray-400">
          En validant, vous acceptez nos{' '}
          <Link href="/cgv" className="underline hover:text-forge-red transition-colors">
            Conditions Générales de Vente
          </Link>
        </p>

        <button
          onClick={onBack}
          className="flex w-full items-center justify-center gap-1.5 py-2 text-sm text-forge-steel transition hover:text-forge-red"
        >
          <ChevronLeft size={14} /> Retour aux coordonnées
        </button>
      </div>
    </div>
  )
}

// ── ÉTAPE 4 — Confirmation ─────────────────────────────────────────────────────

function StepConfirmation({
  commandeRef, coordonnees, modePaiement, totals,
}: {
  commandeRef: string
  coordonnees: Coordonnees
  modePaiement: ModePaiement | null
  totals: CartTotals
}) {
  const frais = FRAIS[coordonnees.ville]
  const total = grandTotal(totals, coordonnees.ville)
  const prenom = coordonnees.nom.split(' ')[0]

  const whatsappUrl = `https://wa.me/${(process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '').replace(/\D/g, '')}?text=${encodeURIComponent(
    `Bonjour TAFDIL, je viens de passer la commande *${commandeRef}*.\nPouvez-vous me confirmer la livraison ?`
  )}`

  return (
    <div className="space-y-6 text-center">
      {/* Check animé */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 14 }}
        className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-100"
      >
        <Check size={36} className="text-green-600" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
      >
        <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-forge-steel">
          {commandeRef}
        </p>
        <h2 className="mt-1.5 text-2xl font-black text-forge-dark">
          Merci, {prenom} !
        </h2>
        <p className="mt-2 text-sm text-forge-steel">
          Votre commande a bien été reçue. Notre équipe vous contactera sous 24h pour confirmer la livraison.
        </p>
      </motion.div>

      {/* Récap commande */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45 }}
        className="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-left"
      >
        <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-forge-steel">Détails de la commande</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-[10px] font-semibold uppercase text-gray-400">Montant total</p>
            <p className="font-black text-forge-red">{fmt(total)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase text-gray-400">Paiement</p>
            <p className="font-semibold text-forge-dark">
              {modePaiement ? MODE_LABEL[modePaiement] : '—'}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase text-gray-400">Adresse</p>
            <p className="text-forge-dark">{coordonnees.adresse}, {coordonnees.ville}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase text-gray-400">Délai estimé</p>
            <p className="font-semibold text-forge-dark">2 – 5 jours ouvrés</p>
          </div>
          {frais != null && (
            <div>
              <p className="text-[10px] font-semibold uppercase text-gray-400">Livraison</p>
              <p className="text-forge-dark">{fmt(frais)}</p>
            </div>
          )}
          {coordonnees.telephone && (
            <div>
              <p className="text-[10px] font-semibold uppercase text-gray-400">Contact</p>
              <p className="text-forge-dark">{coordonnees.telephone}</p>
            </div>
          )}
        </div>
      </motion.div>

      {/* Actions */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.65 }}
        className="space-y-3"
      >
        <Link
          href={`/suivi/${commandeRef}`}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-forge-red px-5 py-3 text-sm font-bold text-forge-red transition hover:bg-forge-red hover:text-white"
        >
          Suivre ma commande →
        </Link>

        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-green-200 bg-green-50 py-3 text-sm font-bold text-green-700 transition hover:bg-green-100"
        >
          <MessageCircle size={15} /> Questions ? Contactez-nous sur WhatsApp
        </a>

        <Link
          href="/catalogue"
          className="block py-2 text-sm text-forge-steel transition hover:text-forge-red"
        >
          ← Retourner au catalogue
        </Link>
      </motion.div>
    </div>
  )
}

// ── CheckoutClient — Orchestrateur ─────────────────────────────────────────────

const slideVariants = {
  enter: (d: number) => ({ x: d > 0 ? 60 : -60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit:  (d: number) => ({ x: d > 0 ? -60 : 60, opacity: 0 }),
}

export function CheckoutClient() {
  const [step, setStep] = useState<Step>(1)
  const [direction, setDirection] = useState(1)
  const { items, clearCart, sessionId } = useCartStore()
  const totals = computeTotal(items)

  const [coordonnees, setCoordonnees] = useState<Coordonnees>(DEFAULT_COORDONNEES)
  const [modePaiement, setModePaiement] = useState<ModePaiement | null>(null)
  const [numeroPaiement, setNumeroPaiement] = useState('')
  const [commandeRef, setCommandeRef] = useState('')
  const [loading, setLoading] = useState(false)

  const goTo = (next: Step) => {
    setDirection(next > step ? 1 : -1)
    setStep(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleConfirm = async () => {
    setLoading(true)
    const frais = FRAIS[coordonnees.ville]
    const total = grandTotal(totals, coordonnees.ville)

    // Mapper mode paiement vers valeurs API
    const modeApi =
      modePaiement === 'mtn'    ? 'mtn_momo' :
      modePaiement === 'orange' ? 'orange_money' : 'livraison'

    // Construire notes (inclure infos facture si demandée)
    const notesClient = [
      coordonnees.notes,
      coordonnees.veutFacture && coordonnees.niu
        ? `[FACTURE] NIU: ${coordonnees.niu}${coordonnees.rccm ? ` / RCCM: ${coordonnees.rccm}` : ''}`
        : coordonnees.veutFacture
        ? '[FACTURE DEMANDÉE]'
        : null,
    ].filter(Boolean).join(' — ') || undefined

    try {
      // ── 1. Créer la commande ─────────────────────────────────────────────────
      const orderRes = await fetch(`/api/shop/commandes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_nom:       coordonnees.nom,
          client_telephone: coordonnees.telephone,
          client_email:     coordonnees.email || undefined,
          client_adresse:   coordonnees.adresse,
          client_ville:     coordonnees.ville,
          notes_client:     notesClient,
          frais_livraison:  frais ?? 0,
          mode_paiement:    modeApi,
          lignes: items.map(i => ({
            product_id:    i.id,
            designation:   i.nom,
            quantite:      i.quantite,
            prix_unitaire: i.prix ?? 0,
          })),
        }),
      })

      if (!orderRes.ok) {
        const errJson = await orderRes.json().catch(() => ({})) as Record<string, unknown>
        const code = (errJson as { code?: string }).code
        if (code === 'STOCK_INSUFFISANT') {
          const details = errJson.details as { designation?: string } | undefined
          toast.error(`Stock insuffisant : ${details?.designation ?? 'un article'}`)
        } else {
          toast.error('Erreur lors de la commande. Réessayez.')
        }
        return
      }

      const orderJson = await orderRes.json() as { ref: string }
      const ref = orderJson.ref

      // ── 2. Paiement à la livraison → confirmation directe ────────────────────
      if (modePaiement === 'livraison') {
        clearCart()
        setCommandeRef(ref)
        goTo(4)
        return
      }

      // ── 3. Mobile Money → initialiser le paiement Notchpay ──────────────────
      const payRes = await fetch(`/api/paiements/initier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commande_ref: ref,
          montant:      total,
          telephone:    `237${numeroPaiement.replace(/\D/g, '')}`,
          canal:        modePaiement === 'mtn' ? 'cm.mtn' : 'cm.orange',
          email:        coordonnees.email || 'client@forge.cm',
        }),
      })

      if (!payRes.ok) {
        // Commande créée mais paiement non initié → aller à la confirmation quand même
        toast.warning('Commande créée. Contactez-nous pour le paiement via WhatsApp.')
        clearCart()
        setCommandeRef(ref)
        goTo(4)
        return
      }

      const payJson = await payRes.json() as { payment_reference: string }

      // ── 4. Stocker la session de paiement ────────────────────────────────────
      sessionStorage.setItem('forge-paiement', JSON.stringify({
        commande_ref:        ref,
        payment_reference:   payJson.payment_reference,
        canal:               modePaiement,
        client_nom:          coordonnees.nom,
        montant_total:       total,
        adresse:             `${coordonnees.adresse}, ${coordonnees.ville}`,
        mode_paiement_label: MODE_LABEL[modePaiement!],
      }))

      // ── 5. Naviguer vers la page d'attente (panier gardé jusqu'à confirmation)
      window.location.href =
        `/paiement-en-cours?payment_ref=${payJson.payment_reference}` +
        `&commande_ref=${ref}&canal=${modePaiement}`

    } catch {
      toast.error('Connexion impossible. Contactez-nous via WhatsApp.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      {/* Stepper */}
      <div className="mb-8">
        <Stepper current={step} />
      </div>

      {/* Contenu étape animé */}
      <AnimatePresence mode="wait" custom={direction}>
        <motion.div
          key={step}
          custom={direction}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.22, ease: 'easeInOut' }}
        >
          {step === 1 && (
            <StepPanier onNext={() => goTo(2)} />
          )}
          {step === 2 && (
            <StepCoordonnees
              coordonnees={coordonnees}
              onChange={setCoordonnees}
              onNext={() => goTo(3)}
              onBack={() => goTo(1)}
              totals={totals}
            />
          )}
          {step === 3 && (
            <StepPaiement
              coordonnees={coordonnees}
              modePaiement={modePaiement}
              numeroPaiement={numeroPaiement}
              setModePaiement={m => { setModePaiement(m); setNumeroPaiement('') }}
              setNumeroPaiement={setNumeroPaiement}
              onConfirm={handleConfirm}
              onBack={() => goTo(2)}
              totals={totals}
              loading={loading}
            />
          )}
          {step === 4 && (
            <StepConfirmation
              commandeRef={commandeRef}
              coordonnees={coordonnees}
              modePaiement={modePaiement}
              totals={totals}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </main>
  )
}
