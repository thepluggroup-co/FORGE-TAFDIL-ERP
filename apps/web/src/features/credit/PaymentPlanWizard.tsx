import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, ChevronRight, ChevronLeft, AlertCircle, Loader2, ShieldPlus } from 'lucide-react'
import { Button, Modal } from '@forge/ui'
import { formatXAF, formatDate } from '@/lib/utils'
import { useEligibilityCheck, useCreatePaymentPlan } from '@/hooks/useCredit'
import type { EligibilityCheck } from '@/hooks/useCredit'
import { CreditLimitForm } from './CreditLimitForm'

interface Props {
  open:       boolean
  orderId:    string
  customerId: string
  orderAmount: number
  orderRef?:  string
  onClose:    () => void
  onCreated:  (planId: string) => void
}

type Step = 1 | 2 | 3

const INSTALLMENT_OPTIONS = [2, 3, 4, 6] as const

function StepIndicator({ current }: { current: Step }) {
  const steps = ['Éligibilité', 'Paramétrage', 'Confirmation']
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {steps.map((label, i) => {
        const n = (i + 1) as Step
        const done    = n < current
        const active  = n === current
        return (
          <React.Fragment key={label}>
            <div className={`flex items-center gap-1.5 text-xs font-medium ${active ? 'text-blue-600' : done ? 'text-green-600' : 'text-gray-400'}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 ${active ? 'border-blue-600 bg-blue-50 text-blue-600' : done ? 'border-green-500 bg-green-50 text-green-600' : 'border-gray-300 text-gray-400'}`}>
                {done ? <CheckCircle className="w-3.5 h-3.5" /> : n}
              </span>
              {label}
            </div>
            {i < 2 && <div className={`flex-1 h-px max-w-10 ${done ? 'bg-green-400' : 'bg-gray-200'}`} />}
          </React.Fragment>
        )
      })}
    </div>
  )
}

export function PaymentPlanWizard({ open, orderId, customerId, orderAmount, orderRef, onClose, onCreated }: Props) {
  const [step, setStep] = useState<Step>(1)
  const [eligibility, setEligibility] = useState<EligibilityCheck | null>(null)
  const [installmentsCount, setInstallmentsCount] = useState<2|3|4|6>(3)
  const [firstPercent, setFirstPercent] = useState(30)
  const [showSetLimit, setShowSetLimit] = useState(false)

  const { check, loading: checkLoading } = useEligibilityCheck(customerId)
  const { create, loading: creating }    = useCreatePaymentPlan()

  // Dates calculées
  const installmentDates = Array.from({ length: installmentsCount }, (_, i) => {
    const d = new Date()
    d.setMonth(d.getMonth() + i)
    return d.toISOString().slice(0, 10)
  })

  const firstAmount    = Math.round(orderAmount * firstPercent / 100)
  const remaining      = orderAmount - firstAmount
  const perInstallment = installmentsCount > 1
    ? Math.floor(remaining / (installmentsCount - 1))
    : remaining
  const lastAdjust     = remaining - perInstallment * (installmentsCount - 1)
  const amounts        = installmentDates.map((_, i) => {
    if (i === 0) return firstAmount
    if (i === installmentsCount - 1) return perInstallment + lastAdjust
    return perInstallment
  })

  // Charger l'éligibilité à l'ouverture
  useEffect(() => {
    if (open && step === 1) {
      check().then(res => { if (res) setEligibility(res) })
    }
  }, [open])

  async function handleCreate() {
    try {
      const result = await create({
        order_id:              orderId,
        customer_id:           customerId,
        total_amount:          orderAmount,
        installments_count:    installmentsCount,
        first_payment_percent: firstPercent,
      })
      onCreated((result.plan as { id: string }).id)
      onClose()
    } catch {
      // toast already shown in hook
    }
  }

  function handleClose() {
    setStep(1)
    setEligibility(null)
    onClose()
  }

  return (
    <Modal isOpen={open} onClose={handleClose} title="Créer un plan de paiement">
      <div className="min-h-[320px] flex flex-col">
        <StepIndicator current={step} />

        <AnimatePresence mode="wait">

          {/* ── Étape 1 : Éligibilité ─────────────────────────────────────── */}
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} className="flex-1 space-y-4">
              <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-500">Commande</span>
                  <span className="font-semibold">{orderRef ?? orderId.slice(0, 8)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Montant total</span>
                  <span className="font-bold text-blue-700">{formatXAF(orderAmount)}</span>
                </div>
              </div>

              {checkLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin" /> Vérification éligibilité…
                </div>
              ) : eligibility ? (
                <div className={`rounded-xl border p-4 space-y-2 ${eligibility.eligible ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                  <div className="flex items-center gap-2">
                    {eligibility.eligible
                      ? <CheckCircle className="w-5 h-5 text-green-600" />
                      : <AlertCircle className="w-5 h-5 text-red-500" />}
                    <span className={`font-semibold text-sm ${eligibility.eligible ? 'text-green-700' : 'text-red-600'}`}>
                      {eligibility.eligible ? 'Client éligible au crédit' : 'Client non éligible'}
                    </span>
                  </div>
                  {!eligibility.eligible && (
                    <>
                      <p className="text-xs text-red-500 ml-7">{eligibility.reason}</p>
                      <button
                        type="button"
                        onClick={() => setShowSetLimit(true)}
                        className="ml-7 flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-800 underline underline-offset-2 transition-colors"
                      >
                        <ShieldPlus className="w-3.5 h-3.5" />
                        Définir un plafond de crédit
                      </button>
                    </>
                  )}
                  {eligibility.eligible && (
                    <div className="ml-7 text-xs text-green-700 space-y-0.5">
                      <p>Crédit disponible : <strong>{formatXAF(eligibility.availableCredit)}</strong></p>
                      <p>Commandes livrées : {eligibility.details.completedOrdersCount}</p>
                      <p>Ancienneté : {eligibility.details.accountAgeMonths} mois</p>
                    </div>
                  )}
                </div>
              ) : null}

              <div className="flex justify-end gap-3 pt-4">
                <Button variant="secondary" onClick={handleClose}>Annuler</Button>
                <Button
                  onClick={() => setStep(2)}
                  disabled={!eligibility?.eligible}
                >
                  Suivant <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* ── Étape 2 : Paramétrage ─────────────────────────────────────── */}
          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} className="flex-1 space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Nombre d'échéances</label>
                <div className="flex gap-2">
                  {INSTALLMENT_OPTIONS.map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setInstallmentsCount(n)}
                      className={`flex-1 py-2 rounded-lg border text-sm font-semibold transition-colors ${installmentsCount === n ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 text-gray-600 hover:border-blue-400'}`}
                    >
                      {n}x
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  1er versement : {firstPercent}% — {formatXAF(firstAmount)}
                </label>
                <input
                  type="range" min={0} max={100} step={5} value={firstPercent}
                  onChange={e => setFirstPercent(parseInt(e.target.value))}
                  className="w-full accent-blue-600"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                  <span>0 %</span><span>50 %</span><span>100 %</span>
                </div>
              </div>

              {/* Aperçu échéances */}
              <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
                {installmentDates.map((d, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className="text-gray-500">Échéance {i + 1} — {d}</span>
                    <span className="font-semibold text-gray-700">{formatXAF(amounts[i])}</span>
                  </div>
                ))}
                <div className="pt-1 border-t border-gray-200 flex justify-between text-xs font-bold">
                  <span>Total</span>
                  <span className="text-blue-700">{formatXAF(orderAmount)}</span>
                </div>
              </div>

              <div className="flex justify-between gap-3 pt-2">
                <Button variant="secondary" onClick={() => setStep(1)}>
                  <ChevronLeft className="w-4 h-4 mr-1" /> Retour
                </Button>
                <Button onClick={() => setStep(3)}>
                  Suivant <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* ── Étape 3 : Confirmation ────────────────────────────────────── */}
          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} className="flex-1 space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2 text-sm">
                <h4 className="font-semibold text-blue-800">Récapitulatif du plan</h4>
                <div className="flex justify-between text-gray-700">
                  <span>Montant total</span>
                  <span className="font-bold">{formatXAF(orderAmount)}</span>
                </div>
                <div className="flex justify-between text-gray-700">
                  <span>Nombre d'échéances</span>
                  <span className="font-bold">{installmentsCount}</span>
                </div>
                <div className="flex justify-between text-gray-700">
                  <span>1er versement</span>
                  <span className="font-bold">{formatXAF(firstAmount)} ({firstPercent}%)</span>
                </div>
                <div className="pt-2 border-t border-blue-200 space-y-1">
                  {installmentDates.map((d, i) => (
                    <div key={i} className="flex justify-between text-xs text-blue-700">
                      <span>{i + 1}. {d}</span>
                      <span>{formatXAF(amounts[i])}</span>
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-xs text-gray-500">
                Un SMS de confirmation sera envoyé au client après validation.
              </p>

              <div className="flex justify-between gap-3 pt-2">
                <Button variant="secondary" onClick={() => setStep(2)}>
                  <ChevronLeft className="w-4 h-4 mr-1" /> Retour
                </Button>
                <Button onClick={handleCreate} disabled={creating} loading={creating}>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Créer le plan
                </Button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* Plafond inline — s'ouvre par dessus le wizard */}
      <CreditLimitForm
        open={showSetLimit}
        customerId={customerId}
        onClose={() => setShowSetLimit(false)}
        onSaved={() => {
          setShowSetLimit(false)
          check().then(res => { if (res) setEligibility(res) })
        }}
      />
    </Modal>
  )
}
