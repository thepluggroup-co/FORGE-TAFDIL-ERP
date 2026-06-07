'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle, AlertCircle, Loader2, ShoppingCart, CreditCard, Smartphone } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface EligibilityCheck {
  eligible:        boolean
  availableCredit: number
  reason?:         string
  details?: {
    accountAgeMonths:     number
    completedOrdersCount: number
    creditLimit:          number
    outstandingBalance:   number
    outstandingRatio:     number
  }
}

interface PendingOrder {
  id:     string
  amount: number
  ref:    string
}

type PaymentMode = 'full' | 'installments_2' | 'installments_3' | 'installments_4'

const NOTCHPAY_PUBLIC_KEY = process.env.NEXT_PUBLIC_NOTCHPAY_PUBLIC_KEY ?? ''
const FORGE_API           = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

function formatXAF(n: number) {
  return new Intl.NumberFormat('fr-CM', { style: 'currency', currency: 'XAF', maximumFractionDigits: 0 }).format(n)
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PaymentOptionsPage() {
  const router = useRouter()

  const [loading, setLoading]         = useState(true)
  const [eligibility, setEligibility] = useState<EligibilityCheck | null>(null)
  const [order, setOrder]             = useState<PendingOrder | null>(null)
  const [mode, setMode]               = useState<PaymentMode>('full')
  const [processing, setProcessing]   = useState(false)
  const [error, setError]             = useState<string | null>(null)

  useEffect(() => {
    async function init() {
      try {
        // Récupérer la commande en attente depuis le sessionStorage
        const raw = sessionStorage.getItem('forge_pending_order')
        if (!raw) { router.push('/panier'); return }
        const pending = JSON.parse(raw) as PendingOrder
        setOrder(pending)

        // Récupérer le token Supabase (shop auth)
        const tokenRaw = document.cookie
          .split('; ')
          .find(r => r.startsWith('forge_shop_token='))
          ?.split('=')[1]

        if (!tokenRaw) { setEligibility({ eligible: false, reason: 'Non connecté' }); return }

        // Obtenir le profil du client connecté
        const profileRes = await fetch('/api/auth/shop/profil', {
          headers: { Authorization: `Bearer ${tokenRaw}` },
        })
        if (!profileRes.ok) throw new Error('Profil introuvable')
        const profile = await profileRes.json() as { id: string }

        // Vérifier l'éligibilité via l'API FORGE
        const eligRes = await fetch(`${FORGE_API}/api/credit/limits/${profile.id}/check`, {
          headers: { Authorization: `Bearer ${tokenRaw}` },
        })
        if (eligRes.ok) {
          const data = await eligRes.json() as EligibilityCheck
          setEligibility(data)
        } else {
          setEligibility({ eligible: false, reason: 'Vérification impossible' })
        }
      } catch (e) {
        setEligibility({ eligible: false, reason: (e as Error).message })
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [router])

  async function handlePay() {
    if (!order) return
    setProcessing(true)
    setError(null)

    try {
      if (mode === 'full') {
        // Paiement comptant via NotchPay
        const res = await fetch('/api/paiements/initier', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            commande_id:  order.id,
            montant_xaf:  order.amount,
            methode:      'notchpay',
            reference:    order.ref,
          }),
        })
        const data = await res.json() as { payment_url?: string; error?: string }
        if (!res.ok || !data.payment_url) throw new Error(data.error ?? 'Erreur initialisation paiement')
        window.location.href = data.payment_url
      } else {
        // Paiement fractionné via FORGE API
        const nInstallments = parseInt(mode.split('_')[1]) as 2 | 3 | 4
        const tokenRaw = document.cookie
          .split('; ')
          .find(r => r.startsWith('forge_shop_token='))
          ?.split('=')[1]

        const res = await fetch(`${FORGE_API}/api/credit/plans`, {
          method:  'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokenRaw}`,
          },
          body: JSON.stringify({
            order_id:              order.id,
            customer_id:           'self', // résolu côté API via JWT
            total_amount:          order.amount,
            installments_count:    nInstallments,
            first_payment_percent: 30,
          }),
        })
        const data = await res.json() as { plan?: { id: string }; error?: string }
        if (!res.ok) throw new Error(data.error ?? 'Erreur création plan')

        sessionStorage.removeItem('forge_pending_order')
        router.push(`/compte/dashboard?plan=${data.plan?.id}&success=1`)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setProcessing(false)
    }
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Vérification des options de paiement…</span>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-xl mx-auto space-y-6">

        {/* Récap commande */}
        {order && (
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <div className="flex items-center gap-3 mb-3">
              <ShoppingCart className="w-5 h-5 text-gray-400" />
              <h2 className="font-semibold text-gray-800">Votre commande</h2>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Référence</span>
              <span className="font-mono font-medium">{order.ref}</span>
            </div>
            <div className="flex justify-between text-sm mt-1">
              <span className="text-gray-500">Montant total</span>
              <span className="font-bold text-lg text-gray-900">{formatXAF(order.amount)}</span>
            </div>
          </div>
        )}

        {/* Options de paiement */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-800 text-lg">Options de paiement</h2>

          {/* Paiement comptant */}
          <label className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors ${mode === 'full' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
            <input type="radio" name="mode" value="full" checked={mode === 'full'} onChange={() => setMode('full')} className="mt-0.5" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-orange-500" />
                <span className="font-semibold text-sm">Paiement comptant</span>
                <span className="ml-auto text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">NotchPay</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">Orange Money · MTN MoMo · Carte bancaire</p>
              <p className="text-sm font-bold text-gray-900 mt-1">{order ? formatXAF(order.amount) : '—'}</p>
            </div>
          </label>

          {/* Options fractionnées — conditionnelles à l'éligibilité */}
          {eligibility?.eligible ? (
            <>
              {([2, 3, 4] as const).map(n => {
                const key  = `installments_${n}` as PaymentMode
                const amt  = order ? Math.ceil(order.amount * 0.3) : 0
                return (
                  <label
                    key={n}
                    className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors ${mode === key ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    <input type="radio" name="mode" value={key} checked={mode === key} onChange={() => setMode(key)} className="mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <CreditCard className="w-4 h-4 text-green-500" />
                        <span className="font-semibold text-sm">{n} versements sans frais</span>
                        <span className="ml-auto text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Crédit TAFDIL</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Acompte aujourd'hui : {order ? formatXAF(amt) : '—'} (30%)
                      </p>
                      {order && (
                        <p className="text-xs text-gray-400">
                          puis {n - 1}× {formatXAF(Math.floor((order.amount - amt) / (n - 1)))} / mois
                        </p>
                      )}
                    </div>
                  </label>
                )
              })}

              <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2">
                <CheckCircle className="w-4 h-4 shrink-0" />
                Crédit disponible : {formatXAF(eligibility.availableCredit)}
              </div>
            </>
          ) : (
            <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-3">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Paiement fractionné non disponible</p>
                <p className="mt-0.5 text-amber-600">{eligibility?.reason ?? 'Conditions non remplies'}</p>
                {eligibility?.details && (
                  <ul className="mt-1 list-disc list-inside space-y-0.5 text-amber-500">
                    <li>Ancienneté : {eligibility.details.accountAgeMonths} mois (min. 3)</li>
                    <li>Commandes livrées : {eligibility.details.completedOrdersCount} (min. 5)</li>
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* CTA */}
        <button
          onClick={handlePay}
          disabled={processing || !order}
          className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-2xl text-sm transition-colors flex items-center justify-center gap-2"
        >
          {processing
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Traitement…</>
            : mode === 'full'
              ? <><Smartphone className="w-4 h-4" /> Payer {order ? formatXAF(order.amount) : ''}</>
              : <><CreditCard className="w-4 h-4" /> Confirmer le plan de paiement</>
          }
        </button>

        <p className="text-center text-xs text-gray-400">
          Paiements sécurisés · TAFDIL SARL · Douala, Cameroun
        </p>
      </div>
    </main>
  )
}
